-- =====================================================
-- VICINO — Account Deletion (Google Play Data Safety)
-- Migration: 20260320000019_account_deletion
-- =====================================================

-- =====================================================
-- 1. Audit log (90-day retention)
-- =====================================================
CREATE TABLE IF NOT EXISTS public.account_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_user_id UUID NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  summary JSONB,
  expires_at TIMESTAMPTZ GENERATED ALWAYS AS (deleted_at + INTERVAL '90 days') STORED
);

CREATE INDEX IF NOT EXISTS idx_deletion_log_expires
  ON public.account_deletion_log (expires_at);

ALTER TABLE public.account_deletion_log ENABLE ROW LEVEL SECURITY;
-- No explicit policies: service_role bypasses RLS, anon/authenticated cannot read.

-- =====================================================
-- 2. Anonymization support on reviews
-- The original FKs (migration 0008) are inline NO ACTION:
--   reviewer_id UUID NOT NULL REFERENCES profiles(id)
--   reviewed_id UUID NOT NULL REFERENCES profiles(id)
-- We change reviewed_id to nullable + ON DELETE SET NULL so a future
-- profile delete leaves the review (anonymized) instead of failing.
-- =====================================================
ALTER TABLE public.reviews ALTER COLUMN reviewed_id DROP NOT NULL;

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_reviewed_id_fkey;

ALTER TABLE public.reviews
  ADD CONSTRAINT reviews_reviewed_id_fkey
  FOREIGN KEY (reviewed_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ;

-- =====================================================
-- 3. Main deletion function
-- =====================================================
CREATE OR REPLACE FUNCTION public.delete_user_data(target_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_summary JSONB := '{}'::JSONB;
  cnt INTEGER;
BEGIN
  -- Only allow if caller is service_role or the user themselves.
  IF auth.uid() IS NOT NULL AND auth.uid() != target_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot delete another user''s data';
  END IF;

  -- Messages authored by user
  DELETE FROM public.messages WHERE autor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('messages', cnt);

  -- Chats where user is buyer or seller
  DELETE FROM public.chats
    WHERE comprador_id = target_user_id OR vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('chats', cnt);

  -- Favorites
  DELETE FROM public.favorites WHERE usuario_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('favorites', cnt);

  -- Reviews authored by user
  DELETE FROM public.reviews WHERE reviewer_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_authored', cnt);

  -- Reviews about user's products: delete (the product is being removed,
  -- so the review loses its subject). reviews.product_id is NO ACTION,
  -- so this MUST happen before deleting products_services.
  DELETE FROM public.reviews
    WHERE product_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_on_user_products', cnt);

  -- Remaining reviews where user was reviewed: anonymize (keeps community
  -- reputation context). reviewed_id becomes NULL via ON DELETE SET NULL,
  -- but we set it explicitly + stamp anonymized_at for clarity.
  UPDATE public.reviews
    SET reviewed_id = NULL,
        anonymized_at = NOW()
    WHERE reviewed_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_received_anonymized', cnt);

  -- Sale confirmations (English column names in this table)
  DELETE FROM public.sale_confirmations
    WHERE buyer_id = target_user_id OR seller_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('sale_confirmations', cnt);

  -- Coupons
  DELETE FROM public.coupons WHERE vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('coupons', cnt);

  -- Disputes
  DELETE FROM public.disputes
    WHERE reporter_id = target_user_id OR reported_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('disputes', cnt);

  -- Notifications
  DELETE FROM public.notifications WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('notifications', cnt);

  -- Verifications (seller + trust)
  DELETE FROM public.seller_verification WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('seller_verifications', cnt);

  DELETE FROM public.trust_level_verification WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('trust_verifications', cnt);

  -- Bookings
  DELETE FROM public.bookings
    WHERE comprador_id = target_user_id OR vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('bookings', cnt);

  -- Service availability (via user's listings)
  DELETE FROM public.service_availability
    WHERE servicio_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('service_availability', cnt);

  -- Product variants (via user's products)
  DELETE FROM public.product_variants
    WHERE producto_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('product_variants', cnt);

  -- Media assets for user's products/services
  DELETE FROM public.media_assets
    WHERE owner_type IN ('producto', 'servicio')
      AND owner_id IN (
        SELECT id FROM public.products_services WHERE creador_id = target_user_id
      );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('media_assets_products', cnt);

  -- Media assets for user's profile
  DELETE FROM public.media_assets
    WHERE owner_type = 'profile' AND owner_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('media_assets_profile', cnt);

  -- Products and services
  DELETE FROM public.products_services WHERE creador_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('products_services', cnt);

  -- Roles
  DELETE FROM public.user_roles WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('user_roles', cnt);

  -- Profile (last, before auth.users)
  DELETE FROM public.profiles WHERE id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('profile', cnt);

  -- Audit log
  INSERT INTO public.account_deletion_log (
    deleted_user_id,
    deleted_at,
    summary
  ) VALUES (
    target_user_id,
    NOW(),
    deleted_summary
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'deleted_at', NOW(),
    'summary', deleted_summary
  );
END;
$$;

-- =====================================================
-- 4. Cleanup helper (cron-ready)
-- =====================================================
CREATE OR REPLACE FUNCTION public.cleanup_old_deletion_logs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.account_deletion_log
    WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- =====================================================
-- 5. Permissions
-- =====================================================
GRANT EXECUTE ON FUNCTION public.delete_user_data(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_user_data(UUID) FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_old_deletion_logs() TO service_role;
