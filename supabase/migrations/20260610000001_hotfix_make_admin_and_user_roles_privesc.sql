-- =============================================================================
-- P0 HOTFIX -- make_admin privilege escalation + user_roles lockdown (Finding #1)
-- Change: openspec/changes/2026-06-10-hotfix-make-admin-privesc
-- =============================================================================
-- WHY: make_admin(p_email) was SECURITY DEFINER with NO authorization guard and
-- the Supabase default EXECUTE grant to anon/authenticated. Any holder of the
-- public anon key could POST /rest/v1/rpc/make_admin and self-promote to admin
-- (CWE-269 / CWE-862, CVSS 9.8). Second vector: public.user_roles allowed direct
-- writes by authenticated (default table grant), so an attacker could INSERT an
-- admin row for themselves WITHOUT make_admin at all.
--
-- WHAT (two parts, BOTH already applied manually in Supabase Studio via Camino 2
-- on 2026-06-10 -- this file is the idempotent mirror kept for git history):
--   CH-1  make_admin: admin-only in-body guard + REVOKE anon/PUBLIC + GRANT authenticated.
--   CH-1b user_roles: REVOKE all writes from anon+authenticated, REVOKE SELECT from
--         anon, FORCE RLS, and an admin-only manage policy with USING + WITH CHECK.
--
-- RUN MODEL: applied by Pedro in Supabase Studio SQL Editor (browser). NOT via
-- `supabase db push` -- the schema_migrations ledger is desynchronized on this
-- project (see memory reference_supabase_project).
--
-- CAVEAT -- FORCE RLS recursion (see design.md): user_roles FORCE ROW LEVEL
-- SECURITY is only safe if the object-owner role (postgres) carries the BYPASSRLS
-- attribute. That attribute lets the SECURITY DEFINER has_role() read user_roles
-- without re-entering RLS, which is what prevents infinite recursion in the ~20
-- policies that call has_role() AND in the user_roles "Admin can manage roles"
-- policy itself. BYPASSRLS on postgres is the Supabase default, but it MUST be
-- confirmed by the BLOCK 4 recursion smoke test (studio-script.sql) before relying
-- on FORCE RLS. If recursion is observed, run
--   ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;
-- the grant-level REVOKE below already blocks the attacker on its own.
--
-- BOOTSTRAP: the first admin row must be seeded once, directly as postgres in
-- Studio (which bypasses the new guard) -- e.g. run `SELECT make_admin('<email>')`
-- as postgres, or a direct INSERT INTO public.user_roles. After that, only an
-- existing admin can promote others.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- CH-1 -- make_admin: admin-only guard + grants
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.make_admin(p_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller  UUID := auth.uid();
  v_user_id UUID;
BEGIN
  -- Authorization: caller must already be an admin. SECURITY DEFINER bypasses
  -- RLS, so enforce explicitly via the user_roles pivot (mirrors the pattern in
  -- 20260528000003_rpc_approve_verification_atomic.sql). anon (v_caller IS NULL)
  -- is rejected.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller AND role = 'admin'::app_role
  ) THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede promover'
      USING ERRCODE = '42501', HINT = 'caller must already hold the admin role';
  END IF;

  SELECT id INTO v_user_id FROM public.profiles WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', p_email
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$$;

REVOKE ALL     ON FUNCTION public.make_admin(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.make_admin(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.make_admin(TEXT) TO authenticated;

COMMENT ON FUNCTION public.make_admin(TEXT) IS
  'P0 hotfix 2026-06-10 (#1): admin-only guard via user_roles pivot. SECURITY '
  'DEFINER with explicit caller-is-admin check. Break-glass tool, no app caller. '
  'Bootstrap the first admin as postgres in Studio.';

-- ----------------------------------------------------------------------------
-- CH-1b -- user_roles: close the second privesc vector (direct table writes)
-- ----------------------------------------------------------------------------
-- Remove the Supabase default write grants. After this, anon has NO access and
-- authenticated keeps only SELECT (row-gated by the policies below).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.user_roles FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;

-- RLS already ENABLED in 20260320000002_profiles.sql. FORCE so the table owner is
-- also subject (defense-in-depth). See the FORCE RLS recursion CAVEAT above.
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE  ROW LEVEL SECURITY;

-- Admin-only manage policy with BOTH USING and WITH CHECK (the original had USING
-- only). auth.uid() wrapped as (select auth.uid()) preserves the A2 InitPlan
-- optimization (20260602000001_optimize_rls_performance.sql).
DROP POLICY IF EXISTS "Admin can manage roles" ON public.user_roles;
CREATE POLICY "Admin can manage roles" ON public.user_roles
  FOR ALL
  TO authenticated
  USING      (has_role((select auth.uid()), 'admin'))
  WITH CHECK (has_role((select auth.uid()), 'admin'));

-- NOTE: "Users can view own roles" (SELECT, USING (select auth.uid()) = user_id)
-- is intentionally LEFT INTACT from 20260602000001 -- it lets a user read their
-- own role row (and lets has_role() self-check) without exposing others.

-- =============================================================================
-- ROLLBACK (manual) -- if FORCE RLS causes recursion or any regression:
--   ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;
-- Full revert of the privesc fix is NOT recommended (re-opens CVSS 9.8). The
-- make_admin guard and the write REVOKEs should remain.
-- =============================================================================
