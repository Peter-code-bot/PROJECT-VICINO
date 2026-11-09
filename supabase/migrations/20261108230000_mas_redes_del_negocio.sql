-- Mas redes en el perfil del negocio: Facebook (y Messenger), TikTok, YouTube,
-- X, LinkedIn, Threads, Pinterest y Telegram.
--
-- Segunda entrega de INT-CRM-20261104, sobre 20261108120000 (Instagram,
-- WhatsApp, Google Maps y resenas). Misma receta, mismas reglas:
--
--   1. Se guarda el DATO (el usuario, o la ruta corta del perfil en Facebook,
--      YouTube y LinkedIn) y no la URL que pega el vendedor. La URL la arma
--      @vicino/shared con el formato oficial de cada red
--      (packages/shared/src/utils/redes-negocio.ts).
--   2. Columnas PUBLICAS: SELECT para anon y authenticated, porque la ficha
--      /vendedor/[id] se sirve a invitados. Sin INSERT ni UPDATE por columna.
--   3. Un solo camino de escritura: guardar_enlaces_negocio(jsonb). Es un RPC
--      NUEVO y no una version ampliada de actualizar_enlaces_negocio, por dos
--      razones:
--        - Con el mismo nombre y otra aridad, PostgREST ve dos funciones y
--          responde 300 (sobrecarga). Es lo que ya se evito en 20261108120000.
--        - En el RPC viejo, vacio = quitar. Un formulario abierto antes del
--          despliegue no trae los campos nuevos y los borraria al guardar. En
--          el nuevo, una clave que NO viene no se toca.
--      El RPC viejo se queda tal cual mientras el codigo desplegado lo use; se
--      borra en una migracion de limpieza posterior.
--   4. Los clics de los canales nuevos se cuentan igual: sin identidad, con los
--      mismos topes. Se amplia el CHECK y la funcion conserva su firma (no hay
--      sobrecarga).
--
-- Compatible con el codigo de master: las columnas nacen vacias, el RPC nuevo
-- va aparte, el viejo no cambia y el CHECK de clics solo se amplia. Por eso se
-- aplica ANTES del merge.
--
-- ORDEN, a proposito: primero clics y funciones (los cuerpos plpgsql no se
-- validan contra las columnas al crearse) y AL FINAL un solo ALTER TABLE sobre
-- profiles, con todas las columnas y CHECK juntos: un solo recorrido de la
-- tabla y el bloqueo ACCESS EXCLUSIVE de profiles dura lo menos posible.
--
-- REGLA DURA DE ESTE REPO: profiles otorga privilegios COLUMNA POR COLUMNA. Una
-- columna nueva nace SIN NINGUNO, y sin el GRANT SELECT cualquier consulta que
-- la incluya muere entera con 42501.
--
-- Los patrones se repiten tal cual en packages/shared/src/utils/redes-negocio.ts.
-- Excepcion deliberada: el @handle de YouTube admite letras de cualquier idioma.
-- El \p{L} de JavaScript no tiene equivalente exacto en una expresion de
-- Postgres (las clases dependen del locale), asi que aqui la regla es mas laxa:
-- longitud; sin espacios, controles, caracteres de formato o de direccion de
-- texto (U+202E y familia), ni / ? # % \ @ & = + " ' < > `. La completa vive en
-- el formulario y la URL se arma sobre youtube.com con el handle codificado:
-- lo laxo no abre ningun salto a otro sitio.

SET LOCAL lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- 1. Clics de los canales nuevos. Mismas reglas y mismos topes que en
-- 20261108120000; cambian solo la lista de canales y el CASE. Misma firma.
-- ---------------------------------------------------------------------------

