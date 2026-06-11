# Tasks -- P0 Hotfix: make_admin privesc + user_roles lockdown (#1)

> FASE A = OpenSpec (this directory). FASE B = SQL + git commit (Claude).
> FASE C = Pedro runs the SQL in Supabase Studio. No `pnpm build` gate -- no app
> code is touched.
> NOTE: FASE C was done FIRST this time (P0 emergency) -- Pedro applied CH-1 + CH-1b
> live before this change was written. FASE A/B record and mirror it.

## FASE A -- OpenSpec (this directory)

- [x] T-01 - proposal.md (why + what + scope + debt + risk + success criteria)
- [x] T-02 - design.md (threat model + SQL design + FORCE RLS recursion analysis + bootstrap)
- [x] T-03 - tasks.md (this file)
- [x] T-04 - specs/security/spec.md (EARS delta: make_admin + user_roles)
- [x] T-05 - studio-script.sql (5-block Camino 2 record, re-runnable)

## FASE B -- SQL mirror + commit (Claude)

- [x] T-06 - mirror migration `supabase/migrations/20260610000001_hotfix_make_admin_and_user_roles_privesc.sql`
  (idempotent: CREATE OR REPLACE / DROP POLICY IF EXISTS / REVOKE-GRANT / FORCE RLS)
- [x] T-07 - explicit `git add` of the change dir + the migration; ASCII commit:
  `fix(security): P0 privesc -- make_admin guard + user_roles lockdown (#1)`
- [x] T-08 - CODEX adversarial review loop (internal); HIGH findings -> STOP, report to Pedro
- [ ] T-09 - **NO push until Pedro's go-ahead** (per megaprompt). Report commit SHA.

## FASE C -- Pedro execution (Supabase Studio) -- ALREADY DONE for prod

- [x] P-1 - CH-1 make_admin guard + grants applied (Camino 2, COMMIT)
- [x] P-2 - CH-1b user_roles REVOKEs + FORCE RLS + policy applied (Camino 2, COMMIT)
- [x] P-3 - attacker smoke: authenticated non-admin INSERT -> `permission denied for table user_roles`
- [ ] P-4 - **CRITICAL recursion smoke (BLOCK 4e)**: confirm an authenticated has_role-gated
  read (e.g. `SELECT id FROM products_services LIMIT 1`) does NOT raise
  `infinite recursion detected in policy for relation user_roles`. If it does ->
  `ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;`
- [ ] P-5 - confirm an existing admin can still `make_admin` another user
- [ ] P-6 - (optional) account-deletion smoke for a user WITH a role row (moderator)

## Closing

- [ ] T-10 - after Pedro's go-ahead: push branch `security/fase0-audit-verification`,
  open PR to master.
- [ ] T-11 - merge + archive: move this change to `openspec/changes/archive/2026-06-10-hotfix-make-admin-privesc/`;
  merge spec delta into `openspec/specs/security/spec.md`.

## Known follow-ups (separate changes)

- **#14 has_role info-disclosure** -- guard self-or-admin + REVOKE anon. LAST in the
  sprint (touches every policy). Gated by BLOQUE A query A11.
- **default-role trigger** -- evaluate seeding a base `user_roles` row on signup so role
  lookups need not rely on absence. Separate sprint (data-model change + backfill).
- **Findings #2-#13** -- remaining audit items, each its own change, gated on BLOQUE A.

## Rollback

- FORCE RLS regression: `ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;`
- Do NOT revert the make_admin guard or the write REVOKEs (re-opens CVSS 9.8).
