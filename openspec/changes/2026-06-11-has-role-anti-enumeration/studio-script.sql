-- =============================================================================
-- #14 has_role anti-enumeration -- STUDIO SCRIPT
-- Change: 2026-06-11-has-role-anti-enumeration
-- =============================================================================
-- STATUS: ALREADY APPLIED (Camino 2: DRY-RUN -> WRITE -> VERIFY OK). Idempotent.
-- Canonical SQL in 20260611213630_14_has_role_anti_enumeration.sql.
-- =============================================================================

-- ---- BLOCK 1: SNAPSHOT (read-only) ----
SELECT prosecdef, proconfig, proacl, pg_get_functiondef(oid) AS body
FROM pg_proc WHERE proname = 'has_role' AND pronamespace = 'public'::regnamespace;
SELECT grantee, privilege_type FROM information_schema.role_routine_grants
WHERE routine_schema='public' AND routine_name='has_role' ORDER BY grantee;

-- ---- BLOCK 2: APPLY (see migration for full body) ----
-- CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role) ... guard self-or-admin,
--   RETURN false (not RAISE) on non-admin third-party probe; original EXISTS body otherwise.
-- REVOKE EXECUTE FROM PUBLIC, anon; GRANT EXECUTE TO authenticated, service_role.

-- ---- BLOCK 3: VERIFY (live results recorded) ----
-- es_definer=true; search_path={public,pg_temp}; tiene_guard=true;
-- anon_exec=false; auth_exec=true; svc_exec=true. Re-verify out-of-txn: guard_vivo=true, anon_exec=false.

-- ---- BLOCK 4: SMOKE (DRY-RUN, BEGIN; SET LOCAL ROLE authenticated; jwt sub=<non-admin>; ROLLBACK) ----
-- 7/7 pass with real non-admin caller 2977f43a (ephemeral 'user' role in-txn):
--   1) self-admin not broken                4) self-noadmin (real role) not broken
--   2) enumeration blocked (non-admin->false) 5) cross-user enumeration blocked
--   3) admin sees third party's real role     6-7) ACL anon=false, auth=true

-- ---- BLOCK 5: BLAST-RADIUS INVENTORY (read-only, all confirmed pass auth.uid()) ----
SELECT tablename, policyname, cmd FROM pg_policies
WHERE qual ILIKE '%has_role%' OR with_check ILIKE '%has_role%' ORDER BY tablename, policyname;
-- expect 14, all calling has_role((SELECT auth.uid()), ...).
SELECT proname FROM pg_proc WHERE prosrc ILIKE '%has_role%' AND proname <> 'has_role' ORDER BY proname;
-- expect 7: admin_get_user, admin_list_users, make_admin, manage_user_role, moderate_review,
--           moderate_set_content_hidden, resolve_dispute_admin.
