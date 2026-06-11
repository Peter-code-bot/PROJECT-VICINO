-- =============================================================================
-- INCIDENT FIX -- push-on-sale trigger had a hardcoded service_role JWT
-- Change: openspec/changes/2026-06-10-fix-push-trigger-vault-leak
-- =============================================================================
-- INCIDENT: the live AFTER INSERT trigger on sale_confirmations dispatched the
-- push notification with a service_role JWT HARDCODED in the Authorization header
-- (created by hand in Studio; never in a committed migration). That is a long-lived
-- credential in plaintext inside a DB object. Remediation:
--   1. Rotated the Supabase service_role key (old token invalidated).
--   2. Updated the Vault secret 'service_role_key' with the new key.
--   3. Replaced the trigger with call_send_push_on_sale() which reads the key from
--      Vault at call time (same pattern as call_send_push_on_appointment /
--      call_send_push_on_message). Future rotations only touch the Vault secret.
-- Verified: send-push responds 400 (not 401) -> the Vault-sourced token is valid.
--
-- STATUS: applied in Studio (Camino 2, COMMIT). Idempotent mirror.
-- NO secret value appears in this file -- the key lives only in Vault.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.call_send_push_on_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret
    INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key';

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
      'type',       'INSERT',
      'table',      'sale_confirmations',
      'schema',     'public',
      'record',     to_jsonb(NEW),
      'old_record', null
    )
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Never let a push dispatch failure block the sale_confirmations INSERT.
  RAISE WARNING 'push dispatch failed for sale id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

-- Drop the old hardcoded trigger(s) under any prior name, then create the clean one.
DROP TRIGGER IF EXISTS on_sale_confirmation_inserted ON public.sale_confirmations;
DROP TRIGGER IF EXISTS push_on_sale_inserted         ON public.sale_confirmations;
DROP TRIGGER IF EXISTS push_on_sale_pgnet            ON public.sale_confirmations;
CREATE TRIGGER push_on_sale_pgnet
  AFTER INSERT ON public.sale_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.call_send_push_on_sale();
