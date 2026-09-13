-- Comunidades hiperlocales -- ARCHIVO 5: correcciones tras la auditoria del
-- 12-sep-2026 sobre los cuatro archivos YA APLICADOS en produccion
-- (20260912200000, 210000, 220000, 230000). No reabre ninguno: todo lo que
-- cambia se recrea aqui con CREATE OR REPLACE copiando el cuerpo vivo, o con
-- DROP + CREATE de firma completa cuando cambia el RETURNS. Idempotente de
-- punta a punta y sin begin/commit propios: apply-migration.mjs lo envuelve en
-- UNA transaccion con su fila del ledger.
--
-- ---------------------------------------------------------------------------
-- A. EL BLOQUEO CON QUIEN MANDA VALE TAMBIEN AL ACEPTAR -- POR QUE
--
-- alternar_membresia_comunidad (rama ENTRAR) y solicitar_union_comunidad
-- rechazan a quien tiene bloqueo bidireccional con communities.owner_id. Pero
-- resolver_solicitud_union solo miraba hay_bloqueo_con(solicitante), que
-- responde por QUIEN RESUELVE: un moderador sin bloqueo metia a la privada a
-- quien el owner habia bloqueado (o a quien bloqueo al owner), y el owner no
-- podia sacarlo (no hay expulsion en v1). Se cierra en tres sitios:
--   1. resolver_solicitud_union comprueba el bloqueo con el mando ANTES de
--      aceptar, con el mismo P0002 generico que la suspension del solicitante
--      ('Esa solicitud ya no se puede aceptar.'), para que el texto no
--      confirme un bloqueo. El 42501 propio que tenia el bloqueo con el
--      resolutor ('No puedes resolver esa solicitud.') se unifica al mismo
--      P0002 por el mismo motivo.
--   2. solicitudes_de_comunidad oculta a todos los moderadores las pendientes
--      con bloqueo contra el mando: la cola no ensena lo que no se puede
--      aceptar.
--   3. Un trigger AFTER INSERT en user_blocks cancela las pendientes cruzadas
--      entre quien bloquea y quien es bloqueado cuando uno de los dos manda en
--      la comunidad: el solicitante deja de ver 'Solicitud enviada' para
--      siempre y la cola no arrastra filas muertas.
-- El bloqueo se lee DIRECTO de user_blocks dentro de funciones DEFINER (la RLS
-- de user_blocks solo deja ver la mitad en la que yo bloqueo): es la misma
-- regla que notificar_comentario_de_comunidad ya aplicaba.
--
-- ---------------------------------------------------------------------------
-- B. LA POLICY DE community_join_requests SE REDUCE A LA FILA PROPIA -- POR QUE
--
-- La rama 'o las de la comunidad si la modero' abria por REST lo que la RPC de
-- la cola oculta: solicitudes de bloqueados, de suspendidos y las canceladas o
-- rechazadas con su mensaje. El frontend solo lee la fila PROPIA por REST
-- (cancelarSolicitudPropia busca su id); la cola va por
-- solicitudes_de_comunidad. Superficie sin consumidor: se quita. Queda
-- user_id = auth.uid() OR admin.
--
-- ---------------------------------------------------------------------------
-- C. UNA ACEPTACION HISTORICA NO ES UN PASE PERMANENTE -- POR QUE
--
-- La rama ENTRAR de alternar_membresia_comunidad aceptaba cualquier fila
-- 'aceptada' aunque hubiera un rechazo POSTERIOR. Ahora manda la ULTIMA
-- solicitud resuelta (aceptada o rechazada, por resolved_at): salir y volver
-- sigue funcionando sin nueva aprobacion, como pide el contrato, pero un
-- rechazo explicito posterior revoca el pase. La regla vive en UN helper,
-- solicitud_aceptada_vigente(uuid, uuid), que consumen alternar, solicitar,
-- detalle, descubrir y mis_comunidades.
--
-- Y esa misma pregunta sale al cliente como puedo_entrar en detalle_comunidad,
-- descubrir_comunidades y mis_comunidades: sin ella, quien fue aceptado y
-- salio veia 'Solicitar unirse', gastaba cuota y volvia a la cola de los
-- moderadores por algo que la base ya le concedia. solicitar_union_comunidad
-- ademas responde 22023 sin gastar cuota si el pase sigue vigente, y el
-- cliente lo traduce a alternar_membresia_comunidad (mismo patron que el
-- 22023 de 'es publica').
--
-- ---------------------------------------------------------------------------
-- D. ABRIR UNA COMUNIDAD CANCELA SUS PENDIENTES -- POR QUE
--
-- Al pasar de privada a publica, las solicitudes pendientes quedaban vivas:
-- el solicitante veia 'Solicitud enviada' y el panel de administrar no
-- ensena la cola en publicas, asi que nadie podia resolverlas.
-- editar_visibilidad_comunidad(p_privada = false) las marca 'cancelada'. En
-- una publica se entra con un toque; no hace falta avisar.
--
-- ---------------------------------------------------------------------------
-- E. CUOTA DE NOMBRAMIENTOS -- POR QUE
--
-- nombrar_moderador_comunidad insertaba una notificacion cada vez que el rol
-- pasaba de member a moderator, y quitar/nombrar en bucle no tenia freno en
-- la base (writeRateLimit es no-op sin Upstash). Mismo modo de fallo que la
-- migracion base cerro para comentarios (C-3). Clave moderadores_24h = 10 en
-- comunidades_limite y tipo 'moderador' en el ledger append-only: se cuenta
-- por quien nombra, en cualquiera de sus comunidades.
--
-- ---------------------------------------------------------------------------
-- F. MOVER EL CENTRO RESPETA LA CUOTA C -- POR QUE
--
-- fundar_comunidad exige 1 km entre las propias vivas, pero
-- editar_centro_comunidad solo media contra centro_fundacion: se fundaba la
-- segunda en la celda vecina y se movia a la de la primera. Ahora el UPDATE se
-- rechaza si otra comunidad viva del mismo fundador (o de quien mueve) queda
-- a menos de separacion_propias_metros del punto redondeado, con el mismo
-- ERRCODE 23514 que fundar.
--
-- ---------------------------------------------------------------------------
-- G. ARCHIVADA: LA BASE MANDA Y EL CLIENTE DEJA DE PROMETER LECTURA
--
-- feed_muro_comunidad, puedo_ver_publicacion y comentarios_de_publicacion
-- exigen archived_at IS NULL desde el archivo 1 ('dejan de leerse'). El
-- cliente prometia 'puedes leer lo que quedo' y pedia el muro igual: P0002 y
-- Sentry en cada visita. Se alinea el cliente con la base (no se abre nada) y
-- mis_comunidades pasa a listar TAMBIEN las archivadas u ocultas donde sigo
-- siendo miembro vivo, con disponible = false y archivada, despues de las
-- vivas: es la unica ruta desde la app para llegar a una archivada y pulsar
-- Salir. detalle_comunidad devuelve tambien archivada para que el banner no
-- diga 'archivada' cuando la oculto moderacion.
--
-- Y alternar_membresia_comunidad devuelve 'archivada' en el jsonb al salir:
-- si quien sale era la unica persona, comunidad_traspasa_mando la archiva sin
-- vuelta, y el cliente tiene que decirlo en vez de 'Saliste de X'.
--
-- ---------------------------------------------------------------------------
-- H. ACENTOS EN LAS NOTIFICACIONES PERSISTIDAS
--
-- El SQL es ASCII por regla de estilo, pero notifications.mensaje se pinta tal
-- cual en la campana. Los textos de solicitudes y moderadores no llevan tilde;
-- el del comentario si ('comento tu publicacion'). Se recrea
-- notificar_comentario_de_comunidad con escapes U&'\00F3' (el archivo sigue
-- siendo ASCII) y se corrigen las filas ya escritas. Los mensajes de error de
-- las RPC siguen en ASCII: los acentua el cliente en un solo diccionario
-- (apps/web/lib/comunidades/errores.ts).
-- ---------------------------------------------------------------------------

