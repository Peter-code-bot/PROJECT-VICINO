-- El ultimo cron job que vivia solo en produccion, sin migracion que lo cree.
--
-- Item 136 de Notion. Eran dos: purge-verification-documents-hourly quedo
-- respaldado por 20260826061500 al ponerle el timeout, y este era el otro.
--
-- expire-purchase-requests es el unico de los cuatro que NUNCA estuvo roto, y no
-- por casualidad: es SQL directo contra la base, no un net.http_post a una Edge
-- Function. No pasa por pg_net, asi que no le aplican ni el timeout de 5000 ms ni
-- la ceguera de net._http_response que tumbo a los otros tres. Es un buen
-- recordatorio de que el trabajo que puede quedarse dentro de la base deberia
-- quedarse dentro de la base.
--
-- Correrlo es idempotente y no cambia nada en produccion: cron.schedule con un
-- jobname existente reemplaza su definicion por la misma que ya tiene. El valor
-- es que un entorno nuevo levantado desde supabase/migrations tenga los cuatro
-- jobs, no tres.

DO $$
BEGIN
  PERFORM cron.unschedule('expire-purchase-requests');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job" si aun no existe.
  NULL;
END $$;

SELECT cron.schedule(
  'expire-purchase-requests',
  '*/15 * * * *',
  $job$
  UPDATE purchase_requests
     SET status = 'expired'
   WHERE status = 'open'
     AND expires_at <= NOW()
  $job$
);

-- VERIFY:
--   SELECT jobname, schedule, active FROM cron.job ORDER BY jobname;
--   -- esperado: los 5 jobs activos, con expire-purchase-requests cada 15 min
--
--   Y que ninguno queda ya sin respaldo en el repo:
--     grep -l "cron.schedule" supabase/migrations/*.sql
