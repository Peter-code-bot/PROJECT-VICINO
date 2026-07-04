# Spec -- onboarding (delta)

> Domain: server-side onboarding-completion RPC and its execution privileges for the VICINO
> Supabase database.
> This is a DELTA spec -- it defines requirements introduced by change
> `2026-07-04-harden-onboarding-rpc`. It merges into a canonical
> `openspec/specs/onboarding/spec.md` after the change archives.
> Last updated: 2026-07-04

---

## Context

New sellers/buyers finish onboarding by flipping `profiles.has_seen_onboarding` to `true`.
The gate in `apps/web/app/(marketplace)/layout.tsx:95` redirects any authenticated user
whose flag is `false` to `/bienvenida`. The client calls the Server Action
`completeOnboarding()` (`apps/web/app/(marketplace)/perfil/actions.ts:104`), which invokes
the Postgres RPC `public.complete_user_onboarding()`.

The RPC was created ad-hoc in Studio and never hardened. This spec codifies the least-
privilege contract so the function cannot be abused via a direct PostgREST call and cannot be
re-introduced un-hardened.

---

## Requirement R1 -- Only authenticated sessions SHALL execute the RPC

WHEN the RPC `public.complete_user_onboarding()` is invoked, the system SHALL execute the
body only for a request that carries a valid authenticated session (`auth.uid()` is not
null). The function SHALL raise an exception for a request with no authenticated user, and
SHALL grant `EXECUTE` to the `authenticated` role only.

### Scenario: authenticated caller completes onboarding

- GIVEN an authenticated user whose `profiles.has_seen_onboarding` is `false`
- WHEN `complete_user_onboarding()` runs in their session
- THEN their `profiles.has_seen_onboarding` becomes `true`
- AND no other row is modified

### Scenario: no-session caller is rejected

- GIVEN a request where `auth.uid()` is null
- WHEN `complete_user_onboarding()` is invoked
- THEN the function raises `no authenticated user`
- AND no row is modified

---

## Requirement R2 -- anon and PUBLIC SHALL NOT hold EXECUTE

WHEN execution privileges on `public.complete_user_onboarding()` are inspected, the system
SHALL show `EXECUTE` granted to `authenticated` and SHALL show no `EXECUTE` for `anon` or
`PUBLIC`. The default PostgreSQL grant to `PUBLIC` SHALL be revoked.

### Scenario: grant inventory is least-privilege

- GIVEN the hardening has been applied
- WHEN this query runs:
  ```sql
  SELECT grantee, privilege_type FROM information_schema.role_routine_grants
  WHERE routine_name = 'complete_user_onboarding';
  ```
- THEN `authenticated` appears with `EXECUTE`
- AND `anon` and `PUBLIC` do not appear

### Scenario: direct anonymous PostgREST call is denied

- GIVEN an anonymous client (anon key, no user JWT)
- WHEN it POSTs to `/rest/v1/rpc/complete_user_onboarding`
- THEN the call is denied (no EXECUTE for anon)

---

## Requirement R3 -- The RPC SHALL mutate only the caller's own row under INVOKER + RLS

WHEN `complete_user_onboarding()` performs its `UPDATE`, the system SHALL run with the
caller's rights (`SECURITY INVOKER`) so Row-Level Security enforces `(select auth.uid()) = id`,
mutating only the caller's own `profiles` row. The function SHALL pin `search_path` to a
fixed value and reference every object fully-qualified. The function SHALL NOT run as
`SECURITY DEFINER`.

### Scenario: definition is INVOKER with pinned search_path

- GIVEN the hardening has been applied
- WHEN this query runs:
  ```sql
  SELECT proname, prosecdef, proconfig FROM pg_proc
  WHERE proname = 'complete_user_onboarding';
  ```
- THEN `prosecdef` is `false` (INVOKER)
- AND `proconfig` contains `search_path=""`

### Scenario: RLS smoke confirms owner-only write

- GIVEN a transaction with `SET LOCAL ROLE authenticated` and
  `SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`
- WHEN `SELECT public.complete_user_onboarding();` runs
- THEN `profiles.has_seen_onboarding` for `id = '<uuid>'` is `true`
- AND ROLLBACK persists nothing

---

## Implementation notes

- Canonical REVOKE/GRANT pattern: `supabase/migrations/20260521000011_rpc_update_profile_and_pause.sql`
- RLS smoke tests MUST use `SET LOCAL ROLE authenticated` (not only `set_config`), because
  the Studio SQL editor runs as `postgres` and bypasses RLS otherwise
  (CLAUDE.md institutional lesson #2).
- Client wiring is unchanged: `completeOnboarding()` (`perfil/actions.ts:104`) +
  `OnboardingOptions` (`onboarding-options.tsx`) already match the target pattern.

## Out of scope

- MP#07, MP#08, growth skills, marketing.
- Rate-limiting `completeOnboarding` (idempotent already; optional follow-up).
- Any `IF NOT FOUND` 0-row guard in the function body (see design.md rationale).
