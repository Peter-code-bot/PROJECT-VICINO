# Proposal -- Harden onboarding RPC (complete_user_onboarding)

## Why

`complete_user_onboarding()` runs in production (the app already calls it) but was
**created directly in Supabase Studio (Camino 2) and never captured as a migration nor
hardened**. It appeared during the onboarding saga on `master`
(`898dc29` "bypass profiles RLS ... using adminClient" -> `3810930` "switch to RPC for
onboarding to avoid dependency on Vercel service role key"). The lineage strongly implies
the live function is `SECURITY DEFINER` (it was introduced to bypass RLS / avoid the
service-role key), with the Supabase default `EXECUTE` grant left on `PUBLIC`/`anon` and
no `search_path` pin.

Three concrete risks with the likely current state:

1. **`SECURITY DEFINER` without a pinned `search_path`** -- a mutable `search_path` lets a
   caller-controlled schema shadow unqualified object references inside the function body
   (CWE-426/CWE-88 class). Every VICINO hardened RPC pins `search_path`.
2. **`EXECUTE` hanging on `PUBLIC`/`anon`** -- a direct PostgREST call (bypassing the app)
   can invoke the function as an anonymous client. Combined with DEFINER, that is a
   privileged mutation reachable without a session.
3. **DEFINER must be kept, but properly hardened** -- `profiles` has an UPDATE policy
   `"Users can update own profile"` `TO authenticated` (`20260320000002_profiles.sql:107`,
   altered in `20260602000001_optimize_rls_performance.sql:34`), which initially looked like
   grounds for `SECURITY INVOKER`. The FASE C grant audit refuted that: `authenticated` holds
   **no table-level `UPDATE`/`SELECT` grant** on `profiles` (only `service_role`/`postgres`
   do), so an INVOKER version fails `42501 permission denied` (verified live). The function
   must stay DEFINER (owner postgres) but be hardened -- pinned `search_path`, `anon`/`PUBLIC`
   revoked, and in-body `auth.uid()` authorization since DEFINER bypasses RLS.

Evidence (FASE 0 audit, this branch off `origin/master`):
- Caller (client wiring already correct, unchanged by this change):
  - `apps/web/app/(marketplace)/perfil/actions.ts:104-115` -> `completeOnboarding()` ->
    `await createClient()` (:105), `supabase.rpc("complete_user_onboarding")` (:111),
    `revalidatePath("/")` (:115), returns `{ error }`.
  - `apps/web/app/(onboarding)/bienvenida/onboarding-options.tsx` -> `useTransition` (:10) +
    `startTransition` (:14/:25) + `toast.error` (:17/:28).
  - Gate: `apps/web/app/(marketplace)/layout.tsx:95-96` -> `redirect("/bienvenida")` when
    `has_seen_onboarding === false`.
- Column: `supabase/migrations/20260629000001_add_onboarding_column.sql:7`.
- RPC as SQL: **absent from the repo** (no match in `supabase/` or `openspec/`).

## What

Harden `public.complete_user_onboarding()` to the **minimum viable privilege** and capture it
in the repo. Chosen shape (see design.md for the DEFINER-vs-INVOKER decision, corrected by the
FASE C grant audit):

- **`SECURITY DEFINER`, owner postgres** -- required because `authenticated` has no table grant
  on `profiles`. Safe because the function takes no parameters and writes only
  `WHERE id = auth.uid()`, so a caller can only ever set their own flag (no BOLA/IDOR).
- **`SET search_path = ''`** -- fully-qualified references (`public.profiles`, `auth.uid()`)
  make the empty search_path safe and strict.
- **`REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM anon` + `GRANT EXECUTE TO authenticated`**
  -- only authenticated sessions can call it.
- **Explicit `auth.uid() IS NULL` guard** -- fail fast with a clean error instead of a
  silent no-op when there is no session.
- Applied by Pedro in Supabase Studio (Camino 2: READ snapshot -> WRITE -> POST verify +
  RLS smoke), mirrored to `supabase/migrations/20260704000001_harden_complete_user_onboarding.sql`
  as repo-of-record (NOT applied via `db push`).

The client wiring already satisfies the "idempotent client" objective and is **not
rewritten** -- only verified end-to-end (2 viewports).

## Scope

### IN
- Hardened `CREATE OR REPLACE FUNCTION public.complete_user_onboarding()` (DEFINER owner
  postgres, pinned search_path, REVOKE/GRANT) delivered as a 4-block Camino 2 `studio-script.sql`.
- Mirror migration file for git history (repo-of-record, manual Studio run).
- POST verify queries + RLS smoke test.
- End-to-end verification of the existing client wiring on mobile 375x812 + desktop 1280x800.

### OUT
- Growth / marketing skills.
- MP#07 and MP#08 (explicitly separate scope; do not mix).
- Any rewrite of `completeOnboarding()` or `OnboardingOptions` beyond a single conditional
  `revalidatePath("/", "layout")` fallback if the gate redirect proves sticky (see tasks.md).
- Adding rate-limiting to `completeOnboarding` (idempotent already; optional follow-up).

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Reviews SQL, runs Camino 2 in Studio, runs `/ultrareview`, verifies |
| Authoring | Claude Code | Generates studio-script + mirror migration + OpenSpec, verifies client, no `db push` |

## Success criteria (objective, measurable)

1. POST verify shows `prosecdef = true` (DEFINER), `proconfig` contains `search_path=""`.
2. `information_schema.role_routine_grants` shows `authenticated` with `EXECUTE` and
   **zero** rows for `anon`/`PUBLIC`.
3. RLS smoke test (real `authenticated` role, `SET LOCAL ROLE`) flips
   `has_seen_onboarding` to `true` for the caller's own row inside the tx (ROLLBACK
   persists nothing).
4. Client flow verified on both viewports: fresh user (`has_seen_onboarding=false`) is
   redirected to `/bienvenida`, clicking an option calls the RPC with no toast error, and
   reloading `/` no longer redirects.
5. `pnpm type-check` green (no app-code change expected).

## References

- Canonical RPC-hardening pattern: `supabase/migrations/20260521000011_rpc_update_profile_and_pause.sql`
- House Camino 2 + mirror-migration precedent: `openspec/changes/archive/2026-06-02-optimize-rls-performance/`
- Onboarding column migration: `supabase/migrations/20260629000001_add_onboarding_column.sql`
- Memory `reference_supabase_project.md` -- project ref `oxxdkwywprkfghhbnoto`,
  `schema_migrations` ledger desynchronized (see tasks.md bookkeeping note)
