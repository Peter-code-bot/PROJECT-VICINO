-- El flujo de dinero esta roto de fabrica: `authenticated` no puede escribir en
-- sale_confirmations.
--
-- Verificado contra produccion el 26-ago-2026:
--   SELECT relacl FROM pg_class WHERE oid = 'public.sale_confirmations'::regclass;
--     -> authenticated=arxtm/postgres
--        a=INSERT r=SELECT x=REFERENCES t=TRIGGER m=MAINTAIN. Falta w=UPDATE.
--   SELECT has_table_privilege('authenticated','public.sale_confirmations','UPDATE');
--     -> false
--   Grants por columna que lo compensen: ninguno (0 filas en pg_attribute.attacl).
--
-- La policy "Participants can confirm or cancel" (FOR UPDATE) existe desde
-- 20260320000007_sale_confirmations.sql, pero el GRANT nunca se escribio en
-- ninguna migracion. RLS lista, privilegio ausente: TODO confirmSale y TODO
-- cancelSale mueren con "42501 permission denied for table sale_confirmations".
--
-- Es la tercera vez con el mismo patron en este proyecto — modo_precio,
-- sort_order y ahora esto — y la primera que cae sobre el flujo de dinero. Sigue
-- latente porque sale_confirmations tiene 0 filas: reventaria en la primera venta
-- real, que es el peor momento posible para descubrirlo.

-- ---------------------------------------------------------------------------
-- 1. GRANT por columna
--
-- Se sigue la convencion de products_services: columna por columna, nunca a
-- nivel de tabla, para acotar exactamente que puede escribir el cliente.
--
--   confirmSale -> buyer_confirmed, buyer_confirmed_at,
--                  seller_confirmed, seller_confirmed_at
--   cancelSale  -> status, cancelled_at, cancelled_by, cancel_reason
--
-- updated_at y completed_at NO llevan GRANT: los fijan triggers BEFORE
-- (sale_confirmations_updated_at, complete_sale_on_mutual_confirm) y no entran
-- en la lista SET del statement, que es sobre la que Postgres comprueba el
-- privilegio por columna.
--
-- buyer_id, seller_id, product_id, precio_acordado, cantidad, metodo_pago,
-- notas, tipo_entrega, initiated_by y chat_id quedan FUERA a proposito: sin
-- UPDATE por columna son inmutables para el cliente por privilegio, sin depender
-- de ninguna policy.
-- ---------------------------------------------------------------------------

GRANT UPDATE (
  buyer_confirmed,
  buyer_confirmed_at,
  seller_confirmed,
  seller_confirmed_at,
  status,
  cancelled_at,
  cancelled_by,
  cancel_reason
) ON public.sale_confirmations TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guard de integridad, inseparable del GRANT de arriba.
--
-- La policy "Participants can confirm or cancel" tiene USING pero NO WITH CHECK,
-- y WITH CHECK tampoco puede mirar OLD. Sin este guard, el GRANT deja tres
-- puertas abiertas a cualquiera de las dos partes:
--
--   1. Poner buyer_confirmed y seller_confirmed en TRUE en el mismo statement:
--      complete_sale_on_mutual_confirm dispara, la venta se marca completada sin
--      que la contraparte confirme, y se reparten trust_points, ventas_count y
--      se habilita la resena.
--   2. Escribir status = 'completed' directo, saltandose el trigger.
--   3. Cancelar poniendo cancelled_by = la contraparte, para que
--      on_sale_cancellation le descuente los trust_points a ella.
--
-- Un trigger BEFORE si ve OLD, asi que la regla se expresa aqui.
--
-- El prefijo 'aa_' del nombre NO es decorativo: los triggers BEFORE ROW disparan
-- en orden alfabetico, y este tiene que correr ANTES que
-- complete_sale_on_mutual_confirm. Si corriera despues veria el 'completed'
-- legitimo que ese trigger acaba de fijar y abortaria todas las ventas.
-- Comprobado el orden actual: complete_sale_on_mutual_confirm es hoy el primero.
--
-- Fail-open cuando auth.uid() es NULL: las escrituras del backend (service_role,
-- pg_cron marcando 'expired', migraciones) pasan intactas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_sale_confirmation_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'completed' THEN
    RAISE EXCEPTION
      'sale_confirmations: status completed solo lo fija la confirmacion mutua'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NEW.buyer_confirmed, false)
     AND NOT COALESCE(OLD.buyer_confirmed, false)
     AND v_actor <> OLD.buyer_id THEN
    RAISE EXCEPTION
      'sale_confirmations: solo el comprador puede confirmar su lado'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(NEW.seller_confirmed, false)
     AND NOT COALESCE(OLD.seller_confirmed, false)
     AND v_actor <> OLD.seller_id THEN
    RAISE EXCEPTION
      'sale_confirmations: solo el vendedor puede confirmar su lado'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status = 'cancelled'
     AND NEW.cancelled_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION
      'sale_confirmations: cancelled_by debe ser quien cancela'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.guard_sale_confirmation_client_update() IS
  'Acompana al GRANT UPDATE por columna de sale_confirmations: impide que una de las partes complete la venta sola, fije status=completed a mano, o cancele imputando cancelled_by a la contraparte. Fail-open cuando auth.uid() es NULL.';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.sale_confirmations'::regclass
      AND tgname  = 'aa_guard_sale_confirmation_client_update'
  ) THEN
    CREATE TRIGGER aa_guard_sale_confirmation_client_update
      BEFORE UPDATE ON public.sale_confirmations
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_sale_confirmation_client_update();
  END IF;
END
$do$;

-- VERIFY:
--   Las 8 columnas escribibles en true:
--     SELECT c, has_column_privilege('authenticated','public.sale_confirmations',c,'UPDATE')
--     FROM unnest(ARRAY['buyer_confirmed','buyer_confirmed_at','seller_confirmed',
--                       'seller_confirmed_at','status','cancelled_at',
--                       'cancelled_by','cancel_reason']) AS c;
--
--   Las inmutables en false:
--     SELECT c, has_column_privilege('authenticated','public.sale_confirmations',c,'UPDATE')
--     FROM unnest(ARRAY['buyer_id','seller_id','product_id','precio_acordado',
--                       'cantidad','initiated_by','chat_id']) AS c;
--
--   Y el guard PRIMERO en el orden alfabetico:
--     SELECT tgname FROM pg_trigger
--     WHERE tgrelid='public.sale_confirmations'::regclass AND NOT tgisinternal
--     ORDER BY tgname;