-- (sin begin/commit propios: apply-migration.mjs envuelve el archivo entero en UNA transaccion junto con su fila del ledger)

-- ===========================================================================
-- 0. PREFLIGHT: el archivo 4 tiene que estar aplicado.
-- ===========================================================================
DO $preflight$
BEGIN
  IF to_regclass('public.community_join_requests') IS NULL THEN
    RAISE EXCEPTION 'falta aplicar 20260912230000: no existe public.community_join_requests'
      USING ERRCODE = '42P01';
  END IF;
  IF to_regprocedure('public.detalle_comunidad(uuid)') IS NULL
     OR to_regprocedure('public.resolver_solicitud_union(uuid, boolean)') IS NULL
     OR to_regprocedure('public.editar_centro_comunidad(uuid, double precision, double precision)') IS NULL THEN
    RAISE EXCEPTION 'falta aplicar 20260912230000: faltan RPC del archivo 4'
      USING ERRCODE = '42883';
  END IF;
END
$preflight$;


-- ===========================================================================
-- 1. TOPES: moderadores_24h en el unico sitio donde viven los topes, y el
--    ledger admite el tipo 'moderador'.
-- ===========================================================================
create or replace function public.comunidades_limite(p_clave text)
returns integer
language plpgsql
immutable
set search_path to ''
as $function$
DECLARE v INT;
BEGIN
  v := CASE p_clave
         WHEN 'comunidades_fundadas_vivas' THEN 3
         WHEN 'comunidades_fundadas_24h'   THEN 1
         WHEN 'separacion_propias_metros'  THEN 1000
         WHEN 'membresias_vivas'           THEN 20
         WHEN 'membresias_altas_24h'       THEN 10
         WHEN 'publicaciones_24h'          THEN 10
         WHEN 'comentarios_24h'            THEN 60
         WHEN 'reacciones_24h'             THEN 300
         WHEN 'descripciones_24h'          THEN 10
         WHEN 'pagina_muro'                THEN 30
         WHEN 'pagina_descubrir'           THEN 30
         WHEN 'radio_descubrir_metros'     THEN 5000
         -- Archivo 4:
         WHEN 'solicitudes_union_24h'      THEN 10
         WHEN 'moderadores_por_comunidad'  THEN 5
         WHEN 'centros_24h'                THEN 2
         WHEN 'centro_radio_metros'        THEN 1000
         WHEN 'pagina_solicitudes'         THEN 30
         -- Archivo 5:
         WHEN 'moderadores_24h'            THEN 10
         ELSE NULL
       END;
  IF v IS NULL THEN
    RAISE EXCEPTION 'limite desconocido: %', p_clave USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$function$;

comment on function public.comunidades_limite(text) is
  'Tabla de cuotas del producto, en un solo sitio. membresias_vivas x pagina_muro = 600 es la cota dura del fan-out del muro unificado. Desde 20260912230000 incluye solicitudes_union_24h, moderadores_por_comunidad, centros_24h, centro_radio_metros y pagina_solicitudes; desde 20260912240000, moderadores_24h (nombramientos por quien nombra). Una clave desconocida lanza 22023 a proposito.';

alter table public.community_post_quota drop constraint if exists community_post_quota_tipo_valido;
alter table public.community_post_quota add constraint community_post_quota_tipo_valido
  check (tipo in ('publicacion','comentario','reaccion','descripcion','solicitud','centro','moderador'));

comment on column public.community_post_quota.tipo is
  'publicacion | comentario | reaccion | descripcion | solicitud | centro | moderador. Los topes viven en comunidades_limite(): publicaciones_24h, comentarios_24h, reacciones_24h, descripciones_24h, solicitudes_union_24h, centros_24h y moderadores_24h.';


-- ===========================================================================
-- 2. LA POLICY DE community_join_requests: solo la fila propia (o admin).
-- ===========================================================================
drop policy if exists "solicitudes: la mia, o las de la comunidad si la modero" on public.community_join_requests;
drop policy if exists "solicitudes: la mia" on public.community_join_requests;
create policy "solicitudes: la mia"
  on public.community_join_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.has_role((select auth.uid()), 'admin'::app_role))
  );

comment on table public.community_join_requests is
  'Solicitudes para entrar a una comunidad privada. Se escribe SOLO por RPC (solicitar_union_comunidad, cancelar_solicitud_union, resolver_solicitud_union). Una sola pendiente por (community_id, user_id). Por REST solo se lee la fila PROPIA (o admin): la cola de owner/moderadores va por solicitudes_de_comunidad, que filtra bloqueos y suspendidos. NO reutiliza community_members con un estado: romperia comunidad_cuenta_miembros y el tope de 20.';


-- ===========================================================================
-- 3. HELPERS INTERNOS (no concedidos a nadie: los envuelven RPC DEFINER)
-- ===========================================================================

-- 3.1 Bloqueo bidireccional entre una persona y quien MANDA en la comunidad.
-- Lee user_blocks entera (DEFINER): hay_bloqueo_con responde por quien llama
-- y aqui la pregunta es por un tercero.
create or replace function public.comunidad_bloqueo_con_mando(p_community_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.communities c
      join public.user_blocks ub
        on (ub.blocker_id = c.owner_id and ub.blocked_id = p_user)
        or (ub.blocker_id = p_user     and ub.blocked_id = c.owner_id)
     where c.id = p_community_id
       and c.owner_id is not null
       and p_user is not null
  );
$function$;

comment on function public.comunidad_bloqueo_con_mando(uuid, uuid) is
  'true si hay bloqueo en CUALQUIER sentido entre p_user y communities.owner_id. DEFINER porque user_blocks solo deja ver la mitad en la que yo bloqueo. La consumen resolver_solicitud_union y solicitudes_de_comunidad. No concedida a nadie.';

