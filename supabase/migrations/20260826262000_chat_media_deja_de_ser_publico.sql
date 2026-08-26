-- El bucket de fotos de chat es publico, y su policy de lectura no filtra nada.
--
--   policy "Public read chat media": USING (bucket_id = 'chat-media')
--
-- O sea: cualquiera con la URL —incluido anon— veria la foto de una
-- conversacion privada. Hoy no hay ninguna expuesta porque el bucket tiene CERO
-- objetos y ningun codigo sube ahi: la funcionalidad de fotos en el chat no
-- esta construida.
--
-- Justo por eso se cierra AHORA. Cerrarlo hoy es esta migracion. Cerrarlo
-- despues de que la funcionalidad exista significa migrar objetos, reescribir
-- las URL guardadas en messages y decidir que hacer con las fotos que ya se
-- compartieron en abierto. El coste se multiplica y la ventana de exposicion
-- corre mientras tanto.
--
-- Se comprobo antes de tocar nada:
--   - storage.buckets: chat-media public=true, 0 objetos
--   - grep de 'chat-media' en apps/ y supabase/: solo la Edge Function
--     delete-account lo LIMPIA, y usa service_role, que no depende de policies.

-- ---------------------------------------------------------------------------
-- 1. El bucket deja de ser publico.
-- ---------------------------------------------------------------------------

UPDATE storage.buckets SET public = false WHERE id = 'chat-media';

-- ---------------------------------------------------------------------------
-- 2. La lectura abierta se sustituye por lectura del dueno de la carpeta.
--
-- Se acota al dueno y NO a los participantes del chat, aunque lo segundo suene
-- mejor. Motivo: la convencion de rutas para chat solo garantiza hoy
-- {user_id}/..., que es lo unico que exige la policy de INSERT que ya existe.
-- Una policy que dedujera el chat de la ruta estaria inventando una convencion
-- que aun no existe, y si el dia de manana se sube con otra forma fallaria en
-- silencio, que es el modo de fallo que llevamos todo el dia quitando.
--
-- CONSECUENCIA DELIBERADA, y quien construya la funcionalidad tiene que saberla:
-- el destinatario NO podra leer el archivo por URL directa. Las fotos de chat
-- tendran que servirse con URL firmada, generada en el servidor DESPUES de
-- comprobar que quien pide es parte de la conversacion. Es el mismo patron que
-- ya usa admin/verifications con verification-documents, y es el correcto para
-- contenido privado: la alternativa es una URL eterna que circula sola.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Public read chat media" ON storage.objects;

CREATE POLICY "Owner read chat media"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[1] = ((SELECT auth.uid()))::text
  );

-- VERIFY:
--   SELECT public FROM storage.buckets WHERE id = 'chat-media';   -- false
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND coalesce(qual, with_check) ILIKE '%chat-media%';
--   -- esperado: "Owner read chat media" (SELECT) y "Owner upload chat media" (INSERT).
--   -- NO debe seguir apareciendo "Public read chat media".
