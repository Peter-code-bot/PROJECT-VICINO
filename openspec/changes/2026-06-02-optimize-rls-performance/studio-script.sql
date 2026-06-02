-- =============================================================================
-- A2 · Optimize RLS Performance — SUPABASE STUDIO SCRIPT
-- Change: 2026-06-02-optimize-rls-performance
-- =============================================================================
-- HOW TO RUN (Pedro, manual, in Supabase Studio SQL Editor — browser only):
--
--   1. Paste BLOCK 1, click Run. Save the output as a snapshot (copy/paste to
--      a local file). This is your rollback reference.
--   2. Paste BLOCK 2, click Run. The transaction wraps in BEGIN/ROLLBACK so
--      NOTHING persists. Read the two SELECT outputs at the end and confirm:
--        - policies_still_inline = 0
--        - policies_with_to_authenticated >= 60 (was ~7 before)
--      The ROLLBACK fires automatically; no change applied.
--   3. If BLOCK 2 is verde, paste BLOCK 3, click Run. Identical ALTERs but
--      with COMMIT. Studio output should show "COMMIT" and no errors.
--   4. Paste BLOCK 4 (one CREATE INDEX at a time is also fine). CONCURRENTLY
--      cannot run inside a transaction, so this block is outside BEGIN/COMMIT.
--      Each may take seconds to minutes on large tables — does NOT block reads.
--   5. Paste BLOCK 5, click Run. Confirms (a) zero policies still use inline
--      auth.uid(), (b) the 3 new indexes exist, and (c) EXPLAIN ANALYZE on a
--      representative query shows the InitPlan node.
--
-- If any ALTER POLICY in BLOCK 2 fails with "policy ... does not exist", the
-- entire BLOCK 2 transaction rolls back automatically (BEGIN/ROLLBACK pattern).
-- Report the offending policy name to Claude — likely a DROP+CREATE chain
-- the audit missed.
--
-- Out of scope: PostGIS / ubicacion_geo, media_assets polymorphic refactor,
-- reviews.visible deprecation, A1 F5 (getClaims migration).
-- =============================================================================


-- =============================================================================
-- BLOCK 1 — SNAPSHOT BEFORE (read-only; save the output as rollback reference)
-- =============================================================================
SELECT schemaname,
       tablename,
       policyname,
       cmd,
       roles,
       qual,
       with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;


-- =============================================================================
-- BLOCK 2 — DRY-RUN (BEGIN/ROLLBACK — zero impact, validates all ALTERs)
-- =============================================================================
BEGIN;

-- ---- public.profiles ----------------------------------------------
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

-- ---- public.user_roles --------------------------------------------
ALTER POLICY "Users can view own roles" ON public.user_roles
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Admin can manage roles" ON public.user_roles
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

-- ---- public.categories --------------------------------------------
ALTER POLICY "Admin can manage categories" ON public.categories
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

-- ---- public.products_services -------------------------------------
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

-- ---- public.product_variants --------------------------------------
ALTER POLICY "Sellers can manage own variants" ON public.product_variants
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services
       WHERE products_services.id = product_variants.producto_id
         AND products_services.creador_id = (select auth.uid())
    )
  );

-- ---- public.media_assets ------------------------------------------
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

-- ---- public.sale_confirmations ------------------------------------
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

-- ---- public.reviews -----------------------------------------------
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

-- ---- public.chats -------------------------------------------------
ALTER POLICY "Participants can view own chats" ON public.chats
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Authenticated users can create chats" ON public.chats
  TO authenticated
  WITH CHECK ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Participants can update own chats" ON public.chats
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

-- ---- public.messages ----------------------------------------------
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

-- ---- public.favorites ---------------------------------------------
ALTER POLICY "Users can view own favorites" ON public.favorites
  TO authenticated
  USING ((select auth.uid()) = usuario_id);

ALTER POLICY "Users can add favorites" ON public.favorites
  TO authenticated
  WITH CHECK ((select auth.uid()) = usuario_id);

ALTER POLICY "Users can remove favorites" ON public.favorites
  TO authenticated
  USING ((select auth.uid()) = usuario_id);

-- ---- public.coupons -----------------------------------------------
ALTER POLICY "Sellers can manage own coupons" ON public.coupons
  TO authenticated
  USING ((select auth.uid()) = vendedor_id);

-- ---- public.seller_verification -----------------------------------
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

-- ---- public.trust_level_verification ------------------------------
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

-- ---- public.disputes ----------------------------------------------
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

-- ---- public.notifications -----------------------------------------
ALTER POLICY "Users can view own notifications" ON public.notifications
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can update own notifications" ON public.notifications
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---- public.service_availability ----------------------------------
ALTER POLICY "Sellers can manage own availability" ON public.service_availability
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services
       WHERE products_services.id = service_availability.servicio_id
         AND products_services.creador_id = (select auth.uid())
    )
  );

