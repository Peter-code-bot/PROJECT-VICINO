# Design -- INCIDENT: push-on-sale trigger Vault migration

## Root cause

A DB trigger dispatched an HTTP push by embedding a static service_role JWT in the request
headers. Secrets must never live inside DB object definitions: they appear in
`pg_get_functiondef`, in `pg_dump` backups, and survive key rotation until the object is edited.
The project already had the correct pattern (Vault-sourced key) for the message and appointment
push triggers; the sale trigger was a hand-made Studio exception that hardcoded the token.

## Fix pattern (mirror of call_send_push_on_appointment)

`call_send_push_on_sale()` is `SECURITY DEFINER`, `SET search_path = ''`, and at call time:
1. `SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='service_role_key';`
2. If NULL -> `RAISE WARNING` + `RETURN NEW` (never block the INSERT).
3. `PERFORM net.http_post(...)` to `send-push` with `Authorization: Bearer ' || v_key` and a
   payload mimicking the Database Webhook shape (`type/table/schema/record/old_record`).
4. `EXCEPTION WHEN OTHERS` -> WARNING + `RETURN NEW` (push failure never blocks the sale).

Trigger `push_on_sale_pgnet AFTER INSERT ON public.sale_confirmations FOR EACH ROW`. The
migration `DROP TRIGGER IF EXISTS` for the likely prior names before creating the clean one.

Key handling: the secret is read from Vault per call, so rotating the key = updating the Vault
secret only; no SQL/trigger edit needed for future rotations. The migration file contains NO
secret value.

## Rotation blast radius (out of git -- see inventory doc)

The same `service_role_key` Vault secret feeds `call_send_push_on_message`,
`call_send_push_on_appointment`, and now `call_send_push_on_sale`. Updating that one Vault secret
covers all push triggers. Separately, the rotated key must be set in the Edge Function secrets,
Vercel env, and the developer's local `.env` (none in git).

## Defense-in-depth follow-up
- `send-push` itself should require a shared webhook secret + reload the record from the DB (CH-5
  / finding #3) so a leaked dispatch token cannot be replayed to forge pushes.
