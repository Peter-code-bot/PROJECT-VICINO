-- MP#07 #7 Sesion 5a -- media_assets RLS tighten + backfill desde galeria_imagenes
-- Scope: DB only. Code wireup (5b) en sesion separada.
--
-- Lo que hace este archivo:
--   2.1 DROP las 4 policies permissive que dejo la migration original
--       (20260320000006_media_assets.sql). Eran USING (TRUE) para SELECT
--       y auth.uid() IS NOT NULL para INSERT/UPDATE/DELETE sin owner
--       check. Documentadas como deferred refactor en
--       20260425000002_harden_storage_policies.sql:62-66.
--   2.2 CREATE las 4 nuevas policies ownership-aware que cubren los 5
--       owner_types (producto, servicio, profile, review, chat) via
--       EXISTS contra la entidad referenciada. La logica:
--         SELECT  -- anon ve disponibles + profile avatars + reviews
--                 -- visibles + chats donde es participante; owner ve
--                 -- las suyas en cualquier estatus
--         INSERT  -- caller debe ser dueno de la entidad referenciada
--         UPDATE  -- USING + WITH CHECK identicos al INSERT
--         DELETE  -- igual predicate que UPDATE
--   2.3 Backfill idempotente: desde products_services.galeria_imagenes
--       (text[] denormalizado) hacia media_assets, preservando orden
--       (UNNEST WITH ORDINALITY -> order_index 0-based) y detectando
--       type por extension (.mp4|.webm|.mov -> 'video', resto 'image').
--       NOT EXISTS guard protege re-runs (skip productos que ya tienen
--       media_assets bajo owner_type 'producto'/'servicio').
--
-- Verificacion ejecutada (PASO 3 VERIFY en Supabase Studio):
--   - 9/9 checks verde (4 RLS smoke tests A-E + 4 sanities + 1 idempotencia)
--   - Test B prueba el leak original cerrado: producto pausado temporal
--     dentro de transaccion, anon NO ve su media, ROLLBACK revierte.
--   - Tests corridos bajo rol authenticated/anon real con SET LOCAL ROLE
--     + ROLLBACK; set_config('request.jwt.claims',...) solo NO basta
--     porque Supabase Studio SQL Editor corre como rol postgres que
--     bypasea RLS salvo FORCE ROW LEVEL SECURITY.
--   - Backfill: 666 filas (producto/image=249, servicio/image=417,
--     video=0), todas seed de images.unsplash.com via seed-v2.sql.
--   - Re-run del backfill: INSERT 0 0 (idempotencia verde).
--
-- Caveat para Sesion 5b: las URLs migradas son externas (Unsplash), NO
-- del bucket product-media. media_assets.url_original contiene URLs
-- externas. El render de 5b NO debe asumir prefijo bucket;
-- isValidProductMediaUrl() (apps/web/lib/...) rechaza no-bucket URLs y
-- sera punto de friccion (probablemente helper distinto para validar
-- uploads vs render).

-- =========================================================================
-- Paso 2.1 -- DROP las 4 policies permissive viejas
-- =========================================================================

DROP POLICY IF EXISTS "Anyone can view media" ON media_assets;
DROP POLICY IF EXISTS "Authenticated users can insert media" ON media_assets;
DROP POLICY IF EXISTS "Owners can manage media" ON media_assets;
DROP POLICY IF EXISTS "Owners can delete media" ON media_assets;

-- =========================================================================
-- Paso 2.2 -- CREATE las 4 policies ownership-aware
-- =========================================================================

-- SELECT: anon ve media de productos/servicios disponibles + media de
-- profile (avatars publicos siempre) + media de reviews visibles. Owners
-- ven sus propias en cualquier estatus. Chat media solo para
-- participantes del chat.
CREATE POLICY "media select ownership aware"
  ON media_assets FOR SELECT
  USING (
    (
      owner_type IN ('producto', 'servicio')
      AND EXISTS (
        SELECT 1 FROM public.products_services ps
        WHERE ps.id = media_assets.owner_id
          AND (ps.estatus = 'disponible' OR ps.creador_id = auth.uid())
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
          AND (c.comprador_id = auth.uid() OR c.vendedor_id = auth.uid())
      )
    )
  );

