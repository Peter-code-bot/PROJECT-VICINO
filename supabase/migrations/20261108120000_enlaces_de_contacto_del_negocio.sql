-- Enlaces de contacto del negocio: Instagram, WhatsApp, Google Maps y resenas de Google.
--
-- Primera entrega del pendiente INT-CRM-20261104. Cada negocio puede enlazar
-- desde su ficha publica los canales que ya tiene fuera de VICINO. Son enlaces
-- SALIENTES: no se leen ni se sincronizan mensajes ni resenas de ningun
-- proveedor. Eso queda para una fase posterior, si el piloto la justifica.
--
-- Decisiones que fijan la forma de las columnas:
--
--   1. Se guarda el DATO y no la URL armada cuando el dato basta: el usuario de
--      Instagram y el numero de WhatsApp. La URL la arma @vicino/shared con el
--      formato que documenta cada proveedor (instagram.com/<usuario>/ y
--      wa.me/<numero> sin "+", ceros ni guiones). Asi no entran URLs con
--      parametros de rastreo ni variantes que luego haya que normalizar.
--   2. Google Maps y las resenas de Google SI se guardan como URL, porque el
--      vendedor decide que punto comparte (su ficha o un lugar de entrega) y el
--      enlace de resenas lo genera Google en el Perfil de Negocio. Las dos se
--      acotan por CHECK a https y a dominios de Google: una columna publica no
--      puede servir de salto a un sitio ajeno.
--   3. Las cuatro columnas son publicas (SELECT para anon y authenticated, como
--      username): la ficha /vendedor/[id] se sirve a invitados.
--   4. Nadie las escribe directo: ni INSERT ni UPDATE por columna. Solo el RPC
--      actualizar_enlaces_negocio, que valida y exige modo vendedor activo. Es
--      la misma regla que ya rige el resto del perfil.
--   5. Los clics a esos enlaces se cuentan en clics_enlaces_negocio SIN
--      identidad de quien toca (ni usuario, ni IP, ni agente): solo canal y
--      momento. Un clic no es un mensaje ni una venta; es lo unico que se
--      puede medir sin leer conversaciones.
--
-- REGLA DURA DE ESTE REPO: profiles otorga privilegios COLUMNA POR COLUMNA.
-- Una columna nueva nace SIN NINGUNO, y sin el GRANT SELECT cualquier consulta
-- que la incluya muere entera con 42501 (no la columna: la consulta).

-- ---------------------------------------------------------------------------
-- 1. Columnas y su forma.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS instagram_usuario  TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_numero    TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url    TEXT,
  ADD COLUMN IF NOT EXISTS google_resenas_url TEXT;

COMMENT ON COLUMN public.profiles.instagram_usuario IS
  'Usuario publico de Instagram del negocio, sin @. La URL se arma en el cliente.';
COMMENT ON COLUMN public.profiles.whatsapp_numero IS
  'Numero de WhatsApp en formato internacional, solo digitos (sin +, ceros ni guiones), como pide wa.me.';
COMMENT ON COLUMN public.profiles.google_maps_url IS
  'URL https de Google Maps que el vendedor decide compartir (ficha o punto de entrega).';
COMMENT ON COLUMN public.profiles.google_resenas_url IS
  'Enlace oficial para dejar una resena en Google (g.page/r/<id>/review o search.google.com/local/writereview). Se ofrece solo tras una compra real.';

-- Los mismos patrones viven en packages/shared/src/utils/enlaces-negocio.ts.
-- Si divergen, el usuario ve un error distinto segun donde se valide.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_instagram_usuario_formato;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_instagram_usuario_formato
  CHECK (
    instagram_usuario IS NULL
    OR (
      char_length(instagram_usuario) BETWEEN 1 AND 30
      -- letras, numeros, guion bajo y puntos; ningun punto al final ni dos seguidos
      AND instagram_usuario ~ '^(?:[A-Za-z0-9_]|\.(?=[A-Za-z0-9_]))+$'
    )
  );

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_whatsapp_numero_formato;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_whatsapp_numero_formato
  -- E.164 sin "+": de 10 a 15 digitos y sin cero inicial. El minimo de 10 (y
  -- no 8) corta la forma mas comun de enlace roto en Mexico: un numero local
  -- sin lada de pais. No se rellena la lada: eso seria inventar un dato.
  CHECK (whatsapp_numero IS NULL OR whatsapp_numero ~ '^[1-9][0-9]{9,14}$');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_google_maps_url_formato;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_google_maps_url_formato
  CHECK (
    google_maps_url IS NULL
    OR (
      char_length(google_maps_url) <= 500
      AND google_maps_url !~ '\s'
      -- Sin segmentos "." o ".." (ni codificados) ni barras invertidas: el
      -- navegador los normaliza DESPUES de que el patron vio /maps/, y
      -- google.com/maps/../url?q=... acabaria fuera de Maps.
      AND google_maps_url !~* '(/\.|%2e|\\)'
      -- Lista CERRADA de hosts: un comodin de TLD dejaria pasar google.xyz.
      AND google_maps_url ~ '^https://((www\.)?google\.com(\.mx)?/maps([/?]|$)|maps\.google\.com(\.mx)?/|maps\.app\.goo\.gl/|goo\.gl/maps/|g\.page/)'
    )
  );

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_google_resenas_url_formato;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_google_resenas_url_formato
  CHECK (
    google_resenas_url IS NULL
    OR (
      char_length(google_resenas_url) <= 300
      AND google_resenas_url ~ '^https://(g\.page/(r/)?[A-Za-z0-9_-]+/review/?|search\.google\.com/local/writereview\?placeid=[A-Za-z0-9_-]+)$'
    )
  );

