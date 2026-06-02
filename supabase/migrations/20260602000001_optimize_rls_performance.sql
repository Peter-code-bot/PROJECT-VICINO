-- =============================================================================
-- A2 · Optimize RLS Performance
-- Change: 2026-06-02-optimize-rls-performance
-- =============================================================================
-- This migration wraps every inline auth.uid() reference in USING / WITH CHECK
-- as (select auth.uid()) so PostgreSQL evaluates it once per query (InitPlan)
-- instead of once per row. It also adds TO authenticated to user-scoped
-- policies and creates 3 missing indexes.
--
-- RUN MODEL: Pedro runs this manually in Supabase Studio SQL Editor (browser).
-- It is NOT applied via `supabase db push` — the schema_migrations ledger is
-- known-desynchronized on this project.
--
-- The companion Studio script (see openspec/changes/2026-06-02-optimize-rls-
-- performance/) wraps these statements in a dry-run (BEGIN/ROLLBACK) followed
-- by the real apply. This file contains only the canonical apply for git
-- history.
--
-- Out of scope:
--   - PostGIS / ubicacion_geo policies and idx_products_location
--   - media_assets polymorphic ownership refactor
--   - reviews.visible deprecation
--   - F5 of A1 (getClaims migration — requires Supabase Dashboard JWT change)
-- =============================================================================

-- =============================================================================
-- PART 1 — ALTER POLICY (transactional)
-- =============================================================================
BEGIN;

-- -------------------------------------------------------------------
-- public.profiles
-- -------------------------------------------------------------------
ALTER POLICY "Users can update own profile" ON public.profiles
  TO authenticated
  USING ((select auth.uid()) = id)
  WITH CHECK ((select auth.uid()) = id);

ALTER POLICY "Allow trigger insert profiles" ON public.profiles
  TO authenticated
  WITH CHECK ((select auth.uid()) = id);

ALTER POLICY "block_aware_profiles_select" ON public.profiles
  USING (
    (select auth.uid()) = id
    OR has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
    OR (
      (select auth.uid()) IS NULL
      AND is_hidden = FALSE
    )
    OR (
      (select auth.uid()) IS NOT NULL
      AND is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = (select auth.uid()) AND ub.blocked_id = profiles.id)
            OR (ub.blocker_id = profiles.id AND ub.blocked_id = (select auth.uid()))
      )
    )
  );

-- -------------------------------------------------------------------
-- public.user_roles
-- -------------------------------------------------------------------
ALTER POLICY "Users can view own roles" ON public.user_roles
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Admin can manage roles" ON public.user_roles
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

-- -------------------------------------------------------------------
-- public.categories
-- -------------------------------------------------------------------
ALTER POLICY "Admin can manage categories" ON public.categories
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

-- -------------------------------------------------------------------
-- public.products_services
-- -------------------------------------------------------------------
ALTER POLICY "Sellers can create products" ON public.products_services
  TO authenticated
  WITH CHECK ((select auth.uid()) = creador_id);

ALTER POLICY "Sellers can update own products" ON public.products_services
  TO authenticated
  USING ((select auth.uid()) = creador_id)
  WITH CHECK ((select auth.uid()) = creador_id);

ALTER POLICY "Sellers can delete own products" ON public.products_services
  TO authenticated
  USING ((select auth.uid()) = creador_id);

ALTER POLICY "block_aware_products_select" ON public.products_services
  USING (
    (select auth.uid()) = creador_id
    OR has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
    OR (
      (select auth.uid()) IS NULL
      AND estatus = 'disponible'
      AND is_hidden = FALSE
    )
    OR (
      (select auth.uid()) IS NOT NULL
      AND estatus = 'disponible'
      AND is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = (select auth.uid()) AND ub.blocked_id = products_services.creador_id)
            OR (ub.blocker_id = products_services.creador_id AND ub.blocked_id = (select auth.uid()))
      )
    )
  );

-- -------------------------------------------------------------------
-- public.product_variants
-- -------------------------------------------------------------------
ALTER POLICY "Sellers can manage own variants" ON public.product_variants
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services
       WHERE products_services.id = product_variants.producto_id
         AND products_services.creador_id = (select auth.uid())
    )
  );

