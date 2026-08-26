-- products_services.sort_order — orden visual que el vendedor da a sus publicaciones.
--
-- Reemplaza a 20260530000001_product_sort_order.sql, que quedo sin aplicar desde
-- el 30-may y se elimino en esta misma rama. Aquel archivo hacia el ADD COLUMN
-- SIN los GRANT por columna, y aplicarlo tal cual habria roto el perfil de todos
-- los usuarios:
--
--   apps/web/app/(marketplace)/perfil/page.tsx selecciona sort_order y ordena por
--   el. Hoy eso falla con 42703 (la columna no existe) y un fallback explicito lo
--   atrapa, asi que la pagina degrada sin romperse. Con la columna creada pero sin
--   grants, el mismo SELECT pasaria a fallar con 42501 — que ese fallback NO
--   atrapa — y la pagina se caeria. Es el mismo patron del incidente de
--   modo_precio (agosto 2026).
--
-- Los grants de products_services son COLUMNA POR COLUMNA, deliberadamente, y
-- ADD COLUMN nunca los hereda. Ver CLAUDE.md y el ejemplo canonico en
-- 20260819000000_products_services_modo_precio_column.sql.

ALTER TABLE public.products_services
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.products_services.sort_order IS
  'Orden visual personalizado que el vendedor establece para su perfil. 0 = sin orden explicito.';

-- El dueño lee y escribe su propio orden (perfil/page.tsx, perfil/actions.ts).
GRANT SELECT (sort_order), INSERT (sort_order), UPDATE (sort_order)
  ON public.products_services TO authenticated;

-- Lectura anonima: la tienda publica (vendedor/[id]/page.tsx) es el consumidor
-- natural de este orden. Se otorga ahora para que cablearla no vuelva a chocar
-- con un 42501. Es un entero de ordenamiento, no expone nada del vendedor.
GRANT SELECT (sort_order) ON public.products_services TO anon;

-- Verificacion (correr despues de aplicar):
--   SELECT grantee, privilege_type
--   FROM information_schema.column_privileges
--   WHERE table_name = 'products_services' AND column_name = 'sort_order';
-- Esperado: authenticated -> SELECT, INSERT, UPDATE | anon -> SELECT
