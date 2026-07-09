-- =============================================================================
-- Camino 2 studio-script -- harden public.complete_user_onboarding()
-- Change: 2026-07-04-harden-onboarding-rpc
--
-- Run BLOCK by BLOCK in Supabase Studio SQL editor (project oxxdkwywprkfghhbnoto).
-- Order: BLOCK 1 (snapshot) -> BLOCK 2 (dry-run) -> BLOCK 3 (apply) ->
--        ledger INSERT (see tasks.md bookkeeping note) -> BLOCK 4 (verify + smoke).
--
-- Decision: SECURITY DEFINER (hardened). The INVOKER attempt failed live with
-- 42501 -- the `authenticated` role has no table-level UPDATE/SELECT grant on
-- public.profiles (only service_role/postgres do), so RLS alone cannot carry an
-- INVOKER write. DEFINER (owner postgres) is the minimum viable privilege: the
-- function takes no parameters and writes only WHERE id = auth.uid(), anon is
-- revoked, and search_path is pinned. See design.md.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- BLOCK 1 -- SNAPSHOT BEFORE (read-only; capture current live state)
-- -----------------------------------------------------------------------------

-- 1a. Does the onboarding column exist?
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND column_name = 'has_seen_onboarding';

-- 1b. Current definition of the function if it exists (expected pre-state:
--     DEFINER, no search_path pin, anon EXECUTE present).
SELECT p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'complete_user_onboarding';

-- 1c. UPDATE policies on public.profiles.
SELECT polname, polcmd,
       pg_get_expr(polqual, polrelid)      AS using_expr,
       pg_get_expr(polwithcheck, polrelid) AS check_expr
FROM pg_policy
WHERE polrelid = 'public.profiles'::regclass;

-- 1d. Current EXECUTE grants on the function.
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'complete_user_onboarding';

-- 1e. Table-level grants on public.profiles (why INVOKER is not viable:
--     authenticated has no UPDATE/SELECT here -- only service_role/postgres).
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY grantee, privilege_type;


-- -----------------------------------------------------------------------------
-- BLOCK 2 -- DRY-RUN (BEGIN/ROLLBACK -- persists nothing)
-- -----------------------------------------------------------------------------
BEGIN;

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

-- Inline verify inside the dry-run so we see the result before ROLLBACK.
SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = 'complete_user_onboarding';

ROLLBACK;


-- -----------------------------------------------------------------------------
-- BLOCK 3 -- APPLY (BEGIN/COMMIT -- persists)
-- -----------------------------------------------------------------------------
BEGIN;

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

COMMIT;

-- Tell PostgREST to reload its schema cache so the grant change is picked up.
NOTIFY pgrst, 'reload schema';

-- After COMMIT succeeds, record the mirror migration in the ledger so a future
-- CLI diff does not try to re-run it (see tasks.md bookkeeping note):
--   INSERT INTO supabase_migrations.schema_migrations (version, name)
--   VALUES ('20260704000001', 'harden_complete_user_onboarding')
--   ON CONFLICT (version) DO NOTHING;


-- -----------------------------------------------------------------------------
-- BLOCK 4 -- VERIFY + RLS SMOKE
-- -----------------------------------------------------------------------------

-- 4a. Definition: expect prosecdef=true (DEFINER); proconfig contains search_path="".
SELECT proname, prosecdef, proconfig
FROM pg_proc
WHERE proname = 'complete_user_onboarding';

-- 4b. Grants: expect authenticated with EXECUTE; anon/PUBLIC with NONE.
SELECT grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'complete_user_onboarding';

-- 4c. Smoke test under a REAL authenticated role (SET LOCAL ROLE is required; the
--     Studio editor runs as postgres otherwise -- CLAUDE.md institutional lesson
--     #2). Under DEFINER the function runs as owner postgres, so the UPDATE
--     succeeds even though authenticated lacks the table grant; the WHERE
--     id = auth.uid() confines the write to the caller's own row. Fill <UUID>
--     with a real test user's profiles.id. Expect has_seen_onboarding -> true.
BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
  SELECT public.complete_user_onboarding();
  SELECT id, has_seen_onboarding FROM public.profiles WHERE id = '<UUID>';
ROLLBACK;


-- -----------------------------------------------------------------------------
-- BLOCK 5 -- COLUMN-LEVEL SELECT GRANT (read-side root cause; applied 2026-07-09)
--
-- Found during Subfase B verification: profiles carries COLUMN-LEVEL grants
-- (2026-06-10-mass-assignment-column-locks). authenticated had SELECT on every
-- column EXCEPT the sensitive set (has_seen_onboarding, email, fcm_token, rfc,
-- telefono, ...). has_seen_onboarding (added 20260629000001) never got its
-- grant, and Postgres fails the WHOLE statement when any selected column lacks
-- privilege -> the (marketplace) layout gate query returned 42501 -> profile
-- collapsed to null -> every logged-in user bounced to /bienvenida forever.
-- Mirror migration: 20260704000002_grant_select_has_seen_onboarding.sql.
-- -----------------------------------------------------------------------------

-- 5a. READ -- column privileges inventory on profiles (before):
--     expected: has_seen_onboarding ABSENT for authenticated.
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY grantee, privilege_type, column_name;

-- 5b. WRITE -- SELECT only, authenticated only. NO UPDATE on the column: writes
--     stay exclusively behind the SECURITY DEFINER RPC.
GRANT SELECT (has_seen_onboarding) ON public.profiles TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 5c. POST VERIFY -- re-run 5a: expected authenticated | SELECT |
--     has_seen_onboarding present (no UPDATE row for it).

-- 5d. Ledger bookkeeping for the mirror migration (after 5b succeeds):
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES ('20260704000002', 'grant_select_has_seen_onboarding')
ON CONFLICT (version) DO NOTHING;
