# Proposal -- P0 Hotfix: make_admin privesc + user_roles lockdown (#1)

## Why

Security audit finding #1 (CWE-269 / CWE-862, CVSS 9.8 -- CRITICAL). The break-glass
function `public.make_admin(p_email TEXT)` was defined `SECURITY DEFINER` with **no
authorization guard** and carried the Supabase default `EXECUTE` grant to `anon` and
`authenticated`. Any holder of the public anon key could self-promote to admin:

```bash
curl -X POST "$SUPABASE_URL/rest/v1/rpc/make_admin" \
  -H "apikey: $SUPABASE_ANON_KEY" -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" --data '{"p_email":"attacker@example.com"}'
```

This compromised the entire admin plane: an attacker becomes admin without XSS or
session theft, invalidating every downstream `has_role(..., 'admin')` control.

A **second, independent** privesc vector existed on the same data: `public.user_roles`
carried the default table-level write grants for `authenticated`, so an attacker could
`INSERT` an admin row for themselves by hitting the table directly via PostgREST --
without ever calling `make_admin`. Closing #1 fully requires locking down both.

Evidence (production commit 83132f9):
- `supabase/migrations/20260410000001_admin_setup.sql:3-15` -- `make_admin` SECURITY
  DEFINER, no guard, no REVOKE.
- `supabase/migrations/20260425000001_fix_security_definer_search_path.sql:14-15` --
  only adds `search_path`, no authorization.
- `supabase/migrations/20260320000002_profiles.sql:117-147` -- `user_roles` table +
  the `Admin can manage roles` policy (USING only, no WITH CHECK).

## What

Two surgical changes, **already applied by Pedro in Supabase Studio (Camino 2, COMMIT
done, 2026-06-10)**. This OpenSpec change records them and ships an idempotent mirror
migration for git history.

- **CH-1 -- make_admin guard.** `CREATE OR REPLACE` with an explicit caller-is-admin
  check against the `user_roles` pivot (mirrors `approve_verification_atomic`), plus
  `REVOKE ALL FROM PUBLIC`, `REVOKE EXECUTE FROM anon`, `GRANT EXECUTE TO authenticated`.
  `SET search_path = public, pg_temp`.
- **CH-1b -- user_roles lockdown.** `REVOKE INSERT, UPDATE, DELETE, TRUNCATE,
  REFERENCES, TRIGGER FROM anon, authenticated`; `REVOKE SELECT FROM anon`;
  `FORCE ROW LEVEL SECURITY`; and recreate `Admin can manage roles` with both `USING`
  and `WITH CHECK` (`has_role((select auth.uid()), 'admin')`). Net live state verified:
  `user_roles` leaves only `authenticated | SELECT`. Attacker smoke (authenticated
  non-admin INSERT) returns `permission denied for table user_roles`.

## Scope

### IN
- `make_admin` redefinition + grants.
- `user_roles` table-grant REVOKEs, FORCE RLS, admin-only manage policy.
- Idempotent mirror migration `supabase/migrations/20260610000001_hotfix_make_admin_and_user_roles_privesc.sql`.
- `studio-script.sql` (5-block Camino 2 record) + delta spec.

### OUT
- has_role(_user_id) information-disclosure hardening (finding #14) -- separate change,
  scheduled LAST because it touches every policy.
- The other audit findings (#2-#13) -- separate changes, gated on BLOQUE A.
- Seeding a default `user_roles` row per signup -- see Technical debt below.

## Technical debt recorded (do NOT bundle here)

- **Users without a `user_roles` row.** There is no trigger that seeds a default role
  on signup (`handle_new_user` in `20260320000002` creates a `profiles` row only). ~60
  of 65 users have NO row in `user_roles` and are treated as base users *by absence*.
  This is a data-model debt, NOT a vulnerability. Consequence for all role lookups:
  **always `LEFT JOIN` user_roles (or rely on has_role returning false on no row)** --
  never `INNER JOIN`, or base users vanish from results. Evaluate adding a default-role
  trigger in a separate sprint.
- **Correction to context note.** The functions that *write* `user_roles` are
  `make_admin` (INSERT) and `delete_user_data` (`20260320000019_account_deletion.sql:175`,
  DELETE). `approve_verification_atomic` only *reads* `user_roles` for its admin guard --
  it does not write it. Both writers are `SECURITY DEFINER` and were left intact.

## Risk to confirm before relying on FORCE RLS

`FORCE ROW LEVEL SECURITY` on `user_roles` is safe **only if** the object-owner role
(`postgres`) has the `BYPASSRLS` attribute (Supabase default). That attribute lets the
`SECURITY DEFINER` `has_role()` read `user_roles` without re-entering RLS, preventing
infinite recursion in (a) the ~20 policies that call `has_role()` and (b) the
`user_roles` "Admin can manage roles" policy itself. If `postgres` lacked BYPASSRLS,
FORCE RLS would throw `infinite recursion detected in policy for relation user_roles`
on every has_role-gated read -- a site-wide outage. **Must be confirmed by the BLOCK 4
recursion smoke** (studio-script.sql) before this is considered closed. Mitigation if it
recurses: `ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;` -- the grant-level
REVOKE already blocks the attacker without FORCE.

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Applied the SQL in Studio; runs the recursion smoke; signs off before merge |
| Authoring | Claude Code | Records the change in OpenSpec, ships idempotent mirror migration, CODEX review |

## Success criteria

1. `make_admin` called by a non-admin authenticated user raises `forbidden` (42501).
2. `make_admin` called by anon (no JWT) is rejected (no EXECUTE grant + guard).
3. Direct `INSERT INTO user_roles` as authenticated returns `permission denied for table user_roles`.
4. `pg_class.relforcerowsecurity = true` for `user_roles`; grants show only `authenticated | SELECT`.
5. **Recursion smoke passes**: an authenticated `SELECT` from a has_role-gated table
   (e.g. `products_services`) returns rows, NOT a recursion error.
6. An existing admin can still promote another user via `make_admin`.

## References

- Audit FASE 0 report: `docs/security/2026-06-10-fase0-report.md`
- Canonical hardening pattern reused: `supabase/migrations/20260521000011_rpc_update_profile_and_pause.sql`,
  `supabase/migrations/20260528000003_rpc_approve_verification_atomic.sql`
- Memory `reference_supabase_project`: project ref `oxxdkwywprkfghhbnoto`, ledger desynced.
