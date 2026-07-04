# Design -- Harden onboarding RPC

> Domain: Supabase Postgres RPC hardening for VICINO onboarding completion.
> Last updated: 2026-07-04

## Decision: SECURITY INVOKER (not DEFINER)

**Chosen: `SECURITY INVOKER`.**

### Evidence (FASE 0)

`profiles` already has an UPDATE policy that lets an authenticated user mutate their own row:

```
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);
-- supabase/migrations/20260320000002_profiles.sql:107
```

altered to be role-scoped and InitPlan-optimized:

```
ALTER POLICY "Users can update own profile" ON public.profiles
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);
-- supabase/migrations/20260602000001_optimize_rls_performance.sql:34
```

Because the row the function needs to write (`profiles WHERE id = auth.uid()`) is exactly
the row this policy already authorizes, **the function needs no elevated privilege**. Under
`SECURITY INVOKER` the `UPDATE` runs with the caller's rights and RLS enforces
`(select auth.uid()) = id` automatically. This is the minimum-privilege choice per the
FASE 0 rule ("if profiles already has an UPDATE policy with `auth.uid() = id`, prefer
INVOKER over DEFINER").

### Why the historical "permission denied" does NOT justify DEFINER

The lineage (`898dc29` bypass-RLS-with-adminClient -> `3810930` switch-to-RPC) looks like a
reason to keep DEFINER, but it is not. Those failures were a **symptom of a missing/incorrect
GRANT and an anon/session mismatch**, not of RLS forbidding the legitimate owner:

- The pre-RPC modal saga (WKWebView session desync, Authorization header not sent) failed in
  the browser client where `auth.uid()` was effectively null -- RLS correctly denied a write
  with no valid session. That is the anon path, not the owner path.
- The current server-action path runs inside `createClient()` (cookie SSR session) and only
  calls the RPC after `supabase.auth.getUser()` succeeds, so `auth.uid()` is populated.
  Under INVOKER + RLS the owner's `UPDATE ... WHERE id = auth.uid()` matches their row.

The correct fix for the original "permission denied" is precisely what this change ships:
a clean `GRANT EXECUTE TO authenticated` plus `REVOKE` from `anon`/`PUBLIC` -- not a
privilege escalation to DEFINER. The RLS smoke test (real `authenticated` role) is the gate
that proves INVOKER works before commit.

## Hardening details

```sql
CREATE OR REPLACE FUNCTION public.complete_user_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
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
  and `auth.uid()`. (House convention elsewhere uses `public, pg_temp`; the empty path is a
  stricter equivalent given full qualification.)
- The `auth.uid() IS NULL` guard turns the no-session case into an explicit error the client
  surfaces via toast, instead of a silent 0-row update.

### Note: 0-rows guard intentionally omitted

Commit `4e899f3` ("return error if completeOnboarding updates 0 rows to prevent silent
infinite loop") motivated guarding the empty-update case. We **do not** add an
`IF NOT FOUND THEN RAISE` to this body, to avoid diverging from the approved WRITE block.
Rationale it is safe to omit:

- Under INVOKER + RLS, the target row (`id = auth.uid()`) always exists for an authenticated
  user (created by the signup trigger) and always matches the policy, so a 0-row update is
  not reachable on the happy path.
- The no-session case (the real failure mode behind the infinite loop) is already caught by
  the explicit `auth.uid() IS NULL` guard.
- Defense in depth remains at the client: `completeOnboarding` checks `{ error }`, the UI
  toasts on failure, and `OnboardingOptions` calls `router.push` explicitly rather than
  relying only on cache revalidation.

If a future audit wants belt-and-suspenders, add `GET DIAGNOSTICS` + `IF NOT FOUND` in a
follow-up; it is not required for this hardening.

## Delivery: Camino 2 + mirror migration

- `studio-script.sql` (4 blocks: SNAPSHOT / DRY-RUN BEGIN-ROLLBACK / APPLY BEGIN-COMMIT /
  VERIFY+SMOKE) is the record of exactly what Pedro runs in Studio.
- `supabase/migrations/20260704000001_harden_complete_user_onboarding.sql` mirrors the WRITE
  (idempotent `CREATE OR REPLACE` + REVOKE/GRANT) as repo-of-record. It is **NOT** applied via
  `supabase db push` -- Pedro's deploy model is browser-only for SQL. See tasks.md for the
  `schema_migrations` ledger bookkeeping so the manual run does not drift the ledger.

## No app-code change

The client already matches the target pattern (server client `await createClient()`, RPC
call, `revalidatePath("/")`, `useTransition`). The only conditional edit permitted is
switching `revalidatePath("/")` to `revalidatePath("/", "layout")` **iff** the `/bienvenida`
redirect proves sticky after completion (the gate lives in the `(marketplace)` layout that
serves `/`, so path revalidation should already bust it).
