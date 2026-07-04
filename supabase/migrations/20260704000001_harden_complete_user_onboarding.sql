-- Harden public.complete_user_onboarding() -- change 2026-07-04-harden-onboarding-rpc.
--
-- Problem: this RPC was created ad-hoc in Supabase Studio during the onboarding
-- saga (898dc29 -> 3810930) and never captured as a migration nor hardened. Its
-- likely live state is SECURITY DEFINER with no pinned search_path and the
-- Supabase default EXECUTE grant left on PUBLIC/anon -- i.e. a privileged mutation
-- reachable by a direct anonymous PostgREST call.
--
-- Fix: least privilege. profiles already has an UPDATE policy
-- "Users can update own profile" TO authenticated USING/WITH CHECK
-- ((select auth.uid()) = id) (20260320000002_profiles.sql:107, altered in
-- 20260602000001_optimize_rls_performance.sql:34), so an authenticated user can
-- flip their own has_seen_onboarding under RLS with no elevated rights. This
-- function therefore runs SECURITY INVOKER; RLS enforces auth.uid() = id.
--
-- search_path is pinned to '' (empty); every reference is fully qualified
-- (public.profiles, auth.uid()), following the search_path-lock pattern from
-- 20260425000001_fix_security_definer_search_path.sql.
--
-- REVOKE/GRANT mirrors 20260521000011_rpc_update_profile_and_pause.sql: Supabase's
-- project-level default privileges grant EXECUTE directly to anon (not via PUBLIC),
-- so REVOKE FROM PUBLIC is not enough -- we REVOKE FROM anon explicitly.
--
-- Delivery: Camino 2 (Pedro runs the WRITE in Studio). This file is repo-of-record
-- and is NOT applied via `supabase db push`. See the OpenSpec change
-- studio-script.sql for the snapshot/verify/smoke blocks.

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

COMMENT ON FUNCTION public.complete_user_onboarding() IS
  'Onboarding completion: flips profiles.has_seen_onboarding to true for the '
  'caller. SECURITY INVOKER -- RLS policy "Users can update own profile" enforces '
  'auth.uid() = id. Pinned search_path; EXECUTE granted to authenticated only.';

-- Tell PostgREST to reload its schema cache after the grant change.
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- ROLLBACK (manual): re-create the prior definition captured in the studio-script
-- BLOCK 1 snapshot, or DROP and let the previous migration state stand.
-- DROP FUNCTION IF EXISTS public.complete_user_onboarding();
-- -----------------------------------------------------------------------------
