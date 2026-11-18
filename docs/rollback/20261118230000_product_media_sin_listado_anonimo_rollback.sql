-- Reversion de 20261118230000_product_media_sin_listado_anonimo. Se corre a mano.
-- Devuelve la lectura publica de product-media tal como la creo
-- 20260320000017 (FOR SELECT sin TO), y con ella el listado del bucket con la
-- clave anon. Las URL publicas de las fotos funcionan igual con y sin esto.

begin;

DROP POLICY IF EXISTS "Owner read product media" ON storage.objects;
DROP POLICY IF EXISTS "Public read for product media" ON storage.objects;

CREATE POLICY "Public read for product media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-media');

commit;
