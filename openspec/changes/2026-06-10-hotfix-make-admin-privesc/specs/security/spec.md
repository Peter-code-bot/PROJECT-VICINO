# Spec -- security (delta)

> Domain: database-level authorization for the VICINO Supabase project -- privileged
> RPCs and the role pivot table (`user_roles`).
> This is a DELTA spec introduced by change `2026-06-10-hotfix-make-admin-privesc`.
> It will be merged into a canonical `openspec/specs/security/spec.md` on archive.
> Last updated: 2026-06-10

---

## Context

Supabase exposes every `public` function and table over a public PostgREST API reachable
with the anon key. Authorization for privileged operations MUST be enforced in the
database (function grants + in-function guards + RLS), never only in the UI, middleware,
or Server Actions, because a direct REST/RPC call bypasses all client-side controls.

`user_roles(user_id, role)` is the single source of truth for RBAC (`admin`, `moderator`,
`user`). `has_role(uid, role)` reads it. Promotion to a privileged role is therefore the
highest-value target in the system.

---

## Requirement R1 -- Role escalation SHALL require an existing admin

WHEN a user without the `admin` role invokes `public.make_admin(p_email)` OR attempts to
write `public.user_roles` directly (INSERT/UPDATE/DELETE via PostgREST), the system SHALL
reject the operation (`forbidden` at the function layer, or `permission denied for table
user_roles` at the grant layer). Anonymous (no JWT) callers SHALL be rejected
unconditionally.

The privileged path SHALL be: `make_admin` is `SECURITY DEFINER`, has `SET search_path =
public, pg_temp`, performs an in-body check that the caller already holds the `admin` role,
and is `EXECUTE`-able only by `authenticated` (never `anon`/`PUBLIC`).

### Scenario: anon tries to self-promote via the RPC
- GIVEN a request authenticated only with the public anon key
- WHEN it POSTs `/rest/v1/rpc/make_admin` with any `p_email`
- THEN the call is rejected (no EXECUTE grant for anon, and the in-body guard rejects a null auth.uid())
- AND no row is written to `user_roles`

### Scenario: authenticated non-admin tries to self-promote via the RPC
- GIVEN a logged-in user who does NOT hold the `admin` role
- WHEN they call `make_admin('their@email')`
- THEN the function raises `forbidden` with SQLSTATE 42501
- AND no row is written to `user_roles`

### Scenario: authenticated non-admin tries to write the pivot directly
- GIVEN a logged-in non-admin user
- WHEN they `INSERT INTO user_roles (user_id, role) VALUES (self, 'admin')` via PostgREST
- THEN the database returns `permission denied for table user_roles`
- AND no row is written

### Scenario: an existing admin promotes another user
- GIVEN a caller who already holds the `admin` role
- WHEN they call `make_admin('other@email')` for an existing profile
- THEN the function inserts `(other, 'admin')` (idempotent via ON CONFLICT DO NOTHING)
- AND returns successfully

---

## Requirement R2 -- The role pivot SHALL be readable only by its owner or an admin, and writable only by an admin

WHEN any role reads or writes `public.user_roles`, RLS SHALL restrict it so that: a user
may read only their own role row(s); only an admin may read others' rows or perform any
write; and `anon` SHALL have no access. The table SHALL keep RLS enabled; FORCE ROW LEVEL
SECURITY MAY be applied for defense-in-depth ONLY where the object-owner role carries
`BYPASSRLS` (so the SECURITY DEFINER `has_role()` does not recurse).

### Scenario: a user reads their own role
- GIVEN a logged-in user with a row in user_roles
- WHEN they SELECT their own role
- THEN the `Users can view own roles` policy returns their row

### Scenario: a user cannot enumerate others' roles
- GIVEN a logged-in non-admin user
- WHEN they SELECT user_roles for a different user_id
- THEN no rows are returned (RLS filters them out)

### Scenario: has_role-gated reads do not recurse under FORCE RLS
- GIVEN `user_roles` has FORCE ROW LEVEL SECURITY enabled
- WHEN an authenticated user runs a SELECT against a table whose RLS policy calls `has_role()` (e.g. products_services)
- THEN the query returns normally
- AND it does NOT raise `infinite recursion detected in policy for relation "user_roles"`
- AND if it does recurse, FORCE ROW LEVEL SECURITY is removed (the grant REVOKE still blocks direct writes)

---

## Implementation notes

- Canonical SECURITY DEFINER pattern: `20260521000011_rpc_update_profile_and_pause.sql`,
  `20260528000003_rpc_approve_verification_atomic.sql`.
- Mirror migration: `supabase/migrations/20260610000001_hotfix_make_admin_and_user_roles_privesc.sql`.
- `make_admin` has no application caller (grep of `apps/` is empty) -- it is a break-glass
  tool; the first admin is bootstrapped directly as `postgres` in Studio.
- Role lookups elsewhere MUST tolerate users with no `user_roles` row (treat absence as
  base `user`); never INNER JOIN user_roles for general listings.

## Out of scope (separate changes)

- `has_role(_user_id)` information disclosure (finding #14) -- self-or-admin guard, LAST.
- Seeding a default role row on signup (data-model debt).
- Audit findings #2-#13.
