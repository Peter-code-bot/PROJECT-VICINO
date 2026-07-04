# Design -- Harden onboarding RPC

> Domain: Supabase Postgres RPC hardening for VICINO onboarding completion.
> Last updated: 2026-07-04

## Decision: SECURITY DEFINER (hardened)

**Chosen: `SECURITY DEFINER`, owner postgres, hardened.**

### The FASE 0 policy evidence was necessary but NOT sufficient

FASE 0 found that `profiles` has an UPDATE policy that names the authenticated owner:

```
ALTER POLICY "Users can update own profile" ON public.profiles
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);
-- supabase/migrations/20260602000001_optimize_rls_performance.sql:34
-- (base: 20260320000002_profiles.sql:107)
```

We initially read this as pointing to `SECURITY INVOKER` (least privilege). That was
**wrong**, because an RLS policy only filters rows *after* the caller already holds the
base-table privilege. RLS never *grants* access; it only restricts it.

### Grant audit (FASE C smoke, 2026-07-04) -- the decisive evidence

Studio inspection of `information_schema.role_table_grants` on `public.profiles` showed the
`authenticated` role holds **no `UPDATE` and no `SELECT`** on the table -- only `service_role`
and `postgres` do. Consequently:

- A `SECURITY INVOKER` `complete_user_onboarding()` runs the `UPDATE` with the caller's
  (authenticated) rights, which lack the table grant -> **`42501 permission denied`**.
- This was **verified live**: the INVOKER smoke test returned `42501`.

This also explains the original saga (`898dc29` "bypass profiles RLS ... adminClient to avoid
permission denied" -> `3810930` "switch to RPC"): the real blocker was always the missing
base-table grant to `authenticated`, not a session problem. The team routed around it with the
service-role key, then with an RPC. The correct, key-free fix is a hardened DEFINER RPC.

### Why hardened DEFINER is the minimum viable privilege

Granting `authenticated` a broad table-level `UPDATE` on `profiles` just to flip one boolean
would open every column of `profiles` to direct PostgREST writes (mass-assignment surface) --
strictly worse. The DEFINER RPC is tighter:

- **Owner postgres** holds the table grant, so the `UPDATE` succeeds. `CREATE OR REPLACE`
  preserves the existing owner (postgres).
- DEFINER bypasses RLS, so the body enforces authorization itself. It is safe because the
  function takes **no parameters** and derives the row from `auth.uid()` (server-side, from the
  caller's JWT), writing only `WHERE id = auth.uid()`. There is no id parameter to spoof, so a
  caller can never mutate another user's row (no BOLA/IDOR).
- **Single narrow vector**: the only thing any caller can do is set their own
  `has_seen_onboarding = true`.
- `anon`/`PUBLIC` are revoked; `search_path` is pinned. A direct anonymous PostgREST call is
  rejected at the grant layer, and the `auth.uid() IS NULL` guard rejects it in-body too.

**Smoke as evidence:** after applying the DEFINER version, the smoke test
(`SET LOCAL ROLE authenticated` + jwt claims -> `SELECT public.complete_user_onboarding()`)
flipped `has_seen_onboarding` to `true` for the caller's own row inside the tx (ROLLBACK
persisted nothing). Green.

## Hardening details

```sql
CREATE OR REPLACE FUNCTION public.complete_user_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no authenticated user';
  END IF;

  UPDATE public.profiles
  SET has_seen_onboarding = true
  WHERE id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.complete_user_onboarding() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_user_onboarding() FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_user_onboarding() TO authenticated;

NOTIFY pgrst, 'reload schema';
```

- `SET search_path = ''` is safe because every reference is fully qualified: `public.profiles`
  and `auth.uid()`. This is the search_path-lock pattern from
  `20260425000001_fix_security_definer_search_path.sql`.
- The `auth.uid() IS NULL` guard turns the no-session case into an explicit error the client
  surfaces via toast, and is a second line of defense behind `REVOKE ... FROM anon`.
- Because DEFINER bypasses RLS, in-body authorization (the parameterless `WHERE id = auth.uid()`)
  IS the authorization model here -- mirrors the canonical
  `20260521000011_rpc_update_profile_and_pause.sql`.

### Note: 0-rows guard intentionally omitted

Commit `4e899f3` ("return error if completeOnboarding updates 0 rows to prevent silent
infinite loop") motivated guarding the empty-update case. We **do not** add an
`IF NOT FOUND THEN RAISE`, to keep the approved WRITE block minimal. It is safe to omit:

- The target row (`id = auth.uid()`) always exists for an authenticated user (created by the
  signup trigger), so a 0-row update is not reachable on the happy path.
- The no-session case (the real failure mode behind the infinite loop) is already caught by the
  `auth.uid() IS NULL` guard.
- Client defense in depth remains: `completeOnboarding` checks `{ error }`, the UI toasts on
  failure, and `OnboardingOptions` calls `router.push` explicitly.

If a future audit wants belt-and-suspenders, add `GET DIAGNOSTICS` + `IF NOT FOUND` in a
follow-up; it is not required for this hardening.

## Delivery: Camino 2 + mirror migration

- `studio-script.sql` (4 blocks: SNAPSHOT / DRY-RUN BEGIN-ROLLBACK / APPLY BEGIN-COMMIT /
  VERIFY+SMOKE) is the record of exactly what Pedro ran in Studio. BLOCK 1e additionally
  snapshots `role_table_grants` on `profiles`, documenting why INVOKER is not viable.
- `supabase/migrations/20260704000001_harden_complete_user_onboarding.sql` mirrors the WRITE
  (idempotent `CREATE OR REPLACE` + REVOKE/GRANT) as repo-of-record. It is **NOT** applied via
  `supabase db push`. See tasks.md for the `schema_migrations` ledger bookkeeping so the manual
  run does not drift the ledger.

## No app-code change

The client already matches the target pattern (server client `await createClient()`, RPC call,
`revalidatePath("/")`, `useTransition`). The only conditional edit permitted is switching
`revalidatePath("/")` to `revalidatePath("/", "layout")` **iff** the `/bienvenida` redirect
proves sticky after completion (the gate lives in the `(marketplace)` layout that serves `/`,
so path revalidation should already bust it).