-- 3.2 El pase de una privada: la ULTIMA solicitud resuelta es 'aceptada'.
create or replace function public.solicitud_aceptada_vigente(p_community_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((
    select r.status = 'aceptada'
      from public.community_join_requests r
     where r.community_id = p_community_id
       and r.user_id      = p_user
       and r.status in ('aceptada', 'rechazada')
     order by r.resolved_at desc nulls last, r.id desc
     limit 1
  ), false);
$function$;

comment on function public.solicitud_aceptada_vigente(uuid, uuid) is
  'true si la ULTIMA solicitud resuelta de p_user en esa comunidad fue aceptada. Un rechazo posterior revoca el pase; salir y volver no. Es la unica definicion del pase: la consumen alternar_membresia_comunidad, solicitar_union_comunidad, detalle_comunidad, descubrir_comunidades y mis_comunidades. No concedida a nadie.';

-- 3.3 Trigger: bloquear cancela las pendientes cruzadas con el mando.
create or replace function public.bloqueo_cancela_solicitudes_union()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
BEGIN
  UPDATE public.community_join_requests r
     SET status = 'cancelada', resolved_at = now()
    FROM public.communities c
   WHERE c.id = r.community_id
     AND r.status = 'pendiente'
     AND (
       (c.owner_id = NEW.blocker_id AND r.user_id = NEW.blocked_id)
       OR
       (c.owner_id = NEW.blocked_id AND r.user_id = NEW.blocker_id)
     );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Bloquear es una accion de seguridad: nunca falla por esto. Las RPC de
  -- aceptar y de la cola aplican la misma regla por su cuenta.
  RAISE WARNING 'no se pudieron cancelar las solicitudes cruzadas del bloqueo % -> %: % (%)',
    NEW.blocker_id, NEW.blocked_id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

comment on function public.bloqueo_cancela_solicitudes_union() is
  'AFTER INSERT en user_blocks. Cancela las solicitudes pendientes entre quien bloquea y quien es bloqueado cuando uno de los dos manda (owner_id) en la comunidad. Se traga sus errores con RAISE WARNING: bloquear no puede fallar por esto.';

drop trigger if exists bloqueo_cancela_solicitudes_union on public.user_blocks;
create trigger bloqueo_cancela_solicitudes_union
  after insert on public.user_blocks
  for each row execute function public.bloqueo_cancela_solicitudes_union();


-- ===========================================================================
-- 4. RPC RECREADAS CON LA MISMA FIRMA (CREATE OR REPLACE, sin sobrecarga)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4.1 resolver_solicitud_union -- cuerpo vivo mas el bloqueo con el mando y
-- los textos unificados (A).
-- ---------------------------------------------------------------------------
create or replace function public.resolver_solicitud_union(
  p_request_id uuid,
  p_aceptar    boolean
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer     UUID;
  v_req        RECORD;
  v_nombre     TEXT;
  v_disponible BOOLEAN;
  v_vivas      INT;
  v_estado     TEXT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_request_id IS NULL OR p_aceptar IS NULL THEN
    RAISE EXCEPTION 'Faltan datos.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;

  -- FOR UPDATE: dos moderadores resolviendo la misma solicitud se serializan
  -- aqui, y el segundo la encuentra ya resuelta.
  SELECT r.id, r.community_id, r.user_id, r.status INTO v_req
    FROM community_join_requests r
   WHERE r.id = p_request_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa solicitud no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.es_moderador_de_comunidad(v_req.community_id) THEN
    RAISE EXCEPTION 'No administras esa comunidad.' USING ERRCODE = '42501';
  END IF;

  IF v_req.status <> 'pendiente' THEN
    RAISE EXCEPTION 'Esa solicitud ya no esta pendiente.' USING ERRCODE = 'P0002';
  END IF;

  -- Bloqueo bidireccional entre quien pide y quien resuelve, O entre quien
  -- pide y quien MANDA (owner_id): ni se acepta ni se rechaza. Mismo P0002
  -- generico que la suspension del solicitante, para que el texto no confirme
  -- un bloqueo. La cola ya no las muestra (solicitudes_de_comunidad).
  IF public.hay_bloqueo_con(v_req.user_id)
     OR public.comunidad_bloqueo_con_mando(v_req.community_id, v_req.user_id) THEN
    RAISE EXCEPTION 'Esa solicitud ya no se puede aceptar.' USING ERRCODE = 'P0002';
  END IF;

  SELECT c.nombre, (c.is_hidden = FALSE AND c.archived_at IS NULL)
    INTO v_nombre, v_disponible
    FROM communities c WHERE c.id = v_req.community_id;

  IF p_aceptar THEN
    IF NOT v_disponible THEN
      RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
    END IF;
    -- Una cuenta suspendida no entra a comunidades nuevas (I-10), tampoco por
    -- aceptacion. Mensaje generico: no es un oraculo de suspension.
    IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_req.user_id AND pf.is_hidden) THEN
      RAISE EXCEPTION 'Esa solicitud ya no se puede aceptar.' USING ERRCODE = 'P0002';
    END IF;

    -- La MISMA llave que toma quien pide al unirse por su cuenta: la cuota de
    -- 20 vivas se comparte y sin la llave dos altas simultaneas leen 19 las dos.
    PERFORM pg_advisory_xact_lock(
      hashtextextended('comunidad:membresia:' || v_req.user_id::text, 0));

    IF NOT EXISTS (SELECT 1 FROM community_members m
                    WHERE m.community_id = v_req.community_id
                      AND m.user_id = v_req.user_id AND m.left_at IS NULL) THEN
      SELECT count(*) INTO v_vivas
        FROM community_members m
        JOIN communities c ON c.id = m.community_id
       WHERE m.user_id = v_req.user_id AND m.left_at IS NULL
         AND c.is_hidden = FALSE AND c.archived_at IS NULL;
      IF v_vivas >= public.comunidades_limite('membresias_vivas') THEN
        RAISE EXCEPTION 'Esa persona ya pertenece a % comunidades y no cabe en otra. La solicitud sigue pendiente.',
                        public.comunidades_limite('membresias_vivas')
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO community_members (community_id, user_id, role)
      VALUES (v_req.community_id, v_req.user_id, 'member')
      ON CONFLICT (user_id, community_id) DO UPDATE
        SET left_at = NULL
        WHERE community_members.left_at IS NOT NULL;
    END IF;
    v_estado := 'aceptada';
  ELSE
    v_estado := 'rechazada';
  END IF;

  UPDATE community_join_requests
     SET status = v_estado, resolved_at = now(), resolved_by = v_viewer
   WHERE id = p_request_id;

  PERFORM public.comunidad_notifica(
    v_req.user_id, 'comunidad_solicitud_resuelta',
    CASE WHEN p_aceptar THEN 'Solicitud aceptada' ELSE 'Solicitud rechazada' END,
    CASE WHEN p_aceptar THEN 'Ya eres parte de ' || COALESCE(v_nombre, 'la comunidad')
         ELSE 'Tu solicitud para unirte a ' || COALESCE(v_nombre, 'la comunidad') || ' no fue aceptada' END,
    jsonb_build_object('community_id', v_req.community_id, 'request_id', p_request_id,
                       'aceptada', p_aceptar));

  RETURN jsonb_build_object('id', p_request_id, 'status', v_estado,
                            'community_id', v_req.community_id, 'user_id', v_req.user_id);
END;
$function$;

comment on function public.resolver_solicitud_union(uuid, boolean) is
  'Acepta o rechaza una solicitud pendiente. Owner o moderador; guardia de suspension. P0002 generico ("ya no se puede aceptar") si hay bloqueo entre quien pide y quien resuelve O entre quien pide y quien manda (owner_id), o si quien pide esta suspendido: el texto no distingue los tres casos. Al aceptar toma la llave comunidad:membresia:<solicitante> e inserta la membresia con el MISMO tope de 20 vivas que alternar_membresia_comunidad: si no cabe, 23514 y la solicitud sigue pendiente. Avisa a quien pidio.';

-- ---------------------------------------------------------------------------
-- 4.2 solicitudes_de_comunidad -- cuerpo vivo mas: oculta a TODOS los
-- moderadores las pendientes con bloqueo contra el mando (A.2).
-- ---------------------------------------------------------------------------
create or replace function public.solicitudes_de_comunidad(
  p_community_id uuid,
  cursor_time    timestamp with time zone default null::timestamp with time zone,
  cursor_id      uuid                     default null::uuid,
  result_limit   integer                  default 30
)
returns table (
  id uuid, user_id uuid, user_nombre text, user_foto text, user_trust_level text,
  mensaje text, created_at timestamp with time zone
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer  UUID;
  v_owner   UUID;
  v_limite  INT;
  v_vetados UUID[];
BEGIN
  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time y cursor_id se mandan juntos o no se mandan'
      USING ERRCODE = '22023';
  END IF;

  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.es_moderador_de_comunidad(p_community_id) THEN
    RAISE EXCEPTION 'No administras esa comunidad.' USING ERRCODE = '42501';
  END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_solicitudes'));

  SELECT c.owner_id INTO v_owner FROM communities c WHERE c.id = p_community_id;

  -- Bloqueos del visor Y del mando, en un solo arreglo: lo que ni el visor ni
  -- el owner pueden aceptar no se ensena a nadie.
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
      UNION ALL
      SELECT ub.blocked_id     FROM user_blocks ub WHERE v_owner IS NOT NULL AND ub.blocker_id = v_owner
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE v_owner IS NOT NULL AND ub.blocked_id = v_owner
    ) x;

  RETURN QUERY
  SELECT k.id, k.user_id, au.nombre, au.foto, au.trust_level::TEXT,
         k.mensaje, k.created_at
    FROM (
      SELECT r.id, r.user_id, r.mensaje, r.created_at
        FROM community_join_requests r
       WHERE r.community_id = p_community_id
         AND r.status = 'pendiente'
         AND r.user_id <> ALL (v_vetados)
         AND NOT EXISTS (SELECT 1 FROM profiles pf
                          WHERE pf.id = r.user_id AND pf.is_hidden)
         AND (cursor_time IS NULL
              OR (r.created_at, r.id) < (cursor_time, cursor_id))
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT v_limite
    ) k
    JOIN profiles au ON au.id = k.user_id
   ORDER BY k.created_at DESC, k.id DESC;
END;
$function$;

comment on function public.solicitudes_de_comunidad(uuid, timestamp with time zone, uuid, integer) is
  'Cola de solicitudes pendientes de una comunidad, solo para owner/moderadores (42501 si no). Cursor de tupla (created_at, id) descendente. Oculta a quien tiene bloqueo con el visor O con quien manda (owner_id), y a cuentas suspendidas: la cola no ensena lo que no se puede aceptar.';

-- ---------------------------------------------------------------------------
-- 4.3 alternar_membresia_comunidad -- cuerpo vivo mas: el pase es la ULTIMA
-- solicitud resuelta (C) y el jsonb dice si al salir la comunidad se archivo (G).
-- ---------------------------------------------------------------------------
create or replace function public.alternar_membresia_comunidad(p_community_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer     UUID;
  v_owner      UUID;
  v_privada    BOOLEAN;
  v_rol        TEXT;
  v_activa     BOOLEAN;
  v_disponible BOOLEAN;
  v_vivas      INT;
  v_altas      INT;
  v_total      INT;
  v_archivada  BOOLEAN := FALSE;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'Falta la comunidad.' USING ERRCODE = '22023';
  END IF;

  SELECT c.owner_id, c.es_privada, (c.is_hidden = FALSE AND c.archived_at IS NULL)
    INTO v_owner, v_privada, v_disponible
    FROM communities c WHERE c.id = p_community_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:membresia:' || v_viewer::text, 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:mando:' || p_community_id::text, 0));

  SELECT m.role, (m.left_at IS NULL) INTO v_rol, v_activa
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.user_id = v_viewer;

  IF COALESCE(v_activa, FALSE) THEN
    -- SALIR. Siempre posible, este la comunidad archivada, oculta o privada.
    IF v_rol = 'owner' THEN
      PERFORM public.comunidad_traspasa_mando(p_community_id, v_viewer);
    END IF;

    UPDATE community_members
       SET left_at = now(), role = 'member'
     WHERE community_id = p_community_id AND user_id = v_viewer;

    v_activa := FALSE;

    -- Si era la unica persona, comunidad_traspasa_mando la archivo (sin
    -- vuelta desde la app): el cliente tiene que decirlo.
    SELECT (c.archived_at IS NOT NULL) INTO v_archivada
      FROM communities c WHERE c.id = p_community_id;

  ELSE
    -- ENTRAR.
    IF NOT v_disponible THEN
      RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
    END IF;

    IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
      RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
    END IF;

    IF v_owner IS NOT NULL AND public.hay_bloqueo_con(v_owner) THEN
      RAISE EXCEPTION 'No puedes unirte a esa comunidad.' USING ERRCODE = '42501';
    END IF;

    -- PRIVADA (decision 3): no se entra directo. Salvo que el pase siga
    -- vigente -- la ULTIMA solicitud resuelta fue aceptada; un rechazo
    -- posterior lo revoca; salir y volver no -- o que quien entra tenga el
    -- mando (owner_id) y le falte su fila viva por alguna deriva.
    IF v_privada
       AND v_owner IS DISTINCT FROM v_viewer
       AND NOT public.solicitud_aceptada_vigente(p_community_id, v_viewer) THEN
      RAISE EXCEPTION 'Esta comunidad es privada: solicita unirte y espera a que te acepten.'
        USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_vivas
      FROM community_members m
      JOIN communities c ON c.id = m.community_id
     WHERE m.user_id = v_viewer AND m.left_at IS NULL
       AND c.is_hidden = FALSE AND c.archived_at IS NULL;
    IF v_vivas >= public.comunidades_limite('membresias_vivas') THEN
      RAISE EXCEPTION 'Ya perteneces a % comunidades. Sal de alguna para unirte a esta.',
                      public.comunidades_limite('membresias_vivas')
        USING ERRCODE = '23514';
    END IF;

    SELECT count(*) INTO v_altas
      FROM community_members m
     WHERE m.user_id = v_viewer AND m.joined_at > now() - interval '24 hours';
    IF v_altas >= public.comunidades_limite('membresias_altas_24h') THEN
      RAISE EXCEPTION 'Te uniste a demasiadas comunidades hoy. Intentalo manana.'
        USING ERRCODE = '23514';
    END IF;

    INSERT INTO community_members (community_id, user_id, role)
    VALUES (p_community_id, v_viewer, 'member')
    ON CONFLICT (user_id, community_id) DO UPDATE
      SET left_at = NULL
      WHERE community_members.left_at IS NOT NULL;

    v_activa := TRUE;
  END IF;

  SELECT c.miembros_count INTO v_total FROM communities c WHERE c.id = p_community_id;

  RETURN jsonb_build_object('soy_miembro', v_activa,
                            'miembros_count', COALESCE(v_total, 0),
                            'archivada', COALESCE(v_archivada, FALSE));
