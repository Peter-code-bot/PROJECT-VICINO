-- Dale a los tres cron HTTP un timeout que alcance para un arranque en frio.
--
-- net.http_post usa 5000 ms por defecto cuando no se pasa timeout_milliseconds.
-- Una Edge Function que lleva horas inactiva tarda mas que eso solo en levantar
-- el isolate, asi que el disparo muere antes de recibir respuesta.
--
-- Observado el 26-ago-2026 06:00:03 UTC, en el primer disparo de
-- expire-confirmations-6h despues de arreglar la autenticacion:
--   status_code = NULL, timed_out = true,
--   error_msg  = "Timeout of 5000 ms reached. Total time: 5000.301000 ms
--                 (DNS 0.029 ms, TCP/SSL handshake -0.029 ms,
--                  HTTP Request/Response 5000.173 ms)"
-- El handshake fue instantaneo: los 5 segundos se fueron enteros esperando a
-- que la funcion respondiera. No es red, es arranque en frio.
--
-- Un timeout de pg_net NO cancela la Edge Function: esta sigue corriendo del
-- lado del servidor. Lo que se pierde es saber si termino bien. Es decir, el
-- sintoma es exactamente el mismo que veniamos arrastrando — trabajo cuyo
-- resultado nadie observa.
--
-- 30 s deja margen de sobra: la mas pesada (purge-verification-documents) se
-- autolimita con MAX_ROWS_PER_RUN justamente para no acercarse al reloj de
-- pared de las Edge Functions.
--
-- send-appointment-reminders respondio en menos de 5 s hoy (200 a las 06:00:00),
-- pero eso fue con el isolate caliente. Se incluye igual: la diferencia entre
-- las tres es cuando les toca el arranque en frio, no si les toca.
--
-- Idempotente: mismo patron unschedule-dentro-de-DO que
-- 20260531000001_pg_cron_schedules.sql.

DO $$
DECLARE
  nombre text;
BEGIN
  FOREACH nombre IN ARRAY ARRAY[
    'expire-confirmations-6h',
    'purge-verification-documents-hourly',
    'send-appointment-reminders'
  ] LOOP
    BEGIN
      PERFORM cron.unschedule(nombre);
    EXCEPTION WHEN OTHERS THEN
      -- "could not find valid entry for job" si aun no existe.
      NULL;
    END;
  END LOOP;
END $$;

SELECT cron.schedule(
  'expire-confirmations-6h',
  '0 */6 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/expire-confirmations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $job$
);

SELECT cron.schedule(
  'purge-verification-documents-hourly',
  '7 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/purge-verification-documents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $job$
);

SELECT cron.schedule(
  'send-appointment-reminders',
  '*/30 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-appointment-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  ) AS request_id;
  $job$
);

-- VERIFY (tras el siguiente disparo de cada job; los tres deben dar 200):
--   SELECT to_char(created,'HH24:MI:SS') AS hora,
--          coalesce(status_code::text,'NULL') AS codigo,
--          timed_out, coalesce(error_msg,'-') AS error, content
--   FROM net._http_response
--   WHERE created > now() - interval '7 hours'
--   ORDER BY created DESC;
--
-- Y que los tres quedaron con timeout explicito:
--   SELECT jobname, command LIKE '%timeout_milliseconds%' AS tiene_timeout
--   FROM cron.job WHERE command LIKE '%http_post%';
