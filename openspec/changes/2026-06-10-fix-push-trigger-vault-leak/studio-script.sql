-- =============================================================================
-- INCIDENT: push-on-sale trigger Vault migration -- STUDIO SCRIPT
-- Change: 2026-06-10-fix-push-trigger-vault-leak
-- =============================================================================
-- STATUS: ALREADY APPLIED (Camino 2, COMMIT) after rotating the key + updating the
-- Vault secret 'service_role_key'. Idempotent. NO secret value appears here.
-- =============================================================================

-- ---- BLOCK 1: SNAPSHOT (read-only). Confirm the OLD trigger exists; DO NOT paste
-- its definition anywhere (it contains the leaked token). ----
SELECT tgname, tgrelid::regclass AS table, tgenabled
FROM pg_trigger
WHERE tgrelid = 'public.sale_confirmations'::regclass AND NOT tgisinternal;

-- Confirm the Vault secret exists (value NOT selected):
SELECT name FROM vault.secrets WHERE name = 'service_role_key';

-- ---- BLOCK 2: APPLY ----
BEGIN;

CREATE OR REPLACE FUNCTION public.call_send_push_on_sale()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF v_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault; skipping push for sale id=%', NEW.id;
    RETURN NEW;
  END IF;
  PERFORM net.http_post(
    url     := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_key),
    body    := jsonb_build_object('type','INSERT','table','sale_confirmations','schema','public',
                                  'record', to_jsonb(NEW), 'old_record', null)
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'push dispatch failed for sale id=%: % (sqlstate %)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS on_sale_confirmation_inserted ON public.sale_confirmations;
DROP TRIGGER IF EXISTS push_on_sale_inserted         ON public.sale_confirmations;
DROP TRIGGER IF EXISTS push_on_sale_pgnet            ON public.sale_confirmations;
CREATE TRIGGER push_on_sale_pgnet
  AFTER INSERT ON public.sale_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.call_send_push_on_sale();

COMMIT;

-- ---- BLOCK 3: VERIFY ----
-- 3a. only the Vault-based trigger remains; its function has no literal JWT.
SELECT tgname FROM pg_trigger
WHERE tgrelid='public.sale_confirmations'::regclass AND NOT tgisinternal;
-- 3b. functiondef references vault.decrypted_secrets, NOT a token:
SELECT (pg_get_functiondef('public.call_send_push_on_sale()'::regprocedure) ILIKE '%vault.decrypted_secrets%') AS reads_vault,
       (pg_get_functiondef('public.call_send_push_on_sale()'::regprocedure) ILIKE '%eyJhbG%')                  AS has_literal_jwt;
-- expected: reads_vault = true, has_literal_jwt = false
-- 3c. functional smoke: insert a test sale_confirmation -> send-push returns 400 (token valid),
--     not 401 (would mean bad/expired token). Run in a BEGIN/ROLLBACK to avoid persisting.
