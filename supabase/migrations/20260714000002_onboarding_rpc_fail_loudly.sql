-- Anti-loop for public.complete_user_onboarding() -- onboarding audit 2026-07-14.
--
-- Problem: the hardened RPC (20260704000001) runs UPDATE ... WHERE id =
-- auth.uid() and RETURNS void. For a user whose profiles row is missing
-- (signup trigger raced or failed under the old swallow), the UPDATE touches
-- 0 rows and the RPC still "succeeds": the client pushes to /, the layout
-- guard sees no profile and used to bounce back to /bienvenida -- a silent
-- loop. Commit 4e899f3 had this 0-row protection when the client did a direct
-- UPDATE; the switch to the RPC lost it.
--
-- Fix: same signature and RETURNS void (CREATE OR REPLACE preserves the
-- EXECUTE grants from 20260704000001 -- no DROP, no re-GRANT), but report the
-- 0-row case as an exception. completeOnboarding() already propagates RPC
-- errors to a visible toast.
--
-- Delivery: Camino 2 (Pedro runs the WRITE in Studio). This file is
-- repo-of-record and is NOT applied via `supabase db push`.

CREATE OR REPLACE FUNCTION public.complete_user_onboarding()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_rows integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no authenticated user';
  END IF;

  UPDATE public.profiles
  SET has_seen_onboarding = true
  WHERE id = auth.uid();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Missing profiles row (trigger race or failed signup trigger): fail
    -- loudly instead of the silent success that produced the /bienvenida loop.
    RAISE EXCEPTION 'onboarding: no profile row for user %', auth.uid()
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.complete_user_onboarding() IS
  'Onboarding completion: flips profiles.has_seen_onboarding to true for the '
  'caller. SECURITY DEFINER (owner postgres); authorization in-body via '
  'auth.uid(); raises P0002 if the profile row is missing instead of silently '
  'updating 0 rows (anti-loop). Pinned search_path; EXECUTE: authenticated only.';

NOTIFY pgrst, 'reload schema';
