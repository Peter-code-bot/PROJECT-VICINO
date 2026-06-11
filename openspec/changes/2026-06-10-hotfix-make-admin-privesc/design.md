# Design -- P0 Hotfix: make_admin privesc + user_roles lockdown (#1)

## Threat model

Supabase exposes a public PostgREST data plane. Any client with the public anon key can
POST to `/rest/v1/rpc/<fn>` and `/rest/v1/<table>`. Authorization therefore CANNOT live
only in the UI/middleware or in a Server Action -- it must live in the database (RLS +
function grants + in-function guards). Two DB-level holes let a stranger become admin:

1. `make_admin` (SECURITY DEFINER, no guard, anon EXECUTE) -- direct privesc RPC.
2. `user_roles` direct writes (default `authenticated` table grant) -- privesc by
   inserting an admin row straight into the pivot, bypassing `make_admin` entirely.

Both are closed here.

## CH-1 -- make_admin

Reuses the project's canonical SECURITY DEFINER hardening pattern
(`20260521000011_rpc_update_profile_and_pause.sql`, `20260528000003_rpc_approve_verification_atomic.sql`):

- `SECURITY DEFINER` + `SET search_path = public, pg_temp` (search_path injection guard).
- In-body authorization: reject `auth.uid() IS NULL`, then require the caller to already
  hold the `admin` role via an `EXISTS` against `user_roles`. We use the direct `EXISTS`
  (not `has_role`) to keep the guard self-contained, matching `approve_verification_atomic`.
- Grants: `REVOKE ALL FROM PUBLIC`, `REVOKE EXECUTE FROM anon` (Supabase's project-level
  default privileges grant EXECUTE directly to anon/authenticated, so `REVOKE FROM PUBLIC`
  alone is insufficient -- the explicit `REVOKE FROM anon` is required), `GRANT EXECUTE TO
  authenticated`. authenticated callers still pass only if the in-body guard passes.

Behavior preserved for the happy path: an admin calling `make_admin('someone@x.com')`
still inserts `(someone, admin)` with `ON CONFLICT DO NOTHING`. No app code calls
`make_admin` (grep of `apps/` returns zero hits), so the REVOKE breaks nothing.

### Bootstrap (chicken-and-egg)

The guard requires an existing admin to mint admins. The first admin is seeded ONCE by a
direct `INSERT INTO public.user_roles (user_id, role) VALUES ('<pedro_uuid>', 'admin')`
run as `postgres` in Studio. This does NOT go through `make_admin`: the RPC cannot
bootstrap the very first admin because its guard rejects a NULL `auth.uid()` (the Studio
SQL editor session has no `auth.uid()`). Once at least one admin row exists, that admin can
promote others via `make_admin`. One-time manual step, assumed already done in production --
confirm with `SELECT count(*) FROM public.user_roles WHERE role = 'admin'::app_role` (must
be >= 1, else the admin plane is locked out).

## CH-1b -- user_roles lockdown

- `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER FROM anon, authenticated`
  -- removes the default write grants. This is the control that actually blocks the
  attacker; the observed smoke error is `permission denied for table user_roles`
  (grant-level, evaluated before RLS).
- `REVOKE SELECT FROM anon` -- anon has no business reading the role pivot. authenticated
  keeps SELECT, row-gated by `Users can view own roles` (own row only).
- `FORCE ROW LEVEL SECURITY` -- defense-in-depth so even the table owner is subject to
  RLS (see recursion analysis below).
- `Admin can manage roles` recreated with `USING` AND `WITH CHECK` (was USING only). The
  added WITH CHECK closes write-side gaps: even if a future grant re-opened writes, only
  an admin row could be inserted/updated. Wrapped `(select auth.uid())` keeps the A2
  InitPlan optimization.

Net authoritative grants after CH-1b: `authenticated | SELECT` only. Verified by Pedro.

## FORCE RLS recursion analysis (CRITICAL to confirm)

`has_role(_user_id, _role)` is `SECURITY DEFINER` and does
`SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role`. It is called by ~20
RLS policies across profiles, products_services, reviews, messages, audit_log, reports,
critical_reports, categories, and -- crucially -- by the `Admin can manage roles` policy
ON `user_roles` itself.

Under normal RLS, `user_roles`'s owner (`postgres`) bypasses RLS, so `has_role`'s internal
SELECT runs cleanly -- this is exactly why the SECURITY DEFINER pattern is the standard
Supabase fix for "infinite recursion in policy for the roles table".

