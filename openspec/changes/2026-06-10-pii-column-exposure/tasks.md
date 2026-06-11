# Tasks -- CH-6: profiles PII column restriction (#2)

## FASE A -- OpenSpec
- [x] proposal.md, design.md, tasks.md, specs/pii/spec.md, studio-script.sql

## FASE B -- mirror + app edits + commit
- [x] 20260610000009_ch6_pii_column_restrict.sql (REVOKE 6 PII cols + get_my_profile / admin_list_users / admin_get_user)
- [x] app: perfil/page.tsx select(*) -> rpc('get_my_profile')
- [x] app: perfil/editar/page.tsx (email) -> rpc('get_my_profile')
- [x] app: admin/users/page.tsx (email) -> rpc('admin_list_users') + filters
- [x] app: admin/verifications/page.tsx -> public embed + submitter emails via service-role batch
- [x] residual: 0 user-client PII reads of profiles (only the intentional adminSupabase email batch)
- [x] pnpm build green
- [x] CODEX review; HIGH -> STOP

## FASE C -- Studio (DONE) + reconcile
- [x] REVOKE SELECT PII cols; get_my_profile / admin_list_users / admin_get_user applied
- [ ] **RECONCILE (Pedro)**: confirm the live REVOKE does NOT include user_id / is_hidden. If it
      does, re-apply with ONLY the 6 PII columns (user_id is the public handle on vendedor/[id];
      is_hidden is read by admin moderation). Otherwise vendedor/[id] is broken in prod.
- [ ] P-smoke: anon/auth curl of PII -> 42501; perfil/editar shows own email; admin users +
      verifications show emails; public seller page + search still work.

## Out of scope
- Coords distance pill (inert; optional fuzzed RPC). #9 / #14.
