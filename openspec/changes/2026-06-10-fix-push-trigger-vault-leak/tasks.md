# Tasks -- INCIDENT: push-on-sale trigger Vault migration

## FASE A -- OpenSpec
- [x] proposal.md, design.md, tasks.md, specs/push-credentials/spec.md, studio-script.sql

## FASE B -- mirror + scrub + commit
- [x] 20260610000007_fix_push_trigger_vault_leak.sql (call_send_push_on_sale + push_on_sale_pgnet; no secret)
- [x] scrub docs/security/SECURITY_AUDIT_VICINO_20260512.md (JWT -> [REDACTED-ROTATED-TOKEN])
- [x] `rg eyJhbG` clean of real tokens (only the documented pattern string remains)
- [x] CODEX review

## FASE C -- Studio / dashboards (DONE in Studio; OUT-OF-GIT pending)
- [x] rotated service_role key; updated Vault secret 'service_role_key'
- [x] replaced hardcoded trigger with call_send_push_on_sale (Vault); verified send-push 400 (token valid)
- [ ] OUT-OF-GIT (per inventory doc): set the new key in Edge Function secrets, Vercel env, local .env
- [ ] decide: rewrite git history to purge the old token (rotated/dead) vs accept

## Out of scope
- send-push webhook-secret + reload-from-DB hardening (CH-5 / #3).