ALTER TABLE public.clics_enlaces_negocio
  DROP CONSTRAINT IF EXISTS clics_enlaces_negocio_canal_check,
  DROP CONSTRAINT IF EXISTS clics_enlaces_negocio_canal_valido,
  ADD CONSTRAINT clics_enlaces_negocio_canal_valido
    CHECK (canal IN (
      'instagram', 'whatsapp', 'google_maps', 'google_resenas',
      'facebook', 'messenger', 'tiktok', 'youtube', 'x', 'linkedin', 'threads', 'pinterest', 'telegram'
    ));

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
     OR p_canal NOT IN (
       'instagram', 'whatsapp', 'google_maps', 'google_resenas',
       'facebook', 'messenger', 'tiktok', 'youtube', 'x', 'linkedin', 'threads', 'pinterest', 'telegram'
     ) THEN
    RAISE EXCEPTION 'Canal invalido.' USING ERRCODE = '22023';
  END IF;

  -- El dueno probando sus enlaces no es trafico.
  IF v_uid IS NOT NULL AND v_uid = p_vendedor_id THEN
    RETURN FALSE;
  END IF;

  SELECT CASE p_canal
           WHEN 'instagram'      THEN instagram_usuario  IS NOT NULL
           WHEN 'whatsapp'       THEN whatsapp_numero    IS NOT NULL
           WHEN 'google_maps'    THEN google_maps_url    IS NOT NULL
           WHEN 'google_resenas' THEN google_resenas_url IS NOT NULL
           WHEN 'facebook'       THEN facebook_ruta      IS NOT NULL
           WHEN 'messenger'      THEN facebook_messenger IS TRUE AND facebook_ruta IS NOT NULL
           WHEN 'tiktok'         THEN tiktok_usuario     IS NOT NULL
           WHEN 'youtube'        THEN youtube_ruta       IS NOT NULL
           WHEN 'x'              THEN x_usuario          IS NOT NULL
           WHEN 'linkedin'       THEN linkedin_ruta      IS NOT NULL
           WHEN 'threads'        THEN threads_usuario    IS NOT NULL
           WHEN 'pinterest'      THEN pinterest_usuario  IS NOT NULL
           WHEN 'telegram'       THEN telegram_usuario   IS NOT NULL
           ELSE FALSE
         END
    INTO v_tiene
    FROM public.profiles
   WHERE id = p_vendedor_id
     AND es_vendedor IS TRUE
     AND is_hidden = FALSE;

  IF NOT COALESCE(v_tiene, FALSE) THEN
    RETURN FALSE;
  END IF;

  -- Un lock por negocio para que llamadas concurrentes no se salten el tope.
  PERFORM pg_advisory_xact_lock(hashtext('clics_enlaces_negocio:' || p_vendedor_id::text));

  SELECT count(*) INTO v_ultimo_minuto
    FROM public.clics_enlaces_negocio
   WHERE vendedor_id = p_vendedor_id
     AND created_at > now() - interval '1 minute';

  IF v_ultimo_minuto >= 20 THEN
    RETURN FALSE;
  END IF;

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

-- Conteo por canal para /seller/analytics en UNA consulta (antes era una por
-- canal; con trece canales ya no tiene sentido). SECURITY INVOKER: la RLS de
-- clics_enlaces_negocio ya deja ver solo los propios, y el WHERE lo repite.
CREATE OR REPLACE FUNCTION public.clics_enlaces_negocio_por_canal(p_dias INTEGER DEFAULT 30)
RETURNS TABLE (canal TEXT, clics BIGINT)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT c.canal, count(*)::bigint
    FROM public.clics_enlaces_negocio c
   WHERE c.vendedor_id = (SELECT auth.uid())
     AND c.created_at > now() - make_interval(days => LEAST(GREATEST(COALESCE(p_dias, 30), 1), 90))
   GROUP BY c.canal;
$$;

