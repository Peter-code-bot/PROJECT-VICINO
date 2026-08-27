-- Fotos en el chat, parte 1 de 2: la base.
--
-- LO QUE HABIA. El bucket chat-media existe desde marzo, se cerro al publico
-- esta manana, y tiene CERO objetos. La columna messages.attachments existe,
-- se consulta en el servidor, se pasa al cliente... y no la pinta nadie. O sea:
-- media pieza puesta y ningun circuito. Se comprobo antes de escribir esto:
--   select count(*) from storage.objects where bucket_id='chat-media';        -- 0
--   select count(*) from messages where jsonb_array_length(attachments) > 0;  -- 0
-- Por eso se puede cambiar la convencion de rutas sin migrar nada.
--
-- EL PROBLEMA ESTRUCTURAL QUE HABIA QUE RESOLVER PRIMERO. Las dos policies que
-- habia eran "de carpeta propia": leer solo lo que esta bajo <mi uid>/. Con
-- esas, el comprador sube una foto y el vendedor NO PUEDE VERLA. El circuito
-- entero seria imposible, no lento: la persona a la que va dirigida la foto es
-- exactamente la unica que no tiene permiso de leerla.
--
-- POR QUE LA RUTA LLEVA EL CHAT DELANTE: <chat_id>/<autor_id>/<archivo>.
-- La alternativa —seguir con <uid>/<archivo> y permitir leer a quien comparta
-- algun chat contigo— es PEOR: desde un objeto no se puede saber a que
-- conversacion pertenece, asi que ese permiso abriria TODA tu media de TODOS
-- tus chats a cualquiera que tenga uno contigo. Con el chat en la ruta, el
-- permiso es exactamente del tamano de la conversacion.
--
-- El segundo tramo sigue siendo el autor: evita que dos personas del mismo chat
-- se pisen nombres, y deja que quien sube pueda borrar lo suyo si el envio
-- falla a medias.

-- ── Storage: quien sube, quien lee, quien borra ─────────────────────────────
DROP POLICY IF EXISTS "Owner upload chat media" ON storage.objects;
DROP POLICY IF EXISTS "Owner read chat media"   ON storage.objects;

-- Subir: solo a la carpeta de un chat en el que participo, y dentro de ella
-- solo a la mia. Las dos condiciones importan: la primera impide dejar
-- archivos en la conversacion de otros, la segunda impide firmar como otro.
CREATE POLICY "chat media: subir a un chat mio"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND EXISTS (
      SELECT 1 FROM public.chats c
      WHERE c.id::text = (storage.foldername(name))[1]
        AND ((SELECT auth.uid()) IN (c.comprador_id, c.vendedor_id))
    )
  );

-- Leer: cualquiera de los dos participantes del chat. Y moderacion, que sin
-- esto tendria que decidir sobre una foto reportada sin poder verla.
CREATE POLICY "chat media: leer si soy del chat o modero"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (
      EXISTS (
        SELECT 1 FROM public.chats c
        WHERE c.id::text = (storage.foldername(name))[1]
          AND ((SELECT auth.uid()) IN (c.comprador_id, c.vendedor_id))
      )
      OR public.has_role((SELECT auth.uid()), 'admin')
      OR public.has_role((SELECT auth.uid()), 'moderator')
    )
  );

-- Borrar: solo lo propio. Sirve para el caso real de un envio que sube el
-- archivo y falla al insertar el mensaje: sin esto, ese huerfano se queda para
-- siempre, que es como se juntaron los 31 archivos sueltos de esta manana.
CREATE POLICY "chat media: borrar lo mio"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
  );

-- ── Integridad de attachments ───────────────────────────────────────────────
-- Por que va en la base y no solo en la accion de servidor: la policy de INSERT
-- de messages deja escribir al participante DIRECTAMENTE con la llave anon
-- desde el navegador. La accion de servidor es el camino normal, no el unico.
-- Todo lo que solo se valide ahi es una sugerencia.
--
-- La regla fuerte es la de la ruta: cada adjunto tiene que vivir bajo
-- <chat_id>/<autor_id>/. Se puede exigir porque chat_id y autor_id son columnas
-- de la MISMA fila. Asi un mensaje no puede apuntar a la carpeta de otra
-- conversacion ni colgarle una foto a otra persona.
--
-- Va como funcion porque un CHECK no admite subconsultas y hay que recorrer el
-- array. Es IMMUTABLE de verdad: solo mira el jsonb que recibe, no toca tablas.
CREATE OR REPLACE FUNCTION public.chat_attachments_validos(
  p_attachments jsonb,
  p_chat_id     uuid,
  p_autor_id    uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_attachments IS NULL                        THEN true
    WHEN jsonb_typeof(p_attachments) <> 'array'       THEN false
    WHEN jsonb_array_length(p_attachments) = 0        THEN true
    WHEN jsonb_array_length(p_attachments) > 5        THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_attachments) AS e
      WHERE jsonb_typeof(e)          <> 'object'
         OR jsonb_typeof(e -> 'path') <> 'string'
         OR jsonb_typeof(e -> 'tipo') <> 'string'
         OR e ->> 'tipo' <> 'image'
         OR length(e ->> 'path') > 300
         OR e ->> 'path' NOT LIKE p_chat_id::text || '/' || p_autor_id::text || '/%'
    )
  END
$$;

COMMENT ON FUNCTION public.chat_attachments_validos(jsonb, uuid, uuid) IS
  'Valida el array attachments de messages: <=5 objetos, tipo image, y ruta '
  'obligatoriamente bajo <chat_id>/<autor_id>/. Se usa desde un CHECK porque un '
  'CHECK no admite subconsultas y hay que recorrer el array.';

ALTER TABLE public.messages
  ADD CONSTRAINT messages_attachments_validos
  CHECK (public.chat_attachments_validos(attachments, chat_id, autor_id));

-- Un mensaje tiene que traer ALGO. texto es NOT NULL y no admite default, asi
-- que una foto sola viaja con texto = ''. Sin esta regla, ese '' tambien
-- dejaria pasar un mensaje completamente vacio.
-- Comprobado antes: de los 6 mensajes que hay, ninguno tiene texto vacio.
ALTER TABLE public.messages
  ADD CONSTRAINT messages_con_contenido
  CHECK (
    btrim(texto) <> ''
    OR CASE
         WHEN jsonb_typeof(COALESCE(attachments, '[]'::jsonb)) = 'array'
           THEN jsonb_array_length(COALESCE(attachments, '[]'::jsonb)) > 0
         ELSE false
       END
  );

-- El CASE no es adorno. jsonb_array_length sobre algo que no es array LANZA
-- error (22023) en vez de devolver falso, y los CHECK de una tabla no se
-- evaluan en un orden garantizado: sin esto, mandar attachments = '{}' moriria
-- con un error del motor en lugar de con la violacion de constraint que el
-- servidor sabe traducir.

-- COMPROBACION (tras aplicar):
--   select count(*) from pg_policies
--    where schemaname='storage' and tablename='objects'
--      and policyname like 'chat media%';                       -- esperado: 3
--   select conname from pg_constraint
--    where conrelid='public.messages'::regclass and contype='c'; -- las 2 nuevas
