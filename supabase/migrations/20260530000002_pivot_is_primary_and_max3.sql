-- MP#08 #5c-1 -- multi-category foundation on product_categories pivot
--
-- Scope: DB only. Code wireup (form multi-select + helper N-rows + zod
-- validator extension + editar retrocompat) is Parte 5c-2 en sesion
-- separada. Search ranking primary>secondary es 5c-3. Badges en cards
-- es 5c-4. Esta parte (5c-1) NO toca codigo de la app.
--
-- Que hace este archivo (4 statements idempotentes en orden):
--   2.a  ALTER TABLE product_categories ADD COLUMN is_primary BOOLEAN
--        NOT NULL DEFAULT false. Las 243 filas existentes leen el default
--        (Postgres no rewrita la tabla; lectura instantanea).
--   2.b  CREATE UNIQUE INDEX product_categories_one_primary ON (product_id)
--        WHERE is_primary = true. Enforce "como maximo 1 primary por
--        producto" via partial unique constraint. Se crea sobre set vacio
--        post-2.a (todas las filas son is_primary=false) -- cero conflicts.
--   2.c  CREATE OR REPLACE FUNCTION check_max_3_categories() + DROP
--        TRIGGER IF EXISTS + CREATE TRIGGER trg_max_3_categories BEFORE
--        INSERT ON product_categories. RAISE EXCEPTION si una 4a fila
--        intenta insertarse para cualquier product_id. Defense in depth:
--        el real guard contra >3 es el zod schema en 5c-2 (form validator)
--        que corre antes de llegar al helper syncProductCategoriesForProduct.
--        El trigger atrapa rutas alternativas (admin, RPC, futuro). Race
--        tradeoff (BEFORE INSERT + COUNT bajo concurrencia extrema puede
--        permitir 4 filas si dos TX ven COUNT=2 y ambas insertan) aceptado
--        para MVP pre-launch -- zod es la barrera primaria.
--   2.d  Backfill: UPDATE marca como is_primary=true la unica fila
--        existente de cada producto (cada producto tiene 1 fila hoy tras
--        el cierre de huerfanos 29ccefe). Defense in depth: DISTINCT ON
--        (product_id) ORDER BY created_at NULLS FIRST garantiza max 1
--        primary por producto incluso si por improbable algun producto
--        tuviera N filas. WHERE is_primary = false hace re-run = no-op.
--
-- RLS: las 4 policies del pivote (creadas en 1a, 20260529000001) operan
-- sobre product_id via JOIN a products_services.creador_id = auth.uid().
-- Son column-agnostic respecto a is_primary -- cero rewrite necesario.
--
-- categoria TEXT en products_services queda intacta. Su drop es MP#08 #4
-- (futuro, tras migrar los 24 render readers del TEXT al pivote).
--
-- Verificacion ejecutada (PASO 3 VERIFY en Supabase Studio):
--   3.a is_primary boolean NOT NULL DEFAULT false confirmado en
--       information_schema.columns.
--   3.b product_categories_one_primary partial unique index confirmado
--       en pg_indexes con definicion correcta.
--   3.c trg_max_3_categories BEFORE INSERT confirmado en
--       information_schema.triggers.
--   3.d total_primary = 243, productos_con_primary = 243,
--       productos_con_2_primaries = 0. Cada uno de los 243 productos
--       tiene exactamente 1 primary -- prueba de oro perfecta.

-- =========================================================================
-- 2.a  Add is_primary column (default false, backfilled in 2.d)
-- =========================================================================

ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

-- =========================================================================
-- 2.b  Partial unique index: max 1 primary per product
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS product_categories_one_primary
  ON product_categories(product_id) WHERE is_primary = true;

-- =========================================================================
-- 2.c  Trigger BEFORE INSERT: max 3 categories per product (defense in
--      depth; zod en 5c-2 sera el real guard)
-- =========================================================================

CREATE OR REPLACE FUNCTION check_max_3_categories()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM product_categories
      WHERE product_id = NEW.product_id) >= 3 THEN
    RAISE EXCEPTION 'Max 3 categorias por producto (product_id=%)', NEW.product_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_max_3_categories ON product_categories;

CREATE TRIGGER trg_max_3_categories
  BEFORE INSERT ON product_categories
  FOR EACH ROW EXECUTE FUNCTION check_max_3_categories();

-- =========================================================================
-- 2.d  Backfill: mark the existing single row of each product as primary
--      (DISTINCT ON guard for the improbable case of N rows per product)
-- =========================================================================

WITH primary_rows AS (
  SELECT DISTINCT ON (product_id) product_id, categoria_id
  FROM product_categories
  WHERE is_primary = false
  ORDER BY product_id, created_at NULLS FIRST
)
UPDATE product_categories pc
   SET is_primary = true
  FROM primary_rows pr
 WHERE pc.product_id = pr.product_id
   AND pc.categoria_id = pr.categoria_id;