REVOKE ALL ON FUNCTION public.clics_enlaces_negocio_por_canal(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clics_enlaces_negocio_por_canal(INTEGER) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. El camino de escritura para los trece enlaces.
--
-- p_enlaces es un objeto. Por cada clave:
--   - que NO viene: ese enlace no se toca;
--   - null o "": ese enlace se quita (facebook_messenger: null o false lo apaga);
--   - texto: se valida con la regla de su columna y se guarda.
-- Una clave desconocida o de otro tipo es un error: un cliente que manda algo
-- que no entendemos no debe guardar la mitad.
--
-- PONER algo exige modo vendedor. QUITAR siempre se puede, igual que en
-- actualizar_enlaces_negocio: son columnas publicas y un comercio que dejo de
-- vender tiene que poder retirarlas sin volver a activar nada.
--
-- Las rutas de Facebook y Telegram que no son un perfil (share, groups,
-- marketplace, login.php, joinchat, proxy...) se rechazan aqui tambien: quien
-- llama a PostgREST directo con su token se salta el formulario.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guardar_enlaces_negocio(p_enlaces JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  c_textos CONSTANT TEXT[] := ARRAY[
    'instagram_usuario', 'whatsapp_numero', 'google_maps_url', 'google_resenas_url',
    'facebook_ruta', 'tiktok_usuario', 'youtube_ruta', 'x_usuario',
    'linkedin_ruta', 'threads_usuario', 'pinterest_usuario', 'telegram_usuario'
  ];
  c_prohibidos    CONSTANT TEXT := '[\u0001-\u0020\u007f-\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]';
  c_prohibidos_yt CONSTANT TEXT := '[\u00ad\u034f\u061c\u180e\u200e\u200f\u202a-\u202e\u2060-\u206f\U000e0000-\U000e007f"''<>`]';
  c_no_perfil_facebook CONSTANT TEXT[] := ARRAY[
    'share', 'sharer', 'groups', 'pages', 'watch', 'marketplace', 'events', 'photo', 'photos', 'reel', 'reels',
    'videos', 'gaming', 'login', 'help', 'hashtag', 'stories', 'dialog', 'plugins', 'settings', 'messages',
    'notifications', 'friends', 'search', 'profile'
  ];
  c_no_perfil_telegram CONSTANT TEXT[] := ARRAY['joinchat', 'addstickers', 'addemoji', 'share', 'proxy', 'socks', 'login'];
  v_uid        UUID := auth.uid();
  v_clave      TEXT;
  v_valor      JSONB;
  v_texto      TEXT;
  v_nuevos     JSONB := '{}'::jsonb;
  v_pone       BOOLEAN := FALSE;
  v_messenger  BOOLEAN;
  v_es_vendedor BOOLEAN;
  v_fb_actual  TEXT;
  v_msg_actual BOOLEAN;
  v_fb_final   TEXT;
  v_msg_final  BOOLEAN;
  v_resultado  JSONB;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesión.' USING ERRCODE = '42501';
  END IF;

  IF p_enlaces IS NULL OR jsonb_typeof(p_enlaces) <> 'object' THEN
    RAISE EXCEPTION 'No pudimos leer los enlaces de tu negocio.' USING ERRCODE = '22023';
  END IF;

  FOR v_clave, v_valor IN SELECT key, value FROM jsonb_each(p_enlaces) LOOP
    IF v_clave = 'facebook_messenger' THEN
      IF jsonb_typeof(v_valor) NOT IN ('boolean', 'null') THEN
        RAISE EXCEPTION 'No pudimos leer los enlaces de tu negocio.' USING ERRCODE = '22023';
      END IF;
      v_messenger := COALESCE((v_valor #>> '{}')::boolean, FALSE);
      v_pone := v_pone OR v_messenger;
      CONTINUE;
    END IF;

    IF NOT (v_clave = ANY (c_textos)) OR jsonb_typeof(v_valor) NOT IN ('string', 'null') THEN
      -- Sin eco de la clave: la escribe el cliente y el mensaje llega a pantalla.
      RAISE EXCEPTION 'No pudimos leer los enlaces de tu negocio.' USING ERRCODE = '22023';
    END IF;

    v_texto := NULLIF(btrim(v_valor #>> '{}'), '');

    IF v_texto IS NOT NULL THEN
      v_pone := TRUE;

      -- Las mismas reglas que los CHECK, con un mensaje que la persona entiende.
      -- El CHECK sigue siendo la ultima linea.
      IF v_clave = 'instagram_usuario' AND (
           char_length(v_texto) > 30 OR v_texto !~ '^(?:[A-Za-z0-9_]|\.(?=[A-Za-z0-9_]))+$') THEN
        RAISE EXCEPTION 'El usuario de Instagram solo admite letras, números, puntos y guion bajo (máximo 30).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'whatsapp_numero' AND v_texto !~ '^[1-9][0-9]{10,14}$' THEN
        RAISE EXCEPTION 'Escribe el WhatsApp con lada de país y solo dígitos: 52 y tus 10 dígitos, por ejemplo 522221234567.'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'google_maps_url' AND (
           char_length(v_texto) > 500
           OR v_texto ~ c_prohibidos
           OR v_texto ~* '(/\.|%2e|\\)'
           OR v_texto !~ '^https://((www\.)?google\.com(\.mx)?/maps([/?]|$)|maps\.google\.com(\.mx)?/|maps\.app\.goo\.gl/|goo\.gl/maps/|g\.page/)') THEN
        RAISE EXCEPTION 'El enlace de Google Maps debe ser un enlace https de Google Maps.'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'google_resenas_url' AND (
           char_length(v_texto) > 300
           OR v_texto ~ c_prohibidos
           OR v_texto !~ '^https://(g\.page/(r/)?[A-Za-z0-9_-]+/review/?|search\.google\.com/local/writereview\?placeid=[A-Za-z0-9_-]+)$') THEN
        RAISE EXCEPTION 'El enlace de reseñas debe ser el que genera Google en tu Perfil de Negocio (g.page/r/.../review).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'facebook_ruta' AND NOT (
           v_texto ~ '^profile\.php\?id=[0-9]{5,20}$'
           OR (char_length(v_texto) BETWEEN 5 AND 50 AND v_texto ~ '^[a-z0-9.]+$' AND v_texto ~ '[a-z]'
               AND v_texto !~ '\.php$' AND NOT (v_texto = ANY (c_no_perfil_facebook)))) THEN
        RAISE EXCEPTION 'Escribe el usuario de tu página de Facebook: al menos 5 letras, números o puntos.'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'tiktok_usuario' AND v_texto !~ '^[A-Za-z0-9_.]{1,23}[A-Za-z0-9_]$' THEN
        RAISE EXCEPTION 'El usuario de TikTok solo admite letras, números, guion bajo y puntos (de 2 a 24, sin punto al final).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'youtube_ruta' AND NOT (
           v_texto ~ '^channel/UC[A-Za-z0-9_-]{22}$'
           OR (char_length(v_texto) BETWEEN 4 AND 31 AND v_texto ~ '^@[^/?#%\\@&=+]+$'
               AND v_texto !~ c_prohibidos AND v_texto !~ c_prohibidos_yt)) THEN
        RAISE EXCEPTION 'Escribe el @ de tu canal de YouTube (de 3 a 30 caracteres).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'x_usuario' AND v_texto !~ '^[A-Za-z0-9_]{1,15}$' THEN
        RAISE EXCEPTION 'El usuario de X solo admite letras, números y guion bajo (máximo 15).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'linkedin_ruta' AND v_texto !~ '^(in/[a-z0-9][a-z0-9-]{2,99}|company/[a-z0-9][a-z0-9-]{1,99})$' THEN
        RAISE EXCEPTION 'Pega el enlace de tu perfil o de tu página de empresa en LinkedIn (linkedin.com/in/... o linkedin.com/company/...).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'threads_usuario' AND (
           char_length(v_texto) > 30 OR v_texto !~ '^(?:[a-z0-9_]|\.(?=[a-z0-9_]))+$') THEN
        RAISE EXCEPTION 'El usuario de Threads solo admite letras, números, puntos y guion bajo (máximo 30).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'pinterest_usuario' AND NOT (v_texto ~ '^[A-Za-z0-9_]{3,30}$' AND v_texto ~ '[A-Za-z_]') THEN
        RAISE EXCEPTION 'El usuario de Pinterest solo admite letras, números y guion bajo (de 3 a 30).'
          USING ERRCODE = '22023';
      ELSIF v_clave = 'telegram_usuario' AND (
           v_texto !~ '^[a-z0-9_]{5,32}$' OR v_texto = ANY (c_no_perfil_telegram)) THEN
        RAISE EXCEPTION 'El usuario de Telegram solo admite letras, números y guion bajo (de 5 a 32).'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    v_nuevos := v_nuevos || jsonb_build_object(v_clave, v_texto);
  END LOOP;

  -- NO KEY UPDATE y no UPDATE: basta para serializar contra otros escritores y
  -- no frena a quien inserta un clic (la FK de clics toma KEY SHARE).
  SELECT es_vendedor, facebook_ruta, facebook_messenger
    INTO v_es_vendedor, v_fb_actual, v_msg_actual
    FROM public.profiles
   WHERE id = v_uid
   FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontró tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  IF v_pone AND v_es_vendedor IS NOT TRUE THEN
    RAISE EXCEPTION 'Activa el modo vendedor para agregar los enlaces de tu negocio.' USING ERRCODE = '42501';
  END IF;

  -- Messenger va colgado del usuario de Facebook. Si quien llama lo PIDE sin
  -- usuario (o con ID numerico), es un error que tiene que ver. Si solo quito
  -- o cambio Facebook, Messenger se apaga solo: no hay a donde mandar.
  v_fb_final := CASE WHEN v_nuevos ? 'facebook_ruta' THEN v_nuevos ->> 'facebook_ruta' ELSE v_fb_actual END;
  v_msg_final := CASE WHEN p_enlaces ? 'facebook_messenger' THEN v_messenger ELSE v_msg_actual END;
  IF v_msg_final AND (v_fb_final IS NULL OR v_fb_final ~ '^profile\.php\?id=') THEN
    IF p_enlaces ? 'facebook_messenger' THEN
      RAISE EXCEPTION 'Messenger necesita el usuario de tu página de Facebook (no el número de ID).'
        USING ERRCODE = '22023';
    END IF;
    v_msg_final := FALSE;
  END IF;

  -- Nada que cambiar: no se reescribe la fila (los triggers de profiles no
  -- tienen por que correr por un guardado vacio).
  IF v_nuevos = '{}'::jsonb AND v_msg_final IS NOT DISTINCT FROM v_msg_actual THEN
    SELECT jsonb_build_object(
      'instagram_usuario', instagram_usuario, 'whatsapp_numero', whatsapp_numero,
      'google_maps_url', google_maps_url, 'google_resenas_url', google_resenas_url,
      'facebook_ruta', facebook_ruta, 'facebook_messenger', facebook_messenger,
      'tiktok_usuario', tiktok_usuario, 'youtube_ruta', youtube_ruta, 'x_usuario', x_usuario,
      'linkedin_ruta', linkedin_ruta, 'threads_usuario', threads_usuario,
      'pinterest_usuario', pinterest_usuario, 'telegram_usuario', telegram_usuario
    ) INTO v_resultado
      FROM public.profiles
     WHERE id = v_uid;
    RETURN v_resultado;
  END IF;

  UPDATE public.profiles
     SET instagram_usuario  = CASE WHEN v_nuevos ? 'instagram_usuario'  THEN v_nuevos ->> 'instagram_usuario'  ELSE instagram_usuario  END,
         whatsapp_numero    = CASE WHEN v_nuevos ? 'whatsapp_numero'    THEN v_nuevos ->> 'whatsapp_numero'    ELSE whatsapp_numero    END,
         google_maps_url    = CASE WHEN v_nuevos ? 'google_maps_url'    THEN v_nuevos ->> 'google_maps_url'    ELSE google_maps_url    END,
         google_resenas_url = CASE WHEN v_nuevos ? 'google_resenas_url' THEN v_nuevos ->> 'google_resenas_url' ELSE google_resenas_url END,
         facebook_ruta      = v_fb_final,
         facebook_messenger = v_msg_final,
         tiktok_usuario     = CASE WHEN v_nuevos ? 'tiktok_usuario'     THEN v_nuevos ->> 'tiktok_usuario'     ELSE tiktok_usuario     END,
         youtube_ruta       = CASE WHEN v_nuevos ? 'youtube_ruta'       THEN v_nuevos ->> 'youtube_ruta'       ELSE youtube_ruta       END,
         x_usuario          = CASE WHEN v_nuevos ? 'x_usuario'          THEN v_nuevos ->> 'x_usuario'          ELSE x_usuario          END,
         linkedin_ruta      = CASE WHEN v_nuevos ? 'linkedin_ruta'      THEN v_nuevos ->> 'linkedin_ruta'      ELSE linkedin_ruta      END,
         threads_usuario    = CASE WHEN v_nuevos ? 'threads_usuario'    THEN v_nuevos ->> 'threads_usuario'    ELSE threads_usuario    END,
         pinterest_usuario  = CASE WHEN v_nuevos ? 'pinterest_usuario'  THEN v_nuevos ->> 'pinterest_usuario'  ELSE pinterest_usuario  END,
         telegram_usuario   = CASE WHEN v_nuevos ? 'telegram_usuario'   THEN v_nuevos ->> 'telegram_usuario'   ELSE telegram_usuario   END
   WHERE id = v_uid
  RETURNING jsonb_build_object(
    'instagram_usuario', instagram_usuario, 'whatsapp_numero', whatsapp_numero,
    'google_maps_url', google_maps_url, 'google_resenas_url', google_resenas_url,
    'facebook_ruta', facebook_ruta, 'facebook_messenger', facebook_messenger,
    'tiktok_usuario', tiktok_usuario, 'youtube_ruta', youtube_ruta, 'x_usuario', x_usuario,
    'linkedin_ruta', linkedin_ruta, 'threads_usuario', threads_usuario,
    'pinterest_usuario', pinterest_usuario, 'telegram_usuario', telegram_usuario
  ) INTO v_resultado;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.guardar_enlaces_negocio(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_enlaces_negocio(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Columnas y su forma, en UN solo ALTER TABLE (un solo recorrido de la
-- tabla para validar los nueve CHECK). Toma ACCESS EXCLUSIVE sobre profiles
-- hasta el COMMIT; por eso va al final.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS facebook_ruta      TEXT,
  ADD COLUMN IF NOT EXISTS facebook_messenger BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tiktok_usuario     TEXT,
  ADD COLUMN IF NOT EXISTS youtube_ruta       TEXT,
  ADD COLUMN IF NOT EXISTS x_usuario          TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_ruta      TEXT,
  ADD COLUMN IF NOT EXISTS threads_usuario    TEXT,
  ADD COLUMN IF NOT EXISTS pinterest_usuario  TEXT,
  ADD COLUMN IF NOT EXISTS telegram_usuario   TEXT,
  DROP CONSTRAINT IF EXISTS profiles_facebook_ruta_formato,
  DROP CONSTRAINT IF EXISTS profiles_facebook_messenger_con_usuario,
  DROP CONSTRAINT IF EXISTS profiles_tiktok_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_youtube_ruta_formato,
  DROP CONSTRAINT IF EXISTS profiles_x_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_linkedin_ruta_formato,
  DROP CONSTRAINT IF EXISTS profiles_threads_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_pinterest_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_telegram_usuario_formato,
  ADD CONSTRAINT profiles_facebook_ruta_formato CHECK (
    facebook_ruta IS NULL
    OR facebook_ruta ~ '^profile\.php\?id=[0-9]{5,20}$'
    OR (
      char_length(facebook_ruta) BETWEEN 5 AND 50
      AND facebook_ruta ~ '^[a-z0-9.]+$'
      AND facebook_ruta ~ '[a-z]'
      AND facebook_ruta !~ '\.php$'
      AND facebook_ruta NOT IN (
        'share', 'sharer', 'groups', 'pages', 'watch', 'marketplace', 'events', 'photo', 'photos', 'reel', 'reels',
        'videos', 'gaming', 'login', 'help', 'hashtag', 'stories', 'dialog', 'plugins', 'settings', 'messages',
        'notifications', 'friends', 'search', 'profile'
      )
    )
  ),
  -- m.me necesita el usuario: con un ID numerico no hay a donde mandar.
  ADD CONSTRAINT profiles_facebook_messenger_con_usuario CHECK (
    facebook_messenger IS NOT TRUE
    OR (facebook_ruta IS NOT NULL AND facebook_ruta !~ '^profile\.php\?id=')
  ),
  -- 2 a 24: letras, numeros, guion bajo y puntos; sin punto al final.
  ADD CONSTRAINT profiles_tiktok_usuario_formato CHECK (
    tiktok_usuario IS NULL OR tiktok_usuario ~ '^[A-Za-z0-9_.]{1,23}[A-Za-z0-9_]$'
  ),
  ADD CONSTRAINT profiles_youtube_ruta_formato CHECK (
    youtube_ruta IS NULL
    OR youtube_ruta ~ '^channel/UC[A-Za-z0-9_-]{22}$'
    OR (
      char_length(youtube_ruta) BETWEEN 4 AND 31
      AND youtube_ruta ~ '^@[^/?#%\\@&=+]+$'
      AND youtube_ruta !~ '[\u0001-\u0020\u007f-\u00a0\u1680\u2000-\u200d\u2028\u2029\u202f\u205f\u3000\ufeff]'
      AND youtube_ruta !~ '[\u00ad\u034f\u061c\u180e\u200e\u200f\u202a-\u202e\u2060-\u206f\U000e0000-\U000e007f"''<>`]'
    )
  ),
  ADD CONSTRAINT profiles_x_usuario_formato CHECK (
    x_usuario IS NULL OR x_usuario ~ '^[A-Za-z0-9_]{1,15}$'
  ),
  ADD CONSTRAINT profiles_linkedin_ruta_formato CHECK (
    linkedin_ruta IS NULL OR linkedin_ruta ~ '^(in/[a-z0-9][a-z0-9-]{2,99}|company/[a-z0-9][a-z0-9-]{1,99})$'
  ),
  -- Las reglas de Instagram: Threads no publica las suyas.
  ADD CONSTRAINT profiles_threads_usuario_formato CHECK (
    threads_usuario IS NULL
    OR (
      char_length(threads_usuario) BETWEEN 1 AND 30
      AND threads_usuario ~ '^(?:[a-z0-9_]|\.(?=[a-z0-9_]))+$'
    )
  ),
  -- 3 a 30: letras, numeros y guion bajo; no solo numeros.
  ADD CONSTRAINT profiles_pinterest_usuario_formato CHECK (
    pinterest_usuario IS NULL OR (pinterest_usuario ~ '^[A-Za-z0-9_]{3,30}$' AND pinterest_usuario ~ '[A-Za-z_]')
  ),
  ADD CONSTRAINT profiles_telegram_usuario_formato CHECK (
    telegram_usuario IS NULL
    OR (
      telegram_usuario ~ '^[a-z0-9_]{5,32}$'
      AND telegram_usuario NOT IN ('joinchat', 'addstickers', 'addemoji', 'share', 'proxy', 'socks', 'login')
    )
  );

COMMENT ON COLUMN public.profiles.facebook_ruta IS
  'Pagina o perfil de Facebook del negocio: el usuario en minusculas, o profile.php?id=<digitos> si no tiene usuario. La URL se arma en el cliente.';
COMMENT ON COLUMN public.profiles.facebook_messenger IS
  'TRUE = la ficha ofrece Messenger (m.me/<usuario de Facebook>). Solo con usuario, no con ID numerico.';
COMMENT ON COLUMN public.profiles.tiktok_usuario IS
  'Usuario publico de TikTok, sin @, tal como lo escribio el vendedor.';
COMMENT ON COLUMN public.profiles.youtube_ruta IS
  'Canal de YouTube: @handle (el formulario lo guarda en minusculas) o channel/UC<22>.';
COMMENT ON COLUMN public.profiles.x_usuario IS
  'Usuario publico de X (antes Twitter), sin @, tal como lo escribio el vendedor.';
COMMENT ON COLUMN public.profiles.linkedin_ruta IS
  'LinkedIn: company/<slug> (pagina de empresa) o in/<slug> (perfil), en minusculas.';
COMMENT ON COLUMN public.profiles.threads_usuario IS
  'Usuario publico de Threads, sin @, en minusculas.';
COMMENT ON COLUMN public.profiles.pinterest_usuario IS
  'Usuario publico de Pinterest, tal como lo escribio el vendedor.';
COMMENT ON COLUMN public.profiles.telegram_usuario IS
  'Usuario publico de Telegram, sin @, en minusculas.';

-- Publicas, como instagram_usuario. Sin INSERT ni UPDATE a proposito.
REVOKE ALL (facebook_ruta, facebook_messenger, tiktok_usuario, youtube_ruta, x_usuario,
            linkedin_ruta, threads_usuario, pinterest_usuario, telegram_usuario)
  ON public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT (facebook_ruta, facebook_messenger, tiktok_usuario, youtube_ruta, x_usuario,
              linkedin_ruta, threads_usuario, pinterest_usuario, telegram_usuario)
  ON public.profiles TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Comprobaciones: si algo de lo anterior no quedo como se espera, la
-- migracion entera se revierte.
-- ---------------------------------------------------------------------------

DO $verify$
DECLARE
  c_columnas CONSTANT TEXT[] := ARRAY[
    'facebook_ruta', 'facebook_messenger', 'tiktok_usuario', 'youtube_ruta', 'x_usuario',
    'linkedin_ruta', 'threads_usuario', 'pinterest_usuario', 'telegram_usuario'
  ];
  c_checks CONSTANT TEXT[] := ARRAY[
    'profiles_facebook_ruta_formato', 'profiles_facebook_messenger_con_usuario', 'profiles_tiktok_usuario_formato',
    'profiles_youtube_ruta_formato', 'profiles_x_usuario_formato', 'profiles_linkedin_ruta_formato',
    'profiles_threads_usuario_formato', 'profiles_pinterest_usuario_formato', 'profiles_telegram_usuario_formato'
  ];
  v_col TEXT;
  v_rol TEXT;
BEGIN
  FOREACH v_col IN ARRAY c_columnas LOOP
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF NOT has_column_privilege(v_rol, 'public.profiles', v_col, 'SELECT') THEN
        RAISE EXCEPTION 'VERIFY: % no puede leer profiles.%', v_rol, v_col;
      END IF;
      IF has_column_privilege(v_rol, 'public.profiles', v_col, 'INSERT')
         OR has_column_privilege(v_rol, 'public.profiles', v_col, 'UPDATE') THEN
        RAISE EXCEPTION 'VERIFY: % puede escribir profiles.% directo', v_rol, v_col;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_col IN ARRAY c_checks LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'public.profiles'::regclass AND conname = v_col AND contype = 'c') THEN
      RAISE EXCEPTION 'VERIFY: falta el CHECK %', v_col;
    END IF;
  END LOOP;

  IF has_function_privilege('anon', 'public.guardar_enlaces_negocio(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: anon ejecuta guardar_enlaces_negocio';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.guardar_enlaces_negocio(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: authenticated no ejecuta guardar_enlaces_negocio';
  END IF;
  IF NOT has_function_privilege('anon', 'public.registrar_clic_enlace_negocio(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: anon ya no registra clics';
  END IF;
  IF has_function_privilege('anon', 'public.clics_enlaces_negocio_por_canal(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: anon ejecuta clics_enlaces_negocio_por_canal';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.clics_enlaces_negocio_por_canal(integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY: authenticated no ejecuta clics_enlaces_negocio_por_canal';
  END IF;
  -- El RPC viejo sigue: el codigo de master lo llama hasta el merge.
  IF to_regprocedure('public.actualizar_enlaces_negocio(text,text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'VERIFY: desaparecio actualizar_enlaces_negocio';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE oid = 'public.guardar_enlaces_negocio(jsonb)'::regprocedure
                    AND prosecdef AND proconfig @> ARRAY['search_path=""']) THEN
    RAISE EXCEPTION 'VERIFY: guardar_enlaces_negocio no es SECURITY DEFINER con search_path vacio';
  END IF;

  -- Una sola funcion con cada nombre: nada de sobrecargas para PostgREST.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'registrar_clic_enlace_negocio') <> 1
     OR (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'guardar_enlaces_negocio') <> 1 THEN
    RAISE EXCEPTION 'VERIFY: hay sobrecargas de las funciones de enlaces';
  END IF;

  -- El CHECK viejo de canales ya no esta (si siguiera, los canales nuevos
  -- fallarian al insertar).
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.clics_enlaces_negocio'::regclass
                AND contype = 'c'
                AND conname <> 'clics_enlaces_negocio_canal_valido'
                AND pg_get_constraintdef(oid) LIKE '%canal%') THEN
    RAISE EXCEPTION 'VERIFY: queda un CHECK viejo de canales en clics_enlaces_negocio';
  END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';

-- VERIFY a mano tras aplicar (solo lectura):
--   SELECT count(*) FROM public.profiles
--    WHERE facebook_ruta IS NOT NULL OR facebook_messenger OR tiktok_usuario IS NOT NULL;
--   -- esperado: 0 (nadie las ha llenado)
--   SELECT conname FROM pg_constraint WHERE conrelid = 'public.clics_enlaces_negocio'::regclass AND contype = 'c';
--   -- esperado: clics_enlaces_negocio_canal_valido
--
--   Bajo rol real (BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid vendedor>","role":"authenticated"}';):
--     SELECT public.guardar_enlaces_negocio('{"tiktok_usuario":"mi.tienda","facebook_ruta":"mitienda"}');
--     -- esperado: jsonb con esos dos y el resto como estaba
--     SELECT public.guardar_enlaces_negocio('{"facebook_messenger":true}');
--     -- esperado: messenger true (hay usuario de Facebook)
--     SELECT public.guardar_enlaces_negocio('{"facebook_ruta":null}');
--     -- esperado: facebook null y messenger false (se apaga solo)
--     SELECT public.guardar_enlaces_negocio('{"snapchat":"x"}');   -- 22023
--   ROLLBACK;
--   La prueba completa contra el staging: node scripts/staging/probar-redes-negocio.mjs