-- ---- public.bookings ----------------------------------------------
ALTER POLICY "Participants can view own bookings" ON public.bookings
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Users can create bookings" ON public.bookings
  TO authenticated
  WITH CHECK ((select auth.uid()) = comprador_id);

ALTER POLICY "Participants can update bookings" ON public.bookings
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

-- ---- public.appointments ------------------------------------------
ALTER POLICY "Authenticated users can create" ON public.appointments
  TO authenticated
  WITH CHECK ((select auth.uid()) = buyer_id);

ALTER POLICY "Participants can update" ON public.appointments
  TO authenticated
  USING ((select auth.uid()) = buyer_id OR (select auth.uid()) = seller_id);

-- ---- public.audit_log ---------------------------------------------
ALTER POLICY "admins_read_audit" ON public.audit_log
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

ALTER POLICY "admins_insert_audit" ON public.audit_log
  WITH CHECK (has_role((select auth.uid()), 'admin'));

-- ---- public.reports (already TO authenticated; only wrap) ---------
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

-- ---- public.user_blocks (already TO authenticated) ----------------
ALTER POLICY "users_manage_own_blocks" ON public.user_blocks
  USING ((select auth.uid()) = blocker_id)
  WITH CHECK ((select auth.uid()) = blocker_id);

-- ---- public.critical_reports (already TO authenticated) -----------
ALTER POLICY "admins_select_critical_reports" ON public.critical_reports
  USING (has_role((select auth.uid()), 'admin'::app_role));

ALTER POLICY "admins_insert_critical_reports" ON public.critical_reports
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

ALTER POLICY "admins_update_critical_reports" ON public.critical_reports
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- ---- public.product_categories ------------------------------------
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

-- ---- storage.objects ----------------------------------------------
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

ALTER POLICY "Admin read verification docs" ON storage.objects
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role IN ('admin', 'moderator')
    )
  );

-- ---- Dry-run verification (inside the transaction) ---------------
SELECT COUNT(*) AS policies_still_inline_auth_uid
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (
    (qual ~* 'auth\.uid\(\)' AND qual !~* '\(\s*select\s+auth\.uid')
    OR (with_check ~* 'auth\.uid\(\)' AND with_check !~* '\(\s*select\s+auth\.uid')
  );
-- Expected: 0

SELECT COUNT(*) AS policies_with_to_authenticated
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND 'authenticated' = ANY(roles);
-- Expected: roughly 60+ (was around 7 before this script)

ROLLBACK;
-- ^ Dry-run complete. Nothing was persisted. If the two counts above are
-- as expected, paste BLOCK 3.


-- =============================================================================
-- BLOCK 3 — REAL APPLY (same ALTERs, this time with COMMIT)
-- =============================================================================
BEGIN;

-- (Same ALTER POLICY statements as BLOCK 2. Pasted verbatim below for Studio
--  convenience — copy/paste the entire block.)

-- ---- public.profiles ----------------------------------------------
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

-- ---- public.user_roles --------------------------------------------
ALTER POLICY "Users can view own roles" ON public.user_roles
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Admin can manage roles" ON public.user_roles
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

-- ---- public.categories --------------------------------------------
ALTER POLICY "Admin can manage categories" ON public.categories
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

-- ---- public.products_services -------------------------------------
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

-- ---- public.product_variants --------------------------------------
ALTER POLICY "Sellers can manage own variants" ON public.product_variants
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services
       WHERE products_services.id = product_variants.producto_id
         AND products_services.creador_id = (select auth.uid())
    )
  );

-- ---- public.media_assets ------------------------------------------
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

-- ---- public.sale_confirmations ------------------------------------
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

-- ---- public.reviews -----------------------------------------------
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

-- ---- public.chats -------------------------------------------------
ALTER POLICY "Participants can view own chats" ON public.chats
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Authenticated users can create chats" ON public.chats
  TO authenticated
  WITH CHECK ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Participants can update own chats" ON public.chats
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

-- ---- public.messages ----------------------------------------------
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

-- ---- public.favorites ---------------------------------------------
ALTER POLICY "Users can view own favorites" ON public.favorites
  TO authenticated
  USING ((select auth.uid()) = usuario_id);

ALTER POLICY "Users can add favorites" ON public.favorites
  TO authenticated
  WITH CHECK ((select auth.uid()) = usuario_id);

ALTER POLICY "Users can remove favorites" ON public.favorites
  TO authenticated
  USING ((select auth.uid()) = usuario_id);

-- ---- public.coupons -----------------------------------------------
ALTER POLICY "Sellers can manage own coupons" ON public.coupons
  TO authenticated
  USING ((select auth.uid()) = vendedor_id);

-- ---- public.seller_verification -----------------------------------
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

-- ---- public.trust_level_verification ------------------------------
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

