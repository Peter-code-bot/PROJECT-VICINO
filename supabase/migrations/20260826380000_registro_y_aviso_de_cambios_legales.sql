-- Registro de aceptacion de los documentos legales, y el mecanismo de preaviso
-- que el propio Aviso promete en su seccion 18.
--
-- DE DONDE SALE LA FORMA. No se invento: se leyo lo que los documentos
-- publicados YA se obligan a cumplir, y se modelo eso.
--
--   §18 del Aviso: "Cuando los cambios sean SUSTANCIALES, se notificara al
--   Usuario por correo electronico o mediante notificacion visible en la
--   Plataforma con al menos 30 DIAS NATURALES de anticipacion a su entrada en
--   vigor."
--
--   §19: "La utilizacion de la Plataforma con posterioridad a la publicacion
--   del presente Aviso constituye ACEPTACION TACITA de su contenido."
--
-- De ahi salen las dos ideas que estructuran todo esto:
--
--   1. Publicar y ENTRAR EN VIGOR son dos fechas distintas. Sin esa distincion
--      la promesa de los 30 dias no se puede ni expresar, mucho menos cumplir.
--   2. La aceptacion normal es TACITA, por uso. Asi que registrarla al entrar
--      no es una licencia que nos tomemos: es exactamente lo que el documento
--      dice que ocurre. Lo que faltaba era dejar constancia.
--
-- LO QUE ESTO CAMBIA DE VERDAD: hasta hoy la promesa de los 30 dias vivia solo
-- en un parrafo. El CHECK de abajo la vuelve IMPOSIBLE DE INCUMPLIR desde la
-- base: una version marcada como sustancial no se puede insertar con menos de
-- 30 dias entre su publicacion y su entrada en vigor. Postgres rechaza la fila.

-- ── Que documentos existen, y desde cuando rigen ────────────────────────────
CREATE TABLE public.legal_documents (
  documento     text        NOT NULL CHECK (documento IN ('terminos', 'aviso')),
  version       text        NOT NULL CHECK (version ~ '^[0-9]+\.[0-9]+$'),
  publicado_en  timestamptz NOT NULL DEFAULT now(),
  vigente_desde timestamptz NOT NULL,
  -- NULL = todavia sin calificar. Solo es legitimo para las versiones que ya
  -- estaban publicadas antes de que existiera este mecanismo: decir de ellas
  -- "no fue sustancial" seria afirmar algo que nadie ha decidido.
  sustancial    boolean,
  resumen       text        NOT NULL,
  PRIMARY KEY (documento, version),

  -- La seccion 18, hecha regla. Una version sustancial no puede entrar en
  -- vigor antes de 30 dias naturales desde su publicacion.
  CONSTRAINT legal_documents_preaviso_30_dias CHECK (
    sustancial IS DISTINCT FROM true
    OR vigente_desde >= publicado_en + interval '30 days'
  ),
  -- Y nada entra en vigor antes de publicarse, sustancial o no.
  CONSTRAINT legal_documents_vigor_no_precede_publicacion CHECK (
    vigente_desde >= publicado_en
  )
);

COMMENT ON TABLE public.legal_documents IS
  'Versiones publicadas de los documentos legales. publicado_en y vigente_desde '
  'son distintas a proposito: es lo que permite cumplir el preaviso de 30 dias '
  'de la seccion 18 del Aviso.';

COMMENT ON COLUMN public.legal_documents.sustancial IS
  'true dispara el preaviso obligatorio de 30 dias. NULL = sin calificar; solo '
  'valido para versiones anteriores a este mecanismo (26-ago-2026).';