-- Publicas, como username. Sin INSERT ni UPDATE a proposito: las escribe el RPC.
GRANT SELECT (instagram_usuario, whatsapp_numero, google_maps_url, google_resenas_url)
  ON public.profiles TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. El unico camino de escritura.
--
-- Cada parametro en NULL (o vacio) BORRA ese enlace: el formulario manda los
-- cuatro campos siempre, asi que vacio significa "ya no quiero mostrarlo", no
-- "no lo toques". Es el mismo contrato que update_profile_and_pause_products.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.actualizar_enlaces_negocio(
  p_instagram_usuario  TEXT DEFAULT NULL,
  p_whatsapp_numero    TEXT DEFAULT NULL,
  p_google_maps_url    TEXT DEFAULT NULL,
  p_google_resenas_url TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_instagram TEXT := NULLIF(btrim(p_instagram_usuario), '');
  v_whatsapp  TEXT := NULLIF(btrim(p_whatsapp_numero), '');
  v_maps      TEXT := NULLIF(btrim(p_google_maps_url), '');
  v_resenas   TEXT := NULLIF(btrim(p_google_resenas_url), '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  -- Las mismas reglas que los CHECK, pero con un mensaje que la persona
  -- entiende. El CHECK sigue siendo la ultima linea, por si algo se salta esto.
  IF v_instagram IS NOT NULL AND (
       char_length(v_instagram) > 30
       OR v_instagram !~ '^(?:[A-Za-z0-9_]|\.(?=[A-Za-z0-9_]))+$'
     ) THEN
    RAISE EXCEPTION 'El usuario de Instagram solo admite letras, numeros, puntos y guion bajo (maximo 30).'
      USING ERRCODE = '22023';
  END IF;

  IF v_whatsapp IS NOT NULL AND v_whatsapp !~ '^[1-9][0-9]{9,14}$' THEN
    RAISE EXCEPTION 'Escribe el WhatsApp con lada de pais y solo digitos, por ejemplo 522221234567.'
      USING ERRCODE = '22023';
  END IF;

  IF v_maps IS NOT NULL AND (
       char_length(v_maps) > 500
       OR v_maps ~ '\s'
       OR v_maps ~* '(/\.|%2e|\\)'
       OR v_maps !~ '^https://((www\.)?google\.com(\.mx)?/maps([/?]|$)|maps\.google\.com(\.mx)?/|maps\.app\.goo\.gl/|goo\.gl/maps/|g\.page/)'
     ) THEN
    RAISE EXCEPTION 'El enlace de Google Maps debe ser un enlace https de Google Maps.'
      USING ERRCODE = '22023';
  END IF;

  IF v_resenas IS NOT NULL AND (
       char_length(v_resenas) > 300
       OR v_resenas !~ '^https://(g\.page/(r/)?[A-Za-z0-9_-]+/review/?|search\.google\.com/local/writereview\?placeid=[A-Za-z0-9_-]+)$'
     ) THEN
    RAISE EXCEPTION 'El enlace de resenas debe ser el que genera Google en tu Perfil de Negocio (g.page/r/.../review).'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET instagram_usuario  = v_instagram,
         whatsapp_numero    = v_whatsapp,
         google_maps_url    = v_maps,
         google_resenas_url = v_resenas
   WHERE id = v_uid
     AND es_vendedor IS TRUE;

  IF NOT FOUND THEN
    -- Un UPDATE de cero filas devolveria exito sin haber escrito nada.
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
      RAISE EXCEPTION 'Activa el modo vendedor para agregar los enlaces de tu negocio.'
        USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'instagram_usuario',  v_instagram,
    'whatsapp_numero',    v_whatsapp,
    'google_maps_url',    v_maps,
    'google_resenas_url', v_resenas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.actualizar_enlaces_negocio(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_enlaces_negocio(TEXT, TEXT, TEXT, TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Medir el origen sin leer conversaciones.
--
-- Una fila por clic. Deliberadamente NO guarda quien toco (ni id, ni IP, ni
-- agente de usuario): el vendedor necesita saber cuantas personas abrieron
-- cada canal desde su ficha, no quienes. `con_sesion` distingue invitados de
-- cuentas, que es lo unico que hace falta para leer el embudo.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.clics_enlaces_negocio (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendedor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  canal       TEXT NOT NULL CHECK (canal IN ('instagram', 'whatsapp', 'google_maps', 'google_resenas')),
  con_sesion  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.clics_enlaces_negocio IS
  'Un clic a un enlace externo desde la ficha de un negocio. Sin identidad de quien toca. Un clic no es un mensaje ni una venta. Conteo orientativo con topes contra abuso; se purga a los 90 dias (job purgar-clics-enlaces-negocio).';

CREATE INDEX IF NOT EXISTS clics_enlaces_negocio_vendedor_fecha_idx
  ON public.clics_enlaces_negocio (vendedor_id, created_at DESC);

-- Para el tope global por hora del RPC y para la purga diaria.
CREATE INDEX IF NOT EXISTS clics_enlaces_negocio_fecha_idx
  ON public.clics_enlaces_negocio (created_at);

ALTER TABLE public.clics_enlaces_negocio ENABLE ROW LEVEL SECURITY;

-- Nadie inserta, actualiza ni borra desde el cliente: solo el RPC de abajo.
REVOKE ALL ON TABLE public.clics_enlaces_negocio FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.clics_enlaces_negocio TO authenticated;

DROP POLICY IF EXISTS clics_enlaces_negocio_vendedor_lee_los_suyos ON public.clics_enlaces_negocio;
CREATE POLICY clics_enlaces_negocio_vendedor_lee_los_suyos
  ON public.clics_enlaces_negocio
  FOR SELECT
  TO authenticated
  USING (auth.uid() = vendedor_id);

-- Devuelve TRUE si conto el clic. Devuelve FALSE, sin error, cuando no toca
-- contarlo: el dueno toca su propio enlace, el canal no esta configurado, el
-- perfil no es vendedor o esta oculto, o se alcanzo alguno de los dos topes.
-- Sin error a proposito: la respuesta de este RPC no debe servir para adivinar
-- nada de un perfil (TRUE solo confirma lo que las columnas publicas ya dicen).
--
-- Los topes existen porque la llave anon es publica y cualquiera puede llamar
-- a PostgREST sin pasar por el freno de la Server Action:
--   - 20 por minuto por negocio: muy por encima de lo que una ficha real
--     produce, y acota a ~29 mil filas al dia lo que un script puede inflarle a
--     UN negocio (con la purga de 90 dias, el peor caso queda acotado).
--   - 5000 por hora en total: protege el almacenamiento si el ataque se
--     reparte entre muchos negocios. Si se alcanza, los clics reales de esa
--     hora no se cuentan: la metrica es orientativa, no auditada, y la
--     pantalla del vendedor lo dice.
CREATE OR REPLACE FUNCTION public.registrar_clic_enlace_negocio(
  p_vendedor_id UUID,
  p_canal       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_tiene BOOLEAN;
  v_ultimo_minuto INTEGER;
  v_ultima_hora   INTEGER;
BEGIN
  IF p_vendedor_id IS NULL
     OR p_canal IS NULL
     OR p_canal NOT IN ('instagram', 'whatsapp', 'google_maps', 'google_resenas') THEN
    RAISE EXCEPTION 'Canal invalido.' USING ERRCODE = '22023';
  END IF;

  -- El dueno probando sus enlaces no es trafico.
  IF v_uid IS NOT NULL AND v_uid = p_vendedor_id THEN
    RETURN FALSE;
  END IF;

  SELECT CASE p_canal
           WHEN 'instagram'   THEN instagram_usuario  IS NOT NULL
           WHEN 'whatsapp'    THEN whatsapp_numero    IS NOT NULL
           WHEN 'google_maps' THEN google_maps_url    IS NOT NULL
           ELSE                    google_resenas_url IS NOT NULL
         END
    INTO v_tiene
    FROM public.profiles
   WHERE id = p_vendedor_id
     AND es_vendedor IS TRUE
     AND is_hidden = FALSE;

  IF NOT COALESCE(v_tiene, FALSE) THEN
    RETURN FALSE;
  END IF;

  -- Tope por negocio (indice vendedor_id, created_at).
  SELECT count(*) INTO v_ultimo_minuto
    FROM public.clics_enlaces_negocio
   WHERE vendedor_id = p_vendedor_id
     AND created_at > now() - interval '1 minute';

  IF v_ultimo_minuto >= 20 THEN
    RETURN FALSE;
  END IF;

  -- Tope global (indice created_at).
  SELECT count(*) INTO v_ultima_hora
    FROM public.clics_enlaces_negocio
   WHERE created_at > now() - interval '1 hour';

  IF v_ultima_hora >= 5000 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.clics_enlaces_negocio (vendedor_id, canal, con_sesion)
  VALUES (p_vendedor_id, p_canal, v_uid IS NOT NULL);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_clic_enlace_negocio(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_clic_enlace_negocio(UUID, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Retencion: 90 dias. El vendedor ve 30; el resto es margen para comparar.
--
-- SQL puro en pg_cron, como 'expire-purchase-requests' (20260710000001):
-- no hace falta Edge Function ni secreto del Vault para un DELETE. Idempotente:
-- si el job ya existe se vuelve a crear con la misma definicion. Si pg_cron no
-- esta (un entorno local), no falla: se anota en VERIFY y se programa a mano.
-- ---------------------------------------------------------------------------

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-clics-enlaces-negocio') THEN
      PERFORM cron.unschedule('purgar-clics-enlaces-negocio');
    END IF;
    PERFORM cron.schedule(
      'purgar-clics-enlaces-negocio',
      '23 4 * * *',  -- 04:23 UTC, fuera de la punta en :00 que comparten los otros jobs
      $$DELETE FROM public.clics_enlaces_negocio WHERE created_at < now() - interval '90 days'$$
    );
  END IF;
END $do$;

-- VERIFY:
--   SELECT column_name, string_agg(grantee, ',' ORDER BY grantee)
--     FROM information_schema.column_privileges
--    WHERE table_name = 'profiles' AND privilege_type = 'SELECT'
--      AND column_name IN ('instagram_usuario','whatsapp_numero','google_maps_url','google_resenas_url')
--    GROUP BY 1;
--   -- esperado: las cuatro con anon,authenticated
--
--   SELECT count(*) FROM information_schema.column_privileges
--    WHERE table_name = 'profiles' AND privilege_type IN ('INSERT','UPDATE')
--      AND column_name IN ('instagram_usuario','whatsapp_numero','google_maps_url','google_resenas_url');
--   -- esperado: 0
--
--   SELECT has_function_privilege('anon', 'public.actualizar_enlaces_negocio(text,text,text,text)', 'EXECUTE');
--   -- esperado: false
--   SELECT has_function_privilege('anon', 'public.registrar_clic_enlace_negocio(uuid,text)', 'EXECUTE');
--   -- esperado: true
--   SELECT has_table_privilege('anon', 'public.clics_enlaces_negocio', 'SELECT');
--   -- esperado: false
--   SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'purgar-clics-enlaces-negocio';
--   -- esperado: 1 fila, '23 4 * * *', active = true (si no hay fila, pg_cron no estaba: programar a mano)
--
--   SELECT 'https://www.google.com/maps/../url?q=https://evil.com' ~* '(/\.|%2e|\\)';   -- true (se rechaza)
--   SELECT 'https://www.google.xyz/maps/place/x' ~ '^https://((www\.)?google\.com(\.mx)?/maps([/?]|$)|maps\.google\.com(\.mx)?/|maps\.app\.goo\.gl/|goo\.gl/maps/|g\.page/)';
--   -- false (se rechaza)
--
--   Bajo rol real (BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"<uuid vendedor>","role":"authenticated"}';):
--     SELECT public.actualizar_enlaces_negocio('@Mi.Tienda', '+52 (222) 123-4567', NULL, NULL);
--     -- esperado: 22023 en Instagram (el @ no se limpia aqui: lo hace el cliente) y en WhatsApp (tiene + y guiones)
--     SELECT public.actualizar_enlaces_negocio('mi.tienda', '522221234567', 'https://maps.app.goo.gl/abc', NULL);
--     -- esperado: jsonb con los tres valores y resenas null
--     SELECT public.registrar_clic_enlace_negocio('<uuid vendedor>', 'whatsapp');
--     -- esperado: false (es el dueno)
--   ROLLBACK;