ALTER POLICY "Users can create own verification" ON public.trust_level_verification
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

-- ---- public.disputes ----------------------------------------------
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

-- ---- public.notifications -----------------------------------------
ALTER POLICY "Users can view own notifications" ON public.notifications
  TO authenticated
  USING ((select auth.uid()) = user_id);

ALTER POLICY "Users can update own notifications" ON public.notifications
  TO authenticated
  USING ((select auth.uid()) = user_id);

-- ---- public.service_availability ----------------------------------
ALTER POLICY "Sellers can manage own availability" ON public.service_availability
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services
       WHERE products_services.id = service_availability.servicio_id
         AND products_services.creador_id = (select auth.uid())
    )
  );

-- ---- public.bookings ----------------------------------------------
ALTER POLICY "Participants can view own bookings" ON public.bookings
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

ALTER POLICY "Users can create bookings" ON public.bookings
  TO authenticated
  WITH CHECK ((select auth.uid()) = comprador_id);

ALTER POLICY "Participants can update bookings" ON public.bookings
  TO authenticated
  USING ((select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id);

-- ---- public.appointments ------------------------------------------
ALTER POLICY "Authenticated users can create" ON public.appointments
  TO authenticated
  WITH CHECK ((select auth.uid()) = buyer_id);

ALTER POLICY "Participants can update" ON public.appointments
  TO authenticated
  USING ((select auth.uid()) = buyer_id OR (select auth.uid()) = seller_id);

-- ---- public.audit_log ---------------------------------------------
ALTER POLICY "admins_read_audit" ON public.audit_log
  TO authenticated
  USING (has_role((select auth.uid()), 'admin'));

ALTER POLICY "admins_insert_audit" ON public.audit_log
  WITH CHECK (has_role((select auth.uid()), 'admin'));

-- ---- public.reports (already TO authenticated) --------------------
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

-- ---- public.user_blocks (already TO authenticated) ----------------
ALTER POLICY "users_manage_own_blocks" ON public.user_blocks
  USING ((select auth.uid()) = blocker_id)
  WITH CHECK ((select auth.uid()) = blocker_id);

-- ---- public.critical_reports (already TO authenticated) -----------
ALTER POLICY "admins_select_critical_reports" ON public.critical_reports
  USING (has_role((select auth.uid()), 'admin'::app_role));

ALTER POLICY "admins_insert_critical_reports" ON public.critical_reports
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

ALTER POLICY "admins_update_critical_reports" ON public.critical_reports
  USING (has_role((select auth.uid()), 'admin'::app_role))
  WITH CHECK (has_role((select auth.uid()), 'admin'::app_role));

-- ---- public.product_categories ------------------------------------
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

-- ---- storage.objects ----------------------------------------------
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

ALTER POLICY "Admin read verification docs" ON storage.objects
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = (select auth.uid()) AND role IN ('admin', 'moderator')
    )
  );

COMMIT;


-- =============================================================================
-- BLOCK 4 — INDEXES (outside transaction; CONCURRENTLY required)
-- Each may take seconds to minutes on a populated table but does NOT block
-- reads or writes. Studio is fine running them one at a time too.
-- =============================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_services_categoria_id
  ON public.products_services(categoria_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trust_level_verification_user_id
  ON public.trust_level_verification(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_seller_id
  ON public.appointments(seller_id);


-- =============================================================================
-- BLOCK 5 — FINAL VERIFICATION
-- =============================================================================

-- 5a. Confirm zero policies still use inline auth.uid() (expected: 0 rows)
SELECT schemaname, tablename, policyname, qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (
    (qual ~* 'auth\.uid\(\)' AND qual !~* '\(\s*select\s+auth\.uid')
    OR (with_check ~* 'auth\.uid\(\)' AND with_check !~* '\(\s*select\s+auth\.uid')
  );

-- 5b. Confirm the 3 new indexes exist (expected: 3 rows)
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE indexname IN (
  'idx_products_services_categoria_id',
  'idx_trust_level_verification_user_id',
  'idx_appointments_seller_id'
);

-- 5c. Count policies now with TO authenticated (was ~7 before; now ~60+)
SELECT COUNT(*) AS policies_with_to_authenticated
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND 'authenticated' = ANY(roles);

-- 5d. Sample EXPLAIN ANALYZE to confirm InitPlan node for auth.uid()
-- Pick any chat the running session can see. Replace <CHAT_ID> with a real id.
-- Look for "InitPlan 1 (returns $0)" + "auth.uid()" near the top of the plan.
--
-- EXAMPLE (replace the UUID below):
-- EXPLAIN ANALYZE
--   SELECT id, contenido, created_at
--   FROM public.messages
--   WHERE chat_id = '00000000-0000-0000-0000-000000000000'
--   ORDER BY created_at DESC
--   LIMIT 50;
