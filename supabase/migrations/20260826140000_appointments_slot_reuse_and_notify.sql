-- Agendar cita: el horario se quedaba bloqueado para siempre, y nadie recibia aviso.
--
-- DOS PROBLEMAS DISTINTOS.
--
-- 1. EL HORARIO NO SE LIBERA AL CANCELAR.
--    appointments_product_id_appointment_date_appointment_start_key es
--    UNIQUE (product_id, appointment_date, appointment_start) sin mirar `status`.
--    Cuando una cita se cancela, la fila se queda con status='cancelled' y ese
--    horario queda muerto: el selector del agendador lo muestra libre (filtra por
--    status='confirmed') y el INSERT revienta con 23505. Para el comprador es un
--    boton que no hace nada, y para el vendedor un hueco que ya no puede vender.
--
--    Ya estaba diagnosticado en las notas del proyecto — "needs follow-up partial
--    index" — asi que aqui se ejecuta esa decision, no se inventa una nueva.
--
--    Sustituir un UNIQUE exige quitar el viejo: es lo unico de esta migracion que
--    borra un objeto. Va dentro de la transaccion de la migracion, el indice
--    nuevo se crea acto seguido, y la invariante que protege queda MAS estricta,
--    no menos: sigue prohibiendo dos citas vivas en el mismo hueco, y ademas deja
--    de castigar a las canceladas.
--
--    Se excluye solo 'cancelled'. Una cita 'completed' ocupo ese hueco de verdad
--    y debe seguir bloqueandolo. Valores posibles segun appointments_status_check:
--    confirmed, cancelled, completed.
--
-- 2. LAS NOTIFICACIONES NUNCA SE CREARON.
--    El agendador insertaba dos filas en `notifications` desde el navegador, y esa
--    tabla tiene RLS con solo dos policies (ver y actualizar las propias): NO hay
--    ninguna de INSERT. Cada agendamiento moria con 42501, descartado por un
--    `await` sin comprobar. Ni el comprador ni el vendedor se enteraban nunca.
--
--    Se mueve al servidor, que es donde debia estar: un trigger AFTER INSERT
--    SECURITY DEFINER, el mismo patron de notify_new_review y
--    notify_sale_confirmation_created. Asi el aviso no depende de que el cliente
--    tenga permiso ni de que la pestaña siga abierta.

-- ---------------------------------------------------------------------------
-- 1. UNIQUE parcial
-- ---------------------------------------------------------------------------

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_product_id_appointment_date_appointment_start_key;

CREATE UNIQUE INDEX IF NOT EXISTS appointments_slot_activo_uniq
  ON public.appointments (product_id, appointment_date, appointment_start)
  WHERE status <> 'cancelled';

COMMENT ON INDEX public.appointments_slot_activo_uniq IS
  'Un hueco solo lo bloquea una cita VIVA. Sustituye al UNIQUE que ignoraba el status y dejaba el horario muerto tras cancelar.';

-- ---------------------------------------------------------------------------
-- 2. Aviso a las dos partes, desde el servidor
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_appointment_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_titulo text;
  v_cuando text;
BEGIN
  SELECT titulo INTO v_titulo
    FROM public.products_services WHERE id = NEW.product_id;

  v_titulo := COALESCE(v_titulo, 'la publicacion');
  v_cuando := to_char(NEW.appointment_date, 'DD/MM') || ' a las ' ||
              to_char(NEW.appointment_start, 'HH12:MI AM');

  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, data, leida, created_at)
  VALUES
    (NEW.buyer_id, 'cita_agendada', 'Cita agendada',
     v_titulo || ' el ' || v_cuando,
     jsonb_build_object('appointment_id', NEW.id,
                        'appointment_date', NEW.appointment_date,
                        'appointment_start', NEW.appointment_start),
     false, NOW()),
    (NEW.seller_id, 'cita_agendada', 'Nueva cita agendada',
     'Agendaron "' || v_titulo || '" el ' || v_cuando,
     jsonb_build_object('appointment_id', NEW.id,
                        'appointment_date', NEW.appointment_date,
                        'appointment_start', NEW.appointment_start),
     false, NOW());

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Se traga el error a proposito: que falle el aviso no puede deshacer una cita
  -- que la persona ya dio por agendada. Queda en el log de Postgres.
  RAISE WARNING 'no se pudo notificar la cita id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.appointments'::regclass
      AND tgname  = 'on_appointment_created_notify'
  ) THEN
    CREATE TRIGGER on_appointment_created_notify
      AFTER INSERT ON public.appointments
      FOR EACH ROW
      EXECUTE FUNCTION public.notify_appointment_created();
  END IF;
END
$do$;

-- VERIFY:
--   1. El hueco se libera al cancelar (transaccion revertida):
--      BEGIN;
--        UPDATE public.appointments SET status='cancelled' WHERE id='<id>';
--        -- reinsertar el MISMO hueco ahora debe funcionar
--      ROLLBACK;
--
--   2. El indice viejo ya no esta y el nuevo si:
--      SELECT indexname FROM pg_indexes
--      WHERE tablename='appointments' AND indexdef ILIKE '%unique%';
--
--   3. Agendar crea dos notificaciones (transaccion revertida):
--      BEGIN;
--        INSERT INTO public.appointments (...) VALUES (...);
--        SELECT user_id, titulo FROM public.notifications
--        ORDER BY created_at DESC LIMIT 2;   -- comprador y vendedor
--      ROLLBACK;
