-- MP#07 Fase 4 + MP#08 #6: Atomic approve verification RPC.
-- Replaces 3 non-atomic writes in admin/verifications/actions.ts.
-- SECURITY DEFINER with explicit user_roles pivot check
-- (matches require-admin-or-moderator.ts pattern in apps/web/lib/auth/).
-- Verified via SQL Camino 2 in Supabase Studio 29-May-2026.
-- Rollback atomicity confirmed via real test with simulated auth
-- session (caveat P5 of playbook).

CREATE OR REPLACE FUNCTION public.approve_verification_atomic(
  p_verification_id UUID,
  p_user_id         UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller    UUID := auth.uid();
  v_ver_found INTEGER := 0;
  v_has_trust BOOLEAN := FALSE;
BEGIN
  -- Authorization: caller must be admin or moderator. SECURITY DEFINER
  -- bypasses RLS, enforce explicitly via the user_roles pivot table.
  -- Matches require-admin-or-moderator.ts pattern in apps/web/lib/auth/.
  -- Casts to app_role enum for deterministic comparison (no implicit
  -- inference dependency).
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller
      AND role IN ('admin'::app_role, 'moderator'::app_role)
  ) THEN
    RAISE EXCEPTION 'Solo admin o moderator puede aprobar verificaciones'
      USING ERRCODE = '42501';
  END IF;

  -- Write #1: seller_verification approved. Status cast to
  -- verification_status enum.
  UPDATE public.seller_verification
  SET status      = 'approved'::verification_status,
      reviewed_at = NOW()
  WHERE id = p_verification_id;

  GET DIAGNOSTICS v_ver_found = ROW_COUNT;
  IF v_ver_found = 0 THEN
    RAISE EXCEPTION 'Verificacion no encontrada para id %', p_verification_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Write #2: profile is_verified + trust_points bump.
  UPDATE public.profiles
  SET is_verified  = TRUE,
      verified_at  = NOW(),
      trust_points = COALESCE(trust_points, 0) + 30
  WHERE id = p_user_id;

  -- Write #3: trust_level_verification upsert. current_level cast to
  -- trust_level enum.
  SELECT EXISTS(
    SELECT 1 FROM public.trust_level_verification WHERE user_id = p_user_id
  ) INTO v_has_trust;

  IF v_has_trust THEN
    UPDATE public.trust_level_verification
    SET id_verified           = TRUE,
        selfie_verified       = TRUE,
        selfie_match_verified = TRUE,
        current_level         = 'verificado'::trust_level,
        level_1_completed_at  = NOW()
    WHERE user_id = p_user_id;
  ELSE
    INSERT INTO public.trust_level_verification (
      user_id, id_verified, selfie_verified, selfie_match_verified,
      current_level, level_1_completed_at
    ) VALUES (
      p_user_id, TRUE, TRUE, TRUE, 'verificado'::trust_level, NOW()
    );
  END IF;

  RETURN jsonb_build_object(
    'verification_approved', TRUE,
    'profile_updated',       TRUE,
    'trust_level_set',       TRUE
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_verification_atomic(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.approve_verification_atomic(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_verification_atomic(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.approve_verification_atomic(UUID, UUID) IS
  'MP#07 Fase 4 + MP#08 #6: atomic approve verification. Replaces the 3 '
  'state-mutating writes (seller_verification UPDATE, profiles UPDATE, '
  'trust_level_verification upsert) in admin/verifications/actions.ts '
  'approveVerification. SECURITY DEFINER with explicit user_roles pivot '
  'check matching require-admin-or-moderator.ts. Notification + audit_log '
  'INSERTs stay outside the RPC because they do not cause divergent state '
  'on partial failure.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- DROP FUNCTION IF EXISTS public.approve_verification_atomic(UUID, UUID);
-- Then revert apps/web/app/admin/verifications/actions.ts approveVerification
-- to the previous 3-separate-writes flow (see git log of the same commit).
-- ─────────────────────────────────────────────────────────────────────────────