`FORCE ROW LEVEL SECURITY` removes the owner bypass FOR THE TABLE OWNER. If `postgres`
also lacks the `BYPASSRLS` role attribute, then `has_role`'s internal SELECT becomes
subject to `user_roles` RLS, which evaluates `Admin can manage roles` -> calls
`has_role` -> ... -> `ERROR: infinite recursion detected in policy for relation
"user_roles"`. That would fire on EVERY has_role-gated read -- a site-wide outage, not a
localized bug.

Resolution: in Supabase the `postgres` role normally carries `BYPASSRLS`, so the SECURITY
DEFINER `has_role` still bypasses even under FORCE RLS, and there is no recursion. The
attacker write-block comes from the grant REVOKE (not from FORCE RLS), and production is
reported up after apply -- both consistent with `postgres` having BYPASSRLS. But this MUST
be proven, not assumed:

- `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname IN ('postgres','authenticated','anon','authenticator','service_role');`
- BLOCK 4e recursion smoke: as an authenticated session, `SELECT id FROM products_services
  LIMIT 1` and `SELECT has_role('<uuid>','admin')` must NOT raise the recursion error.

If recursion is observed: `ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;`
(keep make_admin guard + REVOKEs -- the attacker stays blocked).

## Impact on the other user_roles writer

`delete_user_data` (`20260320000019_account_deletion.sql:175`) does
`DELETE FROM public.user_roles WHERE user_id = target_user_id` and is SECURITY DEFINER,
invoked by a user deleting their own account (not necessarily admin). Under FORCE RLS
(owner subject), that DELETE is filtered by `Admin can manage roles` -> for a non-admin it
deletes 0 rows. This is benign because: (a) ~60/65 users have no `user_roles` row anyway,
and (b) `user_roles.user_id REFERENCES auth.users(id) ON DELETE CASCADE`, so the row is
removed by the FK cascade when the auth user is deleted, regardless of RLS. If the BYPASSRLS
assumption holds, `delete_user_data` (running as postgres) bypasses and deletes directly.
Either way account deletion completes. Confirm with an account-deletion smoke for a user
who HAS a role row (moderator) if one exists.

## CH-1c -- role mutations go through an RPC (user_roles is client-read-only)

CH-1b made `public.user_roles` non-writable by `anon` and `authenticated` at the grant
layer. That also blocked the only legitimate client writers -- the admin Server Actions
`assignRole` (INSERT) and `removeRole` (DELETE) in `apps/web/app/admin/users/actions.ts`,
which run with the admin's authenticated session (not service_role), so they hit the REVOKE
(42501). Verdict B in `docs/security/2026-06-10-user-roles-usage.md`.

Resolution: a single admin-guarded `SECURITY DEFINER` RPC, `manage_user_role(p_user_id,
p_role, p_action)`, is now the ONLY write path. Invariant going forward:

- **`user_roles` is read-only for all clients.** Reads stay via RLS (`Users can view own
  roles` for self; `Admin can manage roles` SELECT branch for admins reading all rows --
  load-bearing for `admin/users/page.tsx:55`, do NOT drop it). All writes (assign/remove,
  any role) go through `manage_user_role`, which enforces `has_role(auth.uid(),'admin')`
  in-body and protects the last admin on remove.
- The app calls `.rpc('manage_user_role', { p_user_id, p_role, p_action })`; the RPC's
  RAISE message (forbidden / last-admin) is propagated to the admin UI.
- `make_admin` remains as a separate break-glass tool; `manage_user_role` is the
  app-facing role manager. Both are admin-gated SECURITY DEFINER with the same grant model.

## Idempotency

- `make_admin`: `CREATE OR REPLACE FUNCTION` -- safe to re-run.
- REVOKE/GRANT: idempotent by nature.
- `FORCE ROW LEVEL SECURITY` / `ENABLE ROW LEVEL SECURITY`: idempotent.
- Policy: `DROP POLICY IF EXISTS` + `CREATE POLICY` -- safe to re-run.

## Migration ordering

`20260610000001_hotfix_make_admin_and_user_roles_privesc.sql` is after the latest existing
migration (`20260604000005`). It only depends on objects created earlier (user_roles,
profiles, app_role, has_role), all present well before this timestamp.
