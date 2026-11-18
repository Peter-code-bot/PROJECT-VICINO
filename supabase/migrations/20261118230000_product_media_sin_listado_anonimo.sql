-- product-media: las filas de storage.objects las lee solo el dueno de cada
-- carpeta; las fotos se siguen viendo por su URL publica (18-nov-2026).
--
-- POR QUE. "Public read for product media" (20260320000017) es FOR SELECT sin
-- TO, o sea tambien para anon, y esa policy es la que decide quien puede
-- listar el bucket. Leer una foto no la necesita (ver abajo); listar el bucket
-- entero no le hace falta a nadie mas que al dueno de cada carpeta.
--
-- POR QUE NO ROMPE LAS FOTOS. El bucket es public = true, y Storage sirve sus
-- archivos sin mirar RLS: por /object/public, por /render/image/public y, en
-- un bucket publico, tambien por /object/authenticated (comprobado en
-- staging). Por esta policy pasan el listado y las escrituras que leen la
-- fila: subir es un INSERT ... RETURNING y borrar un DELETE ... RETURNING, y
-- las dos exigen que la fila se pueda leer. Por eso el dueno conserva el
-- SELECT de SU carpeta. Todas las subidas ya van a <auth.uid()>/... (lo exigen las dos
-- policies de INSERT), y el formulario de vender y cleanupRemovedMedia borran
-- con la sesion del vendedor.
--
-- NADIE MAS LO NECESITA. Ningun codigo llama a list() sobre este bucket; el
-- worker de video y la Edge Function delete-account usan la clave de servicio,
-- que salta RLS; y la policy de DELETE ya era solo del dueno, asi que ningun
-- moderador borraba fotos ajenas con su sesion.
--
-- Reversion: docs/rollback/20261118230000_product_media_sin_listado_anonimo_rollback.sql
-- Ensayo: node scripts/staging/probar-product-media-sin-listado.mjs

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Public read for product media" ON storage.objects;
DROP POLICY IF EXISTS "Owner read product media" ON storage.objects;

CREATE POLICY "Owner read product media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'product-media'
    AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
  );

DO $verify$
DECLARE
  visibles_para_anon bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'storage' AND tablename = 'objects'
                AND policyname = 'Public read for product media') THEN
    RAISE EXCEPTION 'sigue la lectura publica de product-media';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'storage' AND tablename = 'objects'
                    AND policyname = 'Owner read product media'
                    AND cmd = 'SELECT' AND roles = '{authenticated}'::name[]) THEN
    RAISE EXCEPTION 'falta la lectura del dueno de product-media';
  END IF;

  -- Lo que de verdad importa: anon ya no ve ni una fila del bucket.
  SET LOCAL ROLE anon;
  SELECT count(*) INTO visibles_para_anon FROM storage.objects WHERE bucket_id = 'product-media';
  RESET ROLE;
  IF visibles_para_anon <> 0 THEN
    RAISE EXCEPTION 'anon todavia ve % objetos de product-media', visibles_para_anon;
  END IF;
END
$verify$;

-- VERIFY (a mano, solo lectura):
--   SELECT policyname, cmd, roles FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname ILIKE '%product media%';
--   -- ya no sale "Public read for product media"; sale "Owner read product media" {authenticated}
