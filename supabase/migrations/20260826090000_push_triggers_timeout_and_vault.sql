-- Endurece los caminos de push. Todo es aditivo: ni un DROP.
--
-- Dos problemas distintos, los dos del mismo dia:
--
-- 1. TIMEOUT. Ninguna de las funciones de push pasa timeout_milliseconds, asi que
--    usan el default de pg_net: 5000 ms. Ese modo de fallo YA ocurrio hoy
--    (26-ago 06:00:03 UTC, net._http_response con timed_out = true y
--    "Timeout of 5000 ms reached", mientras la funcion respondia 200 a los
--    6100 ms). Un arranque en frio de send-push supera 5 s con normalidad.
--    20260826061500 subio los 3 jobs de pg_cron a 30000 ms y dejo los triggers
--    fuera; esto cierra ese hueco.
--
--    Lo insidioso es que un timeout de pg_net NO cancela la Edge Function: sigue
--    corriendo del lado del servidor. Lo unico que se pierde es saber si
--    termino — o sea, mas trabajo cuyo resultado nadie observa.
--
-- 2. UN JWT service_role EN TEXTO PLANO DENTRO DEL CATALOGO. El trigger
--    "push-on-booking" sobre public.bookings era un Database Webhook del
--    Dashboard, con el Bearer completo escrito en pg_trigger.tgargs. Cualquier
--    pg_dump, snapshot o diff de esquema se lo lleva, y esa llave salta TODA la
--    seguridad por fila del proyecto. La descripcion en vault.secrets dice
--    "rotado 2026-07": la rotacion no alcanzo a este trigger, porque un literal
--    dentro del catalogo no se entera de las rotaciones. Se sustituye por una
--    funcion que lee de Vault en cada disparo, como las otras tres.
--
-- NO SE TOCA AQUI, a proposito: sale_confirmations tiene DOS triggers de push
-- (on_sale_confirmation_inserted -> notify_push y push_on_sale_pgnet ->
-- call_send_push_on_sale) que mandan el mismo POST, asi que cada venta dispara
-- dos notificaciones. Quitar el sobrante exige DROP, y eso necesita el visto
-- bueno de Pedro. Hoy es latente: cero ventas en la base.

-- ---------------------------------------------------------------------------
-- 1. Las tres funciones que ya leen de Vault, ahora con timeout.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_send_push_on_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault; skipping push for message id=%', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'type', 'INSERT', 'table', 'messages', 'schema', 'public',
      'record', to_jsonb(NEW), 'old_record', null
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for message id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.call_send_push_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault; skipping push for sale id=%', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'type', 'INSERT', 'table', 'sale_confirmations', 'schema', 'public',
      'record', to_jsonb(NEW), 'old_record', null
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for sale id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.call_send_push_on_appointment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault; skipping push for appointment id=%', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'type', 'INSERT', 'table', 'appointments', 'schema', 'public',
      'record', to_jsonb(NEW), 'old_record', null
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for appointment id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Saca el JWT del catalogo: "push-on-booking" pasa a leer de Vault.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.call_send_push_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault; skipping push for booking id=%', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'type', 'INSERT', 'table', 'bookings', 'schema', 'public',
      'record', to_jsonb(NEW), 'old_record', null
    ),
    timeout_milliseconds := 30000
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for booking id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.call_send_push_on_booking() IS
  'Sustituye al Database Webhook "push-on-booking", que llevaba el JWT service_role escrito en pg_trigger.tgargs. OJO: send-push solo acepta messages, appointments y sale_confirmations, asi que hoy este POST recibe 400. El valor de esta migracion es sacar la llave del catalogo, no revivir el push de bookings.';

-- CREATE OR REPLACE TRIGGER (PG 14+) sustituye la definicion sin un DROP, y con
-- ella desaparece el literal del JWT.
CREATE OR REPLACE TRIGGER "push-on-booking"
AFTER INSERT ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.call_send_push_on_booking();

-- VERIFY:
--   1. Ya no hay ningun JWT en el catalogo de triggers:
--      SELECT count(*) FROM pg_trigger
--      WHERE NOT tgisinternal AND encode(tgargs,'escape') LIKE '%eyJ%';
--      -- esperado: 0
--
--   2. Las cuatro funciones llevan timeout:
--      SELECT proname, prosrc LIKE '%timeout_milliseconds%' AS tiene_timeout
--      FROM pg_proc WHERE proname LIKE 'call_send_push%';
--      -- esperado: las cuatro en true
--
--   3. notify_push sigue SIN timeout y SIN search_path fijado, a proposito: es la
--      que sobra en sale_confirmations y esta pendiente de que Pedro apruebe su
--      DROP. Si se decide conservarla, hay que endurecerla igual.
