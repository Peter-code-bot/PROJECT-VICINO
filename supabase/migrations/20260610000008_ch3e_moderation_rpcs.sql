-- =============================================================================
-- CH-3e -- admin/moderator RPCs for moderation column writes (#7 collateral)
-- Change: openspec/changes/2026-06-10-mass-assignment-column-locks
-- =============================================================================
-- WHY: CH-3 (20260610000005) revoked UPDATE on profiles/products_services/reviews
-- and granted only a user-safe column allowlist. But the admin moderation feature
-- (apps/web/app/admin/moderation/actions.ts) writes the PRIVILEGED columns
-- is_hidden / visible / reportada using the ordinary authenticated-role session
-- client (requireAdmin/requireAdminOrModerator return createClient(), NOT a
-- service-role client). After the REVOKE, every moderation write 42501'd -- and
-- resolveReport's hide branch swallowed the error and returned success. This was a
-- broken-legitimate-write regression. Lesson: the caller-write inventory MUST
-- include ADMIN/MODERATION paths, not just end-user paths (3 collaterals came from
-- this omission: the 5 stat triggers, update_trust_level_from_points, and these
-- moderation actions).
--
-- WHAT: two SECURITY DEFINER RPCs that re-check the caller is admin OR moderator
-- and write the moderation columns (bypassing the user column-grant). The app is
-- migrated to call them and to surface their errors.
--
-- STATUS: applied in Studio (Camino 2, COMMIT). Idempotent mirror (reconstructed;
-- reconcile vs pg_get_functiondef).
-- =============================================================================

-- ---- set is_hidden on the moderated content (listing/review/message/user) ----
CREATE OR REPLACE FUNCTION public.moderate_set_content_hidden(
  p_target_type TEXT,
  p_target_id   UUID,
  p_hidden      BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL
     OR NOT (public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'moderator')) THEN
    RAISE EXCEPTION 'forbidden: solo admin o moderator' USING ERRCODE = '42501';
  END IF;

  -- Accept both the report.target_type vocabulary (listing/user) and the
  -- table-oriented vocabulary (product/profile) the app uses for suspend/unhide.
  CASE
    WHEN p_target_type IN ('product', 'listing', 'producto', 'servicio') THEN
      UPDATE public.products_services SET is_hidden = p_hidden WHERE id = p_target_id;
    WHEN p_target_type IN ('profile', 'user', 'usuario') THEN
      UPDATE public.profiles SET is_hidden = p_hidden WHERE id = p_target_id;
    WHEN p_target_type = 'review' THEN
      UPDATE public.reviews SET is_hidden = p_hidden WHERE id = p_target_id;
    WHEN p_target_type = 'message' THEN
      UPDATE public.messages SET is_hidden = p_hidden WHERE id = p_target_id;
    ELSE
      RAISE EXCEPTION 'target_type invalido: %', p_target_type USING ERRCODE = '22023';
  END CASE;
END;
$$;
REVOKE ALL     ON FUNCTION public.moderate_set_content_hidden(TEXT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.moderate_set_content_hidden(TEXT, UUID, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.moderate_set_content_hidden(TEXT, UUID, BOOLEAN) TO authenticated;

-- ---- review moderation: set visible (+ optionally clear reportada) ----
CREATE OR REPLACE FUNCTION public.moderate_review(
  p_review_id      UUID,
  p_visible        BOOLEAN,
  p_clear_reported BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL
     OR NOT (public.has_role(v_actor, 'admin') OR public.has_role(v_actor, 'moderator')) THEN
    RAISE EXCEPTION 'forbidden: solo admin o moderator' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews
  SET visible   = p_visible,
      reportada = CASE WHEN p_clear_reported THEN false ELSE reportada END
  WHERE id = p_review_id;
END;
$$;
REVOKE ALL     ON FUNCTION public.moderate_review(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.moderate_review(UUID, BOOLEAN, BOOLEAN) FROM anon;
GRANT  EXECUTE ON FUNCTION public.moderate_review(UUID, BOOLEAN, BOOLEAN) TO authenticated;

COMMENT ON FUNCTION public.moderate_set_content_hidden(TEXT, UUID, BOOLEAN) IS
  'CH-3e: admin/moderator sets is_hidden on moderated content. SECURITY DEFINER + '
  'in-body has_role(admin|moderator) guard. Replaces direct is_hidden writes in '
  'admin/moderation/actions.ts after CH-3 column REVOKE.';
COMMENT ON FUNCTION public.moderate_review(UUID, BOOLEAN, BOOLEAN) IS
  'CH-3e: admin/moderator sets reviews.visible (+ clears reportada). SECURITY '
  'DEFINER + has_role(admin|moderator) guard. Replaces hideReview/approveReview '
  'direct UPDATE after CH-3 column REVOKE.';

-- NOTE (hardening to evaluate): the app gates suspendUser / hideReview / approveReview
-- to admin-only (requireAdmin) while these RPCs allow moderator too. The app gate is
-- the stricter layer; if defense-in-depth requires admin-only at the DB for
-- profile/user hiding, split the guard by target_type.
