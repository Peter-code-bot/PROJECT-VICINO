-- Retención automática de documentos de verificación (Aviso de Privacidad §15).
--
-- §15 promete que los DOCUMENTOS se eliminan cuando la verificación se
-- resuelve. La FILA de seller_verification se conserva a propósito: es el
-- registro de que la verificación ocurrió. Esta migración añade:
--
--   1. verification_document_purge_log -- la única prueba durable de que el
--      borrado ocurrió. Los logs de consola de una Edge Function expiran; una
--      auditoría de §15 necesita algo que no.
--   2. El cron horario que dispara la Edge Function purge-verification-documents.
--
-- NO se aplica con `supabase db push`. El ledger tiene 33 versiones contra 93
-- archivos de migración, así que un push intentaría aplicar ~60 migraciones no
-- idempotentes contra producción. Copiar y pegar este archivo en el SQL Editor.
--
-- Patrón de cron copiado tal cual de 20260531000001_pg_cron_schedules.sql:
-- pg_net + el secreto 'cron_secret' del Vault. Nota: de los tres cron jobs
-- vivos solo dos usan ese patrón; 'expire-purchase-requests'
-- (20260710000001_purchase_requests.sql:309) es SQL puro y no llama a ninguna
-- Edge Function, por lo que no sirve de modelo aquí.

-- =========================================================================
-- 1. Tabla de log de cumplimiento
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.verification_document_purge_log (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  run_at        TIMESTAMPTZ NOT NULL,
  -- resolved: la fila se resolvió y todavía traía URLs -> se limpiaron y se
  --           borraron sus archivos.
  -- leftover: la fila ya estaba limpia (status resuelto, URLs en NULL) pero
  --           quedaban archivos sueltos en su prefijo. Es la red de seguridad
  --           del orden "URLs primero, archivos después": si la corrida
  --           anterior murió entre los dos pasos, estos son los archivos que
  --           quedaron sin ninguna URL apuntándolos.
  -- orphan:   prefijo sin ninguna fila en seller_verification, más viejo que
  --           el umbral de retención.
  phase         TEXT NOT NULL CHECK (phase IN ('resolved', 'leftover', 'orphan')),
  -- NULL en la pasada de huérfanos: ahí justamente no hay fila que consultar.
  -- Sin FK a auth.users por el mismo motivo -- el prefijo de abril-2026 que
  -- motivó la pasada 2 pertenece a una cuenta que ya no existe, y una FK
  -- impediría registrar precisamente ese borrado.
  user_id       UUID,
  storage_prefix TEXT NOT NULL,
  deleted_paths TEXT[] NOT NULL DEFAULT '{}',
  deleted_count INT NOT NULL DEFAULT 0,
  verification_status TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vdpl_run_at
  ON public.verification_document_purge_log (run_at DESC);
CREATE INDEX IF NOT EXISTS idx_vdpl_user_id
  ON public.verification_document_purge_log (user_id)
  WHERE user_id IS NOT NULL;

-- GRANTs: deliberadamente NINGUNO para `authenticated`.
--
-- La regla del proyecto ("toda columna nueva lleva su GRANT para authenticated
-- en la misma migración", la lección de modo_precio) existe porque una columna
-- sin GRANT mata la escritura del cliente con 42501 en silencio. Aquí no
-- aplica: ningún código de cliente lee ni escribe esta tabla. La escribe solo
-- la Edge Function con SB_SECRET_KEY (service_role, que ignora RLS y GRANTs), y
-- la lectura de auditoría se hace desde el SQL Editor o con createAdminClient().
-- Dar SELECT a `authenticated` expondría a cada usuario el historial de
-- documentos de todos los demás, que es lo contrario de lo que §15 promete.
--
-- RLS activo sin ninguna política = deny-all para anon/authenticated. Es la
-- postura explícita, no un descuido.
ALTER TABLE public.verification_document_purge_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.verification_document_purge_log FROM anon, authenticated;

COMMENT ON TABLE public.verification_document_purge_log IS
  'Prueba de cumplimiento del Aviso de Privacidad §15: qué documentos de verificación se borraron y cuándo. Escrita solo por la Edge Function purge-verification-documents (service_role). Sin acceso para anon/authenticated a propósito.';

-- =========================================================================
-- 2. Cron horario
-- =========================================================================
-- Ambas extensiones ya están activas desde 20260531000001; los
-- CREATE ... IF NOT EXISTS son no-ops idempotentes y se repiten aquí para que
-- este archivo se pueda aplicar solo.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule('purge-verification-documents-hourly');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job ..." en la primera aplicación.
  NULL;
END $$;

SELECT cron.schedule(
  'purge-verification-documents-hourly',
  '7 * * * *',  -- minuto 7: fuera de la punta en :00 que comparten los otros jobs
  $$
  SELECT net.http_post(
    url := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/purge-verification-documents',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'
      )
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- =========================================================================
-- VERIFY (correr a mano en el SQL Editor después de aplicar):
--
--   -- a) el job quedó registrado y activo
--   SELECT jobid, schedule, jobname, active FROM cron.job
--    WHERE jobname = 'purge-verification-documents-hourly';
--   -- esperado: 1 fila, active = true.
--
--   -- b) el secreto del Vault existe (mismo que usan los otros dos jobs).
--   --    Si falta, el job se registra igual pero cada disparo recibe 401.
--   SELECT name FROM vault.decrypted_secrets WHERE name = 'cron_secret';
--   -- esperado: 1 fila.
--
--   -- c) después del primer disparo
--   SELECT status_code, content::text, created
--     FROM net._http_response ORDER BY created DESC LIMIT 5;
--   -- esperado: 200 con ok=true y los contadores resolved_rows_purged /
--   -- orphan_prefixes_purged / files_deleted.
--
--   -- d) la prueba de cumplimiento
--   SELECT run_at, phase, storage_prefix, deleted_count, error
--     FROM public.verification_document_purge_log
--    ORDER BY run_at DESC LIMIT 20;
--
-- ESTADO ACTUAL ESPERADO: el bucket quedó en 0 archivos tras el borrado
-- manual del 24-ago-2026 y las 3 filas tienen las URLs en NULL, así que las
-- primeras corridas devolverán ok=true con todos los contadores en 0 y no
-- escribirán ninguna fila de log. Eso es correcto, no un fallo: el log solo
-- registra borrados reales. Para probarlo de verdad, ver el plan de prueba
-- del reporte de cierre (se siembra un prefijo falso).
-- =========================================================================