-- -------------------------------------------------------------------
-- public.media_assets
-- -------------------------------------------------------------------
ALTER POLICY "media select ownership aware" ON public.media_assets
  USING (
    (
      owner_type IN ('producto', 'servicio')
      AND EXISTS (
        SELECT 1 FROM public.products_services ps
        WHERE ps.id = media_assets.owner_id
          AND (ps.estatus = 'disponible' OR ps.creador_id = (select auth.uid()))
      )
    )
    OR (owner_type = 'profile')
    OR (
      owner_type = 'review'
      AND EXISTS (
        SELECT 1 FROM public.reviews r
        WHERE r.id = media_assets.owner_id AND r.visible = TRUE
      )
    )
    OR (
      owner_type = 'chat'
      AND EXISTS (
        SELECT 1 FROM public.chats c
        WHERE c.id = media_assets.owner_id
          AND (c.comprador_id = (select auth.uid()) OR c.vendedor_id = (select auth.uid()))
      )
    )
  );

ALTER POLICY "media insert ownership aware" ON public.media_assets
  TO authenticated
  WITH CHECK (
    (select auth.uid()) IS NOT NULL
    AND (
      (
        owner_type IN ('producto', 'servicio')
        AND EXISTS (
          SELECT 1 FROM public.products_services ps
          WHERE ps.id = media_assets.owner_id AND ps.creador_id = (select auth.uid())
        )
      )
      OR (owner_type = 'profile' AND owner_id = (select auth.uid()))
      OR (
        owner_type = 'review'
        AND EXISTS (
          SELECT 1 FROM public.reviews r
          WHERE r.id = media_assets.owner_id AND r.reviewer_id = (select auth.uid())
        )
      )
      OR (
        owner_type = 'chat'
        AND EXISTS (
          SELECT 1 FROM public.chats c
          WHERE c.id = media_assets.owner_id
            AND (c.comprador_id = (select auth.uid()) OR c.vendedor_id = (select auth.uid()))
        )
      )
    )
  );

ALTER POLICY "media update ownership aware" ON public.media_assets
  TO authenticated
  USING (
    (select auth.uid()) IS NOT NULL
    AND (
      (owner_type IN ('producto','servicio') AND EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id = media_assets.owner_id AND ps.creador_id = (select auth.uid())))
      OR (owner_type = 'profile' AND owner_id = (select auth.uid()))
      OR (owner_type = 'review' AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = media_assets.owner_id AND r.reviewer_id = (select auth.uid())))
      OR (owner_type = 'chat' AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = media_assets.owner_id AND (c.comprador_id = (select auth.uid()) OR c.vendedor_id = (select auth.uid()))))
    )
  )
  WITH CHECK (
    (select auth.uid()) IS NOT NULL
    AND (
      (owner_type IN ('producto','servicio') AND EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id = media_assets.owner_id AND ps.creador_id = (select auth.uid())))
      OR (owner_type = 'profile' AND owner_id = (select auth.uid()))
      OR (owner_type = 'review' AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = media_assets.owner_id AND r.reviewer_id = (select auth.uid())))
      OR (owner_type = 'chat' AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = media_assets.owner_id AND (c.comprador_id = (select auth.uid()) OR c.vendedor_id = (select auth.uid()))))
    )
  );

ALTER POLICY "media delete ownership aware" ON public.media_assets
  TO authenticated
  USING (
    (select auth.uid()) IS NOT NULL
    AND (
      (owner_type IN ('producto','servicio') AND EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id = media_assets.owner_id AND ps.creador_id = (select auth.uid())))
      OR (owner_type = 'profile' AND owner_id = (select auth.uid()))
      OR (owner_type = 'review' AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = media_assets.owner_id AND r.reviewer_id = (select auth.uid())))
      OR (owner_type = 'chat' AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = media_assets.owner_id AND (c.comprador_id = (select auth.uid()) OR c.vendedor_id = (select auth.uid()))))
    )
  );

-- -------------------------------------------------------------------
-- public.sale_confirmations
-- -------------------------------------------------------------------
ALTER POLICY "Participants can view own confirmations" ON public.sale_confirmations
  TO authenticated
  USING ((select auth.uid()) = buyer_id OR (select auth.uid()) = seller_id);

ALTER POLICY "Participants can create confirmations" ON public.sale_confirmations
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = initiated_by
    AND ((select auth.uid()) = buyer_id OR (select auth.uid()) = seller_id)
  );

ALTER POLICY "Participants can confirm or cancel" ON public.sale_confirmations
  TO authenticated
  USING ((select auth.uid()) = buyer_id OR (select auth.uid()) = seller_id);

ALTER POLICY "Admin can view all confirmations" ON public.sale_confirmations
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role = 'admin'
    )
  );