-- ── Quien acepto que, y cuando ──────────────────────────────────────────────
CREATE TABLE public.legal_acceptances (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  documento   text        NOT NULL,
  version     text        NOT NULL,
  aceptado_en timestamptz NOT NULL DEFAULT now(),
  -- Como se acepto. Importa: 'expreso' es una casilla marcada a mano, y es lo
  -- unico que sirve para datos sensibles bajo el articulo 8 de la LFPDPPP.
  -- 'uso_continuado' es la aceptacion tacita del §19, que basta para el resto.
  modo        text        NOT NULL CHECK (modo IN ('registro', 'uso_continuado', 'expreso')),
  user_agent  text,
  ip          inet,
  FOREIGN KEY (documento, version) REFERENCES public.legal_documents(documento, version),
  -- Una aceptacion por version. Volver a entrar no genera filas nuevas: lo que
  -- acredita es la PRIMERA vez que uso la plataforma bajo esa version.
  UNIQUE (user_id, documento, version)
);

CREATE INDEX legal_acceptances_user_idx ON public.legal_acceptances (user_id);

-- ── Semilla: lo que hay publicado hoy ───────────────────────────────────────
-- vigente_desde = publicado_en porque es la verdad: las dos entraron en vigor
-- el mismo dia que se publicaron. sustancial queda NULL porque la pregunta
-- —si el cambio del 26-ago fue sustancial y por tanto exigia preaviso— sigue
-- siendo de Pedro y nadie la ha respondido. Escribir false aqui seria
-- responderla en silencio.
INSERT INTO public.legal_documents (documento, version, publicado_en, vigente_desde, sustancial, resumen)
VALUES
  ('aviso', '2.2', '2026-08-26 00:00:00+00', '2026-08-26 00:00:00+00', NULL,
   'La seccion 4.2 dejaba de declarar solo la Credencial para Votar del INE y '
   'pasa a una formula abierta que incluye la credencial universitaria y remite '
   'al flujo de verificacion para las que se habiliten despues.'),
  ('terminos', '1.1', '2026-08-26 00:00:00+00', '2026-08-26 00:00:00+00', NULL,
   'Misma correccion que el Aviso 2.2, en la seccion 7.');

-- ── Permisos ────────────────────────────────────────────────────────────────
-- Se declaran a mano en vez de heredar los privilegios por defecto del esquema,
-- que conceden practicamente todo. Y se pone el GRANT en la MISMA migracion que
-- crea la tabla: la saga del onboarding de esta manana salio de una columna
-- anadida sin su GRANT, que rompio en silencio todo SELECT que la incluyera.
ALTER TABLE public.legal_documents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.legal_acceptances ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.legal_documents   FROM anon, authenticated;
REVOKE ALL ON public.legal_acceptances FROM anon, authenticated;

-- Que version rige es informacion publica: la pagina la muestra.
GRANT SELECT ON public.legal_documents TO anon, authenticated;

CREATE POLICY "legal_documents: leer lo publicado"
  ON public.legal_documents FOR SELECT TO anon, authenticated
  USING (true);

-- De las aceptaciones, cada quien ve las suyas. Y quien modera, todas: si
-- manana alguien pregunta que acepto un usuario, hay que poder responder.
GRANT SELECT ON public.legal_acceptances TO authenticated;

CREATE POLICY "legal_acceptances: las mias, o las de todos si modero"
  ON public.legal_acceptances FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin')
    OR public.has_role((SELECT auth.uid()), 'moderator')
  );

-- NO hay GRANT de INSERT, y no es un olvido. Esto es prueba legal: si el
-- cliente pudiera insertar, elegiria la fecha, la version y el modo que dice
-- haber aceptado. Se escribe solo por el RPC de abajo, que es SECURITY DEFINER
-- y pone las tres cosas desde el servidor. Mismo razonamiento que se aplico al
-- consentimiento biometrico.

