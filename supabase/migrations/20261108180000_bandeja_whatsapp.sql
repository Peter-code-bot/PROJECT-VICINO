-- Bandeja de WhatsApp (fase 2 de INT-CRM-20261104): los mensajes que un negocio
-- recibe en su numero de WhatsApp Business (Cloud API de Meta) llegan a VICINO y
-- el negocio los responde desde su panel.
--
-- Lo que esta migracion deja listo:
--
--   1. canales_whatsapp: que numero de WhatsApp (phone_number_id de Meta) es de
--      que negocio. En el piloto lo conecta un admin a mano; mas adelante lo
--      hara el propio negocio con el Embedded Signup de Meta.
--   2. conversaciones_whatsapp y mensajes_whatsapp: una conversacion por
--      (numero del negocio, numero del cliente); los mensajes entrantes los
--      escribe el webhook, los salientes el negocio desde la bandeja.
--   3. eventos_webhook_whatsapp: cada aviso de Meta ya verificado, para
--      idempotencia (Meta reintenta) y para depurar; el que no dejo nada en la
--      bandeja se guarda recortado (sin contenido). Se purga a los 7 dias.
--   4. RPC ingerir_webhook_whatsapp: el UNICO camino por el que entra un
--      mensaje. Lo llama la ruta /api/webhooks/whatsapp con la llave anon.
--
-- MODELO DE CONFIANZA (la decision importante de esta migracion):
--
--   La firma de Meta se verifica DENTRO de Postgres. Meta firma cada aviso con
--   HMAC-SHA256 del cuerpo usando el App Secret de la app (cabecera
--   X-Hub-Signature-256). El App Secret vive en el Vault de Supabase (nombre
--   'whatsapp_app_secret'), y el RPC recalcula la firma con pgcrypto y la
--   compara antes de tocar una sola fila. Asi:
--     - La llave anon puede llamar al RPC sin riesgo: sin el App Secret no se
--       puede fabricar un cuerpo que pase. Quien llame sin firma valida recibe
--       P0401 (codigo propio) y nada se escribe. La ruta de Next verifica la
--       misma firma ANTES con WHATSAPP_APP_SECRET, asi que a la base solo llega
--       lo que ya firmo bien; si la base dice que no, los dos secretos divergen.
--     - Vercel NO necesita la service_role key para esto, en linea con la regla
--       del repo (openspec/changes/2026-07-09-eradicate-vercel-service-role-key).
--     - El secreto no viaja por la app: la ruta solo reenvia el cuerpo crudo y
--       la cabecera. Opcionalmente puede hacer una comprobacion previa con
--       WHATSAPP_APP_SECRET en Vercel, pero la que manda es esta.
--
--   Los RPC del negocio (preparar_envio, cerrar_envio, marcar_leida) exigen
--   sesion y que la conversacion sea suya (negocio_id = auth.uid()). Los de
--   admin exigen el rol admin de user_roles, como el resto del panel.
--
-- PRIVACIDAD Y RETENCION:
--
--   - Se guarda el texto de los mensajes porque la bandeja ES el texto; sin el
--     no hay nada que responder. No se descargan adjuntos (imagenes, audios,
--     documentos): se registra el tipo y, si viene, su pie de foto.
--   - Lo ve exclusivamente el negocio dueno del numero (RLS por negocio_id).
--     Los admins ven que numero esta conectado a que negocio, NO los mensajes.
--   - eventos_webhook_whatsapp y estados_huerfanos_whatsapp se purgan a los 7
--     dias; mensajes_whatsapp a los 180 dias y conversaciones_whatsapp a los
--     180 dias sin actividad y ya sin mensajes (jobs de pg_cron al final). Las
--     ventanas se cambian en una migracion posterior sin tocar codigo.
--
-- REGLA DURA DE ESTE REPO: toda escritura pasa por RPC SECURITY DEFINER con
-- search_path vacio; las tablas solo dan SELECT al cliente, y por RLS.

-- ---------------------------------------------------------------------------
-- 0. pgcrypto (extensions.hmac). Supabase lo trae activado en `extensions`
--    (comprobado en produccion el 8-nov-2026); esto solo deja la migracion
--    autosuficiente en un entorno nuevo.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ---------------------------------------------------------------------------
-- 1. Tablas.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.canales_whatsapp (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id       UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Identificadores que da Meta en WhatsApp > API Setup. Solo digitos.
  phone_number_id  TEXT NOT NULL UNIQUE CHECK (phone_number_id ~ '^[0-9]{5,32}$'),
  waba_id          TEXT NOT NULL CHECK (waba_id ~ '^[0-9]{5,32}$'),
  -- Como lo muestra Meta ("+1 555 025 3483"); solo informativo para el admin.
  numero_mostrado  TEXT CHECK (numero_mostrado IS NULL OR numero_mostrado ~ '^\+?[0-9][0-9 ()-]{5,23}$'),
  -- 'pausado' = el negocio NO puede responder (y la bandeja lo avisa). Lo que
  -- le escriban se sigue guardando: una pausa no puede costar mensajes.
  estado           TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'pausado')),
  conectado_por    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Para que conversaciones y mensajes puedan atar (canal, negocio) con una
  -- FK compuesta: la columna negocio_id repetida en ellas (la que decide la
  -- RLS) no puede divergir del canal ni con un UPDATE a mano.
  UNIQUE (id, negocio_id)
);

COMMENT ON TABLE public.canales_whatsapp IS
  'Numero de WhatsApp Business (Cloud API) conectado a un negocio. Un numero por negocio en el piloto. Sin tokens: el token de acceso vive fuera de la base (entorno del servidor) hasta que haya Embedded Signup. Pausado = no responde; sigue recibiendo.';

