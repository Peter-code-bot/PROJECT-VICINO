-- Cuatro cosas que encontro la revision adversarial de la tanda.

-- ── 1. Borrar una foto del chat deja de ser retractarla ─────────────────────
--
-- La policy de DELETE decia querer una cosa y autorizaba otra. Su justificacion
-- escrita era la limpieza del envio a medias —"sube el archivo y falla al
-- insertar el mensaje"—, pero tal como estaba permitia a quien subio borrar
-- CUALQUIER foto suya, incluida una ya entregada y una ya denunciada. En un
-- chat entre desconocidos eso es una via de escape de la moderacion: mandas la
-- foto, la otra persona la denuncia, y la borras antes de que nadie la mire.
--
-- Se acota a lo que decia querer: solo se puede borrar lo que NINGUN mensaje
-- referencia todavia.
--
-- OJO CON EL DETALLE QUE HACE QUE ESTO FUNCIONE. La comprobacion NO puede ser
-- un simple subselect sobre messages dentro de la policy: esa subconsulta
-- correria como `authenticated` y por tanto bajo la RLS de messages, que
-- esconde los mensajes con is_hidden = true. O sea que en cuanto moderacion
-- ocultara el mensaje, su foto volveria a ser borrable — exactamente el caso
-- que esto viene a cerrar. Por eso va en una funcion SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.ruta_de_chat_referenciada(p_ruta text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.attachments @> jsonb_build_array(jsonb_build_object('path', p_ruta))
  );
$$;

COMMENT ON FUNCTION public.ruta_de_chat_referenciada(text) IS
  'Si algun mensaje referencia esa ruta de chat-media. SECURITY DEFINER a '
  'proposito: la policy de DELETE la usa, y bajo RLS un mensaje oculto por '
  'moderacion seria invisible y su foto volveria a ser borrable.';

REVOKE ALL ON FUNCTION public.ruta_de_chat_referenciada(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_de_chat_referenciada(text) TO authenticated;

DROP POLICY IF EXISTS "chat media: borrar lo mio" ON storage.objects;

CREATE POLICY "chat media: borrar solo lo que aun no mande"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-media'
    AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
    AND NOT public.ruta_de_chat_referenciada(name)
  );

-- ── 2. El bucket deja de aceptar lo que la funcion no usa ───────────────────
--
-- chat-media admitia video/mp4, audio/mpeg y audio/webm. La funcion sube UNA
-- cosa: image/webp. Mientras el bucket estuvo cerrado daba igual; ahora que
-- cualquier participante de un chat puede escribir en el, esos tipos son un
-- canal de subida de 10 MB por archivo que nada en la app pinta ni modera.
-- Se dejan los tres de imagen (webp es lo que se sube; jpeg y png quedan por si
-- algun camino futuro sube el original).
UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'chat-media';

-- ── 3. El registro legal deja de aceptar el modo del cliente ────────────────
--
-- La migracion 20260826380000 afirmaba en su comentario que "el servidor pone
-- las tres cosas". Ponia UNA y media: la version y la fecha si, pero `modo`
-- llegaba como parametro, y este RPC esta concedido a authenticated. O sea que
-- cualquiera podia registrarse a si mismo un consentimiento 'expreso' —el que
-- el articulo 8 de la LFPDPPP reserva para datos sensibles— con una llamada.
-- Una constancia que elige quien consiente no constituye constancia.
--
-- Se fija en el servidor. El parametro SE QUEDA en la firma a proposito:
-- quitarlo cambiaria la aridad, y cambiar la aridad de una funcion con
-- CREATE OR REPLACE es lo que acaba de tumbar el feed hace media hora — crea
-- una sobrecarga en vez de reemplazar. Ahora se ignora, y se dice.
--
-- Y sobre user_agent e IP, con honestidad: los manda el cliente y siempre sera
-- asi (salen de cabeceras que el cliente controla). No prueban nada y no
-- pretenden hacerlo. Lo que acredita es la FILA, con su fecha de servidor y su
-- version elegida por el servidor.
CREATE OR REPLACE FUNCTION public.registrar_aceptacion_legal(
  p_modo       text DEFAULT 'uso_continuado',
  p_user_agent text DEFAULT NULL,
  p_ip         text DEFAULT NULL
) RETURNS TABLE (documento text, version text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_ip  inet;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- p_modo se IGNORA. Este RPC solo acredita la aceptacion tacita del §19; el
  -- consentimiento expreso vive en su propio flujo (verification_consent) y no
  -- se puede alcanzar desde aqui. Se conserva el parametro solo para no cambiar
  -- la aridad de la funcion.
  PERFORM p_modo;

  BEGIN
    v_ip := CASE WHEN p_ip IS NULL OR btrim(p_ip) = '' THEN NULL ELSE p_ip::inet END;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  RETURN QUERY
  INSERT INTO public.legal_acceptances AS la
    (user_id, documento, version, modo, user_agent, ip)
  SELECT v_uid, d.doc, d.ver, 'uso_continuado', p_user_agent, v_ip
  FROM (
    SELECT DISTINCT ON (ld.documento) ld.documento AS doc, ld.version AS ver
    FROM public.legal_documents ld
    WHERE ld.vigente_desde <= now()
    ORDER BY ld.documento, ld.vigente_desde DESC, ld.publicado_en DESC
  ) d
  ON CONFLICT (user_id, documento, version) DO NOTHING
  RETURNING la.documento, la.version;
END;
$$;

-- ── 4. La fabrica, un poco mas apagada ──────────────────────────────────────
--
-- La migracion 20260826360000 quito la D (TRUNCATE) del ACL por defecto, pero
-- dejo a/w/d: cada tabla nueva del esquema seguia naciendo con INSERT, UPDATE y
-- DELETE para anon. Hoy los frena la RLS, pero el patron correcto de este repo
-- es el que se uso al crear legal_documents y legal_acceptances: REVOKE ALL y
-- despues conceder exactamente lo que hace falta.
--
-- Solo se toca `anon`. `authenticated` escribe legitimamente en muchas tablas y
-- quitarle el default convertiria cada tabla nueva en una sorpresa.
-- Esto NO altera ninguna tabla existente: los privilegios por defecto solo
-- aplican a las que se creen a partir de ahora.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE INSERT, UPDATE, DELETE ON TABLES FROM anon;

-- COMPROBACION (tras aplicar):
--   select policyname from pg_policies where schemaname='storage'
--     and tablename='objects' and policyname like 'chat media%';   -- 3, una nueva
--   select allowed_mime_types from storage.buckets where id='chat-media';
--   select d.defaclacl::text from pg_default_acl d join pg_namespace n
--     on n.oid=d.defaclnamespace where n.nspname='public' and d.defaclobjtype='r'
--     and pg_get_userbyid(d.defaclrole)='postgres';   -- anon deberia quedar en r/x/t
