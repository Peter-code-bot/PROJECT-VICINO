-- Reversion de 20260925010000_chat_producto_y_venta_atomica (S04), SIN perder datos.
--
-- Vive en docs/rollback/ y NO en supabase/migrations/ a proposito: nada debe
-- aplicarla en una replica. Se corre a mano y SIEMPRE junto con la reversion
-- del codigo: volver a servir el cliente anterior (4b6be86, el que produccion
-- tenia antes de S04) con Vercel -> Deployments -> Promote/Instant Rollback.
-- Ese cliente escribe directo en sale_confirmations y en chats.ultimo_producto_id;
-- esta reversion le devuelve exactamente esos permisos y la guarda que tenia.
--
-- Que conserva: TODAS las filas. Tambien deja en su sitio las columnas
-- (chats.producto_revision, sale_confirmations.clave_idempotencia/producto_revision),
-- los indices, el trigger de revision y las tres RPC: el cliente viejo no los
-- usa y no le estorban, y borrarlos perderia las claves de idempotencia.
--
-- Que NO hace: borrar la version del ledger. Las columnas siguen ahi, asi que
-- reaplicar el archivo entero fallaria en ADD COLUMN. Para volver a activar S04
-- basta con re-ejecutar su bloque de ACL (desde "CREATE OR REPLACE FUNCTION
-- public.guard_sale_confirmation_client_update" hasta el DO $verify$).
--
-- Verificada en staging el 26-sep-2026 (scripts/staging): tras correrla, el
-- cliente viejo vuelve a poder INSERTar la venta y confirmar su lado.

begin;

-- 1. La guarda de sale_confirmations vuelve a la version de produccion previa a S04.
CREATE OR REPLACE FUNCTION public.guard_sale_confirmation_client_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$

;

-- 2. Permisos que el cliente viejo usa y S04 retiro.
grant update (ultimo_producto_id) on public.chats to authenticated;
grant insert (buyer_id, cantidad, chat_id, initiated_by, metodo_pago, notas,
              precio_acordado, product_id, seller_id, tipo_entrega)
  on public.sale_confirmations to authenticated;
grant update (buyer_confirmed, buyer_confirmed_at, seller_confirmed, seller_confirmed_at)
  on public.sale_confirmations to authenticated;

-- 3. Comprobacion: si falta algo, no se confirma nada.
do $verify$
begin
  if not has_column_privilege('authenticated', 'public.chats', 'ultimo_producto_id', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.sale_confirmations', 'product_id', 'INSERT')
     or not has_column_privilege('authenticated', 'public.sale_confirmations', 'buyer_confirmed', 'UPDATE') then
    raise exception 'La reversion de S04 no devolvio los permisos del cliente anterior';
  end if;
end;
$verify$;

commit;
