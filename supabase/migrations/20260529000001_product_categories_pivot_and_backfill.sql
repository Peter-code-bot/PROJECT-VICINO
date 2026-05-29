-- MP#08 #1 Parte 1a -- product_categories pivot table + RLS + backfill
-- Scope: DB only. Code wireup (Parte 1b) en sesion separada.
--
-- Que hace este archivo:
--   1. CREATE TABLE product_categories(product_id, categoria_id) con composite
--      PK + FKs (CASCADE producto, RESTRICT categoria) + created_at. Habilita
--      multi-categoria por producto sin tocar products_services.categoria TEXT
--      (que sigue canonical para render y search durante coexistencia).
--   2. CREATE INDEX explicito sobre categoria_id para soportar facetas
--      "que productos hay en X categoria" (la PK ya cubre product_id).
--   3. ENABLE ROW LEVEL SECURITY + 4 policies ownership-aware espejando el
--      patron de media_assets 5a (commit 941c724,
--      20260528000001_media_assets_rls_tighten_and_backfill.sql).
--   4. Backfill idempotente desde products_services.categoria TEXT via INNER
--      JOIN categories on slug, NOT EXISTS guard. Insert 237 / 241 filas;
--      los 4 productos restantes tienen categoria en display-format
--      (Electronica, Servicios) en vez de slug (electronica, servicios)
--      y son skipeados naturalmente por el INNER JOIN. Esos 4 son hallazgo
--      a normalizar en item futuro (D11 Option A firmada).
--
-- Verificacion ejecutada (PASO 3 VERIFY en Supabase Studio):
--   - 8/8 checks verde (1 pre-check GRANTs + 3 verifies + 4 RLS smoke tests)
--   - Pre-check: anon + authenticated tienen GRANTs completos.
--   - Conteo: pc_total=237, distinct_products=237, duplicates=0.
--   - Idempotencia: re-run del backfill -> INSERT 0 0.
--   - RLS smoke tests bajo SET LOCAL ROLE real + ROLLBACK (leccion #2):
--       A. anon ve 237 filas de pivote de productos disponibles.
--       B. anon NO ve filas de pivote de producto pausado (setup temporal
--          + ROLLBACK; estatus post-rollback = 'disponible').
--       C. owner ve sus filas con estatus='disponible' (n=8).
--       D. attacker INSERT con product_id ajeno -> ERROR 42501
--          "new row violates row-level security policy".
--
-- Caveat para Parte 1b: el write path (createProduct, updateProductFull) en
-- vender/actions.ts debe invocar un helper syncProductCategoriesForProduct
-- que mantenga el pivote en sync con el FormData. Best-effort + Sentry, NO
-- abortar (mirror 5b D7), porque categoria TEXT sigue canonical durante
-- coexistencia.

-- =========================================================================
-- CREATE TABLE product_categories
-- =========================================================================

CREATE TABLE product_categories (
  product_id   UUID NOT NULL REFERENCES products_services(id) ON DELETE CASCADE,
  categoria_id UUID NOT NULL REFERENCES categories(id)        ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (product_id, categoria_id)
);

CREATE INDEX idx_product_categories_categoria
  ON product_categories(categoria_id);

-- =========================================================================
-- RLS
-- =========================================================================

ALTER TABLE product_categories ENABLE ROW LEVEL SECURITY;

-- SELECT: anon ve pivote de productos disponibles; owner ve los suyos en
-- cualquier estatus (paridad con products_services SELECT policy).
CREATE POLICY "product_categories select ownership aware"
  ON product_categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = product_categories.product_id
        AND (ps.estatus = 'disponible' OR ps.creador_id = auth.uid())
    )
  );

-- INSERT: solo el dueno del producto referenciado.
CREATE POLICY "product_categories insert ownership aware"
  ON product_categories FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = product_categories.product_id
        AND ps.creador_id = auth.uid()
    )
  );

-- UPDATE: USING + WITH CHECK identicos para prevenir cambio de product_id
-- a una entidad ajena.
CREATE POLICY "product_categories update ownership aware"
  ON product_categories FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = product_categories.product_id
        AND ps.creador_id = auth.uid()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = product_categories.product_id
        AND ps.creador_id = auth.uid()
    )
  );

-- DELETE: igual predicate que UPDATE.
CREATE POLICY "product_categories delete ownership aware"
  ON product_categories FOR DELETE
  USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.products_services ps
      WHERE ps.id = product_categories.product_id
        AND ps.creador_id = auth.uid()
    )
  );

-- =========================================================================
-- Backfill idempotente desde products_services.categoria TEXT
-- =========================================================================

INSERT INTO public.product_categories (product_id, categoria_id, created_at)
SELECT
  ps.id AS product_id,
  c.id AS categoria_id,
  NOW() AS created_at
FROM public.products_services ps
INNER JOIN public.categories c ON c.slug = ps.categoria
WHERE ps.estatus != 'eliminado'
  AND NOT EXISTS (
    SELECT 1 FROM public.product_categories pc
    WHERE pc.product_id = ps.id
      AND pc.categoria_id = c.id
  );
