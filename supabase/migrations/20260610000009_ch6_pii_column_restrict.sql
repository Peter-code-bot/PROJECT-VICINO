-- =============================================================================
-- CH-6 -- restrict PII columns on profiles + self/admin read RPCs (#2)
-- Change: openspec/changes/2026-06-10-pii-column-exposure
-- =============================================================================
-- WHY: anon/authenticated could SELECT PII columns of profiles directly via
-- PostgREST (email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token). The
-- row-SELECT was already gated (block_aware_profiles_select) but RLS gates rows,
-- not columns. Fix: REVOKE SELECT on the PII columns; serve the owner's own PII via
-- a SECURITY DEFINER RPC, and admin PII reads via admin RPCs (lesson CH-3: admin
-- reads go through guarded RPCs, never a public view).
--
-- STATUS: applied in Studio (Camino 2, COMMIT, VERIFY 0 PII rows). Idempotent mirror
-- (reconcile vs information_schema.column_privileges + pg_get_functiondef).
--
-- ==> RECONCILE (IMPORTANT): the applied set reportedly also revoked SELECT on
-- `is_hidden` and `user_id`. This mirror does NOT revoke those, because they are
-- NOT PII and revoking them BREAKS the app:
--   * user_id is the PUBLIC 8-char handle shown on the public seller page
--     apps/web/app/(marketplace)/vendedor/[id]/page.tsx:36 (and searchable). Revoking
--     it 42501s that public page -- a public handle cannot be made private.
--   * is_hidden is read by the admin moderation list
--     apps/web/app/admin/moderation/users/page.tsx:31.
-- RESOLVED 2026-06-10: user_id / is_hidden re-granted (VERIFY 4 correct rows). This
-- mirror revokes ONLY the 6 PII columns and explicitly re-grants user_id / is_hidden
-- (self-healing on replay).
-- =============================================================================

-- ---- REVOKE SELECT on the 6 PII columns (keep all other columns readable) ----
REVOKE SELECT (email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token)
  ON public.profiles FROM anon, authenticated;

-- Reconcile: user_id (public handle) + is_hidden (admin moderation read) are NOT PII
-- and MUST stay readable. Re-grant explicitly so a DB where they were mistakenly
-- revoked is self-healed (no-op on a fresh DB; a fix on a previously-over-revoked one).
GRANT SELECT (user_id, is_hidden) ON public.profiles TO anon, authenticated;

-- ---- self reads own PII via SECURITY DEFINER (auth.uid()-scoped) ----
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT * FROM public.profiles WHERE id = auth.uid();
$$;
REVOKE ALL     ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_profile() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- ---- admin reads PII via guarded SECURITY DEFINER RPCs ----
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS SETOF public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: solo admin' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public.profiles;
END;
$$;
REVOKE ALL     ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_user(p_user_id UUID)
RETURNS public.profiles
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.profiles;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: solo admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.profiles WHERE id = p_user_id;
  RETURN v_row;
END;
$$;
REVOKE ALL     ON FUNCTION public.admin_get_user(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_user(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_get_user(UUID) TO authenticated;

COMMENT ON FUNCTION public.get_my_profile() IS
  'CH-6 (#2): returns the caller''s own profile row (all columns incl PII), '
  'auth.uid()-scoped. Self-service replacement for select(*) after the PII REVOKE.';
COMMENT ON FUNCTION public.admin_list_users() IS
  'CH-6 (#2): admin-only (has_role guard) SETOF profiles with PII for the admin '
  'users panel. Filters/order/limit applied by PostgREST on the result set.';
COMMENT ON FUNCTION public.admin_get_user(UUID) IS
  'CH-6 (#2): admin-only single profile incl PII (e.g. verification submitter email).';
