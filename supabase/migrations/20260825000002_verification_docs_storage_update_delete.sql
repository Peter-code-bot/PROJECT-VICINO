-- Políticas UPDATE y DELETE en storage.objects para el bucket
-- `verification-documents`.
--
-- ARCHIVO SEPARADO A PROPÓSITO. No toca la RLS ni los GRANT de la TABLA
-- seller_verification (ese arreglo va aparte y va antes, sigue pendiente).
-- Esto son políticas sobre storage.objects, otro objeto distinto, y se aísla
-- aquí para que se pueda revisar y aplicar por su cuenta.
--
-- POR QUÉ HACE FALTA
--
-- 20260320000017_storage_buckets.sql:56-63 creó exactamente dos políticas para
-- este bucket -- "Owner read verification docs" (SELECT) y "Owner upload
-- verification docs" (INSERT) -- y 20260602000001_optimize_rls_performance.sql
-- :614-627 solo las reescribió con (select auth.uid()). No hay UPDATE ni
-- DELETE. Eso causa dos cosas:
--
--   1. `upsert: true` sobre una ruta que YA existe se resuelve como UPDATE de
--      storage.objects, no como INSERT. Sin política de UPDATE el segundo
--      envío del mismo documento falla con RLS. La ruta determinista
--      {user_id}/{tipo}.{ext} de verification-upload.tsx NO funciona sin
--      esta migración: el primer envío pasa y el reintento se rechaza.
--
--   2. handleDelete (verification-upload.tsx) llama .remove() con el cliente
--      del navegador y hasta ahora estaba roto: sin política de DELETE la
--      llamada no borraba nada, el código no verificaba el resultado, y acto
--      seguido ponía las columnas *_url en NULL. El archivo quedaba en el
--      bucket sin ninguna fila que lo referenciara -- exactamente la clase de
--      huérfano permanente que la pasada `leftover` del cron tiene que ir a
--      recoger. Era un generador de huérfanos activo, no una hipótesis.
--
--      El arreglo va en dos mitades y las dos son necesarias:
--        - esta política, para que el borrado pueda ocurrir;
--        - la verificación del resultado en el cliente, que viaja en el mismo
--          commit. Detalle importante: .remove() NO devuelve `error` cuando
--          RLS lo bloquea -- la Storage API responde 200 con la lista de
--          objetos efectivamente borrados, y una fila que la política no deja
--          ver simplemente no viene en esa lista. Por eso el cliente
--          comprueba que `data` traiga algo, no solo que `error` sea null.
--
-- Ambas políticas usan el mismo predicado folder-owner que las dos que ya
-- existen: el primer segmento de la ruta debe ser el uid de quien llama.
-- 20260714000003_tighten_product_media_delete_policy.sql:6 ya señala ese
-- patrón como el correcto del proyecto.

-- Idempotente: DROP ... IF EXISTS antes de cada CREATE.

DROP POLICY IF EXISTS "Owner update verification docs" ON storage.objects;
CREATE POLICY "Owner update verification docs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  )
  WITH CHECK (
    bucket_id = 'verification-documents'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Owner delete verification docs" ON storage.objects;
CREATE POLICY "Owner delete verification docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'verification-documents'
    AND (select auth.uid())::text = (storage.foldername(name))[1]
  );

-- =========================================================================
-- VERIFY (correr a mano en el SQL Editor después de aplicar):
--
--   SELECT policyname, cmd, roles
--     FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND policyname LIKE '%verification docs%'
--    ORDER BY cmd;
--   -- esperado: 4 filas -- SELECT, INSERT, UPDATE, DELETE, todas {authenticated}.
--
-- NOTA DE ALCANCE: la Edge Function purge-verification-documents usa
-- SB_SECRET_KEY (service_role), que ignora RLS por completo. El cron de la
-- migración 20260825000001 funciona con o sin este archivo. Lo que NO
-- funciona sin él es la ruta determinista con upsert del punto 2.
-- =========================================================================