-- ── Registrar la aceptacion tacita ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.registrar_aceptacion_legal(
  p_modo       text DEFAULT 'uso_continuado',
  p_user_agent text DEFAULT NULL,
  p_ip         text DEFAULT NULL
) RETURNS TABLE (documento text, version text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
-- Los parametros de SALIDA se llaman `documento` y `version`, igual que dos
-- columnas de la tabla. Sin esta directiva, PL/pgSQL resuelve esos nombres
-- como VARIABLES dentro del ON CONFLICT y del RETURNING, y la funcion muere
-- con "column reference is ambiguous" en tiempo de EJECUCION, no al crearla,
-- que es la peor forma de enterarse. `use_column` le dice que ahi mande la
-- columna, que es lo que se quiere en las tres apariciones.
#variable_conflict use_column
DECLARE
  v_uid uuid := auth.uid();
  v_ip  inet;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_modo NOT IN ('registro', 'uso_continuado', 'expreso') THEN
    RAISE EXCEPTION 'modo invalido';
  END IF;

  -- La IP llega de x-forwarded-for, que es una cabecera que pone el cliente y
  -- por tanto puede traer cualquier cosa. Un cast directo a inet levantaria
  -- 22P02 y tumbaria el registro entero de la aceptacion por un dato que solo
  -- es de apoyo: lo que acredita es la fila y su fecha, no la IP.
  BEGIN
    v_ip := CASE WHEN p_ip IS NULL OR btrim(p_ip) = '' THEN NULL ELSE p_ip::inet END;
  EXCEPTION WHEN others THEN
    v_ip := NULL;
  END;

  -- Para cada documento, la version VIGENTE: la de mayor vigente_desde que ya
  -- entro en vigor. Una version publicada pero aun no vigente no se acepta
  -- todavia — precisamente porque esta en su plazo de preaviso.
  RETURN QUERY
  INSERT INTO public.legal_acceptances AS la
    (user_id, documento, version, modo, user_agent, ip)
  SELECT v_uid, d.doc, d.ver, p_modo, p_user_agent, v_ip
  FROM (
    SELECT DISTINCT ON (ld.documento) ld.documento AS doc, ld.version AS ver
    FROM public.legal_documents ld
    WHERE ld.vigente_desde <= now()
    ORDER BY ld.documento, ld.vigente_desde DESC, ld.publicado_en DESC
  ) d
  -- Volver a entrar no genera filas nuevas. Lo que acredita es la primera vez
  -- que uso la plataforma bajo esa version.
  ON CONFLICT (user_id, documento, version) DO NOTHING
  RETURNING la.documento, la.version;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_aceptacion_legal(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_aceptacion_legal(text, text, text) TO authenticated;

COMMENT ON FUNCTION public.registrar_aceptacion_legal(text, text, text) IS
  'Deja constancia de la aceptacion tacita (§19 del Aviso) de las versiones '
  'vigentes. La fecha, el usuario y la version los pone el servidor: si los '
  'eligiera el cliente, el registro no acreditaria nada.';

-- ── Que hay que anunciar ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.avisos_legales_pendientes()
RETURNS TABLE (documento text, version text, vigente_desde timestamptz, resumen text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- Versiones SUSTANCIALES ya publicadas que aun no entran en vigor. Eso es
  -- exactamente la "notificacion visible en la Plataforma" que exige el §18.
  -- Las no sustanciales no se anuncian: el propio documento no lo pide, y un
  -- aviso que sale por cualquier retoque deja de leerse.
  SELECT ld.documento, ld.version, ld.vigente_desde, ld.resumen
  FROM public.legal_documents ld
  WHERE ld.sustancial IS TRUE
    AND ld.vigente_desde > now()
  ORDER BY ld.vigente_desde;
$$;

REVOKE ALL ON FUNCTION public.avisos_legales_pendientes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.avisos_legales_pendientes() TO anon, authenticated;

-- COMPROBACION (tras aplicar):
--   select * from legal_documents;                    -- 2 filas, sustancial NULL
--   select proname from pg_proc where proname in
--     ('registrar_aceptacion_legal','avisos_legales_pendientes');
--   -- y el candado, que es lo que importa:
--   insert into legal_documents (documento, version, publicado_en, vigente_desde, sustancial, resumen)
--   values ('aviso','9.9', now(), now(), true, 'x');  -- debe fallar con 23514
