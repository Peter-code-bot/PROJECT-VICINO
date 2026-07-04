-- Harden public.complete_user_onboarding() -- change 2026-07-04-harden-onboarding-rpc.
--
-- Problem: this RPC was created ad-hoc in Supabase Studio during the onboarding
-- saga (898dc29 -> 3810930) and never captured as a migration nor hardened. Its
-- live state was SECURITY DEFINER with no pinned search_path and the Supabase
-- default EXECUTE grant left on PUBLIC/anon -- i.e. a privileged mutation
-- reachable by a direct anonymous PostgREST call.
--
-- Grant audit (FASE C smoke, 2026-07-04): the `authenticated` role holds NO
-- table-level UPDATE/SELECT privilege on public.profiles -- only service_role and
-- postgres do. profiles' UPDATE policy ("Users can update own profile" TO
-- authenticated USING/WITH CHECK auth.uid()=id) is therefore necessary but NOT
-- sufficient: RLS filters rows only after the base-table grant exists. A
-- SECURITY INVOKER version fails with 42501 (permission denied) because the
-- caller has no UPDATE grant. Verified live: INVOKER smoke returned 42501.
--
-- Fix: SECURITY DEFINER, hardened. The function is owned by postgres (which holds
-- the table grants), so the UPDATE succeeds; DEFINER bypasses RLS, so the body
-- MUST enforce authorization itself. It does: the function takes NO parameters
-- and derives the target row from auth.uid() (server-side, from the caller's JWT),
-- writing only `WHERE id = auth.uid()`. A caller can never touch another user's
-- row -- there is no id parameter to spoof. This is the minimum viable privilege:
-- the RPC is the single vector, search_path is pinned, anon/PUBLIC are revoked.
--
-- search_path is pinned to '' (empty); every reference is fully qualified
-- (public.profiles, auth.uid()), following the search_path-lock pattern from
-- 20260425000001_fix_security_definer_search_path.sql.
--
-- REVOKE/GRANT mirrors 20260521000011_rpc_update_profile_and_pause.sql: Supabase's
-- project-level default privileges grant EXECUTE directly to anon (not via PUBLIC),
-- so REVOKE FROM PUBLIC is not enough -- we REVOKE FROM anon explicitly.
--
-- Delivery: Camino 2 (Pedro ran the WRITE in Studio; smoke green). This file is
-- repo-of-record and is NOT applied via `supabase db push`. See the OpenSpec change
-- studio-script.sql for the snapshot/verify/smoke blocks.

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

COMMENT ON FUNCTION public.complete_user_onboarding() IS
  'Onboarding completion: flips profiles.has_seen_onboarding to true for the '
  'caller. SECURITY DEFINER (owner postgres) because authenticated has no '
  'table-level UPDATE grant on profiles. Authorization enforced in-body: no '
  'parameters, writes only WHERE id = auth.uid(); anon rejected via NULL guard '
  'and REVOKE. Pinned search_path; EXECUTE granted to authenticated only.';

-- Tell PostgREST to reload its schema cache after the grant change.
NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- ROLLBACK (manual): re-create the prior definition captured in the studio-script
-- BLOCK 1 snapshot, or DROP and let the previous migration state stand.
-- DROP FUNCTION IF EXISTS public.complete_user_onboarding();
-- -----------------------------------------------------------------------------
