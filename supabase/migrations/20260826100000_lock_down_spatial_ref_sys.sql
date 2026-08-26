-- SEGURIDAD: un anonimo podia borrar el sistema de coordenadas y tumbar el feed.
--
-- public.spatial_ref_sys es la tabla de PostGIS con las 8500 definiciones de
-- sistemas de referencia espacial. Tenia:
--   - RLS DESACTIVADA (relrowsecurity = false), la unica tabla del esquema public
--     en ese estado.
--   - INSERT, UPDATE y DELETE otorgados a anon Y a authenticated.
--
-- Sin RLS que filtre, esos GRANT son acceso real, no un no-op. Comprobado el
-- 26-ago-2026 contra produccion, en una transaccion revertida:
--
--   BEGIN;
--   SET LOCAL ROLE anon;
--   DELETE FROM public.spatial_ref_sys WHERE srid = 4326;   -- funciono
--   SELECT count(*) FROM public.spatial_ref_sys;            -- 8499, era 8500
--   ROLLBACK;
--
-- El SRID 4326 es WGS84: el sistema en el que estan TODAS las coordenadas de
-- VICINO. Sin esa fila, cada calculo de distancia de PostGIS falla, y con el se
-- cae search_nearby_products_v4, el feed de cercania entero y el ranking por
-- ubicacion. Es decir, el producto. Y no hacia falta ni iniciar sesion.
--
-- No es un fallo de VICINO: la extension PostGIS crea esta tabla y los GRANT por
-- defecto del proyecto la alcanzan. Le pasa a muchos proyectos de Supabase, y su
-- propio linter lo marca. Que sea comun no lo hace menos explotable.
--
-- Se conserva SELECT: PostGIS lo necesita para resolver proyecciones, y las
-- definiciones de SRID son publicas de todos modos. Se quitan solo las
-- escrituras, que nadie usa — VICINO no define proyecciones propias.

DO $$
BEGIN
  REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES
    ON TABLE public.spatial_ref_sys FROM anon, authenticated;
EXCEPTION WHEN insufficient_privilege THEN
  -- La tabla es propiedad de supabase_admin. Si el rol que aplica la migracion
  -- no puede revocar, hay que hacerlo desde el Dashboard o pedirselo a soporte.
  -- Se avisa alto y claro en vez de fallar en silencio, que es justo el patron
  -- que este proyecto lleva todo el dia persiguiendo.
  RAISE WARNING 'NO SE PUDO REVOCAR sobre spatial_ref_sys: %. Hay que hacerlo con un rol con privilegios de su dueno (supabase_admin).', SQLERRM;
END $$;

-- VERIFY (los cuatro deben dar false; el SELECT debe seguir en true):
--   SELECT
--     has_table_privilege('anon','public.spatial_ref_sys','DELETE')          AS anon_delete,
--     has_table_privilege('anon','public.spatial_ref_sys','UPDATE')          AS anon_update,
--     has_table_privilege('authenticated','public.spatial_ref_sys','DELETE') AS auth_delete,
--     has_table_privilege('authenticated','public.spatial_ref_sys','UPDATE') AS auth_update,
--     has_table_privilege('anon','public.spatial_ref_sys','SELECT')          AS anon_select;
--
-- Y la prueba que de verdad importa, revertida:
--   BEGIN;
--     SET LOCAL ROLE anon;
--     DELETE FROM public.spatial_ref_sys WHERE srid = 4326;  -- debe dar 42501
--   ROLLBACK;