-- -------------------------------------------------------------------
-- public.reviews
-- -------------------------------------------------------------------
ALTER POLICY "Participants can create reviews on completed sales" ON public.reviews
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = reviewer_id
    AND EXISTS (
      SELECT 1 FROM public.sale_confirmations sc
       WHERE sc.id = sale_confirmation_id
         AND sc.status = 'completed'
         AND (
           (review_type = 'buyer_to_seller' AND sc.buyer_id = (select auth.uid()) AND sc.seller_id = reviewed_id)
           OR (review_type = 'seller_to_buyer' AND sc.seller_id = (select auth.uid()) AND sc.buyer_id = reviewed_id)
         )
    )
  );

ALTER POLICY "Reviewed user can respond" ON public.reviews
  TO authenticated
  USING ((select auth.uid()) = reviewed_id)
  WITH CHECK ((select auth.uid()) = reviewed_id);

ALTER POLICY "Admin can manage reviews" ON public.reviews
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role = 'admin'
    )
  );

ALTER POLICY "block_aware_reviews_select" ON public.reviews
  USING (
    (select auth.uid()) = reviewer_id
    OR (select auth.uid()) = reviewed_id
    OR has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
    OR (
      (select auth.uid()) IS NULL
      AND is_hidden = FALSE
      AND visible = TRUE
    )
    OR (
      (select auth.uid()) IS NOT NULL
      AND is_hidden = FALSE
      AND visible = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = (select auth.uid()) AND ub.blocked_id = reviews.reviewer_id)
            OR (ub.blocker_id = reviews.reviewer_id AND ub.blocked_id = (select auth.uid()))
      )
    )
  );

-- -------------------------------------------------------------------
-- public.chats
-- -------------------------------------------------------------------
ALTER POLICY "Participants can view own chats" ON public.chats
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Authenticated users can create chats" ON public.chats
  TO authenticated
  WITH CHECK ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Participants can update own chats" ON public.chats
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

-- -------------------------------------------------------------------
-- public.messages
-- -------------------------------------------------------------------
ALTER POLICY "Participants can send messages" ON public.messages
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = autor_id
    AND EXISTS (
      SELECT 1 FROM public.chats
       WHERE chats.id = chat_id
         AND (chats.comprador_id = (select auth.uid()) OR chats.vendedor_id = (select auth.uid()))
    )
  );

ALTER POLICY "block_aware_messages_select" ON public.messages
  TO authenticated
  USING (
    has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
    OR (
      EXISTS (
        SELECT 1 FROM public.chats
         WHERE chats.id = messages.chat_id
           AND (chats.comprador_id = (select auth.uid()) OR chats.vendedor_id = (select auth.uid()))
      )
      AND is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = (select auth.uid()) AND ub.blocked_id = messages.autor_id)
            OR (ub.blocker_id = messages.autor_id AND ub.blocked_id = (select auth.uid()))
      )
    )
  );

-- -------------------------------------------------------------------
-- public.favorites
-- -------------------------------------------------------------------
ALTER POLICY "Users can view own favorites" ON public.favorites
  TO authenticated
  USING ((select auth.uid()) = usuario_id);

ALTER POLICY "Users can add favorites" ON public.favorites
  TO authenticated
  WITH CHECK ((select auth.uid()) = usuario_id);

ALTER POLICY "Users can remove favorites" ON public.favorites
  TO authenticated
  USING ((select auth.uid()) = usuario_id);

-- -------------------------------------------------------------------
-- public.coupons
-- -------------------------------------------------------------------
ALTER POLICY "Sellers can manage own coupons" ON public.coupons
  TO authenticated
  USING ((select auth.uid()) = vendedor_id);

-- -------------------------------------------------------------------
-- public.seller_verification
-- -------------------------------------------------------------------
ALTER POLICY "Users can view own verification" ON public.seller_verification
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can submit verification" ON public.seller_verification
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "Users can update own verification" ON public.seller_verification
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Admin can manage verifications" ON public.seller_verification
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role = 'admin'
    )
  );

-- -------------------------------------------------------------------
-- public.trust_level_verification
-- -------------------------------------------------------------------
ALTER POLICY "Users can view own trust verification" ON public.trust_level_verification
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can submit trust verification" ON public.trust_level_verification
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

ALTER POLICY "Users can update own trust verification" ON public.trust_level_verification
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Admin can manage trust verifications" ON public.trust_level_verification
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role = 'admin'
    )
  );

-- Added by fix migration 20260327000002_fix_signup_and_rls.sql:
ALTER POLICY "Users can create own verification" ON public.trust_level_verification
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- -------------------------------------------------------------------
-- public.disputes
-- -------------------------------------------------------------------
ALTER POLICY "Participants can view own disputes" ON public.disputes
  TO authenticated
  USING ((select auth.uid()) = reporter_id OR (select auth.uid()) = reported_id);