-- INSERT: el caller debe ser dueno de la entidad referenciada.
CREATE POLICY "media insert ownership aware"
  ON media_assets FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      (
        owner_type IN ('producto', 'servicio')
        AND EXISTS (
          SELECT 1 FROM public.products_services ps
          WHERE ps.id = media_assets.owner_id AND ps.creador_id = auth.uid()
        )
      )
      OR (owner_type = 'profile' AND owner_id = auth.uid())
      OR (
        owner_type = 'review'
        AND EXISTS (
          SELECT 1 FROM public.reviews r
          WHERE r.id = media_assets.owner_id AND r.reviewer_id = auth.uid()
        )
      )
      OR (
        owner_type = 'chat'
        AND EXISTS (
          SELECT 1 FROM public.chats c
          WHERE c.id = media_assets.owner_id
            AND (c.comprador_id = auth.uid() OR c.vendedor_id = auth.uid())
        )
      )
    )
  );

-- UPDATE: solo el dueno puede modificar; mismo predicate en USING y
-- WITH CHECK para prevenir cambio de owner_id a una entidad ajena.
CREATE POLICY "media update ownership aware"
  ON media_assets FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND (
      (owner_type IN ('producto','servicio') AND EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id = media_assets.owner_id AND ps.creador_id = auth.uid()))
      OR (owner_type = 'profile' AND owner_id = auth.uid())
      OR (owner_type = 'review' AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = media_assets.owner_id AND r.reviewer_id = auth.uid()))
      OR (owner_type = 'chat' AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = media_assets.owner_id AND (c.comprador_id = auth.uid() OR c.vendedor_id = auth.uid())))
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      (owner_type IN ('producto','servicio') AND EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id = media_assets.owner_id AND ps.creador_id = auth.uid()))
      OR (owner_type = 'profile' AND owner_id = auth.uid())
      OR (owner_type = 'review' AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = media_assets.owner_id AND r.reviewer_id = auth.uid()))
      OR (owner_type = 'chat' AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = media_assets.owner_id AND (c.comprador_id = auth.uid() OR c.vendedor_id = auth.uid())))
    )
  );

-- DELETE: igual predicate que UPDATE.
CREATE POLICY "media delete ownership aware"
  ON media_assets FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND (
      (owner_type IN ('producto','servicio') AND EXISTS (SELECT 1 FROM public.products_services ps WHERE ps.id = media_assets.owner_id AND ps.creador_id = auth.uid()))
      OR (owner_type = 'profile' AND owner_id = auth.uid())
      OR (owner_type = 'review' AND EXISTS (SELECT 1 FROM public.reviews r WHERE r.id = media_assets.owner_id AND r.reviewer_id = auth.uid()))
      OR (owner_type = 'chat' AND EXISTS (SELECT 1 FROM public.chats c WHERE c.id = media_assets.owner_id AND (c.comprador_id = auth.uid() OR c.vendedor_id = auth.uid())))
    )
  );

-- =========================================================================
-- Paso 2.3 -- Backfill idempotente desde galeria_imagenes
-- =========================================================================

INSERT INTO public.media_assets (
  owner_type, owner_id, type, url_original, order_index, created_at
)
SELECT
  CASE WHEN ps.tipo = 'servicio' THEN 'servicio' ELSE 'producto' END AS owner_type,
  ps.id AS owner_id,
  CASE WHEN img ~* '\.(mp4|webm|mov)(\?.*)?$' THEN 'video' ELSE 'image' END AS type,
  img AS url_original,
  (ord - 1) AS order_index,
  NOW() AS created_at
FROM public.products_services ps,
  LATERAL unnest(ps.galeria_imagenes) WITH ORDINALITY AS img_data(img, ord)
WHERE ps.galeria_imagenes IS NOT NULL
  AND array_length(ps.galeria_imagenes, 1) > 0
  AND ps.estatus != 'eliminado'
  AND NOT EXISTS (
    SELECT 1 FROM public.media_assets ma
    WHERE ma.owner_id = ps.id
      AND ma.owner_type IN ('producto','servicio')
  );