END;
$function$;

comment on function public.alternar_membresia_comunidad(uuid) is
  'Unirse y salir en un solo boton, devolviendo el estado autoritativo ({soy_miembro, miembros_count, archivada}). Salir es borrado SUAVE (left_at + role=member) y SIEMPRE posible; si quien sale era la unica persona, comunidad_traspasa_mando archiva la comunidad y archivada=true. Entrar exige comunidad viva, cuenta no suspendida, sin bloqueo con quien manda, tope de 20 vivas, 10 altas por 24 h y que la comunidad sea publica, o que el pase siga vigente (solicitud_aceptada_vigente: la ULTIMA resuelta fue aceptada), o que quien entra tenga el mando (42501 si no). Dos llaves en orden fijo usuario -> comunidad.';

-- ---------------------------------------------------------------------------
-- 4.4 solicitar_union_comunidad -- cuerpo vivo mas: si el pase sigue vigente
-- responde 22023 sin gastar cuota (C).
-- ---------------------------------------------------------------------------
create or replace function public.solicitar_union_comunidad(
  p_community_id uuid,
  p_mensaje      text default null::text
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer   UUID;
  v_owner    UUID;
  v_privada  BOOLEAN;
  v_nombre   TEXT;
  v_mensaje  TEXT;
  v_n        INT;
  v_id       UUID;
  v_creado   TIMESTAMPTZ;
  v_quien    TEXT;
  v_mod      UUID;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'Falta la comunidad.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;

  v_mensaje := NULLIF(btrim(COALESCE(p_mensaje, '')), '');
  IF v_mensaje IS NOT NULL AND char_length(v_mensaje) > 200 THEN
    RAISE EXCEPTION 'El mensaje no puede pasar de 200 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT c.owner_id, c.es_privada, c.nombre INTO v_owner, v_privada, v_nombre
    FROM communities c
   WHERE c.id = p_community_id AND c.is_hidden = FALSE AND c.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- No se solicita entrar a la comunidad de quien te bloqueo (ni de quien
  -- bloqueaste). Mismo mensaje que alternar_membresia_comunidad.
  IF v_owner IS NOT NULL AND public.hay_bloqueo_con(v_owner) THEN
    RAISE EXCEPTION 'No puedes unirte a esa comunidad.' USING ERRCODE = '42501';
  END IF;

  IF public.es_miembro_de_comunidad(p_community_id) THEN
    RAISE EXCEPTION 'Ya eres miembro de esa comunidad.' USING ERRCODE = '22023';
  END IF;

  -- Una publica no se solicita: se entra. El cliente traduce este 22023 a una
  -- llamada a alternar_membresia_comunidad (la comunidad pudo abrirse entre el
  -- render y el toque).
  IF NOT v_privada THEN
    RAISE EXCEPTION 'Esa comunidad es publica: puedes unirte directamente.' USING ERRCODE = '22023';
  END IF;

  -- El pase sigue vigente (te aceptaron y saliste): tampoco se solicita, se
  -- entra. Mismo 22023, sin gastar cuota ni molestar a los moderadores.
  IF v_owner IS DISTINCT FROM v_viewer
     AND public.solicitud_aceptada_vigente(p_community_id, v_viewer) THEN
    RAISE EXCEPTION 'Ya te aceptaron en esa comunidad: puedes entrar directamente.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:solicitar:' || v_viewer::text, 0));

  -- DOBLE TOQUE = IDEMPOTENTE. Ya hay una pendiente: se devuelve sin gastar
  -- cuota ni avisar de nuevo.
  SELECT r.id, r.created_at INTO v_id, v_creado
    FROM community_join_requests r
   WHERE r.community_id = p_community_id AND r.user_id = v_viewer AND r.status = 'pendiente';
  IF FOUND THEN
    RETURN jsonb_build_object('id', v_id, 'status', 'pendiente',
                              'community_id', p_community_id,
                              'created_at', v_creado, 'repetida', TRUE);
  END IF;

  -- Cuota contra el ledger: cancelar y volver a pedir GASTA.
  SELECT count(*) INTO v_n
    FROM community_post_quota q
   WHERE q.user_id = v_viewer AND q.tipo = 'solicitud'
     AND q.created_at > now() - interval '24 hours';
  IF v_n >= public.comunidades_limite('solicitudes_union_24h') THEN
    RAISE EXCEPTION 'Llegaste al limite de % solicitudes en 24 horas.',
                    public.comunidades_limite('solicitudes_union_24h')
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO community_join_requests (community_id, user_id, mensaje)
  VALUES (p_community_id, v_viewer, v_mensaje)
  RETURNING id, created_at INTO v_id, v_creado;

  INSERT INTO community_post_quota (user_id, tipo) VALUES (v_viewer, 'solicitud');

  -- Aviso al mando y a los moderadores (tope 5, asi que son <= 6 filas), sin
  -- avisar a quien tiene bloqueo con quien pide. hay_bloqueo_con responde por
  -- QUIEN LLAMA, que aqui es quien pide: sirve tal cual.
  SELECT pr.nombre INTO v_quien FROM profiles pr WHERE pr.id = v_viewer;
  FOR v_mod IN
    SELECT m.user_id FROM community_members m
     WHERE m.community_id = p_community_id AND m.left_at IS NULL
       AND m.role IN ('owner','moderator')
       AND NOT public.hay_bloqueo_con(m.user_id)
  LOOP
    PERFORM public.comunidad_notifica(
      v_mod, 'comunidad_solicitud', 'Nueva solicitud para unirse',
      COALESCE(NULLIF(btrim(v_quien), ''), 'Alguien') || ' quiere unirse a ' || v_nombre,
      jsonb_build_object('community_id', p_community_id, 'request_id', v_id, 'user_id', v_viewer));
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'status', 'pendiente',
                            'community_id', p_community_id,
                            'created_at', v_creado, 'repetida', FALSE);
