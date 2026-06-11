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
- [x] T-08 - CODEX adversarial review (4-lens workflow + synthesis): verdict STOP_HIGH --
  1 CRITICAL (FORCE RLS recursion unverified live), 4 IMPORTANT. Fixed in-doc: design.md
  bootstrap contradiction; added rolbypassrls + admin-count checks to studio-script BLOCK 4.
  Push gated until P-4 recursion smoke is green.
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

## CH-1c -- role management RPC + app migration (closes the CH-1b side effect)

The CH-1b write REVOKE broke the two admin Server Actions that wrote user_roles directly
(verdict B, docs/security/2026-06-10-user-roles-usage.md). Fix = one admin-guarded RPC.

- [x] C-1 - RPC `manage_user_role(p_user_id, p_role app_role, p_action)` applied in Studio
  (SECURITY DEFINER + has_role admin guard + last-admin protection + REVOKE anon/PUBLIC +
  GRANT authenticated). Smokes OK: attacker=forbidden, admin=assign, last-admin=blocked.
- [x] C-2 - mirror migration `supabase/migrations/20260610000002_manage_user_role.sql` (idempotent)
- [x] C-3 - migrate call sites (authenticated session, not service-role):
  - `apps/web/app/admin/users/actions.ts` assignRole -> `.rpc('manage_user_role', {..., p_action:'assign'})`
  - `apps/web/app/admin/users/actions.ts` removeRole -> `.rpc('manage_user_role', {..., p_action:'remove'})`
- [x] C-4 - surface RPC error (forbidden / last-admin) in the UI `admin/users/role-actions.tsx`
  (error state only; no behavior change). Reused assignRoleSchema/removeRoleSchema.
- [x] C-5 - policy `Admin can manage roles` LEFT INTACT (load-bearing for admin/users/page.tsx:55 reads)
- [x] C-6 - `rg "from\(['\"]user_roles['\"]\).*(insert|delete|update|upsert)" apps/web` == 0 hits
- [ ] C-7 - `pnpm build` green (type-check)

## Closing

- [ ] T-10 - after Pedro's go-ahead: push branch `security/fase0-audit-verification`
  (rebased onto 3f4fffc -> needs `--force-with-lease`), open PR to master.
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
