-- =============================================================================
-- P0 HOTFIX -- make_admin + user_roles lockdown -- SUPABASE STUDIO SCRIPT
-- Change: 2026-06-10-hotfix-make-admin-privesc   (audit finding #1, CVSS 9.8)
-- =============================================================================
-- STATUS: ALREADY APPLIED by Pedro in Studio on 2026-06-10 (Camino 2, COMMIT done).
-- This file is the canonical record + a re-runnable, idempotent version:
--   BLOCK 1 snapshot -> BLOCK 2 dry-run (BEGIN/ROLLBACK) -> BLOCK 3 real (COMMIT)
--   -> BLOCK 4 verify + recursion smoke.
--
-- HOW TO RUN (if re-applying, or applying to a new environment):
--   1. BLOCK 1 -> Run. Save the output as a rollback reference.
--   2. BLOCK 2 -> Run. Wraps in BEGIN/ROLLBACK; nothing persists. Use it to confirm
--      the attacker-blocked and recursion-free smokes (uncomment them first).
--   3. BLOCK 3 -> Run. Same DDL with COMMIT.
--   4. BLOCK 4 -> Run. Confirm grants/policies + the CRITICAL recursion smoke.
--
-- All statements are transactional DDL (no CREATE INDEX CONCURRENTLY here), so
-- BLOCK 2/3 can wrap everything in a single BEGIN/COMMIT.
-- =============================================================================


-- =============================================================================
-- BLOCK 1 -- SNAPSHOT BEFORE (read-only; save output)
-- =============================================================================
SELECT proname, prosecdef, proacl, pg_get_function_arguments(oid) AS args
FROM pg_proc WHERE proname = 'make_admin';

SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'user_roles'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname = 'user_roles';


-- =============================================================================
-- BLOCK 2 -- DRY-RUN (BEGIN/ROLLBACK -- validates everything, persists nothing)
-- Replace <NON_ADMIN_UUID> with a real non-admin auth user id before uncommenting
-- the smokes.
-- =============================================================================
BEGIN;

-- ---- CH-1: make_admin guard + grants ----
CREATE OR REPLACE FUNCTION public.make_admin(p_email TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_caller UUID := auth.uid(); v_user_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller AND role = 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede promover' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_user_id FROM public.profiles WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', p_email USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::app_role) ON CONFLICT (user_id, role) DO NOTHING;
END; $$;

REVOKE ALL     ON FUNCTION public.make_admin(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.make_admin(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.make_admin(TEXT) TO authenticated;

-- ---- CH-1b: user_roles lockdown ----
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.user_roles FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can manage roles" ON public.user_roles;
CREATE POLICY "Admin can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING      (has_role((select auth.uid()), 'admin'))
  WITH CHECK (has_role((select auth.uid()), 'admin'));

-- ---- SMOKE 1: attacker (authenticated, non-admin) cannot write user_roles ----
-- Expect ERROR: "permission denied for table user_roles" (grant-level block,
-- evaluated before RLS). Uncomment to assert:
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"<NON_ADMIN_UUID>","role":"authenticated"}';
-- INSERT INTO public.user_roles (user_id, role) VALUES ('<NON_ADMIN_UUID>', 'admin');
-- RESET ROLE;

-- ---- SMOKE 2: recursion check -- a has_role-gated read must NOT error ----
-- Expect up to 1 row, NOT "infinite recursion detected in policy for relation
-- user_roles". Uncomment to assert:
-- SET LOCAL ROLE authenticated;
-- SET LOCAL request.jwt.claims = '{"sub":"<NON_ADMIN_UUID>","role":"authenticated"}';
-- SELECT id FROM public.products_services LIMIT 1;
-- RESET ROLE;

ROLLBACK;
-- ^ Dry-run complete. Nothing persisted. If the smokes pass, run BLOCK 3.


-- =============================================================================
-- BLOCK 3 -- REAL APPLY (same DDL, COMMIT)
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.make_admin(p_email TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_caller UUID := auth.uid(); v_user_id UUID;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_caller AND role = 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede promover' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_user_id FROM public.profiles WHERE email = p_email LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'User with email % not found', p_email USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_user_id, 'admin'::app_role) ON CONFLICT (user_id, role) DO NOTHING;
END; $$;

REVOKE ALL     ON FUNCTION public.make_admin(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.make_admin(TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.make_admin(TEXT) TO authenticated;

COMMENT ON FUNCTION public.make_admin(TEXT) IS
  'P0 hotfix 2026-06-10 (#1): admin-only guard via user_roles pivot. SECURITY DEFINER with explicit caller-is-admin check. Break-glass tool, no app caller.';

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.user_roles FROM anon, authenticated;
REVOKE SELECT ON public.user_roles FROM anon;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can manage roles" ON public.user_roles;
CREATE POLICY "Admin can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING      (has_role((select auth.uid()), 'admin'))
  WITH CHECK (has_role((select auth.uid()), 'admin'));

COMMIT;


-- =============================================================================
-- BLOCK 4 -- VERIFY (read-only) + CRITICAL recursion smoke
-- =============================================================================
-- 4a. make_admin: SECURITY DEFINER; anon has NO EXECUTE; authenticated has EXECUTE
SELECT proname, prosecdef, proacl FROM pg_proc WHERE proname = 'make_admin';

-- 4b. user_roles grants: expect ONLY authenticated|SELECT (anon: nothing)
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'user_roles'
  AND grantee IN ('anon', 'authenticated')
ORDER BY grantee, privilege_type;

-- 4c. user_roles is FORCE RLS (relforcerowsecurity = true)
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname = 'user_roles';

-- 4d. policies present (Admin can manage roles has USING + WITH CHECK)
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_roles'
ORDER BY policyname;

-- 4e-pre. EVIDENCE for the FORCE RLS safety assumption: postgres SHOULD be true.
--   If postgres.rolbypassrls = false, FORCE RLS on user_roles WILL recurse -- drop it.
--   Save this output to the decision log so the assumption is evidence-backed.
SELECT rolname, rolbypassrls
FROM pg_roles
WHERE rolname IN ('postgres', 'authenticated', 'anon', 'authenticator', 'service_role')
ORDER BY rolname;

-- 4f. Bootstrap admin must exist (>= 1) or the admin plane is locked out.
SELECT count(*) AS admin_rows FROM public.user_roles WHERE role = 'admin'::app_role;

-- 4e. CRITICAL recursion smoke -- run as a real authenticated session (replace uuid).
--   MUST return without "infinite recursion detected in policy for relation
--   user_roles". If it recurses, the owner role lacks BYPASSRLS and FORCE RLS is
--   unsafe in this DB -> run: ALTER TABLE public.user_roles NO FORCE ROW LEVEL SECURITY;
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<REAL_USER_UUID>","role":"authenticated"}';
--   SELECT id FROM public.products_services LIMIT 1;            -- has_role via block_aware policy
--   SELECT public.has_role('<REAL_USER_UUID>'::uuid, 'admin'::app_role);  -- direct
-- ROLLBACK;


-- =============================================================================
-- BLOCK 5 -- CH-1c: manage_user_role RPC (restores admin role management after the
-- CH-1b write REVOKE). ALREADY APPLIED 2026-06-10 (Camino 2, COMMIT). Idempotent.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.manage_user_role(
  p_user_id UUID, p_role app_role, p_action TEXT
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_caller UUID := auth.uid(); v_admin_count INTEGER;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede gestionar roles' USING ERRCODE = '42501';
  END IF;
  IF p_action NOT IN ('assign', 'remove') THEN
    RAISE EXCEPTION 'accion invalida: %', p_action USING ERRCODE = '22023';
  END IF;
  IF p_action = 'assign' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    -- TOCTOU-safe: lock admin rows with a plain PERFORM ... FOR UPDATE (NO
    -- aggregate -- "count(*) ... FOR UPDATE" is invalid, SQLSTATE 0A000); then
    -- count in a separate statement under the lock.
    IF p_role = 'admin'::app_role THEN
      PERFORM 1 FROM public.user_roles WHERE role = 'admin'::app_role FOR UPDATE;
      IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user_id AND role = 'admin'::app_role) THEN
        SELECT count(*) INTO v_admin_count FROM public.user_roles WHERE role = 'admin'::app_role;
        IF v_admin_count <= 1 THEN
          RAISE EXCEPTION 'no se puede quitar el ultimo admin' USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = p_role;
  END IF;
END; $$;

REVOKE ALL     ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) TO authenticated;

COMMIT;

-- ---- CH-1c smokes (run as real sessions; replace uuids) ----
-- S1 attacker: authenticated NON-admin -> expect 'forbidden: solo un admin ...' (42501)
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<NON_ADMIN_UUID>","role":"authenticated"}';
--   SELECT public.manage_user_role('<TARGET_UUID>'::uuid, 'moderator'::app_role, 'assign');
-- ROLLBACK;
--
-- S2 admin assign: authenticated ADMIN -> expect success, row appears
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<ADMIN_UUID>","role":"authenticated"}';
--   SELECT public.manage_user_role('<TARGET_UUID>'::uuid, 'moderator'::app_role, 'assign');
--   SELECT user_id, role FROM public.user_roles WHERE user_id = '<TARGET_UUID>';
-- ROLLBACK;
--
-- S3 last-admin guard: admin removes the only admin -> expect 'no se puede quitar el ultimo admin'
-- (run in a DB with exactly 1 admin, inside BEGIN/ROLLBACK so nothing persists).

-- 4g. VERIFY grants on the RPC (anon: none; authenticated: EXECUTE)
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name = 'manage_user_role' AND grantee IN ('anon', 'authenticated')
ORDER BY grantee;
