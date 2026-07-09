# Spec -- onboarding

> Domain: server-side onboarding-completion RPC, its execution privileges, and the
> column-level read grant for the VICINO Supabase database (`oxxdkwywprkfghhbnoto`).
> Last updated: 2026-07-09 (bootstrapped from change `2026-07-04-harden-onboarding-rpc`
> after verified deploy: RPC hardened as SECURITY DEFINER, column SELECT grant applied,
> production reboot loop resolved, e2e verde on mobile 375x812 + desktop 1280x800).

---

## Context

New users finish onboarding by flipping `profiles.has_seen_onboarding` to `true`.
The gate in `apps/web/app/(marketplace)/layout.tsx` redirects any authenticated user
whose flag is `false` (or whose profile cannot be read) to `/bienvenida`. The client
calls the Server Action `completeOnboarding()`
(`apps/web/app/(marketplace)/perfil/actions.ts`), which invokes the Postgres RPC
`public.complete_user_onboarding()`.

`public.profiles` carries COLUMN-LEVEL grants (change
`2026-06-10-mass-assignment-column-locks`): `authenticated` has SELECT on the
non-sensitive columns only, and no table-level UPDATE. Two consequences shape this
spec: writes to the onboarding flag must go through a hardened `SECURITY DEFINER`
RPC (no table grant to lean on), and the flag column itself needs an explicit
column-level SELECT grant for the gate to read it.

Mirror migrations: `20260704000001_harden_complete_user_onboarding.sql` (RPC) and
`20260704000002_grant_select_has_seen_onboarding.sql` (column grant). Applied via
Camino 2 (Studio); repo files are the record, never `db push`.

---

## Requirement R1 -- Only authenticated sessions SHALL execute the RPC

WHEN the RPC `public.complete_user_onboarding()` is invoked, the system SHALL execute
the body only for a request that carries a valid authenticated session (`auth.uid()`
is not null). The function SHALL raise an exception for a request with no
authenticated user, and SHALL grant `EXECUTE` to the `authenticated` role only.

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

WHEN execution privileges on `public.complete_user_onboarding()` are inspected, the
system SHALL show `EXECUTE` granted to `authenticated` and SHALL show no `EXECUTE`
for `anon` or `PUBLIC`. The default PostgreSQL grant to `PUBLIC` SHALL be revoked.

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
- THEN the call is denied (verified live 2026-07-09: 401 / 42501)

---

## Requirement R3 -- The RPC SHALL mutate only the caller's own row via in-body auth.uid()

WHEN `complete_user_onboarding()` performs its `UPDATE`, the system SHALL run as
`SECURITY DEFINER` (owner postgres), because the `authenticated` role has no
table-level grant on `public.profiles`. Since DEFINER bypasses RLS, the function
SHALL enforce authorization in-body: it SHALL take NO parameters and SHALL restrict
the write to `WHERE id = auth.uid()`, so a caller can mutate only their own
`profiles` row (no BOLA/IDOR). The function SHALL pin `search_path` to a fixed value
and reference every object fully-qualified.

### Scenario: definition is hardened DEFINER with pinned search_path

- GIVEN the hardening has been applied
- WHEN this query runs:
  ```sql
  SELECT proname, prosecdef, proconfig FROM pg_proc
  WHERE proname = 'complete_user_onboarding';
  ```
- THEN `prosecdef` is `true` (DEFINER)
- AND `proconfig` contains `search_path=""`

### Scenario: RLS smoke confirms owner-only write

- GIVEN a transaction with `SET LOCAL ROLE authenticated` and
  `SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}'`
- WHEN `SELECT public.complete_user_onboarding();` runs
- THEN `profiles.has_seen_onboarding` for `id = '<uuid>'` is `true`
- AND ROLLBACK persists nothing

---

## Requirement R4 -- Columns on column-locked tables SHALL be granted in the same migration

WHEN a migration adds a column to a table protected by column-level privileges (such
as `public.profiles`), the SAME migration SHALL include the explicit column-level
`GRANT` for every role that reads it (typically `GRANT SELECT (column) ... TO
authenticated`). Postgres rejects an ENTIRE statement when any selected column lacks
privilege, so an ungranted column breaks every existing query that includes it.

Origin: `has_seen_onboarding` was added (20260629000001) without its grant; the
layout gate query failed whole with `42501`, `profile` collapsed to null, and every
logged-in user bounced to `/bienvenida` -- a production incident resolved by
`20260704000002`.

### Scenario: gate query reads the flag

- GIVEN an authenticated session
- WHEN the layout query
  `select nombre, foto, es_vendedor, has_seen_onboarding from profiles where id = auth.uid()`
  runs via PostgREST
- THEN it returns 200 with the row (no 42501)

### Scenario: column grants are audited with column_privileges

- GIVEN a table with column-level grants
- WHEN privileges are audited
- THEN the audit uses `information_schema.column_privileges`
- AND does NOT rely on `information_schema.role_table_grants`, which shows nothing
  for column-granted tables and misleads the reader into assuming no access exists

---

## Implementation notes

- Canonical REVOKE/GRANT pattern: `supabase/migrations/20260521000011_rpc_update_profile_and_pause.sql`
- RLS smoke tests MUST use `SET LOCAL ROLE authenticated` (not only `set_config`) --
  the Studio SQL editor runs as `postgres` and bypasses RLS otherwise
  (CLAUDE.md institutional lesson #2).
- Client wiring: `completeOnboarding()` (server action, `{ error }` contract,
  `revalidatePath("/")`) + `OnboardingOptions` (`useTransition` + explicit
  `router.push`). No admin client, no service-role key anywhere in the flow.
- Writes to `has_seen_onboarding` remain EXCLUSIVELY behind the RPC: the column has
  SELECT granted to `authenticated` but NO UPDATE.