CREATE TABLE IF NOT EXISTS public.conversaciones_whatsapp (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canal_id             UUID NOT NULL REFERENCES public.canales_whatsapp(id) ON DELETE CASCADE,
  -- Repetido a proposito: la RLS y el indice del panel no necesitan el join.
  negocio_id           UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- Numero del cliente como lo da Meta (wa_id): digitos con lada, sin "+".
  wa_id                TEXT NOT NULL CHECK (wa_id ~ '^[1-9][0-9]{6,15}$'),
  nombre_perfil        TEXT CHECK (nombre_perfil IS NULL OR char_length(nombre_perfil) <= 128),
  ultimo_mensaje_texto TEXT CHECK (ultimo_mensaje_texto IS NULL OR char_length(ultimo_mensaje_texto) <= 160),
  ultimo_mensaje_at    TIMESTAMPTZ,
  -- Abre la ventana de 24 horas de WhatsApp: solo se puede responder con texto
  -- libre dentro de las 24 h siguientes al ultimo mensaje del cliente.
  ultimo_entrante_at   TIMESTAMPTZ,
  no_leidos            INTEGER NOT NULL DEFAULT 0 CHECK (no_leidos >= 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (canal_id, wa_id),
  UNIQUE (id, negocio_id),
  -- El negocio de la conversacion es, por construccion, el del canal.
  FOREIGN KEY (canal_id, negocio_id) REFERENCES public.canales_whatsapp (id, negocio_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

COMMENT ON TABLE public.conversaciones_whatsapp IS
  'Una conversacion por (numero del negocio, numero del cliente). La escribe solo el RPC del webhook y los RPC de envio. Se purga a los 180 dias sin actividad y sin mensajes (job purgar-conversaciones-whatsapp).';

CREATE INDEX IF NOT EXISTS conversaciones_whatsapp_negocio_reciente_idx
  ON public.conversaciones_whatsapp (negocio_id, ultimo_mensaje_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.mensajes_whatsapp (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id UUID NOT NULL REFERENCES public.conversaciones_whatsapp(id) ON DELETE CASCADE,
  negocio_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  direccion       TEXT NOT NULL CHECK (direccion IN ('entrante', 'saliente')),
  -- Id del mensaje en WhatsApp. NULL solo mientras un envio esta 'pendiente'.
  wamid           TEXT UNIQUE CHECK (wamid IS NULL OR wamid ~ '^[A-Za-z0-9._+/=-]{10,200}$'),
  tipo            TEXT NOT NULL CHECK (tipo IN (
                    'text', 'image', 'audio', 'video', 'document', 'sticker', 'location',
                    'contacts', 'interactive', 'button', 'reaction', 'order', 'system',
                    'unsupported', 'unknown')),
  -- Texto del mensaje, o el pie/titulo cuando es un adjunto o un boton.
  texto           TEXT CHECK (texto IS NULL OR char_length(texto) <= 4096),
  estado          TEXT NOT NULL CHECK (estado IN ('recibido', 'pendiente', 'enviado', 'entregado', 'leido', 'fallido')),
  error_codigo    INTEGER,
  error_detalle   TEXT CHECK (error_detalle IS NULL OR char_length(error_detalle) <= 500),
  -- wamid del mensaje al que responde (context.id de Meta), si lo hay.
  contexto_wamid  TEXT CHECK (contexto_wamid IS NULL OR char_length(contexto_wamid) <= 200),
  -- Quien lo escribio desde la bandeja (solo salientes).
  enviado_por     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- Momento del mensaje segun WhatsApp (entrantes) o segun nosotros (salientes).
  marca_tiempo    TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (direccion = 'saliente' OR estado = 'recibido'),
  CHECK (direccion = 'entrante' OR estado <> 'recibido'),
  -- El negocio del mensaje es, por construccion, el de su conversacion.
  FOREIGN KEY (conversacion_id, negocio_id) REFERENCES public.conversaciones_whatsapp (id, negocio_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

COMMENT ON TABLE public.mensajes_whatsapp IS
  'Mensajes de WhatsApp de una conversacion. Entrantes: los escribe el webhook. Salientes: preparar_envio (pendiente) y cerrar_envio (enviado/fallido); los estados entregado/leido llegan por webhook. Sin adjuntos. Se purga a los 180 dias (job purgar-mensajes-whatsapp).';

CREATE INDEX IF NOT EXISTS mensajes_whatsapp_conversacion_tiempo_idx
  ON public.mensajes_whatsapp (conversacion_id, marca_tiempo DESC);

-- Para la purga por antiguedad.
CREATE INDEX IF NOT EXISTS mensajes_whatsapp_tiempo_idx
  ON public.mensajes_whatsapp (marca_tiempo);

-- Para el ritmo por negocio de preparar_envio y para el ON DELETE de profiles.
CREATE INDEX IF NOT EXISTS mensajes_whatsapp_negocio_creado_idx
  ON public.mensajes_whatsapp (negocio_id, created_at DESC);

CREATE INDEX IF NOT EXISTS mensajes_whatsapp_enviado_por_idx
  ON public.mensajes_whatsapp (enviado_por) WHERE enviado_por IS NOT NULL;

-- Un estado de Meta (sent/delivered/read/failed) que llega ANTES de que
-- cerrar_envio_whatsapp escriba el wamid del mensaje no tiene fila que
-- actualizar. Se guarda aqui (el de mayor rango) y cerrar_envio lo aplica al
-- cerrar. Sin esto, un 'delivered' que gana la carrera se perderia y la
-- palomita se quedaria en una. Se purga a los 7 dias.
CREATE TABLE IF NOT EXISTS public.estados_huerfanos_whatsapp (
  wamid         TEXT PRIMARY KEY CHECK (wamid ~ '^[A-Za-z0-9._+/=-]{10,200}$'),
  negocio_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  estado        TEXT NOT NULL CHECK (estado IN ('enviado', 'entregado', 'leido', 'fallido')),
  error_codigo  INTEGER,
  error_detalle TEXT CHECK (error_detalle IS NULL OR char_length(error_detalle) <= 500),
  recibido_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.estados_huerfanos_whatsapp IS
  'Estados de Meta recibidos antes de que el mensaje saliente tuviera wamid. Los consume cerrar_envio_whatsapp. Ningun rol de cliente lo lee. Se purga a los 7 dias (job purgar-estados-huerfanos-whatsapp).';

CREATE INDEX IF NOT EXISTS estados_huerfanos_whatsapp_recibido_idx
  ON public.estados_huerfanos_whatsapp (recibido_at);

CREATE TABLE IF NOT EXISTS public.eventos_webhook_whatsapp (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- sha256 del cuerpo crudo: Meta reenvia el mismo aviso si no ve un 200.
  huella      TEXT NOT NULL UNIQUE CHECK (huella ~ '^[0-9a-f]{64}$'),
  cuerpo      JSONB NOT NULL,
  resultado   JSONB,
  recibido_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.eventos_webhook_whatsapp IS
  'Cada aviso de Meta ya verificado, tal cual llego, con el resumen de lo que produjo. Solo para idempotencia y depuracion; ningun rol de cliente lo lee. Se purga a los 7 dias (job purgar-eventos-webhook-whatsapp).';

CREATE INDEX IF NOT EXISTS eventos_webhook_whatsapp_recibido_idx
  ON public.eventos_webhook_whatsapp (recibido_at);

-- ---------------------------------------------------------------------------
-- 2. Privilegios y RLS. Solo SELECT para el cliente, y solo lo propio.
-- ---------------------------------------------------------------------------

ALTER TABLE public.canales_whatsapp          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversaciones_whatsapp   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mensajes_whatsapp         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eventos_webhook_whatsapp  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_huerfanos_whatsapp ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.canales_whatsapp          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.conversaciones_whatsapp   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.mensajes_whatsapp         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.eventos_webhook_whatsapp  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.estados_huerfanos_whatsapp FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.canales_whatsapp        TO authenticated;
GRANT SELECT ON TABLE public.conversaciones_whatsapp TO authenticated;
GRANT SELECT ON TABLE public.mensajes_whatsapp       TO authenticated;

-- El dueno ve su canal; el admin ve todos (para conectar y pausar). Nadie mas.
DROP POLICY IF EXISTS canales_whatsapp_dueno_o_admin_lee ON public.canales_whatsapp;
CREATE POLICY canales_whatsapp_dueno_o_admin_lee
  ON public.canales_whatsapp
  FOR SELECT
  TO authenticated
  USING (
    negocio_id = (SELECT auth.uid())
    OR public.has_role((SELECT auth.uid()), 'admin'::public.app_role)
  );

-- Conversaciones y mensajes: SOLO el negocio dueno. Ni siquiera el admin.
DROP POLICY IF EXISTS conversaciones_whatsapp_dueno_lee ON public.conversaciones_whatsapp;
CREATE POLICY conversaciones_whatsapp_dueno_lee
  ON public.conversaciones_whatsapp
  FOR SELECT
  TO authenticated
  USING (negocio_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS mensajes_whatsapp_dueno_lee ON public.mensajes_whatsapp;
CREATE POLICY mensajes_whatsapp_dueno_lee
  ON public.mensajes_whatsapp
  FOR SELECT
  TO authenticated
  USING (negocio_id = (SELECT auth.uid()));

-- eventos_webhook_whatsapp y estados_huerfanos_whatsapp: RLS encendida y sin
-- policies = nadie desde el cliente. Los lee solo quien administra la base.

-- Realtime: la bandeja se refresca al vuelo. La RLS de arriba es la que decide
-- que cambios ve cada suscriptor. Idempotente: no falla si ya estan.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversaciones_whatsapp'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversaciones_whatsapp;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'mensajes_whatsapp'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.mensajes_whatsapp;
    END IF;
  END IF;
END $do$;

-- ---------------------------------------------------------------------------
-- 3. Ayudantes puros.
-- ---------------------------------------------------------------------------

-- El texto que se muestra de un mensaje de Meta, segun su tipo. NULL cuando
-- el tipo no trae texto (un audio, un sticker): la bandeja pinta el tipo.
CREATE OR REPLACE FUNCTION public.whatsapp_texto_de_mensaje(p_msg JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT left(
    CASE p_msg->>'type'
      WHEN 'text'        THEN p_msg->'text'->>'body'
      WHEN 'button'      THEN p_msg->'button'->>'text'
      WHEN 'interactive' THEN coalesce(p_msg->'interactive'->'button_reply'->>'title',
                                       p_msg->'interactive'->'list_reply'->>'title')
      WHEN 'reaction'    THEN p_msg->'reaction'->>'emoji'
      WHEN 'image'       THEN p_msg->'image'->>'caption'
      WHEN 'video'       THEN p_msg->'video'->>'caption'
      WHEN 'document'    THEN coalesce(p_msg->'document'->>'caption', p_msg->'document'->>'filename')
      WHEN 'location'    THEN coalesce(p_msg->'location'->>'name', p_msg->'location'->>'address')
      ELSE NULL
    END,
    4096
  );
$$;

REVOKE ALL ON FUNCTION public.whatsapp_texto_de_mensaje(JSONB) FROM PUBLIC, anon, authenticated;

-- Orden de los estados de un envio: un aviso de Meta solo avanza, nunca
-- retrocede (si llega 'entregado' despues de 'leido', se ignora).
CREATE OR REPLACE FUNCTION public.whatsapp_rango_estado(p_estado TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE p_estado
    WHEN 'pendiente' THEN 0
    WHEN 'enviado'   THEN 1
    WHEN 'entregado' THEN 2
    WHEN 'leido'     THEN 3
    WHEN 'fallido'   THEN 9
    ELSE -1
  END;
$$;

REVOKE ALL ON FUNCTION public.whatsapp_rango_estado(TEXT) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. El webhook: verificar la firma de Meta y guardar lo que trae.
--
-- p_firma  : la cabecera X-Hub-Signature-256 tal cual ("sha256=<hex>").
-- p_cuerpo : el cuerpo CRUDO de la peticion, sin reserializar. La firma es de
--            esos bytes exactos (Meta escapa los caracteres no ASCII como
--            \uXXXX y la firma se calcula sobre ese texto).
--
-- Devuelve un resumen: {duplicado, nuevos, estados, estados_sin_mensaje, sin_canal, ignorados}.
-- Errores:
--   P0401  firma ausente, mal formada o que no coincide  -> la ruta responde 401
--   55000  no hay secreto 'whatsapp_app_secret' en Vault -> 503 (y a Sentry)
--   22023  cuerpo que no es JSON o demasiado grande     -> 400 (y a Sentry)
--   42501  privilegios: perdio el acceso al Vault/pgcrypto -> 500 (y a Sentry)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingerir_webhook_whatsapp(
  p_firma  TEXT,
  p_cuerpo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET statement_timeout = '8s'
AS $$
DECLARE
  v_secreto      TEXT;
  v_firma        TEXT;
  v_esperada     TEXT;
  v_huella       TEXT;
  v_cuerpo       JSONB;
  v_evento_id    UUID;
  v_entry        JSONB;
  v_change       JSONB;
  v_value        JSONB;
  v_msg          JSONB;
  v_st           JSONB;
  v_canal        RECORD;
  v_conv_id      UUID;
  v_phone        TEXT;
  v_phones       TEXT[] := '{}';
  v_wamid        TEXT;
  v_de           TEXT;
  v_tipo         TEXT;
  v_texto        TEXT;
  v_nombre       TEXT;
  v_momento      TIMESTAMPTZ;
  v_estado       TEXT;
  v_codigo_txt   TEXT;
  v_codigo       INTEGER;
  v_detalle      TEXT;
  v_nuevos       INTEGER := 0;
  v_estados      INTEGER := 0;
  v_huerfanos    INTEGER := 0;
  v_sin_canal    INTEGER := 0;
  v_ignorados    INTEGER := 0;
  v_resultado    JSONB;
BEGIN
  -- 4.1 Firma. Un fallo de firma es P0401 (codigo propio de este repo): la
  -- ruta lo traduce a 401. El 42501 queda reservado para un fallo de
  -- privilegios de verdad (perder el acceso al Vault o a pgcrypto), que la
  -- ruta reporta a Sentry como 500 para que Meta reintente y alguien lo vea.
  IF p_firma IS NULL OR p_cuerpo IS NULL THEN
    RAISE EXCEPTION 'Falta la firma o el cuerpo.' USING ERRCODE = 'P0401';
  END IF;

  v_firma := lower(btrim(p_firma));
  IF v_firma LIKE 'sha256=%' THEN
    v_firma := substr(v_firma, 8);
  END IF;
  IF v_firma !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Firma mal formada.' USING ERRCODE = 'P0401';
  END IF;

  -- Meta documenta 3 MB como tamano maximo de un aviso (puede traer hasta
  -- 1000 cambios agrupados). La ruta aplica el mismo tope antes de llamar.
  IF octet_length(p_cuerpo) > 3145728 THEN
    RAISE EXCEPTION 'Cuerpo demasiado grande.' USING ERRCODE = '22023';
  END IF;

  SELECT decrypted_secret
    INTO v_secreto
    FROM vault.decrypted_secrets
   WHERE name = 'whatsapp_app_secret'
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_secreto IS NULL OR v_secreto = '' THEN
    RAISE EXCEPTION 'Falta el secreto whatsapp_app_secret en el Vault.' USING ERRCODE = '55000';
  END IF;

  v_esperada := encode(
    extensions.hmac(convert_to(p_cuerpo, 'UTF8'), convert_to(v_secreto, 'UTF8'), 'sha256'),
    'hex'
  );

  -- Se comparan los resumenes de las dos firmas, no las firmas: asi el tiempo
  -- de la comparacion no depende de cuantos caracteres acerto quien la mando.
  IF sha256(convert_to(v_esperada, 'UTF8')) <> sha256(convert_to(v_firma, 'UTF8')) THEN
    RAISE EXCEPTION 'La firma no coincide.' USING ERRCODE = 'P0401';
  END IF;

  -- 4.2 Cuerpo. jsonb no admite U+0000: si el cast falla, se quita el escape
  -- \u0000 (solo cuando no va precedido de otra barra, que seria una barra
  -- escapada) y se reintenta. La firma y la huella ya se calcularon sobre el
  -- cuerpo crudo, asi que esto no cambia la verificacion.
  BEGIN
    v_cuerpo := p_cuerpo::jsonb;
  EXCEPTION WHEN OTHERS THEN
    BEGIN
      v_cuerpo := regexp_replace(p_cuerpo, '([^\\])\\u0000', '\1', 'g')::jsonb;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'El cuerpo no es JSON valido.' USING ERRCODE = '22023';
    END;
  END;

  IF jsonb_typeof(v_cuerpo) <> 'object'
     OR v_cuerpo->>'object' IS DISTINCT FROM 'whatsapp_business_account' THEN
    RETURN jsonb_build_object('duplicado', false, 'nuevos', 0, 'estados', 0,
                              'estados_sin_mensaje', 0, 'sin_canal', 0, 'ignorados', 1);
  END IF;

  -- 4.3 Idempotencia: el mismo cuerpo, una sola vez.
  v_huella := encode(sha256(convert_to(p_cuerpo, 'UTF8')), 'hex');

  INSERT INTO public.eventos_webhook_whatsapp (huella, cuerpo)
  VALUES (v_huella, v_cuerpo)
  ON CONFLICT (huella) DO NOTHING
  RETURNING id INTO v_evento_id;

  IF v_evento_id IS NULL THEN
    RETURN jsonb_build_object('duplicado', true, 'nuevos', 0, 'estados', 0,
                              'estados_sin_mensaje', 0, 'sin_canal', 0, 'ignorados', 0);
  END IF;

  -- Un solo cerrojo para todos los avisos. Uno por numero permitiria que dos
  -- avisos con varios numeros en distinto orden se bloquearan entre si
  -- (40P01); con el volumen de un webhook (segundos entre avisos) este
  -- cerrojo unico no cuesta nada y no puede abrazarse.
  PERFORM pg_advisory_xact_lock(hashtext('whatsapp:webhook'));

  -- 4.4 Recorrer entry[].changes[].value.
  IF jsonb_typeof(v_cuerpo->'entry') <> 'array' THEN
    v_ignorados := v_ignorados + 1;
  ELSE
  FOR v_entry IN SELECT e FROM jsonb_array_elements(v_cuerpo->'entry') AS t(e) LOOP
    IF jsonb_typeof(v_entry->'changes') <> 'array' THEN
      v_ignorados := v_ignorados + 1;
      CONTINUE;
    END IF;

    FOR v_change IN SELECT c FROM jsonb_array_elements(v_entry->'changes') AS t(c) LOOP
      IF v_change->>'field' IS DISTINCT FROM 'messages' OR jsonb_typeof(v_change->'value') <> 'object' THEN
        v_ignorados := v_ignorados + 1;
        CONTINUE;
      END IF;

      v_value := v_change->'value';
      v_phone := v_value->'metadata'->>'phone_number_id';

      IF v_phone IS NULL OR v_phone !~ '^[0-9]{5,32}$' THEN
        v_ignorados := v_ignorados + 1;
        CONTINUE;
      END IF;

      IF NOT (v_phone = ANY (v_phones)) THEN
        v_phones := array_append(v_phones, v_phone);
      END IF;

      -- Sin filtro por estado: un numero pausado sigue recibiendo. La pausa
      -- solo impide responder (preparar_envio_whatsapp). Lo que llegue a un
      -- numero pausado no puede perderse: Meta no lo volveria a mandar.
      SELECT id, negocio_id
        INTO v_canal
        FROM public.canales_whatsapp
       WHERE phone_number_id = v_phone;

      IF NOT FOUND THEN
        -- Un numero que nadie conecto todavia: no se guarda nada suyo (abajo
        -- se recorta el evento crudo si no produjo nada).
        v_sin_canal := v_sin_canal + 1;
        CONTINUE;
      END IF;

      -- Mensajes entrantes.
      IF jsonb_typeof(v_value->'messages') = 'array' THEN
        FOR v_msg IN SELECT m FROM jsonb_array_elements(v_value->'messages') AS t(m) LOOP
          v_wamid := v_msg->>'id';
          v_de    := v_msg->>'from';

          -- Sin numero no hay conversacion: Meta puede omitir `from` cuando el
          -- usuario se identifica solo por nombre de usuario (identificador
          -- BSUID). El piloto no atiende ese caso; se cuenta como ignorado.
          IF v_wamid IS NULL OR v_wamid !~ '^[A-Za-z0-9._+/=-]{10,200}$'
             OR v_de IS NULL OR v_de !~ '^[1-9][0-9]{6,15}$' THEN
            v_ignorados := v_ignorados + 1;
            CONTINUE;
          END IF;

          v_tipo := coalesce(v_msg->>'type', 'unknown');

          -- Una edicion o un borrado de un mensaje anterior no es un mensaje
          -- nuevo: en el piloto se ignoran (el texto original se queda).
          IF v_tipo IN ('edit', 'revoke') THEN
            v_ignorados := v_ignorados + 1;
            CONTINUE;
          END IF;

          IF v_tipo NOT IN ('text', 'image', 'audio', 'video', 'document', 'sticker', 'location',
                            'contacts', 'interactive', 'button', 'reaction', 'order', 'system',
                            'unsupported') THEN
            v_tipo := 'unknown';
          END IF;

          -- Meta manda el timestamp en segundos Unix, como texto. Nunca se
          -- acepta uno del futuro (dejaria la ventana de 24 h abierta sin fin).
          IF (v_msg->>'timestamp') ~ '^[0-9]{1,12}$' THEN
            v_momento := LEAST(to_timestamp((v_msg->>'timestamp')::bigint), now() + interval '5 minutes');
          ELSE
            v_momento := now();
          END IF;

          v_texto := public.whatsapp_texto_de_mensaje(v_msg);

          v_nombre := NULL;
          IF jsonb_typeof(v_value->'contacts') = 'array' THEN
            SELECT left(c->'profile'->>'name', 128)
              INTO v_nombre
              FROM jsonb_array_elements(v_value->'contacts') AS t(c)
             WHERE c->>'wa_id' = v_de
             LIMIT 1;
          END IF;

          -- El nombre de perfil es el que el cliente tiene puesto en WhatsApp:
          -- se toma el mas reciente que llegue (puede cambiarlo), y si un aviso
          -- no lo trae se conserva el anterior.
          INSERT INTO public.conversaciones_whatsapp (canal_id, negocio_id, wa_id, nombre_perfil)
          VALUES (v_canal.id, v_canal.negocio_id, v_de, NULLIF(btrim(v_nombre), ''))
          ON CONFLICT (canal_id, wa_id) DO UPDATE
             SET nombre_perfil = coalesce(EXCLUDED.nombre_perfil, public.conversaciones_whatsapp.nombre_perfil),
                 updated_at    = now()
          RETURNING id INTO v_conv_id;

          INSERT INTO public.mensajes_whatsapp
            (conversacion_id, negocio_id, direccion, wamid, tipo, texto, estado, contexto_wamid, marca_tiempo)
          VALUES
            (v_conv_id, v_canal.negocio_id, 'entrante', v_wamid, v_tipo, v_texto, 'recibido',
             left(v_msg->'context'->>'id', 200), v_momento)
          ON CONFLICT (wamid) DO NOTHING;

          IF FOUND THEN
            v_nuevos := v_nuevos + 1;
            -- Un aviso puede llegar fuera de orden (Meta reintenta hasta 7
            -- dias): el texto del ultimo mensaje solo cambia si este es, de
            -- verdad, el mas reciente.
            UPDATE public.conversaciones_whatsapp
               SET ultimo_mensaje_texto = CASE WHEN ultimo_mensaje_at IS NULL OR v_momento >= ultimo_mensaje_at
                                               THEN left(coalesce(v_texto, '[' || v_tipo || ']'), 160)
                                               ELSE ultimo_mensaje_texto END,
                   ultimo_mensaje_at    = GREATEST(ultimo_mensaje_at, v_momento),
                   ultimo_entrante_at   = GREATEST(ultimo_entrante_at, v_momento),
                   no_leidos            = no_leidos + 1,
                   updated_at           = now()
             WHERE id = v_conv_id;
          END IF;
        END LOOP;
      END IF;

      -- Estados de mensajes que enviamos nosotros (sent/delivered/read/failed).
      IF jsonb_typeof(v_value->'statuses') = 'array' THEN
        FOR v_st IN SELECT s FROM jsonb_array_elements(v_value->'statuses') AS t(s) LOOP
          v_estado := CASE v_st->>'status'
                        WHEN 'sent'      THEN 'enviado'
                        WHEN 'delivered' THEN 'entregado'
                        WHEN 'read'      THEN 'leido'
                        WHEN 'failed'    THEN 'fallido'
                        ELSE NULL
                      END;
          v_wamid := v_st->>'id';

          IF v_estado IS NULL OR v_wamid IS NULL OR v_wamid !~ '^[A-Za-z0-9._+/=-]{10,200}$' THEN
            v_ignorados := v_ignorados + 1;
            CONTINUE;
          END IF;

          v_codigo_txt := v_st->'errors'->0->>'code';
          v_codigo := CASE WHEN v_estado = 'fallido' AND v_codigo_txt ~ '^[0-9]{1,9}$'
                           THEN v_codigo_txt::integer ELSE NULL END;
          v_detalle := CASE WHEN v_estado = 'fallido'
                            THEN left(btrim(coalesce(v_st->'errors'->0->>'title', '') || ' ' ||
                                            coalesce(v_st->'errors'->0->'error_data'->>'details', '')), 500)
                            ELSE NULL END;

          UPDATE public.mensajes_whatsapp m
             SET estado        = v_estado,
                 error_codigo  = CASE WHEN v_estado = 'fallido' THEN v_codigo ELSE m.error_codigo END,
                 error_detalle = CASE WHEN v_estado = 'fallido' THEN v_detalle ELSE m.error_detalle END
           WHERE m.wamid = v_wamid
             AND m.direccion = 'saliente'
             AND m.negocio_id = v_canal.negocio_id
             AND public.whatsapp_rango_estado(v_estado) > public.whatsapp_rango_estado(m.estado);

          IF FOUND THEN
            v_estados := v_estados + 1;
          ELSIF NOT EXISTS (SELECT 1 FROM public.mensajes_whatsapp WHERE wamid = v_wamid) THEN
            -- Todavia no hay fila con ese wamid: casi siempre es que el estado
            -- gano la carrera a cerrar_envio_whatsapp. Se guarda el de mayor
            -- rango para que cerrar_envio lo aplique.
            INSERT INTO public.estados_huerfanos_whatsapp (wamid, negocio_id, estado, error_codigo, error_detalle)
            VALUES (v_wamid, v_canal.negocio_id, v_estado, v_codigo, v_detalle)
            ON CONFLICT (wamid) DO UPDATE
               SET estado        = EXCLUDED.estado,
                   error_codigo  = EXCLUDED.error_codigo,
                   error_detalle = EXCLUDED.error_detalle,
                   recibido_at   = now()
             WHERE public.whatsapp_rango_estado(EXCLUDED.estado) > public.whatsapp_rango_estado(public.estados_huerfanos_whatsapp.estado);
            v_huerfanos := v_huerfanos + 1;
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
  END IF;

  v_resultado := jsonb_build_object(
    'duplicado',           false,
    'nuevos',              v_nuevos,
    'estados',             v_estados,
    'estados_sin_mensaje', v_huerfanos,
    'sin_canal',           v_sin_canal,
    'ignorados',           v_ignorados
  );

  -- Minimizacion: un aviso que no dejo nada en la bandeja (numero sin
  -- conectar, solo ruido) no conserva su contenido ni 7 dias; quedan la
  -- huella (idempotencia), el resumen y los numeros que traia, que es lo que
  -- hace falta para depurar "no me llegan mensajes".
  IF v_nuevos = 0 AND v_estados = 0 AND v_huerfanos = 0 THEN
    UPDATE public.eventos_webhook_whatsapp
       SET cuerpo    = jsonb_build_object('object', v_cuerpo->>'object', 'redactado', true,
                                          'phone_number_ids', to_jsonb(v_phones)),
           resultado = v_resultado
     WHERE id = v_evento_id;
  ELSE
    UPDATE public.eventos_webhook_whatsapp SET resultado = v_resultado WHERE id = v_evento_id;
  END IF;

  RETURN v_resultado;
END;
$$;

REVOKE ALL ON FUNCTION public.ingerir_webhook_whatsapp(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ingerir_webhook_whatsapp(TEXT, TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. El negocio responde. Dos pasos, porque el envio real lo hace el servidor
--    de Next contra la API de Meta entre uno y otro:
--
--    preparar_envio_whatsapp  valida (sesion, dueno, canal activo, ventana de
--                             24 h, largo, ritmo) y deja el mensaje 'pendiente'.
--    cerrar_envio_whatsapp    lo marca 'enviado' con su wamid, o 'fallido'
--                             con el error que devolvio Meta.
--
--    Si el servidor muere entre los dos, queda un 'pendiente' que la bandeja
--    muestra como "sin confirmar"; no se reintenta solo (un reintento ciego
--    podria duplicar un mensaje al cliente).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.preparar_envio_whatsapp(
  p_conversacion_id UUID,
  p_texto           TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid    UUID := auth.uid();
  v_texto  TEXT := btrim(p_texto);
  v_conv   RECORD;
  v_ritmo  INTEGER;
  v_msg_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION E'Necesitas iniciar sesi\u00f3n.' USING ERRCODE = '42501';
  END IF;

  IF p_conversacion_id IS NULL THEN
    RAISE EXCEPTION E'Falta la conversaci\u00f3n.' USING ERRCODE = '22023';
  END IF;

  IF v_texto IS NULL OR char_length(v_texto) < 1 OR char_length(v_texto) > 4096 THEN
    RAISE EXCEPTION 'El mensaje debe tener entre 1 y 4096 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT c.id, c.wa_id, c.ultimo_entrante_at, k.phone_number_id, k.estado AS canal_estado
    INTO v_conv
    FROM public.conversaciones_whatsapp c
    JOIN public.canales_whatsapp k ON k.id = c.canal_id
   WHERE c.id = p_conversacion_id
     AND c.negocio_id = v_uid
   FOR UPDATE OF c;

  IF NOT FOUND THEN
    RAISE EXCEPTION E'No se encontr\u00f3 la conversaci\u00f3n.' USING ERRCODE = 'P0002';
  END IF;

  IF v_conv.canal_estado <> 'activo' THEN
    RAISE EXCEPTION E'Tu n\u00famero de WhatsApp est\u00e1 pausado. Pide al equipo de VICINO que lo reactive.'
      USING ERRCODE = '55000';
  END IF;

  -- Regla de WhatsApp, no nuestra: fuera de las 24 h desde el ultimo mensaje
  -- del cliente solo se pueden mandar plantillas aprobadas, y en el piloto
  -- no hay plantillas.
  IF v_conv.ultimo_entrante_at IS NULL OR v_conv.ultimo_entrante_at < now() - interval '24 hours' THEN
    RAISE EXCEPTION E'La ventana de 24 horas cerr\u00f3: WhatsApp solo permite responder dentro de las 24 horas siguientes al \u00faltimo mensaje del cliente. Espera a que te vuelva a escribir.'
      USING ERRCODE = '55000';
  END IF;

  -- Ritmo por negocio, ademas del freno por usuario de la Server Action: la
  -- llave anon es publica y el RPC se puede llamar sin pasar por la app.
  SELECT count(*)
    INTO v_ritmo
    FROM public.mensajes_whatsapp
   WHERE negocio_id = v_uid
     AND direccion = 'saliente'
     AND created_at > now() - interval '1 minute';

  IF v_ritmo >= 30 THEN
    RAISE EXCEPTION E'Est\u00e1s enviando demasiados mensajes seguidos. Espera un momento.'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.mensajes_whatsapp
    (conversacion_id, negocio_id, direccion, tipo, texto, estado, enviado_por, marca_tiempo)
  VALUES
    (v_conv.id, v_uid, 'saliente', 'text', v_texto, 'pendiente', v_uid, now())
  RETURNING id INTO v_msg_id;

  RETURN jsonb_build_object(
    'mensaje_id',      v_msg_id,
    'phone_number_id', v_conv.phone_number_id,
    'wa_id',           v_conv.wa_id,
    'texto',           v_texto
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preparar_envio_whatsapp(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preparar_envio_whatsapp(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cerrar_envio_whatsapp(
  p_mensaje_id    UUID,
  p_wamid         TEXT DEFAULT NULL,
  p_error_codigo  INTEGER DEFAULT NULL,
  p_error_detalle TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_wamid    TEXT := NULLIF(btrim(p_wamid), '');
  v_msg      RECORD;
  v_huerfano RECORD;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION E'Necesitas iniciar sesi\u00f3n.' USING ERRCODE = '42501';
  END IF;

  IF v_wamid IS NOT NULL AND v_wamid !~ '^[A-Za-z0-9._+/=-]{10,200}$' THEN
    RAISE EXCEPTION E'Identificador de mensaje inv\u00e1lido.' USING ERRCODE = '22023';
  END IF;

  SELECT id, conversacion_id, texto
    INTO v_msg
    FROM public.mensajes_whatsapp
   WHERE id = p_mensaje_id
     AND negocio_id = v_uid
     AND direccion = 'saliente'
     AND estado = 'pendiente'
   FOR UPDATE;

  IF NOT FOUND THEN
    -- Ya cerrado (o no es suyo): no hay nada que hacer y no se dice cual.
    RETURN FALSE;
  END IF;

  IF v_wamid IS NOT NULL THEN
    UPDATE public.mensajes_whatsapp
       SET estado = 'enviado', wamid = v_wamid, error_codigo = NULL, error_detalle = NULL
     WHERE id = v_msg.id;

    -- Si un estado de Meta llego antes que este cierre (carrera habitual con
    -- 'sent' y 'delivered'), se aplica ahora y se consume.
    SELECT estado, error_codigo, error_detalle
      INTO v_huerfano
      FROM public.estados_huerfanos_whatsapp
     WHERE wamid = v_wamid
       AND negocio_id = v_uid;

    IF FOUND THEN
      IF public.whatsapp_rango_estado(v_huerfano.estado) > public.whatsapp_rango_estado('enviado') THEN
        UPDATE public.mensajes_whatsapp
           SET estado        = v_huerfano.estado,
               error_codigo  = v_huerfano.error_codigo,
               error_detalle = v_huerfano.error_detalle
         WHERE id = v_msg.id;
      END IF;
      DELETE FROM public.estados_huerfanos_whatsapp WHERE wamid = v_wamid;
    END IF;

    UPDATE public.conversaciones_whatsapp
       SET ultimo_mensaje_texto = CASE WHEN ultimo_mensaje_at IS NULL OR now() >= ultimo_mensaje_at
                                       THEN left(v_msg.texto, 160) ELSE ultimo_mensaje_texto END,
           ultimo_mensaje_at    = GREATEST(ultimo_mensaje_at, now()),
           updated_at           = now()
     WHERE id = v_msg.conversacion_id;
  ELSE
    UPDATE public.mensajes_whatsapp
       SET estado        = 'fallido',
           error_codigo  = p_error_codigo,
           error_detalle = left(NULLIF(btrim(p_error_detalle), ''), 500)
     WHERE id = v_msg.id;
  END IF;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.cerrar_envio_whatsapp(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_envio_whatsapp(UUID, TEXT, INTEGER, TEXT) TO authenticated;

-- Pone a cero los no leidos y devuelve el wamid del ultimo mensaje del cliente,
-- para que el servidor mande a Meta la confirmacion de lectura (palomitas
-- azules) si quiere. NULL si no hay entrantes.
CREATE OR REPLACE FUNCTION public.marcar_leida_conversacion_whatsapp(p_conversacion_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_wamid TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION E'Necesitas iniciar sesi\u00f3n.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.conversaciones_whatsapp
     SET no_leidos = 0, updated_at = now()
   WHERE id = p_conversacion_id
     AND negocio_id = v_uid
     AND no_leidos > 0;

  SELECT wamid
    INTO v_wamid
    FROM public.mensajes_whatsapp
   WHERE conversacion_id = p_conversacion_id
     AND negocio_id = v_uid
     AND direccion = 'entrante'
   ORDER BY marca_tiempo DESC
   LIMIT 1;

  RETURN v_wamid;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_leida_conversacion_whatsapp(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_leida_conversacion_whatsapp(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Admin: conectar un numero a un negocio y pausarlo/reactivarlo.
--
-- En el piloto el numero es el de prueba que da Meta y lo conecta el equipo.
-- Reasignar un numero a OTRO negocio no se permite aqui: las conversaciones
-- cuelgan del canal y cambiarian de dueno en silencio. Si hace falta, el admin
-- lo desconecta con eliminar_canal_whatsapp (borra sus conversaciones) y lo
-- vuelve a conectar al negocio correcto.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.conectar_canal_whatsapp(
  p_negocio_id      UUID,
  p_phone_number_id TEXT,
  p_waba_id         TEXT,
  p_numero_mostrado TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_phone   TEXT := NULLIF(regexp_replace(coalesce(p_phone_number_id, ''), '[^0-9]', '', 'g'), '');
  v_waba    TEXT := NULLIF(regexp_replace(coalesce(p_waba_id, ''), '[^0-9]', '', 'g'), '');
  v_numero  TEXT := NULLIF(btrim(p_numero_mostrado), '');
  v_dueno   UUID;
  v_canal   UUID;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION E'Solo un administrador puede conectar n\u00fameros.' USING ERRCODE = '42501';
  END IF;

  IF p_negocio_id IS NULL THEN
    RAISE EXCEPTION 'Falta el negocio.' USING ERRCODE = '22023';
  END IF;

  IF v_phone IS NULL OR v_phone !~ '^[0-9]{5,32}$' THEN
    RAISE EXCEPTION E'El Phone number ID debe ser el n\u00famero que muestra Meta en API Setup (solo d\u00edgitos).'
      USING ERRCODE = '22023';
  END IF;

  IF v_waba IS NULL OR v_waba !~ '^[0-9]{5,32}$' THEN
    RAISE EXCEPTION E'El WhatsApp Business Account ID debe ser el n\u00famero que muestra Meta (solo d\u00edgitos).'
      USING ERRCODE = '22023';
  END IF;

  IF v_numero IS NOT NULL AND v_numero !~ '^\+?[0-9][0-9 ()-]{5,23}$' THEN
    RAISE EXCEPTION E'El n\u00famero mostrado solo admite d\u00edgitos, espacios, par\u00e9ntesis, guiones y un + inicial.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_negocio_id AND es_vendedor IS TRUE) THEN
    RAISE EXCEPTION 'Ese perfil no existe o no tiene el modo vendedor activo.' USING ERRCODE = '22023';
  END IF;

  SELECT negocio_id INTO v_dueno FROM public.canales_whatsapp WHERE phone_number_id = v_phone;
  IF FOUND AND v_dueno <> p_negocio_id THEN
    RAISE EXCEPTION E'Ese n\u00famero ya est\u00e1 conectado a otro negocio.' USING ERRCODE = '23505';
  END IF;

  IF EXISTS (SELECT 1 FROM public.canales_whatsapp WHERE negocio_id = p_negocio_id AND phone_number_id <> v_phone) THEN
    RAISE EXCEPTION E'Ese negocio ya tiene otro n\u00famero conectado.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.canales_whatsapp (negocio_id, phone_number_id, waba_id, numero_mostrado, estado, conectado_por)
  VALUES (p_negocio_id, v_phone, v_waba, v_numero, 'activo', v_uid)
  ON CONFLICT (phone_number_id) DO UPDATE
     SET waba_id         = EXCLUDED.waba_id,
         numero_mostrado = EXCLUDED.numero_mostrado,
         conectado_por   = EXCLUDED.conectado_por,
         updated_at      = now()
  RETURNING id INTO v_canal;

  RETURN v_canal;
END;
$$;

REVOKE ALL ON FUNCTION public.conectar_canal_whatsapp(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conectar_canal_whatsapp(UUID, TEXT, TEXT, TEXT) TO authenticated;

-- Pausar: el negocio deja de poder responder (preparar_envio lo rechaza con
-- 55000) y la bandeja lo avisa; lo que le escriban se sigue guardando. SOLO
-- el equipo (rol admin) pausa y reactiva: es la herramienta para frenar un
-- numero con problemas, y si el propio negocio pudiera deshacerla no seria
-- un control. Darle al negocio su propio boton de pausa es una decision
-- pendiente (T-53) que, si se toma, necesita distinguir quien pauso.
CREATE OR REPLACE FUNCTION public.cambiar_estado_canal_whatsapp(
  p_canal_id UUID,
  p_activo   BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION E'Solo un administrador puede pausar o reactivar n\u00fameros.' USING ERRCODE = '42501';
  END IF;

  IF p_canal_id IS NULL OR p_activo IS NULL THEN
    RAISE EXCEPTION 'Faltan datos.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.canales_whatsapp
     SET estado = CASE WHEN p_activo THEN 'activo' ELSE 'pausado' END,
         updated_at = now()
   WHERE id = p_canal_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.cambiar_estado_canal_whatsapp(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cambiar_estado_canal_whatsapp(UUID, BOOLEAN) TO authenticated;

-- Desconectar del todo un numero (p. ej. uno conectado al negocio equivocado):
-- borra el canal y, en cascada, sus conversaciones y mensajes. Solo admin.
-- Es lo unico que permite volver a conectar ese numero a otro negocio.
CREATE OR REPLACE FUNCTION public.eliminar_canal_whatsapp(p_canal_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION E'Solo un administrador puede desconectar n\u00fameros.' USING ERRCODE = '42501';
  END IF;

  IF p_canal_id IS NULL THEN
    RAISE EXCEPTION 'Falta el canal.' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.canales_whatsapp WHERE id = p_canal_id;

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_canal_whatsapp(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.eliminar_canal_whatsapp(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7. Retencion con pg_cron, como 'purgar-clics-enlaces-negocio' (20261108120000).
--    Idempotente; si pg_cron no esta (entorno local), no falla.
--
--    - eventos crudos: 7 dias (y los que no dejaron nada ya van recortados)
--    - estados huerfanos: 7 dias
--    - mensajes: 180 dias
--    - conversaciones: 180 dias sin actividad y ya sin mensajes (asi el
--      numero, el nombre de perfil y el extracto del ultimo mensaje del
--      cliente no quedan para siempre)
-- ---------------------------------------------------------------------------

DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-eventos-webhook-whatsapp') THEN
      PERFORM cron.unschedule('purgar-eventos-webhook-whatsapp');
    END IF;
    PERFORM cron.schedule(
      'purgar-eventos-webhook-whatsapp',
      '41 4 * * *',
      $$DELETE FROM public.eventos_webhook_whatsapp WHERE recibido_at < now() - interval '7 days'$$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-estados-huerfanos-whatsapp') THEN
      PERFORM cron.unschedule('purgar-estados-huerfanos-whatsapp');
    END IF;
    PERFORM cron.schedule(
      'purgar-estados-huerfanos-whatsapp',
      '43 4 * * *',
      $$DELETE FROM public.estados_huerfanos_whatsapp WHERE recibido_at < now() - interval '7 days'$$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-mensajes-whatsapp') THEN
      PERFORM cron.unschedule('purgar-mensajes-whatsapp');
    END IF;
    PERFORM cron.schedule(
      'purgar-mensajes-whatsapp',
      '47 4 * * *',
      $$DELETE FROM public.mensajes_whatsapp WHERE marca_tiempo < now() - interval '180 days'$$
    );

    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purgar-conversaciones-whatsapp') THEN
      PERFORM cron.unschedule('purgar-conversaciones-whatsapp');
    END IF;
    PERFORM cron.schedule(
      'purgar-conversaciones-whatsapp',
      '53 4 * * *',
      $$DELETE FROM public.conversaciones_whatsapp c WHERE coalesce(c.ultimo_mensaje_at, c.created_at) < now() - interval '180 days' AND NOT EXISTS (SELECT 1 FROM public.mensajes_whatsapp m WHERE m.conversacion_id = c.id)$$
    );
  END IF;
END $do$;

-- VERIFY:
--   SELECT tablename, rowsecurity FROM pg_tables
--    WHERE tablename IN ('canales_whatsapp','conversaciones_whatsapp','mensajes_whatsapp',
--                        'eventos_webhook_whatsapp','estados_huerfanos_whatsapp');
--   -- esperado: 5 filas, rowsecurity = true
--
--   SELECT grantee, table_name, string_agg(privilege_type, ',' ORDER BY privilege_type)
--     FROM information_schema.table_privileges
--    WHERE table_name IN ('canales_whatsapp','conversaciones_whatsapp','mensajes_whatsapp',
--                         'eventos_webhook_whatsapp','estados_huerfanos_whatsapp')
--      AND grantee IN ('anon','authenticated')
--    GROUP BY 1, 2 ORDER BY 2, 1;
--   -- esperado: authenticated SELECT en canales, conversaciones y mensajes; NADA para anon;
--   -- NADA en eventos ni en estados huerfanos
--
--   SELECT has_function_privilege('anon', 'public.ingerir_webhook_whatsapp(text,text)', 'EXECUTE');            -- true
--   SELECT has_function_privilege('anon', 'public.preparar_envio_whatsapp(uuid,text)', 'EXECUTE');             -- false
--   SELECT has_function_privilege('anon', 'public.conectar_canal_whatsapp(uuid,text,text,text)', 'EXECUTE');   -- false
--   SELECT has_function_privilege('anon', 'public.cambiar_estado_canal_whatsapp(uuid,boolean)', 'EXECUTE');    -- false
--   SELECT has_function_privilege('anon', 'public.eliminar_canal_whatsapp(uuid)', 'EXECUTE');                  -- false
--
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
--      AND tablename IN ('conversaciones_whatsapp','mensajes_whatsapp');
--   -- esperado: las dos
--
--   SELECT jobname, schedule, active, username FROM cron.job
--    WHERE jobname IN ('purgar-eventos-webhook-whatsapp','purgar-estados-huerfanos-whatsapp',
--                      'purgar-mensajes-whatsapp','purgar-conversaciones-whatsapp');
--   -- esperado: 4 filas, active, username = postgres
--
--   SELECT conname FROM pg_constraint WHERE conname IN
--     ('conversaciones_whatsapp_canal_id_negocio_id_fkey','mensajes_whatsapp_conversacion_id_negocio_id_fkey');
--   -- esperado: las dos FK compuestas (nombres que genera Postgres)
--
--   SELECT name FROM vault.secrets WHERE name = 'whatsapp_app_secret';
--   -- esperado: 1 fila. Si no esta, el webhook responde 503 hasta que Pedro lo cree:
--   --   SELECT vault.create_secret('<App Secret de la app de Meta>', 'whatsapp_app_secret',
--   --                              'App Secret de Meta para verificar los webhooks de WhatsApp');
--
--   Prueba de firma (sin tocar nada, dentro de BEGIN ... ROLLBACK), con un secreto de prueba:
--     SELECT vault.create_secret('secreto-de-prueba', 'whatsapp_app_secret');
--     SELECT public.ingerir_webhook_whatsapp(
--       'sha256=' || encode(extensions.hmac('{"object":"whatsapp_business_account","entry":[]}', 'secreto-de-prueba', 'sha256'), 'hex'),
--       '{"object":"whatsapp_business_account","entry":[]}');
--     -- esperado: {"duplicado": false, "nuevos": 0, "estados": 0, "estados_sin_mensaje": 0, "sin_canal": 0, "ignorados": 0}
--     SELECT public.ingerir_webhook_whatsapp('sha256=' || repeat('0', 64), '{"object":"whatsapp_business_account","entry":[]}');
--     -- esperado: ERROR P0401 La firma no coincide.
--   El arnes completo (88+ comprobaciones bajo roles reales) esta en scripts/sql/arnes-bandeja-whatsapp/.
