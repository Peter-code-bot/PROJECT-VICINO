-- =============================================================================
-- CH-6 profiles PII column restriction (#2) -- STUDIO SCRIPT
-- Change: 2026-06-10-pii-column-exposure
-- =============================================================================
-- STATUS: ALREADY APPLIED (Camino 2, COMMIT, VERIFY 0 PII rows). Idempotent.
-- Canonical SQL in 20260610000009_ch6_pii_column_restrict.sql.
-- DO NOT revoke user_id / is_hidden (public handle / admin moderation read).
-- =============================================================================

-- ---- BLOCK 1: SNAPSHOT (read-only) ----
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles'
  AND grantee IN ('anon','authenticated')
ORDER BY grantee, column_name;

-- ---- BLOCK 2: APPLY ----
BEGIN;
REVOKE SELECT (email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token)
  ON public.profiles FROM anon, authenticated;
-- (then the 3 SECURITY DEFINER functions from 20260610000009: get_my_profile,
--  admin_list_users, admin_get_user, each REVOKE anon / GRANT authenticated.)
COMMIT;

-- ---- BLOCK 3: VERIFY ----
-- 3a. PII columns NOT in the SELECT grant for anon/authenticated; user_id/is_hidden ARE.
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='SELECT'
  AND grantee IN ('anon','authenticated')
  AND column_name IN ('email','telefono','rfc','ubicacion_lat','ubicacion_lng','fcm_token','user_id','is_hidden')
ORDER BY grantee, column_name;
-- expected: rows for user_id + is_hidden only; NONE for the 6 PII columns.

-- 3b. functions exist + grants
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('get_my_profile','admin_list_users','admin_get_user') ORDER BY proname;

-- ---- BLOCK 4: SMOKE (as authenticated; replace uuid) ----
-- attacker PII read -> expect 42501:
--   GET /rest/v1/profiles?select=email,telefono,rfc,ubicacion_lat,ubicacion_lng,fcm_token&id=eq.<x>
-- self: SELECT public.get_my_profile();  -- returns own row incl email
-- admin: SELECT public.admin_list_users();  -- as admin -> rows; as non-admin -> forbidden
-- public seller page still works: GET /rest/v1/profiles?select=id,nombre,user_id,ubicacion&id=eq.<x>
