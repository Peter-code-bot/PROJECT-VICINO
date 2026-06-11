# Spec -- push-credentials (delta)

> Domain: how database triggers obtain the service_role credential to call Edge Functions.
> DELTA spec from change `2026-06-10-fix-push-trigger-vault-leak`. Last updated 2026-06-10.

## Context

Push notifications are dispatched by `AFTER INSERT` triggers that call the `send-push` Edge
Function via `net.http_post` with a service_role bearer token. The token MUST never be embedded
in a database object; it MUST be read from Supabase Vault at call time.

## Requirement R1 -- trigger credentials SHALL come from Vault, never hardcoded

WHEN a database trigger function dispatches an authenticated HTTP request to an Edge Function,
it SHALL read the service_role key from `vault.decrypted_secrets` (secret name
`service_role_key`) at call time. It SHALL NOT contain a literal JWT. A missing Vault secret
SHALL log a WARNING and let the originating INSERT proceed (never block the write).

### Scenario: key sourced from Vault
- GIVEN the `push_on_sale_pgnet` trigger on `sale_confirmations`
- WHEN a sale_confirmation is inserted
- THEN `call_send_push_on_sale` reads `service_role_key` from Vault and dispatches the push
- AND `pg_get_functiondef` for the function contains NO literal JWT

### Scenario: missing secret does not block writes
- GIVEN the Vault secret is absent
- WHEN a sale_confirmation is inserted
- THEN the function logs a WARNING and the INSERT still commits

### Scenario: rotation touches only Vault
- WHEN the service_role key is rotated
- THEN updating the Vault secret `service_role_key` is sufficient for all push triggers
  (message, appointment, sale); no trigger SQL changes

## Requirement R2 -- no service_role JWT SHALL be committed to the repo

WHEN scanning the repository, no `eyJhbG`-prefixed service_role JWT SHALL appear in migrations,
application code, or docs (a documented 6-char pattern string for search guidance is not a
secret).

### Scenario: repo is clean of real tokens
- WHEN `rg eyJhbG` runs over the repo
- THEN it returns no real JWT (only documentation references to the pattern, and unrelated
  third-party example tokens under `.claude/skills/`)

## Implementation notes
- Canonical pattern: `20260604000005_push_on_appointment_trigger.sql`.
- Mirror migration: `20260610000007_fix_push_trigger_vault_leak.sql` (no secret value).
- Out-of-git secret stores (Vercel env, Edge Function secrets, local .env) are listed in
  `docs/security/2026-06-10-service-role-key-inventory.md`.