ALTER POLICY "Users can create disputes" ON public.disputes
  TO authenticated
  WITH CHECK ((select auth.uid()) = reporter_id);

ALTER POLICY "Admin can manage disputes" ON public.disputes
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role = 'admin'
    )
  );

-- -------------------------------------------------------------------
-- public.notifications
-- -------------------------------------------------------------------
ALTER POLICY "Users can view own notifications" ON public.notifications
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can update own notifications" ON public.notifications
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- -------------------------------------------------------------------
-- public.service_availability
-- -------------------------------------------------------------------
ALTER POLICY "Sellers can manage own availability" ON public.service_availability
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services
       WHERE products_services.id = service_availability.servicio_id
         AND products_services.creador_id = (select auth.uid())
    )
  );

-- -------------------------------------------------------------------
-- public.bookings
-- -------------------------------------------------------------------
ALTER POLICY "Participants can view own bookings" ON public.bookings
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Users can create bookings" ON public.bookings
  TO authenticated
  WITH CHECK ((select auth.uid()) = comprador_id);

ALTER POLICY "Participants can update bookings" ON public.bookings
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

-- -------------------------------------------------------------------
-- public.appointments
-- -------------------------------------------------------------------
ALTER POLICY "Authenticated users can create" ON public.appointments
  TO authenticated
  WITH CHECK ((select auth.uid()) = buyer_id);

ALTER POLICY "Participants can update" ON public.appointments
  TO authenticated
  USING ((select auth.uid()) = buyer_id OR (select auth.uid()) = seller_id);

-- -------------------------------------------------------------------
-- public.audit_log
-- -------------------------------------------------------------------
ALTER POLICY "admins_read_audit" ON public.audit_log
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

ALTER POLICY "admins_insert_audit" ON public.audit_log
  WITH CHECK (has_role((select auth.uid()), 'admin'));

-- -------------------------------------------------------------------
-- public.reports (already TO authenticated; only wrap auth.uid)
-- -------------------------------------------------------------------
ALTER POLICY "users_can_create_reports" ON public.reports
  WITH CHECK ((select auth.uid()) = reporter_id);

ALTER POLICY "users_see_own_reports" ON public.reports
  USING ((select auth.uid()) = reporter_id);

ALTER POLICY "admins_see_all_reports" ON public.reports
  USING (
    has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
  );

ALTER POLICY "admins_update_reports" ON public.reports
  USING (
    has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
  )
  WITH CHECK (
    has_role((select auth.uid()), 'admin'::app_role)
    OR has_role((select auth.uid()), 'moderator'::app_role)
  );

-- -------------------------------------------------------------------
-- public.user_blocks (already TO authenticated)
-- -------------------------------------------------------------------
ALTER POLICY "users_manage_own_blocks" ON public.user_blocks
  USING ((select auth.uid()) = blocker_id)
  WITH CHECK ((select auth.uid()) = blocker_id);

-- -------------------------------------------------------------------
-- public.critical_reports (already TO authenticated)
-- -------------------------------------------------------------------
ALTER POLICY "admins_select_critical_reports" ON public.critical_reports
  USING (has_role((select auth.uid()), 'admin'::app_role));

ALTER POLICY "admins_insert_critical_reports" ON public.critical_reports
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

ALTER POLICY "admins_update_critical_reports" ON public.critical_reports
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- -------------------------------------------------------------------
-- public.product_categories
-- -------------------------------------------------------------------
ALTER POLICY "product_categories select ownership aware" ON public.product_categories
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services ps
       WHERE ps.id = product_categories.product_id
         AND (ps.estatus = 'disponible' OR ps.creador_id = (select auth.uid()))
    )
  );

ALTER POLICY "product_categories insert ownership aware" ON public.product_categories
  TO authenticated
  WITH CHECK (
    (select auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
       WHERE ps.id = product_categories.product_id
         AND ps.creador_id = (select auth.uid())
    )
  );

ALTER POLICY "product_categories update ownership aware" ON public.product_categories
  TO authenticated
  USING (
    (select auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
       WHERE ps.id = product_categories.product_id
         AND ps.creador_id = (select auth.uid())
    )
  )
  WITH CHECK (
    (select auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
       WHERE ps.id = product_categories.product_id
         AND ps.creador_id = (select auth.uid())
    )
  );

ALTER POLICY "product_categories delete ownership aware" ON public.product_categories
  TO authenticated
  USING (
    (select auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
       WHERE ps.id = product_categories.product_id
         AND ps.creador_id = (select auth.uid())
    )
  );

-- -------------------------------------------------------------------
-- storage.objects
-- -------------------------------------------------------------------
ALTER POLICY "Owner read verification docs" ON storage.objects
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );

ALTER POLICY "Owner upload verification docs" ON storage.objects
  TO authenticated
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );

ALTER POLICY "Authenticated upload review media" ON storage.objects
  TO authenticated
  WITH CHECK (
    bucket_id = 'review-media'
    AND (select auth.uid()) IS NOT NULL
  );

ALTER POLICY "Owner upload product media" ON storage.objects
  WITH CHECK (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

ALTER POLICY "Owner delete product media" ON storage.objects
  USING (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

ALTER POLICY "avatar_upload" ON storage.objects
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

ALTER POLICY "avatar_update" ON storage.objects
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

ALTER POLICY "avatar_delete" ON storage.objects
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

ALTER POLICY "Owner upload chat media" ON storage.objects
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- REMOVED 2026-06-02: "Admin read verification docs" does not exist in production.
-- The migration 20260429000001_admin_verification_docs_read.sql was never applied
-- (schema_migrations ledger desynchronized — see memory reference_supabase_project).
-- TODO follow-up: decide if we re-create this policy or document it as deferred.

-- -------------------------------------------------------------------
-- public.media_assets — 3 legacy Dashboard-created policies
-- Coexist with the canonical "ownership aware" set (above).
-- Wrapped here byte-for-byte preserving the original USING/WITH CHECK.
-- Dedup pending separate follow-up (dedup-media-assets-legacy-policies).
-- -------------------------------------------------------------------
ALTER POLICY "Owner delete media" ON public.media_assets
  USING (
    (has_role((select auth.uid()), 'admin'::app_role) OR ((owner_type = ANY (ARRAY['producto'::text, 'servicio'::text])) AND (EXISTS ( SELECT 1 FROM products_services ps WHERE ((ps.id = media_assets.owner_id) AND (ps.creador_id = (select auth.uid())))))) OR ((owner_type = 'profile'::text) AND (owner_id = (select auth.uid()))) OR ((owner_type = 'chat'::text) AND (EXISTS ( SELECT 1 FROM chats c WHERE ((c.id = media_assets.owner_id) AND ((c.comprador_id = (select auth.uid())) OR (c.vendedor_id = (select auth.uid()))))))) OR ((owner_type = 'review'::text) AND (EXISTS ( SELECT 1 FROM reviews r WHERE ((r.id = media_assets.owner_id) AND (r.reviewer_id = (select auth.uid())))))))
  );

ALTER POLICY "Owner insert media" ON public.media_assets
  WITH CHECK (
    (has_role((select auth.uid()), 'admin'::app_role) OR ((owner_type = ANY (ARRAY['producto'::text, 'servicio'::text])) AND (EXISTS ( SELECT 1 FROM products_services ps WHERE ((ps.id = media_assets.owner_id) AND (ps.creador_id = (select auth.uid())))))) OR ((owner_type = 'profile'::text) AND (owner_id = (select auth.uid()))) OR ((owner_type = 'chat'::text) AND (EXISTS ( SELECT 1 FROM chats c WHERE ((c.id = media_assets.owner_id) AND ((c.comprador_id = (select auth.uid())) OR (c.vendedor_id = (select auth.uid()))))))) OR ((owner_type = 'review'::text) AND (EXISTS ( SELECT 1 FROM reviews r WHERE ((r.id = media_assets.owner_id) AND (r.reviewer_id = (select auth.uid())))))))
  );

ALTER POLICY "Owner update media" ON public.media_assets
  USING (
    (has_role((select auth.uid()), 'admin'::app_role) OR ((owner_type = ANY (ARRAY['producto'::text, 'servicio'::text])) AND (EXISTS ( SELECT 1 FROM products_services ps WHERE ((ps.id = media_assets.owner_id) AND (ps.creador_id = (select auth.uid())))))) OR ((owner_type = 'profile'::text) AND (owner_id = (select auth.uid()))) OR ((owner_type = 'chat'::text) AND (EXISTS ( SELECT 1 FROM chats c WHERE ((c.id = media_assets.owner_id) AND ((c.comprador_id = (select auth.uid())) OR (c.vendedor_id = (select auth.uid()))))))) OR ((owner_type = 'review'::text) AND (EXISTS ( SELECT 1 FROM reviews r WHERE ((r.id = media_assets.owner_id) AND (r.reviewer_id = (select auth.uid())))))))
  );

COMMIT;

-- =============================================================================
-- PART 2 — INDEXES (outside transaction — CONCURRENTLY required)
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_services_categoria_id
  ON public.products_services(categoria_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trust_level_verification_user_id
  ON public.trust_level_verification(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_seller_id
  ON public.appointments(seller_id);