END;
$function$;

comment on function public.solicitar_union_comunidad(uuid, text) is
  'Pide entrar a una comunidad PRIVADA. Guardia de suspension, bloqueo bidireccional con quien manda, 22023 si ya eres miembro, si es publica o si tu pase sigue vigente (te aceptaron y saliste: entra directo con alternar_membresia_comunidad), cuota de 10 en 24 h contra el ledger (cancelar y volver a pedir gasta). Doble toque idempotente: devuelve la pendiente existente con repetida=true sin gastar cuota. Avisa al mando y a los moderadores sin bloqueo con quien pide.';

-- ---------------------------------------------------------------------------
-- 4.5 editar_visibilidad_comunidad -- cuerpo vivo mas: abrir cancela las
-- pendientes (D).
-- ---------------------------------------------------------------------------
create or replace function public.editar_visibilidad_comunidad(
  p_community_id uuid,
  p_privada      boolean
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_actual BOOLEAN;
  v_canceladas INT := 0;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL OR p_privada IS NULL THEN
    RAISE EXCEPTION 'Faltan datos.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM community_members m
                  WHERE m.community_id = p_community_id AND m.user_id = v_viewer
                    AND m.left_at IS NULL AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Solo quien administra la comunidad puede cambiar su visibilidad.' USING ERRCODE = '42501';
  END IF;

  SELECT c.es_privada INTO v_actual
    FROM communities c WHERE c.id = p_community_id AND c.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  IF v_actual IS DISTINCT FROM p_privada THEN
    UPDATE communities SET es_privada = p_privada WHERE id = p_community_id;
  END IF;

  -- Publica: las pendientes ya no tienen sentido (se entra con un toque) y el
  -- panel no ensena la cola en publicas. Se cancelan, tambien si ya era
  -- publica (idempotente y limpia restos).
  IF NOT p_privada THEN
    UPDATE community_join_requests
       SET status = 'cancelada', resolved_at = now()
     WHERE community_id = p_community_id AND status = 'pendiente';
    GET DIAGNOSTICS v_canceladas = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('id', p_community_id, 'es_privada', p_privada,
                            'solicitudes_canceladas', v_canceladas);
END;
$function$;

comment on function public.editar_visibilidad_comunidad(uuid, boolean) is
  'Cambia es_privada. Solo el mando (owner en su fila viva), cuenta no suspendida, comunidad no archivada. Idempotente: pedir el valor que ya tiene no hace nada. Al abrir (p_privada = false) cancela las solicitudes pendientes: en una publica se entra directo y el panel no ensena la cola.';

-- ---------------------------------------------------------------------------
-- 4.6 nombrar_moderador_comunidad -- cuerpo vivo mas la cuota moderadores_24h
-- por quien nombra (E).
-- ---------------------------------------------------------------------------
create or replace function public.nombrar_moderador_comunidad(
  p_community_id uuid,
  p_user_id      uuid
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_rol    TEXT;
  v_n      INT;
  v_nombre TEXT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Faltan datos.' USING ERRCODE = '22023';
  END IF;
  IF p_user_id = v_viewer THEN
    RAISE EXCEPTION 'Quien manda ya modera.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM community_members m
                  WHERE m.community_id = p_community_id AND m.user_id = v_viewer
                    AND m.left_at IS NULL AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Solo quien administra la comunidad puede nombrar moderadores.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:mando:' || p_community_id::text, 0));

  SELECT m.role INTO v_rol
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.user_id = p_user_id AND m.left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa persona no es miembro de la comunidad.' USING ERRCODE = 'P0002';
  END IF;

  IF v_rol <> 'moderator' THEN
    SELECT count(*) INTO v_n
      FROM community_members m
     WHERE m.community_id = p_community_id AND m.left_at IS NULL AND m.role = 'moderator';
    IF v_n >= public.comunidades_limite('moderadores_por_comunidad') THEN
      RAISE EXCEPTION 'Una comunidad puede tener hasta % moderadores.',
                      public.comunidades_limite('moderadores_por_comunidad')
        USING ERRCODE = '23514';
    END IF;

    -- Cuota por quien nombra, en cualquiera de sus comunidades: el bucle
    -- quitar/nombrar contra una misma persona era una manguera de
    -- notificaciones sin freno en la base.
    SELECT count(*) INTO v_n
      FROM community_post_quota q
     WHERE q.user_id = v_viewer AND q.tipo = 'moderador'
       AND q.created_at > now() - interval '24 hours';
    IF v_n >= public.comunidades_limite('moderadores_24h') THEN
      RAISE EXCEPTION 'Solo puedes nombrar % moderadores en 24 horas.',
                      public.comunidades_limite('moderadores_24h')
        USING ERRCODE = '23514';
    END IF;

    UPDATE community_members SET role = 'moderator'
     WHERE community_id = p_community_id AND user_id = p_user_id AND left_at IS NULL;

    INSERT INTO community_post_quota (user_id, tipo) VALUES (v_viewer, 'moderador');

    IF NOT public.hay_bloqueo_con(p_user_id) THEN
      SELECT c.nombre INTO v_nombre FROM communities c WHERE c.id = p_community_id;
      PERFORM public.comunidad_notifica(
        p_user_id, 'comunidad_moderador', 'Ahora eres moderador',
        'Te nombraron moderador de ' || COALESCE(v_nombre, 'una comunidad'),
        jsonb_build_object('community_id', p_community_id));
    END IF;
  END IF;

  SELECT count(*) INTO v_n
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.left_at IS NULL AND m.role = 'moderator';

  RETURN jsonb_build_object('community_id', p_community_id, 'user_id', p_user_id,
                            'role', 'moderator', 'moderadores_count', v_n);
END;
$function$;

comment on function public.nombrar_moderador_comunidad(uuid, uuid) is
  'Solo el owner. El nombrado tiene que ser miembro vivo (P0002 si no). Tope moderadores_por_comunidad = 5 (23514) bajo la llave comunidad:mando, y cuota moderadores_24h = 10 nombramientos por quien nombra en el ledger (23514). Idempotente si ya era moderador (no gasta). Avisa al nombrado salvo bloqueo.';

-- ---------------------------------------------------------------------------
-- 4.7 editar_centro_comunidad -- cuerpo vivo mas la cuota C (F).
-- ---------------------------------------------------------------------------
create or replace function public.editar_centro_comunidad(
  p_community_id uuid,
  p_lat          double precision,
  p_lng          double precision
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer    UUID;
  v_fundador  UUID;
  v_lat       FLOAT;
  v_lng       FLOAT;
  v_pedido    geography;
  v_nuevo     geography;
  v_fundacion geography;
  v_celda_old TEXT;
  v_celda_new TEXT;
  v_dist      FLOAT;
  v_n         INT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'Falta la comunidad.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM community_members m
                  WHERE m.community_id = p_community_id AND m.user_id = v_viewer
                    AND m.left_at IS NULL AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Solo quien administra la comunidad puede mover su centro.' USING ERRCODE = '42501';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(c.centro_fundacion, c.centro), c.celda, c.fundador_id
    INTO v_fundacion, v_celda_old, v_fundador
    FROM communities c WHERE c.id = p_community_id AND c.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- El limite se mide contra el punto PEDIDO (cabecera D del archivo 4):
  -- entre dos puntos de rejilla nunca hay menos de ~1.05 km, asi que medirlo
  -- contra el redondeado prohibiria mover siempre. El punto crudo no se guarda.
  v_pedido := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;
  v_dist   := ST_Distance(v_fundacion, v_pedido);
  IF v_dist > public.comunidades_limite('centro_radio_metros') THEN
    RAISE EXCEPTION 'El centro solo se puede mover hasta 1 km del punto donde se fundo la comunidad.'
      USING ERRCODE = '23514';
  END IF;

  -- Mismo redondeo que fundar_comunidad, mismo CHECK de rejilla en la tabla.
  v_lat   := round(p_lat::numeric, 2)::FLOAT;
  v_lng   := round(p_lng::numeric, 2)::FLOAT;
  v_nuevo := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;
  v_celda_new := round(v_lat::numeric, 2)::text || ',' || round(v_lng::numeric, 2)::text;

  -- Misma celda: no hay nada que mover, no se gasta cuota.
  IF v_celda_new = v_celda_old THEN
    RETURN jsonb_build_object('id', p_community_id, 'lat', v_lat, 'lng', v_lng, 'movido', FALSE);
  END IF;

  -- CUOTA C, la misma que fundar_comunidad: 1 km entre las propias vivas. Se
  -- mide contra el punto REDONDEADO (el que se guarda), como en fundar, y
  -- contra las de quien fundo esta comunidad y las de quien la mueve (que
  -- pueden no ser la misma persona si el mando se traspaso).
  IF EXISTS (SELECT 1 FROM communities c
              WHERE c.id <> p_community_id
                AND c.archived_at IS NULL
                AND (c.fundador_id = v_viewer OR (v_fundador IS NOT NULL AND c.fundador_id = v_fundador))
                AND ST_DWithin(c.centro, v_nuevo,
                               public.comunidades_limite('separacion_propias_metros'))) THEN
    RAISE EXCEPTION 'Ya tienes otra comunidad a menos de 1 km de ahi.'
      USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:centro:' || v_viewer::text, 0));

  SELECT count(*) INTO v_n
    FROM community_post_quota q
   WHERE q.user_id = v_viewer AND q.tipo = 'centro'
     AND q.created_at > now() - interval '24 hours';
  IF v_n >= public.comunidades_limite('centros_24h') THEN
    RAISE EXCEPTION 'Solo puedes mover el centro % veces en 24 horas.',
                    public.comunidades_limite('centros_24h')
      USING ERRCODE = '23514';
  END IF;

  -- Abre el unico camino que comunidad_normaliza deja pasar, local a la
  -- transaccion, y lo cierra en cuanto termina el UPDATE.
  PERFORM set_config('vicino.mover_centro', p_community_id::text, true);
  BEGIN
    UPDATE communities SET centro = v_nuevo WHERE id = p_community_id;
  EXCEPTION WHEN unique_violation THEN
    -- uq_communities_celda_nombre: en la celda destino ya hay una comunidad
    -- viva con el mismo nombre_norm.
    RAISE EXCEPTION 'Ya hay una comunidad con ese nombre en la zona a la que la quieres mover.'
      USING ERRCODE = '23505';
  END;
  PERFORM set_config('vicino.mover_centro', '', true);

  INSERT INTO community_post_quota (user_id, tipo) VALUES (v_viewer, 'centro');

  RETURN jsonb_build_object('id', p_community_id, 'lat', v_lat, 'lng', v_lng, 'movido', TRUE);
END;
$function$;

comment on function public.editar_centro_comunidad(uuid, double precision, double precision) is
  'Mueve el centro. Solo el owner; guardia de suspension; limite de 1 km medido contra el centro de FUNDACION y contra el punto PEDIDO; se guarda redondeado a 2 decimales como en fundar_comunidad; CUOTA C de fundar (1 km entre las propias vivas, del fundador y de quien mueve) contra el punto redondeado (23514); cuota centros_24h = 2 en el ledger; el 23505 de uq_communities_celda_nombre se traduce a un mensaje legible. Abre el camino del trigger con set_config(vicino.mover_centro) local a la transaccion.';

-- ---------------------------------------------------------------------------
-- 4.8 notificar_comentario_de_comunidad -- cuerpo vivo con el mensaje
-- acentuado via escapes U& (H). CREATE OR REPLACE conserva el trigger.
-- ---------------------------------------------------------------------------
create or replace function public.notificar_comentario_de_comunidad()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
DECLARE
  v_autor_madre uuid;
  v_nombre_com  text;
  v_quien       text;
BEGIN
  IF NEW.parent_post_id IS NULL THEN
    RETURN NEW;   -- publicar en el muro no avisa a nadie
  END IF;

  SELECT p.author_id INTO v_autor_madre
    FROM public.community_posts p WHERE p.id = NEW.parent_post_id;

  IF v_autor_madre IS NULL OR v_autor_madre = NEW.author_id THEN
    RETURN NEW;   -- responderse a uno mismo no avisa
  END IF;

  -- Bloqueo bidireccional: si se bloquearon, el comentario no se ve y el aviso
  -- tampoco se manda.
  IF EXISTS (SELECT 1 FROM public.user_blocks ub
              WHERE (ub.blocker_id = v_autor_madre AND ub.blocked_id = NEW.author_id)
                 OR (ub.blocker_id = NEW.author_id AND ub.blocked_id = v_autor_madre)) THEN
    RETURN NEW;
  END IF;

  SELECT c.nombre INTO v_nombre_com
    FROM public.communities c WHERE c.id = NEW.community_id;
  SELECT pr.nombre INTO v_quien
    FROM public.profiles pr WHERE pr.id = NEW.author_id;

  -- 'comento tu publicacion en' con tildes: el archivo sigue siendo ASCII
  -- gracias a los escapes U&, y la campana pinta mensaje tal cual.
  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, data, leida, created_at)
  VALUES (v_autor_madre,
          'comunidad_comentario',
          'Nuevo comentario',
          COALESCE(NULLIF(btrim(v_quien), ''), 'Alguien') || U&' coment\00F3 tu publicaci\00F3n en ' ||
            COALESCE(v_nombre_com, 'tu comunidad'),
          jsonb_build_object('community_id',   NEW.community_id,
                             'post_id',        NEW.parent_post_id,
                             'comentario_id',  NEW.id),
          false, now());
  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'no se pudo notificar el comentario %: % (%)', NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

comment on function public.notificar_comentario_de_comunidad() is
  'AFTER INSERT en community_posts. Avisa al autor de la publicacion madre, y SOLO por comentario: los likes no notifican. Ignora el auto-comentario, respeta el bloqueo bidireccional y se traga sus propios errores con RAISE WARNING, porque un aviso fallido no puede deshacer un comentario ya publicado. Desde 20260912240000 el mensaje lleva tildes (escapes U&).';

-- Las filas ya escritas con el texto sin tildes (en produccion hoy son cero).
UPDATE public.notifications
   SET mensaje = replace(mensaje, ' comento tu publicacion en ', U&' coment\00F3 tu publicaci\00F3n en ')
 WHERE tipo = 'comunidad_comentario'
   AND mensaje LIKE '% comento tu publicacion en %';


-- ===========================================================================
-- 5. RPC CON RETURNS NUEVO: DROP + CREATE con firma completa
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5.1 mis_comunidades -- anade puedo_entrar (true: soy miembro), disponible y
-- archivada; lista TAMBIEN las archivadas u ocultas donde sigo siendo miembro
-- vivo, despues de las vivas (G).
-- ---------------------------------------------------------------------------
drop function if exists public.mis_comunidades();
create function public.mis_comunidades()
returns table (
  id uuid, nombre text, descripcion text, mi_rol text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  soy_fundador boolean, es_privada boolean, soy_miembro boolean,
  solicitud_pendiente boolean, puedo_entrar boolean,
  disponible boolean, archivada boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE v_viewer UUID;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion, m.role,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         COALESCE(c.fundador_id = v_viewer, FALSE),
         c.es_privada, TRUE, FALSE, TRUE,
         (c.is_hidden = FALSE AND c.archived_at IS NULL),
         (c.archived_at IS NOT NULL)
    FROM community_members m
    JOIN communities c ON c.id = m.community_id
   WHERE m.user_id = v_viewer
     AND m.left_at IS NULL
   ORDER BY (c.is_hidden = FALSE AND c.archived_at IS NULL) DESC,
            c.ultima_publicacion_at DESC NULLS LAST, c.nombre ASC
   LIMIT public.comunidades_limite('membresias_vivas') + 10;
END;
$function$;

comment on function public.mis_comunidades() is
  'Directorio de mis comunidades, vivas primero y ordenadas por actividad con NULLS LAST; despues las archivadas u ocultas donde sigo siendo miembro vivo (disponible = false, archivada), que es la unica ruta desde la app para llegar a una archivada y salir. mi_rol responde "que mando tengo aqui" y soy_fundador "la funde yo". es_privada, soy_miembro (true), solicitud_pendiente (false) y puedo_entrar (true) salen para que la tarjeta comparta tipo con descubrir_comunidades y detalle_comunidad.';

-- ---------------------------------------------------------------------------
-- 5.2 descubrir_comunidades -- anade puedo_entrar (C). Cuerpo vivo.
-- ---------------------------------------------------------------------------
drop function if exists public.descubrir_comunidades(double precision, double precision, integer);
create function public.descubrir_comunidades(
  p_lat        double precision,
  p_lng        double precision,
  result_limit integer default 30
)
returns table (
  id uuid, nombre text, descripcion text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  distancia_m integer,
  es_privada boolean, soy_miembro boolean, mi_rol text, solicitud_pendiente boolean,
  puedo_entrar boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_lat    FLOAT;
  v_lng    FLOAT;
  v_punto  geography;
  v_limite INT;
  c_radio  CONSTANT INT := public.comunidades_limite('radio_descubrir_metros') + 100;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN RETURN; END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_descubrir'));

  v_lat := round(p_lat::numeric, 3)::FLOAT;
  v_lng := round(p_lng::numeric, 3)::FLOAT;
  v_punto := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         (CEIL(ST_Distance(c.centro, v_punto) / 500) * 500)::INT,
         c.es_privada,
         FALSE,
         NULL::text,
         EXISTS (SELECT 1 FROM community_join_requests r
                  WHERE r.community_id = c.id AND r.user_id = v_viewer
                    AND r.status = 'pendiente'),
         -- Solo sobre las <= 30 filas que salen: una sonda por fila.
         (NOT c.es_privada
          OR c.owner_id = v_viewer
          OR public.solicitud_aceptada_vigente(c.id, v_viewer))
    FROM communities c
   WHERE c.is_hidden   = FALSE
     AND c.archived_at IS NULL
     AND c.miembros_count > 0
     AND ST_DWithin(c.centro, v_punto, c_radio)
     AND NOT EXISTS (SELECT 1 FROM community_members m
                      WHERE m.community_id = c.id
                        AND m.user_id      = v_viewer
                        AND m.left_at IS NULL)
     AND (c.owner_id IS NULL OR NOT public.hay_bloqueo_con(c.owner_id))
   ORDER BY c.centro <-> v_punto, c.miembros_count DESC, c.id
   LIMIT v_limite;
END;
$function$;

comment on function public.descubrir_comunidades(double precision, double precision, integer) is
  'Comunidades a <=5 km que no son mias. Radio CONSTANTE, entrada snapeada a 100 m, salida en cubos de 500 m, sin paginacion por cursor. Devuelve es_privada, soy_miembro (false), mi_rol (null), solicitud_pendiente y puedo_entrar (publica, o mando, o pase vigente) para pintar Unete / Solicitar unirse / Solicitud enviada / Volver a entrar.';

-- ---------------------------------------------------------------------------
-- 5.3 detalle_comunidad -- anade puedo_entrar (C) y archivada (G). Cuerpo vivo.
-- ---------------------------------------------------------------------------
drop function if exists public.detalle_comunidad(uuid);
create function public.detalle_comunidad(p_community_id uuid)
returns table (
  id uuid, nombre text, descripcion text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  created_at timestamp with time zone,
  es_privada boolean, disponible boolean,
  soy_miembro boolean, mi_rol text, soy_fundador boolean, solicitud_pendiente boolean,
  puedo_entrar boolean, archivada boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_rol    TEXT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL OR p_community_id IS NULL THEN RETURN; END IF;

  SELECT m.role INTO v_rol
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.user_id = v_viewer AND m.left_at IS NULL;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         c.created_at,
         c.es_privada,
         (c.is_hidden = FALSE AND c.archived_at IS NULL),
         (v_rol IS NOT NULL),
         v_rol,
         COALESCE(c.fundador_id = v_viewer, FALSE),
         EXISTS (SELECT 1 FROM community_join_requests r
                  WHERE r.community_id = c.id AND r.user_id = v_viewer
                    AND r.status = 'pendiente'),
         (v_rol IS NOT NULL
          OR NOT c.es_privada
          OR c.owner_id = v_viewer
          OR public.solicitud_aceptada_vigente(c.id, v_viewer)),
         (c.archived_at IS NOT NULL)
    FROM communities c
   WHERE c.id = p_community_id
     AND (
       v_rol IS NOT NULL
       OR c.owner_id = v_viewer
       OR (c.is_hidden = FALSE AND c.archived_at IS NULL
           AND (c.owner_id IS NULL OR NOT public.hay_bloqueo_con(c.owner_id)))
     );
END;
$function$;

comment on function public.detalle_comunidad(uuid) is
  'Cabecera de /comunidades/[id]: la comunidad mas mi relacion con ella (soy_miembro, mi_rol, soy_fundador, solicitud_pendiente, disponible, puedo_entrar = la privacidad no me frena: miembro, publica, mando o pase vigente; archivada distingue el archivo del ocultado por moderacion). Cero filas si no existe, no esta disponible y no soy miembro ni mando, o hay bloqueo con quien manda: no es un oraculo de existencia.';


-- ===========================================================================
-- 6. GRANTS. Firma completa en cada REVOKE y GRANT; solo authenticated.
-- ===========================================================================
revoke execute on function public.comunidades_limite(text) from public, anon, authenticated;
grant  execute on function public.comunidades_limite(text) to authenticated;

revoke execute on function public.comunidad_bloqueo_con_mando(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.solicitud_aceptada_vigente(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.bloqueo_cancela_solicitudes_union() from public, anon, authenticated;

revoke execute on function public.resolver_solicitud_union(uuid, boolean) from public, anon, authenticated;
grant  execute on function public.resolver_solicitud_union(uuid, boolean) to authenticated;

revoke execute on function public.solicitudes_de_comunidad(uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.solicitudes_de_comunidad(uuid, timestamp with time zone, uuid, integer) to authenticated;

revoke execute on function public.alternar_membresia_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.alternar_membresia_comunidad(uuid) to authenticated;

revoke execute on function public.solicitar_union_comunidad(uuid, text) from public, anon, authenticated;
grant  execute on function public.solicitar_union_comunidad(uuid, text) to authenticated;

revoke execute on function public.editar_visibilidad_comunidad(uuid, boolean) from public, anon, authenticated;
grant  execute on function public.editar_visibilidad_comunidad(uuid, boolean) to authenticated;

revoke execute on function public.nombrar_moderador_comunidad(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.nombrar_moderador_comunidad(uuid, uuid) to authenticated;

revoke execute on function public.editar_centro_comunidad(uuid, double precision, double precision) from public, anon, authenticated;
grant  execute on function public.editar_centro_comunidad(uuid, double precision, double precision) to authenticated;

revoke execute on function public.notificar_comentario_de_comunidad() from public, anon, authenticated;

revoke execute on function public.mis_comunidades() from public, anon, authenticated;
grant  execute on function public.mis_comunidades() to authenticated;

revoke execute on function public.descubrir_comunidades(double precision, double precision, integer) from public, anon, authenticated;
grant  execute on function public.descubrir_comunidades(double precision, double precision, integer) to authenticated;

revoke execute on function public.detalle_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.detalle_comunidad(uuid) to authenticated;


-- ===========================================================================
-- 7. NINGUNA SOBRECARGA, el trigger enganchado y la policy reducida. Dentro de
--    la transaccion, para que la migracion no pueda entrar en verde a medias.
-- ===========================================================================
DO $sin_sobrecargas$
DECLARE duplicada text;
BEGIN
  SELECT string_agg(x.proname || ' x' || x.n, ', ' ORDER BY x.proname) INTO duplicada
    FROM (
      SELECT p.proname, count(*) AS n
        FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
       WHERE n2.nspname = 'public'
         AND p.proname IN (
           'comunidades_limite','comunidad_bloqueo_con_mando','solicitud_aceptada_vigente',
           'bloqueo_cancela_solicitudes_union','resolver_solicitud_union','solicitudes_de_comunidad',
           'alternar_membresia_comunidad','solicitar_union_comunidad','editar_visibilidad_comunidad',
           'nombrar_moderador_comunidad','editar_centro_comunidad','notificar_comentario_de_comunidad',
           'mis_comunidades','descubrir_comunidades','detalle_comunidad')
       GROUP BY p.proname
      HAVING count(*) <> 1
    ) x;
  IF duplicada IS NOT NULL THEN
    RAISE EXCEPTION 'hay sobrecargas donde tiene que haber una sola firma (%): PostgREST devolvera 300 PGRST203', duplicada;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.user_blocks'::regclass
                    AND tgname = 'bloqueo_cancela_solicitudes_union' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'el trigger bloqueo_cancela_solicitudes_union no quedo enganchado a user_blocks';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policies
              WHERE schemaname = 'public' AND tablename = 'community_join_requests'
                AND policyname = 'solicitudes: la mia, o las de la comunidad si la modero') THEN
    RAISE EXCEPTION 'la policy de moderador sobre community_join_requests sigue viva';
  END IF;

  -- El trigger de comentarios sigue enganchado tras el CREATE OR REPLACE.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.community_posts'::regclass
                    AND p.proname = 'notificar_comentario_de_comunidad' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'notificar_comentario_de_comunidad perdio su trigger en community_posts';
  END IF;
END
$sin_sobrecargas$;

-- Sin esto PostgREST sigue sirviendo el esquema viejo.
notify pgrst, 'reload schema';

-- (fin del archivo: el COMMIT lo pone apply-migration.mjs)

-- ===========================================================================
-- VERIFY -- ejercido contra el proyecto de pruebas el 12-sep-2026 (arnes
-- scratchpad/m5-verify.sql, cada bloque bajo BEGIN ... ROLLBACK con
-- SET LOCAL ROLE authenticated y request.jwt.claims). Sustituir los uuids.
-- ===========================================================================
--
-- ---- A. PRIVILEGIOS -------------------------------------------------------
--   SELECT has_function_privilege('authenticated','public.comunidad_bloqueo_con_mando(uuid,uuid)','EXECUTE'), -- false
--          has_function_privilege('authenticated','public.solicitud_aceptada_vigente(uuid,uuid)','EXECUTE'),  -- false
--          has_function_privilege('anon','public.detalle_comunidad(uuid)','EXECUTE');                          -- false
--   SELECT count(*) FROM pg_policies WHERE tablename = 'community_join_requests';                             -- 1 ('solicitudes: la mia')
--
-- ---- C. LOS CASOS ---------------------------------------------------------
--   -- C1 (A). A funda privada, B es moderador, E solicita, A bloquea a E:
--   --   la pendiente de E queda 'cancelada' (trigger); B no la ve en la cola;
--   --   si se reabre a mano, B acepta -> P0002 'Esa solicitud ya no se puede
--   --   aceptar.'; E no queda miembro. Simetrico: C solicita y bloquea a A ->
--   --   cancelada; B acepta a mano -> P0002.
--   -- C2 (B). Como owner, GET REST community_join_requests de su comunidad -> 0
--   --   filas (solo las propias); como solicitante, su propia fila -> 1.
--   -- C3 (C). A acepta a B; B sale; B solicita; A RECHAZA; B alternar -> 42501
--   --   'Esta comunidad es privada...'. Sin el rechazo: B alternar -> entra.
--   --   detalle_comunidad(B) tras salir -> puedo_entrar = true; solicitar ->
--   --   22023 'Ya te aceptaron...' y el ledger NO crece.
--   -- C4 (D). Privada con pendiente de B; A la abre -> pendiente 'cancelada';
--   --   detalle(B) solicitud_pendiente=false; B alternar -> entra.
--   -- C5 (E). 10 nombramientos (ciclos quitar/nombrar) -> el 11o 23514 'Solo
--   --   puedes nombrar 10 moderadores en 24 horas.'; ledger 'moderador' = 10.
--   -- C6 (F). 'Uno' en (19.04,-98.21); 'Dos' fundada en (19.05,-98.21);
--   --   editar_centro(Dos, 19.0449, -98.206) -> 23514 'Ya tienes otra
--   --   comunidad a menos de 1 km de ahi.'; celda de Dos intacta.
--   -- C7 (G). Owner unico con publicacion sale -> {soy_miembro:false,
--   --   miembros_count:0, archivada:true}. Miembro vivo de una archivada:
--   --   mis_comunidades la lista con disponible=false, archivada=true, al
--   --   final; detalle_comunidad archivada=true.
--   -- C8 (H). B comenta la publicacion de A -> notifications.mensaje =
--   --   'B coment\00F3 tu publicaci\00F3n en <nombre>' (con tildes; el
--   --   archivo sigue en ASCII).
--
-- ---- G. Y AL FINAL, SIEMPRE -----------------------------------------------
--   NOTIFY pgrst, 'reload schema';
--   Y fuera de la base: regenerar apps/web/types/database.types.ts DESDE
--   PRODUCCION tras aplicar (detalle_comunidad, descubrir_comunidades y
--   mis_comunidades cambian de RETURNS).
-- ===========================================================================
