-- Remap 4 orphan products from display-format categoria to the real slug
--
-- Context:
--   The seed script supabase/insert_dummy_data.sql inserts a handful of demo
--   products with `categoria` set to display-format strings ("Electronica",
--   "Servicios") instead of the lowercase slugs that products_services.categoria
--   is supposed to mirror from categories.slug. These four rows were therefore
--   skipped by:
--     - The MP#08 #1 Parte 1a backfill (commit d6d6dbd) -- INNER JOIN on slug
--       found no match for "Electronica" / "Servicios", so they were never
--       written to product_categories.
--     - The MP#08 #1 Parte 1b dual-write (commit d95f1a5) -- the slug lookup
--       missed identically; helper logged to Sentry and skipped the insert.
--   Net effect: 4 products had a categoria TEXT that did not point to any
--   real category and no row in the product_categories pivot. MP#08 #5 (read
--   switch from categoria TEXT to the pivot) would have left them
--   uncategorized in search.
--
-- What this migration does:
--   1. Remaps the 4 known orphans to the 'tecnologia' slug (the closest real
--      category for monitor / laptop / mechanical keyboard / PC repair).
--   2. Inserts their product_categories pivot rows so the dataset is
--      consistent with the rest of the catalog.
--   Both steps are idempotent:
--   - The UPDATE matches only when the row still has the legacy display-
--     format value, so re-running after a successful WRITE is a no-op (the
--     categoria column already says 'tecnologia' and no longer matches the
--     IN clause). If the dummy seed script reseeds the same UUIDs with the
--     same display-format values, this migration will re-apply cleanly.
--   - The INSERT uses NOT EXISTS to skip rows already present in the pivot.
--
-- Scope and limitations:
--   This is a one-shot remediation for the 4 known orphans (their UUIDs are
--   pinned below). It will NOT catch new display-format strings introduced
--   by other seed paths or by a future regression. The real fix is two
--   separate items pending in MP#08:
--     - Validator enum / lower-case normalization at write time in
--       createProductSchema (z.string() -> z.enum from categories.slug). The
--       fc846a3 fix from Javier already added `.toLowerCase()` to the pivot
--       sync lookup, which mitigates capitalization drift but does not
--       reject categoria values that do not match any slug.
--     - Cleaning insert_dummy_data.sql to use real lowercase slugs.
--
-- Verified in Supabase Studio (SQL Camino 2: READ -> WRITE -> VERIFY):
--   READ: 4 rows returned by NOT EXISTS audit against categories.slug.
--   WRITE: 4 UPDATE 1, then INSERT 0 4.
--   VERIFY: 0 huerfanos remaining; the 4 pivot rows return coherente=true
--   with pivot_slug='tecnologia' for all four; pivot count grew by +4.

-- =========================================================================
-- 1. Remap categoria from display-format to slug for the 4 known orphans.
--    Guarded by `categoria IN (...)` so already-remapped rows are skipped.
-- =========================================================================

UPDATE public.products_services
   SET categoria = 'tecnologia'
 WHERE id IN (
     '8ca2c5dc-67f3-4e15-bc04-f2ad14117d30',  -- Monitor UltraWide LG 29"
     '1e45f828-79ef-4c2b-bb15-5dfc7c816324',  -- Laptop Dell XPS 15
     '4ce23c31-ca36-4a77-a435-2630e5e3516f',  -- Teclado Mecanico Keychron
     'e10c35a5-fba0-4b93-9c7d-5413923746ef'   -- Mantenimiento Preventivo PC
   )
   AND categoria IN ('Electronica', 'Servicios');

-- =========================================================================
-- 2. Insert their product_categories pivot rows. NOT EXISTS guard makes the
--    INSERT a no-op when the row already exists, matching the idempotency
--    pattern of the original 5a backfill in 20260528000001.
-- =========================================================================

INSERT INTO public.product_categories (product_id, categoria_id)
SELECT ps.id, c.id
FROM public.products_services ps
INNER JOIN public.categories c ON c.slug = ps.categoria
WHERE ps.id IN (
    '8ca2c5dc-67f3-4e15-bc04-f2ad14117d30',
    '1e45f828-79ef-4c2b-bb15-5dfc7c816324',
    '4ce23c31-ca36-4a77-a435-2630e5e3516f',
    'e10c35a5-fba0-4b93-9c7d-5413923746ef'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.product_categories pc
    WHERE pc.product_id = ps.id
      AND pc.categoria_id = c.id
  );
