-- Schedule the two sub-daily edge functions from inside the database
-- because Vercel Hobby only supports daily crons.
--
-- recompute-rankings stays on Vercel cron (daily) and is NOT touched here.
-- delete-account stays on-demand (user-triggered) and is NOT scheduled.
--
-- This migration is the FIRST use of pg_cron + pg_net in the project, so it
-- also enables both extensions defensively. Both ship with Supabase managed
-- and the CREATE EXTENSION IF NOT EXISTS calls are idempotent no-ops if
-- already present.
--
-- Secret handoff: the CRON_SECRET that the edge functions validate is the
-- SAME shared secret already in Vercel + Supabase Edge Functions env. To
-- keep it out of git, this migration reads it from Supabase Vault via
-- vault.decrypted_secrets. Pedro must seed the vault entry BEFORE the cron
-- fires for the first time (see VERIFY block at the bottom + the closure
-- report for the exact SQL). If the secret is missing the cron entry still
-- registers but each fire will receive a 401 from the edge function (the
-- bearer check rejects the empty string) and pg_net.http_post will record
-- the 401 in net._http_response -- visible and safe to debug.
--
-- Idempotency: cron job names are unique. Re-running this migration calls
-- cron.unschedule(name) inside a DO block that swallows the "job not found"
-- error so the migration is safe to re-apply.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- =========================================================================
-- 1. expire-confirmations: every 6 hours.
--    Marks sale_confirmations.status = 'expired' for rows older than 72h
--    that are still 'pending_confirmation'. Without this the partial unique
--    index one_active_sale_per_chat (20260424000002) blocks new sales in a
--    chat until the stale one resolves. Window is 72h so 6h granularity is
--    plenty.
-- =========================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('expire-confirmations-6h');
EXCEPTION WHEN OTHERS THEN
  -- "could not find valid entry for job 'expire-confirmations-6h'" on first run
  NULL;
END $$;

SELECT cron.schedule(
  'expire-confirmations-6h',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/expire-confirmations',
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
-- 2. send-appointment-reminders: every 30 minutes.
--    The 1h reminder window inside the function is 45-75 min before the
--    appointment, so the cron must fire at least every 30 min to never
--    miss the window. The 1d reminder window is wider (23-25h) so 30 min
--    granularity covers it trivially.
-- =========================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('send-appointment-reminders-30min');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'send-appointment-reminders-30min',
  '*/30 * * * *',
  $$
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
  $$
);

-- =========================================================================
-- VERIFY (run manually in Studio after applying):
--   SELECT jobid, schedule, jobname, active FROM cron.job
--    WHERE jobname IN ('expire-confirmations-6h','send-appointment-reminders-30min');
--   -- expected: 2 rows, active = true.
--
-- PEDRO PREREQ before the first fire (one-time, in Studio):
--   SELECT vault.create_secret('<paste CRON_SECRET value>', 'cron_secret');
--   -- value must match Vercel CRON_SECRET and Supabase Edge Functions
--   -- CRON_SECRET so all three sides agree.
--
-- POST-FIRE check (after the first scheduled fire):
--   SELECT status_code, content::text, created
--     FROM net._http_response ORDER BY created DESC LIMIT 5;
--   -- expected: 200 with expired_count payload (expire-confirmations) and
--   -- ok=true with reminders_1d/reminders_1h counters (appointment-reminders).
-- =========================================================================
