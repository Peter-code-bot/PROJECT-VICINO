-- Arregla la autenticacion del cron send-appointment-reminders.
--
-- El job construia el header Authorization con el secreto del vault
-- 'service_role_key', pero supabase/functions/send-appointment-reminders/index.ts
-- compara el bearer contra Deno.env.get("CRON_SECRET"). Nunca coincidieron, asi
-- que cada disparo recibia 401 {"ok":false,"error":"unauthorized"}.
--
-- Los otros dos jobs HTTP (expire-confirmations-6h, purge-verification-documents-hourly)
-- ya leen 'cron_secret'. Este quedo fuera de ese patron.
--
-- Por que nadie lo noto: pg_cron registra el job como "succeeded" en cuanto
-- net.http_post ENCOLA la peticion. Nunca mira la respuesta. El 401 vivia en
-- net._http_response, tabla que nada del sistema consulta. Los recordatorios de
-- cita llevaban sin enviarse desde que se creo el job.
--
-- Reactivar es seguro y no provoca avalancha: la funcion solo mira citas que
-- empiezan dentro de 23-25 horas (o 45-75 minutos), y marca reminder_1d_sent /
-- reminder_1h_sent, asi que no puede repetir ni alcanzar citas pasadas.
--
-- Idempotente: mismo patron que 20260531000001_pg_cron_schedules.sql.

DO $$
BEGIN
  PERFORM cron.unschedule('send-appointment-reminders');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job" si el job no existe.
  NULL;
END $$;

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
    body := '{}'::jsonb
  ) AS request_id;
  $job$
);

-- VERIFY (correr ~30 min despues de aplicar; debe devolver 200, no 401):
--   SELECT created, status_code, content
--   FROM net._http_response
--   WHERE created > now() - interval '35 minutes'
--   ORDER BY created DESC;
--
-- Y para confirmar que el job quedo con el secreto correcto:
--   SELECT jobname, command LIKE '%cron_secret%' AS usa_cron_secret
--   FROM cron.job WHERE jobname = 'send-appointment-reminders';
