# Proposal -- INCIDENT: hardcoded service_role JWT in push-on-sale trigger

## Why (incident)

During the CH-3 work a long-lived **service_role JWT was found HARDCODED in plaintext** inside
the live `AFTER INSERT` trigger on `public.sale_confirmations` (the `Authorization: Bearer ...`
header of a `supabase_functions.http_request` / `net.http_post` call to the `send-push` Edge
Function). The trigger was created by hand in Studio and was NEVER in a committed migration, so
the secret lived only in the database object definition. A service_role key bypasses RLS
entirely -- anyone who could read the trigger definition (or a DB backup) held full admin access
to the data plane (CWE-312 / CWE-798 / CWE-522).

A prior audit doc also pasted the same token (`docs/security/SECURITY_AUDIT_VICINO_20260512.md`)
-- a second copy of the secret committed to git.

## What (remediation -- applied)

1. **Rotated** the Supabase service_role key; the old token is invalidated.
2. **Updated the Vault secret** `service_role_key` with the new key (single source for all push
   triggers).
3. **Replaced the trigger**: dropped the hardcoded trigger and created
   `call_send_push_on_sale()` + trigger `push_on_sale_pgnet`, which reads the key from
   `vault.decrypted_secrets` at call time -- identical to the established
   `call_send_push_on_appointment` / `call_send_push_on_message` pattern. Future rotations only
   touch the Vault secret, never SQL.
4. **Scrubbed** the token from `docs/security/SECURITY_AUDIT_VICINO_20260512.md` (replaced with
   `[REDACTED-ROTATED-TOKEN]`).

Verified: `send-push` now responds `400` (not `401`) -> the Vault-sourced token is valid.

Mirror migration: `supabase/migrations/20260610000007_fix_push_trigger_vault_leak.sql`
(idempotent; contains NO secret value -- the key lives only in Vault).

## Scope

### IN
- New `call_send_push_on_sale()` (Vault-sourced) + `push_on_sale_pgnet` trigger; drop of the
  hardcoded trigger; the audit-doc redaction; mirror migration + delta spec.

### OUT
- Updating the out-of-git secret stores (Vercel env, Edge Function secrets, local `.env`) with
  the new key -- tracked in `docs/security/2026-06-10-service-role-key-inventory.md`.
- Rewriting git history to purge the old token (the token is rotated/dead; decision deferred).

## Success criteria

1. No `eyJhbG`-prefixed JWT appears in any `supabase/migrations/` file, app code, or
   `docs/` (except the documented pattern string). `rg eyJhbG` is clean of real tokens.
2. The sale-confirmation push still fires; `call_send_push_on_sale` reads `service_role_key`
   from Vault; a missing Vault secret logs a WARNING and never blocks the INSERT.
3. The old token is invalidated (rotation) and the redacted doc no longer contains it.

## References
- Inventory of every service_role usage: `docs/security/2026-06-10-service-role-key-inventory.md`
- Canonical Vault pattern: `supabase/migrations/20260604000005_push_on_appointment_trigger.sql`
- Reviewer suggested: Alejandro (audit author).
