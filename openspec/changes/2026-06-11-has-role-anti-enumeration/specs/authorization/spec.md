# Spec -- authorization / has_role (delta)

> Domain: the `public.has_role(_user_id uuid, _role app_role)` role-membership helper.
> DELTA spec from change `2026-06-11-has-role-anti-enumeration`. Last updated 2026-06-11.

## Context

`has_role` is a SECURITY DEFINER helper used by 14 RLS policies and 7 DEFINER functions to test role
membership. It previously answered for ANY `_user_id` and was EXECUTE-able by `anon`, so any client
could enumerate role holders (e.g. who is `admin`) via PostgREST.

## Requirement R1 -- non-admins SHALL NOT learn a third party's role

WHEN a caller invokes `has_role(_user_id, _role)` with `_user_id <> auth.uid()` AND the caller is not
an admin, the function SHALL return `false` regardless of the real membership. It SHALL return (not
RAISE), so policies that evaluate `has_role` in `USING` / `WITH CHECK` are not disrupted.

### Scenario: non-admin enumeration is blocked
- GIVEN a non-admin user U
- WHEN U calls `has_role(<other-uuid>, 'admin')`
- THEN the result is `false` (even if that other user IS an admin), with no error raised

### Scenario: cross-user probe for any role blocked
- GIVEN a non-admin user U
- WHEN U calls `has_role(<other-uuid>, <any-role>)`
- THEN the result is `false`

## Requirement R2 -- self and admin callers SHALL get the true membership (byte-faithful)

WHEN `_user_id = auth.uid()`, OR the caller is an admin, `has_role` SHALL return the real membership
exactly as the original function did.

### Scenario: self query unaffected
- WHEN any user calls `has_role(auth.uid(), <role>)`
- THEN the result reflects their real membership

### Scenario: admin sees a third party's real role
- GIVEN an admin caller
- WHEN they call `has_role(<other-uuid>, <role>)`
- THEN the result reflects that user's real membership

## Requirement R3 -- anon SHALL NOT execute has_role

WHEN EXECUTE privileges are evaluated, `has_role` SHALL be revoked from `PUBLIC` and `anon`, and
granted only to `authenticated` and `service_role`.

### Scenario: anon cannot call has_role
- WHEN an anonymous client invokes `rpc('has_role', ...)`
- THEN execution is denied (no EXECUTE grant)

## Requirement R4 -- dependent policies/functions SHALL be unaffected

WHEN the 14 policies and 7 DEFINER functions that reference `has_role` evaluate it, their behavior
SHALL be unchanged, because they all pass `auth.uid()` (the self branch) or run as admin.

### Scenario: policy evaluation intact
- GIVEN any of the 14 policies calling `has_role((SELECT auth.uid()), ...)`
- WHEN a request is authorized
- THEN it behaves exactly as before this change

## Implementation notes
- Mirror migration: `20260611213630_14_has_role_anti_enumeration.sql` (byte-faithful to live).
- Guard uses a direct `EXISTS` on `user_roles` for the admin check (not a recursive `has_role`).
- Validation: 14-policy + 7-function inventory, smoke 7/7, live VERIFY (guard_vivo=true, anon_exec=false).
