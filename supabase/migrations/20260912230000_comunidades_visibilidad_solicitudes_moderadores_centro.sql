-- Comunidades hiperlocales -- ARCHIVO 4: visibilidad, solicitudes de union,
-- moderadores, mover el centro y la cuota de fundacion visible.
--
-- Cierra las decisiones de producto 3, 4, 5, 6, 7 y 10 del 6-sep-2026 (Pedro y
-- Alejandro). Orden de aplicacion OBLIGATORIO, y este archivo lo comprueba en
-- su preflight:
--
--   1. 20260912200000_comunidades_base.sql
--   2. 20260912210000_comunidades_report_target.sql   <-- COMMIT
--   3. 20260912220000_comunidades_moderacion.sql
--   4. 20260912230000_comunidades_visibilidad_solicitudes_moderadores_centro.sql (ESTE)
--
-- Va en archivo APARTE de los tres ya revisados y no reabre ninguno: lo que
-- cambia de sus funciones se recrea aqui con CREATE OR REPLACE copiando el
-- cuerpo vivo y anadiendo SOLO lo nuevo, que es la misma regla con la que el
-- archivo 3 parcheo delete_user_data. Es idempotente de punta a punta (add
-- column if not exists, drop policy if exists, create or replace, drop function
-- if exists para las cinco que cambian de RETURNS) y no lleva begin/commit
-- propios: apply-migration.mjs lo envuelve entero en UNA transaccion con su fila
-- del ledger.
--
-- ---------------------------------------------------------------------------
-- A. VISIBILIDAD -- POR QUE
--
-- Decision 4: una comunidad nace PUBLICA y cerrarla es un acto deliberado. Por
-- eso es_privada es NOT NULL DEFAULT false y solo la cambia una RPC del owner.
-- Decision 3: en una comunidad publica ajena se VEN las publicaciones sin
-- pertenecer (y el boton dice "Unete"); en una privada ajena no se lee nada (y
-- el boton dice "Solicitar unirse").
--
-- Eso obliga a abrir tres cerrojos que hoy exigen pertenencia: la policy del
-- muro (REST), feed_muro_comunidad (la pagina) y puedo_ver_publicacion (el
-- hilo y las reacciones). La policy se abre SIN convertirla en una llamada por
-- fila: la pertenencia ya se resolvia una vez por consulta con
-- mis_comunidades_ids() como SubPlan hasheado, y el conjunto de comunidades
-- publicas vivas se resuelve igual con un segundo helper sin argumentos,
-- comunidades_publicas_ids(). Los dos son "IN (select f())", que es la forma
-- que el planificador convierte en un hash de una sola ejecucion. Se midio con
-- EXPLAIN antes de darla por buena (bloque VERIFY, E1).
--
-- LEER es publico; ESCRIBIR sigue exigiendo pertenencia. publicar_en_comunidad
-- ya lo exigia por su cuenta y no se toca. alternar_like_publicacion NO: se
-- apoyaba solo en puedo_ver_publicacion, y al abrir ese helper a las publicas
-- una cuenta sin pertenecer podria subir likes_count de un barrio ajeno. Se
-- recrea con una sola linea nueva: reaccionar exige pertenencia.
--
-- Entrar DIRECTO a una privada se rechaza en alternar_membresia_comunidad
-- (42501) salvo solicitud aceptada o que quien entra tenga el mando (owner_id).
-- Salir sigue siendo siempre posible: es la unica salida que existe (C-2).
--
-- ---------------------------------------------------------------------------
-- B. SOLICITUDES -- POR QUE UNA TABLA NUEVA Y NO UN ESTADO EN community_members
--
-- Reutilizar community_members con un status 'pendiente' rompia dos cosas a la
-- vez: el trigger comunidad_cuenta_miembros (contaria pendientes como miembros)
-- y el tope de 20 membresias vivas (una solicitud gastaria una plaza). Y
-- confundiria la cuota de altas por 24 h, que cuenta joined_at. Una solicitud
-- no es una membresia: tiene su ciclo (pendiente -> aceptada | rechazada |
-- cancelada), su cola por comunidad y su cola por persona.
--
-- Sin policies de escritura: todo entra por RPC SECURITY DEFINER, que es donde
-- viven la cuota anti-spam (10 solicitudes en 24 h, en el MISMO ledger
-- append-only community_post_quota con el tipo 'solicitud': cancelar y volver
-- a pedir GASTA cuota, porque se cuentan eventos y no filas vivas), el bloqueo
-- bidireccional con quien manda y la guardia de suspension -- la sexta
-- superficie de escritura publica.
--
-- Al aceptar se inserta la membresia con las MISMAS reglas de tope que la rama
-- ENTRAR de alternar_membresia_comunidad: si quien pidio ya tiene 20 vivas, la
-- aceptacion falla con 23514 y la solicitud se queda pendiente. La ventana de
-- 10 altas por 24 h NO se aplica al aceptar: esa cuota frena la cosecha de
-- muros por unirse-volcar-salir, y una privada ya exige aprobacion humana; ademas
-- se la cobrarian al moderador que acepta por algo que hizo otra persona.
--
-- Notificaciones en las dos direcciones, con la forma EXACTA de
-- notificar_comentario_de_comunidad (user_id, tipo, titulo, mensaje, data,
-- leida, created_at; el deep link viaja en data como community_id + request_id
-- y lo resuelve getNotificationHref por tipo). Un aviso fallido nunca deshace
-- la solicitud: van por un helper que se traga sus errores con RAISE WARNING.
--
-- DOBLE TOQUE: solicitar dos veces es IDEMPOTENTE, no 23505. Devuelve la misma
-- solicitud pendiente sin gastar cuota, por el mismo motivo que
-- alternar_membresia y alternar_like: en una conexion lenta el doble toque es
-- lo primero que golpea esto, y un 23505 en la cara de la persona se lee como
-- error. El indice unico parcial sigue existiendo por debajo como cinturon
-- contra cualquier camino que no sea la RPC.
--
-- ---------------------------------------------------------------------------
-- C. MODERADORES -- POR QUE HAY TOPE
--
-- Decision 5: aprueban el mando (owner) y los moderadores, y nombrar
-- moderadores entra en v1. Sin tope, 500 moderadores son 500 notificaciones por
-- cada solicitud: moderadores_por_comunidad = 5. Solo el owner nombra y quita;
-- el nombrado tiene que ser miembro vivo. Al salir, el rol ya vuelve a 'member'
-- (alternar_membresia_comunidad lo escribe junto a left_at); al borrar la
-- cuenta la fila desaparece entera (delete_user_data y la cascada), y
-- comunidad_traspasa_mando solo PROMUEVE al relevo: nunca deja un rol colgado.
-- Se verifico leyendo los tres caminos; no habia nada que cubrir.
--
-- ---------------------------------------------------------------------------
-- D. MOVER EL CENTRO -- POR QUE EL LIMITE SE MIDE CONTRA EL PUNTO PEDIDO
--
-- Decision 6: solo quien manda, y a lo sumo 1 km desde el centro de FUNDACION:
-- corrige un dedazo, no muda el barrio. El centro de fundacion es una columna
-- nueva, centro_fundacion, que el trigger comunidad_normaliza fija en el INSERT
-- y congela despues.
--
-- HAY UNA ARITMETICA QUE OBLIGA A DECIDIR COMO SE MIDE. El centro guardado vive
-- en la rejilla de 2 decimales (decision 7 y el CHECK communities_centro_en_
-- rejilla): dos puntos de rejilla DISTINTOS nunca estan a menos de ~1.05 km
-- (0.01 grados de longitud a 19 grados de latitud) y en latitud a 1.11 km. O sea
-- que si el limite se midiera entre el centro guardado viejo y el nuevo, "mover
-- hasta 1 km" no permitiria mover nunca. Por eso el limite se mide contra el
-- punto PEDIDO (p_lat, p_lng, crudo) y lo que se guarda es su redondeo: puedes
-- declarar el centro en cualquier punto a <= 1 km del de fundacion, y la base lo
-- snapea a la celda que le toca. El punto crudo no se persiste en ningun sitio,
-- asi que la privacidad del diseno no cambia. Con eso, un punto a 900 m al norte
-- entra (y cae en la celda vecina) y uno a 1.5 km no.
--
-- comunidad_normaliza congela el centro en cualquier UPDATE. Se abre SOLO el
-- camino de esta RPC con una variable de sesion local a la transaccion,
-- set_config('vicino.mover_centro', <id>, true), que el trigger compara con
-- OLD.id: un UPDATE de mantenimiento que no la ponga sigue viendo el centro
-- congelado. Cuota centros_24h = 2 en el ledger. El UPDATE puede chocar con
-- uq_communities_celda_nombre si en la celda destino ya hay una comunidad con
-- el mismo nombre_norm: se atrapa el 23505 y se devuelve un mensaje legible.
--
-- ---------------------------------------------------------------------------
-- E. CUOTA DE FUNDACION VISIBLE -- POR QUE UN HELPER
--
-- Decision 10: el boton de fundar se deshabilita con el tiempo que falta, no
-- con un toast tras el fallo. estado_cuota_fundacion() calcula lo mismo que
-- fundar_comunidad con los MISMOS contadores, y para que no haya dos copias que
-- deriven, las tres cuotas que no dependen del punto (A vivas, B ventana de
-- 24 h, D tope de membresias) se extraen a comunidad_fundacion_estado(uuid) y
-- fundar_comunidad la llama tambien. La CUOTA C (separacion de 1 km entre las
-- propias) depende del punto y se queda dentro de fundar_comunidad.
-- ---------------------------------------------------------------------------

-- (sin begin/commit propios: apply-migration.mjs envuelve el archivo entero en UNA transaccion junto con su fila del ledger)

-- ===========================================================================
-- 0. PREFLIGHT
-- ===========================================================================
DO $preflight$
DECLARE cuerpo text;
BEGIN
  IF to_regclass('public.community_post_quota') IS NULL THEN
    RAISE EXCEPTION 'falta aplicar 20260912200000_comunidades_base.sql: no existe public.community_post_quota'
      USING ERRCODE = '42P01';
  END IF;
  IF to_regprocedure('public.comunidad_traspasa_mando(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta aplicar 20260912200000_comunidades_base.sql: no existe comunidad_traspasa_mando(uuid, uuid)'
      USING ERRCODE = '42883';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typname = 'report_target_type' AND e.enumlabel = 'community_post'
  ) THEN
    RAISE EXCEPTION 'falta aplicar 20260912210000_comunidades_report_target.sql'
      USING ERRCODE = '42704';
  END IF;
  -- delete_user_data se recrea aqui copiando el cuerpo del archivo 3: si ese
  -- archivo no esta, el CREATE OR REPLACE de abajo pisaria la version sin
  -- comunidades y dejaria el log de cumplimiento mintiendo por omision.
  SELECT pg_get_functiondef(p.oid) INTO cuerpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_user_data';
  IF cuerpo IS NULL OR position('community_post_quota' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'falta aplicar 20260912220000_comunidades_moderacion.sql: delete_user_data no conoce comunidades'
      USING ERRCODE = '42883';
  END IF;
END
$preflight$;


-- ===========================================================================
-- 1. COLUMNAS NUEVAS EN communities
-- ===========================================================================

-- A. Visibilidad. Dato de PRODUCTO (se pinta en la tarjeta), asi que recibe su
-- GRANT SELECT por columna en la MISMA migracion: communities tiene grants por
-- columna y una columna sin grant rompe todo SELECT que la incluya (42501).
-- Nada de UPDATE por REST: se cambia solo por editar_visibilidad_comunidad.
alter table public.communities
  add column if not exists es_privada boolean not null default false;

comment on column public.communities.es_privada is
  'false = publica (default, decision 4): el muro se lee sin pertenecer. true = privada: el muro exige pertenencia y entrar exige solicitud aceptada. Solo la cambia editar_visibilidad_comunidad (owner). Concedida a authenticated para pintar la tarjeta.';

grant select (es_privada) on public.communities to authenticated;

-- D. Centro de fundacion. Lo fija el trigger en el INSERT (copia del centro ya
-- redondeado) y queda congelado. NULL solo puede significar "fila anterior a
-- esta columna" y el propio trigger la rellena en el primer UPDATE; el backfill
-- de abajo lo hace ya para las existentes (hoy en produccion no hay ninguna).
-- NO se concede a ningun rol: es control, y ademas es posicion absoluta.
alter table public.communities
  add column if not exists centro_fundacion geography(POINT, 4326);

comment on column public.communities.centro_fundacion is
  'Centro con el que se fundo, ya en la rejilla de ~1.1 km. Lo fija comunidad_normaliza en el INSERT y lo congela despues. Es el punto contra el que editar_centro_comunidad mide el limite de 1 km. NO concedido a ningun rol.';

alter table public.communities drop constraint if exists communities_centro_fundacion_en_rejilla;
alter table public.communities add constraint communities_centro_fundacion_en_rejilla
  check (
    centro_fundacion is null or (
      abs(ST_X(centro_fundacion::geometry) - round(ST_X(centro_fundacion::geometry)::numeric, 2)::double precision) < 1e-9
      and abs(ST_Y(centro_fundacion::geometry) - round(ST_Y(centro_fundacion::geometry)::numeric, 2)::double precision) < 1e-9
    )
  );

-- Justifica: comunidades_publicas_ids(), el helper de la policy del muro. Es un
-- Index Only Scan del conjunto "publica y viva", que crece con el numero de
-- comunidades del producto y no con el de publicaciones.
create index if not exists idx_communities_publicas
  on public.communities (id)
  where is_hidden = false and archived_at is null and es_privada = false;


-- ===========================================================================
-- 2. LOS TOPES NUEVOS, EN EL UNICO SITIO DONDE VIVEN LOS TOPES
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
         ELSE NULL
       END;
  IF v IS NULL THEN
    RAISE EXCEPTION 'limite desconocido: %', p_clave USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$function$;

comment on function public.comunidades_limite(text) is
  'Tabla de cuotas del producto, en un solo sitio. membresias_vivas x pagina_muro = 600 es la cota dura del fan-out del muro unificado. Desde 20260912230000 incluye solicitudes_union_24h, moderadores_por_comunidad, centros_24h, centro_radio_metros y pagina_solicitudes. Una clave desconocida lanza 22023 a proposito.';

-- El ledger de cuotas admite dos tipos mas. Es append-only, asi que rehacer el
-- CHECK revalida filas que ya cumplian.
alter table public.community_post_quota drop constraint if exists community_post_quota_tipo_valido;
alter table public.community_post_quota add constraint community_post_quota_tipo_valido
  check (tipo in ('publicacion','comentario','reaccion','descripcion','solicitud','centro'));

comment on column public.community_post_quota.tipo is
  'publicacion | comentario | reaccion | descripcion | solicitud | centro. Los topes viven en comunidades_limite(): publicaciones_24h, comentarios_24h, reacciones_24h, descripciones_24h, solicitudes_union_24h y centros_24h.';


-- ===========================================================================
-- 3. community_join_requests
-- ===========================================================================
create table if not exists public.community_join_requests (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id)    on delete cascade,
  status       text not null default 'pendiente',
  mensaje      text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles(id) on delete set null
);

alter table public.community_join_requests enable row level security;

alter table public.community_join_requests drop constraint if exists community_join_requests_status_valido;
alter table public.community_join_requests add constraint community_join_requests_status_valido
  check (status in ('pendiente','aceptada','rechazada','cancelada'));

alter table public.community_join_requests drop constraint if exists community_join_requests_mensaje_largo;
alter table public.community_join_requests add constraint community_join_requests_mensaje_largo
  check (mensaje is null or char_length(mensaje) <= 200);

comment on table public.community_join_requests is
  'Solicitudes para entrar a una comunidad privada. Se escribe SOLO por RPC (solicitar_union_comunidad, cancelar_solicitud_union, resolver_solicitud_union). Una sola pendiente por (community_id, user_id). NO reutiliza community_members con un estado: romperia comunidad_cuenta_miembros y el tope de 20.';
comment on column public.community_join_requests.resolved_by is
  'Quien acepto o rechazo. NO concedida a authenticated: quien pidio no tiene por que saber que moderador lo rechazo. delete_user_data la anula al borrar esa cuenta.';

-- Una sola pendiente por persona y comunidad. Es el cinturon; la RPC es
-- idempotente por encima y devuelve la existente.
create unique index if not exists uq_community_join_requests_pendiente
  on public.community_join_requests (community_id, user_id)
  where status = 'pendiente';

-- La cola de una comunidad, paginada por (created_at desc, id desc) con cursor
-- de tupla. community_id de prefijo: cubre tambien la FK y su cascada.
create index if not exists idx_community_join_requests_cola
  on public.community_join_requests (community_id, status, created_at desc, id desc);

-- La cola de una persona (mis_solicitudes_union) y la FK user_id.
create index if not exists idx_community_join_requests_persona
  on public.community_join_requests (user_id, created_at desc);

-- La FK resolved_by (regla de 20260827140000: ninguna FK sin indice). Parcial
-- porque casi todas las filas pendientes lo tienen en NULL.
create index if not exists idx_community_join_requests_resolutor
  on public.community_join_requests (resolved_by)
  where resolved_by is not null;

-- Policies de SELECT: la propia; y las de la comunidad para owner/moderadores.
-- es_moderador_de_comunidad(community_id) se evalua solo para filas ajenas (el
-- OR corta antes en las propias), igual que en la policy de membresias.
drop policy if exists "solicitudes: la mia, o las de la comunidad si la modero" on public.community_join_requests;
create policy "solicitudes: la mia, o las de la comunidad si la modero"
  on public.community_join_requests for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.es_moderador_de_comunidad(community_id)
    or (select public.has_role((select auth.uid()), 'admin'::app_role))
  );

-- Sin policies de escritura y sin GRANT de escritura: todo por RPC.
revoke all on public.community_join_requests from public, anon, authenticated;
grant select (id, community_id, user_id, status, mensaje, created_at, resolved_at)
  on public.community_join_requests to authenticated;
-- resolved_by queda FUERA. Consecuencia conocida: select("*") sobre esta tabla
-- muere con 42501; el cliente usa las dos RPC de lectura.


-- ===========================================================================
-- 4. EL TRIGGER comunidad_normaliza APRENDE centro_fundacion Y ABRE UN SOLO
--    CAMINO PARA MOVER EL CENTRO
--
-- Cuerpo VIVO de 20260912200000 (seccion 4.1) mas tres cosas: (1) en el INSERT
-- fija centro_fundacion desde el centro ya normalizado; (2) en el UPDATE lo
-- congela, salvo que OLD lo tenga en NULL (fila anterior a la columna), en cuyo
-- caso lo rellena con el centro que ya tenia; (3) el centro sigue congelado en
-- todo UPDATE salvo cuando la variable de sesion vicino.mover_centro vale el id
-- de ESTA fila, que solo la pone editar_centro_comunidad y solo dentro de su
-- transaccion.
-- ===========================================================================
create or replace function public.comunidad_normaliza()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_acentos CONSTANT TEXT := chr(225)||chr(224)||chr(226)||chr(228)||chr(233)||chr(232)||chr(234)||chr(235)||chr(237)||chr(236)||chr(238)||chr(239)||chr(243)||chr(242)||chr(244)||chr(246)||chr(250)||chr(249)||chr(251)||chr(252)||chr(241)||chr(231);
  v_llanos  CONSTANT TEXT := 'aaaaeeeeiiiioooouuuunc';
  v_mover   BOOLEAN;
BEGIN
  NEW.nombre      := btrim(NEW.nombre);
  NEW.nombre_norm := regexp_replace(
                       translate(lower(NEW.nombre), v_acentos, v_llanos),
                       '[^a-z0-9]+', '', 'g');
  IF NEW.nombre_norm = '' THEN
    NEW.nombre_norm := md5(lower(btrim(NEW.nombre)));
  END IF;

  NEW.celda       := round(ST_Y(NEW.centro::geometry)::numeric, 2)::text || ',' ||
                     round(ST_X(NEW.centro::geometry)::numeric, 2)::text;
  NEW.updated_at  := now();

  IF TG_OP = 'INSERT' THEN
    NEW.fundador_id := COALESCE(NEW.fundador_id, NEW.owner_id);
    NEW.is_hidden   := FALSE;
    NEW.archived_at := NULL;
    -- El centro de fundacion es el centro con el que nace, ya redondeado por
    -- fundar_comunidad y verificado por los dos CHECK de rejilla. Se ignora lo
    -- que mande el INSERT: nadie elige un centro de fundacion distinto del
    -- centro.
    NEW.centro_fundacion := NEW.centro;
  ELSE
    IF NEW.fundador_id IS NOT NULL THEN
      NEW.fundador_id := OLD.fundador_id;
    END IF;
    NEW.nombre      := OLD.nombre;
    NEW.nombre_norm := OLD.nombre_norm;

    -- EL UNICO CAMINO PARA MOVER EL CENTRO. current_setting con missing_ok
    -- devuelve NULL si nadie la puso, y IS DISTINCT FROM trata ese NULL como
    -- "no coincide". editar_centro_comunidad la pone con set_config(..., true),
    -- que muere con la transaccion, y la vacia antes de terminar.
    v_mover := current_setting('vicino.mover_centro', true) IS NOT DISTINCT FROM OLD.id::text;
    IF NOT v_mover THEN
      NEW.centro := OLD.centro;
      NEW.celda  := OLD.celda;
    END IF;

    -- centro_fundacion se congela; si la fila es anterior a la columna (OLD en
    -- NULL) se rellena con el centro que YA tenia, no con el nuevo.
    IF OLD.centro_fundacion IS NOT NULL THEN
      NEW.centro_fundacion := OLD.centro_fundacion;
    ELSE
      NEW.centro_fundacion := OLD.centro;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

comment on function public.comunidad_normaliza() is
  'BEFORE INSERT OR UPDATE en communities. Deriva nombre_norm (md5 cuando la normalizacion daria cadena vacia) y celda del centro, fija fundador_id y centro_fundacion en el INSERT, y CONGELA nombre, nombre_norm, centro, celda y centro_fundacion en cualquier UPDATE. El centro se deja mover SOLO cuando la variable de sesion vicino.mover_centro vale el id de la fila (la pone editar_centro_comunidad dentro de su transaccion). fundador_id se congela contra el RE-APUNTADO, no contra el vaciado del ON DELETE SET NULL.';

-- Backfill de centro_fundacion para filas anteriores a la columna. Guardado por
-- WHERE para que la segunda pasada no toque nada. Dispara el trigger de arriba,
-- que deja pasar el valor porque OLD.centro_fundacion es NULL.
update public.communities set centro_fundacion = centro where centro_fundacion is null;


-- ===========================================================================
-- 5. HELPERS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5.1 comunidades_publicas_ids: el conjunto "publica y viva", resuelto UNA vez
-- por consulta. Mismo molde que mis_comunidades_ids(): sin argumentos, SETOF
-- para que la policy lo consuma como "IN (select ...)" y se planifique como
-- SubPlan hasheado. No revela nada que la policy del directorio de communities
-- no revele ya (toda comunidad viva es visible a cualquier authenticated).
-- ---------------------------------------------------------------------------
create or replace function public.comunidades_publicas_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select c.id
    from public.communities c
   where c.is_hidden = false
     and c.archived_at is null
     and c.es_privada = false;
$function$;

comment on function public.comunidades_publicas_ids() is
  'Ids de las comunidades publicas y vivas. Existe para que la policy de community_posts deje leer el muro de una publica sin pertenecer resolviendolo UNA vez por consulta (SubPlan hasheado), igual que mis_comunidades_ids() resuelve la pertenencia.';

-- ---------------------------------------------------------------------------
-- 5.2 puedo_ver_publicacion admite las publicas. Misma definicion de "ver" que
-- consumen comentarios_de_publicacion (el hilo) y alternar_like_publicacion
-- (que ademas exige pertenencia por su cuenta desde este archivo).
-- ---------------------------------------------------------------------------
create or replace function public.puedo_ver_publicacion(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_posts p
      join public.communities     c on c.id = p.community_id
     where p.id = p_post_id
       and p.is_hidden   = false
       and c.is_hidden   = false
       and c.archived_at is null
       and (
         c.es_privada = false
         or exists (select 1 from public.community_members m
                     where m.community_id = p.community_id
                       and m.user_id      = (select auth.uid())
                       and m.left_at is null)
       )
       and not public.autor_vetado_para_mi(p.author_id)
  );
$function$;

comment on function public.puedo_ver_publicacion(uuid) is
  'Comunidad viva y visible + (publica, o pertenencia) + publicacion no oculta + autor no vetado. Es la unica definicion de "ver": la consumen comentarios_de_publicacion y alternar_like_publicacion, que desde 20260912230000 exige ademas pertenencia para reaccionar.';

-- ---------------------------------------------------------------------------
-- 5.3 comunidad_notifica: la forma EXACTA de insertar en notifications que usa
-- notificar_comentario_de_comunidad, en un solo sitio, tragandose sus errores:
-- un aviso fallido nunca deshace la solicitud ni el nombramiento. No se
-- concede a nadie.
-- ---------------------------------------------------------------------------
create or replace function public.comunidad_notifica(
  p_user_id uuid, p_tipo text, p_titulo text, p_mensaje text, p_data jsonb
)
returns void
language plpgsql
volatile security definer
set search_path to ''
as $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, data, leida, created_at)
  VALUES (p_user_id, p_tipo, p_titulo, p_mensaje, COALESCE(p_data, '{}'::jsonb), false, now());
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'no se pudo notificar % a %: % (%)', p_tipo, p_user_id, SQLERRM, SQLSTATE;
END;
$function$;

comment on function public.comunidad_notifica(uuid, text, text, text, jsonb) is
  'Inserta en notifications con la misma forma que notificar_comentario_de_comunidad y se traga sus errores con RAISE WARNING. Tipos: comunidad_solicitud (a owner/moderadores; data: community_id, request_id, user_id), comunidad_solicitud_resuelta (a quien pidio; data: community_id, request_id, aceptada) y comunidad_moderador (al nombrado; data: community_id). No concedida a nadie.';

-- ---------------------------------------------------------------------------
-- 5.4 comunidad_fundacion_estado: las tres cuotas de fundar que NO dependen del
-- punto, en un solo sitio, para que fundar_comunidad y estado_cuota_fundacion
-- no puedan divergir. Devuelve el motivo con el MISMO texto que fundar_comunidad
-- lanzaba antes. No se concede a nadie: la envuelven dos RPC DEFINER.
-- ---------------------------------------------------------------------------
create or replace function public.comunidad_fundacion_estado(p_viewer uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_tope_vivas INT := public.comunidades_limite('comunidades_fundadas_vivas');
  v_tope_24h   INT := public.comunidades_limite('comunidades_fundadas_24h');
  v_tope_memb  INT := public.comunidades_limite('membresias_vivas');
  v_vivas      INT;
  v_recientes  INT;
  v_membresias INT;
  v_siguiente  TIMESTAMPTZ;
BEGIN
  -- CUOTA A: cuantas tiene vivas (sobre fundador_id, que es inmutable).
  SELECT count(*) INTO v_vivas
    FROM communities c WHERE c.fundador_id = p_viewer AND c.archived_at IS NULL;
  IF v_vivas >= v_tope_vivas THEN
    RETURN jsonb_build_object(
      'puede_fundar', false,
      'motivo', format('Ya fundaste %s comunidades. Archiva una para fundar otra.', v_tope_vivas),
      'siguiente_en', NULL,
      'fundadas_vivas', v_vivas, 'tope_vivas', v_tope_vivas);
  END IF;

  -- CUOTA B: ventana de 24 h, contando TAMBIEN las archivadas.
  SELECT count(*) INTO v_recientes
    FROM communities c
   WHERE c.fundador_id = p_viewer AND c.created_at > now() - interval '24 hours';
  IF v_recientes >= v_tope_24h THEN
    -- Cuando cae la fundacion mas antigua de la ventana, vuelve a haber hueco.
    SELECT c.created_at + interval '24 hours' INTO v_siguiente
      FROM communities c
     WHERE c.fundador_id = p_viewer AND c.created_at > now() - interval '24 hours'
     ORDER BY c.created_at ASC
     OFFSET GREATEST(v_recientes - v_tope_24h, 0) LIMIT 1;
    RETURN jsonb_build_object(
      'puede_fundar', false,
      'motivo', 'Solo puedes fundar una comunidad cada 24 horas.',
      'siguiente_en', v_siguiente,
      'fundadas_vivas', v_vivas, 'tope_vivas', v_tope_vivas);
  END IF;

  -- CUOTA D: fundar tambien ocupa una membresia. MISMO conteo que la rama
  -- ENTRAR de alternar_membresia_comunidad.
  SELECT count(*) INTO v_membresias
    FROM community_members m
    JOIN communities c ON c.id = m.community_id
   WHERE m.user_id = p_viewer AND m.left_at IS NULL
     AND c.is_hidden = FALSE AND c.archived_at IS NULL;
  IF v_membresias >= v_tope_memb THEN
    RETURN jsonb_build_object(
      'puede_fundar', false,
      'motivo', format('Ya perteneces a %s comunidades. Sal de alguna para fundar otra.', v_tope_memb),
      'siguiente_en', NULL,
      'fundadas_vivas', v_vivas, 'tope_vivas', v_tope_vivas);
  END IF;

  RETURN jsonb_build_object(
    'puede_fundar', true, 'motivo', NULL, 'siguiente_en', NULL,
    'fundadas_vivas', v_vivas, 'tope_vivas', v_tope_vivas);
END;
$function$;

comment on function public.comunidad_fundacion_estado(uuid) is
  'Cuotas A (vivas), B (24 h) y D (membresias) de fundar_comunidad, en un solo sitio para que estado_cuota_fundacion() y fundar_comunidad() no diverjan. La CUOTA C (separacion) depende del punto y vive en fundar_comunidad. No concedida a nadie.';


-- ===========================================================================
-- 6. LA POLICY DEL MURO ADMITE LAS PUBLICAS
--
-- Mismo cuerpo que el vivo, con un OR dentro del bloque de pertenencia. Las dos
-- ramas son "IN (select helper())" sin correlacion, o sea dos SubPlan hasheados
-- que corren UNA vez por consulta. Lo que sigue dependiendo de la fila (el
-- EXISTS sobre communities por su PK y autor_vetado_para_mi) ya lo hacia
-- antes y solo se evalua sobre las filas que pasan los hashes.
-- ===========================================================================
drop policy if exists "publicaciones: solo dentro de mi comunidad" on public.community_posts;
create policy "publicaciones: solo dentro de mi comunidad"
  on public.community_posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (select public.has_role((select auth.uid()), 'admin'::app_role))
    or (select public.has_role((select auth.uid()), 'moderator'::app_role))
    or (
      is_hidden = false
      and (
        community_id in (select public.mis_comunidades_ids())
        or community_id in (select public.comunidades_publicas_ids())
      )
      and not public.autor_vetado_para_mi(author_id)
      and exists (
        select 1 from public.communities c
         where c.id = community_posts.community_id
           and c.is_hidden = false
           and c.archived_at is null
      )
    )
  );


-- ===========================================================================
-- 7. LAS RPC
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7.1 editar_visibilidad_comunidad -- solo owner; guardia de suspension;
-- idempotente (poner el valor que ya tiene no falla ni gasta nada).
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

  RETURN jsonb_build_object('id', p_community_id, 'es_privada', p_privada);
END;
$function$;

comment on function public.editar_visibilidad_comunidad(uuid, boolean) is
  'Cambia es_privada. Solo el mando (owner en su fila viva), cuenta no suspendida, comunidad no archivada. Idempotente: pedir el valor que ya tiene no hace nada.';

-- ---------------------------------------------------------------------------
-- 7.2 feed_muro_comunidad -- cambia el RETURNS (community_es_privada), asi que
-- DROP + CREATE. Cuerpo vivo mas: la pertenencia solo se exige si es privada, y
-- un no miembro con bloqueo con quien manda no lee el muro publico (mismo
-- criterio que descubrir_comunidades).
-- ---------------------------------------------------------------------------
drop function if exists public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer);
create function public.feed_muro_comunidad(
  p_community_id uuid,
  cursor_time    timestamp with time zone default null::timestamp with time zone,
  cursor_id      uuid                     default null::uuid,
  result_limit   integer                  default 30
)
returns table (
  id uuid, community_id uuid, community_nombre text, community_es_privada boolean,
  author_id uuid, author_nombre text, author_foto text, author_trust_level text,
  cuerpo text, created_at timestamp with time zone,
  likes_count integer, comentarios_count integer, le_di_like boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer  UUID;
  v_limite  INT;
  v_nombre  TEXT;
  v_privada BOOLEAN;
  v_owner   UUID;
  v_miembro BOOLEAN;
  v_vetados UUID[];
BEGIN
  v_viewer := (SELECT auth.uid());

  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time y cursor_id se mandan juntos o no se mandan'
      USING ERRCODE = '22023';
  END IF;

  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  SELECT c.nombre, c.es_privada, c.owner_id INTO v_nombre, v_privada, v_owner
    FROM communities c
   WHERE c.id = p_community_id
     AND c.is_hidden = FALSE
     AND c.archived_at IS NULL;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  v_miembro := public.es_miembro_de_comunidad(p_community_id);

  -- Privada: un NO miembro recibe un 42501 explicito, no una lista vacia (la
  -- pantalla pinta la silueta difuminada a partir de es_privada, no de este
  -- error). Publica: se lee sin pertenecer, salvo bloqueo con quien manda.
  IF NOT v_miembro THEN
    IF v_privada THEN
      RAISE EXCEPTION 'Solicita unirte a la comunidad para ver su muro.' USING ERRCODE = '42501';
    END IF;
    IF v_owner IS NOT NULL AND public.hay_bloqueo_con(v_owner) THEN
      RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_muro'));

  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
    ) x;

  RETURN QUERY
  SELECT k.id, p_community_id, v_nombre, v_privada,
         k.author_id, au.nombre, au.foto, au.trust_level::TEXT,
         k.cuerpo, k.created_at,
         k.likes_count, k.comentarios_count,
         (l.user_id IS NOT NULL)
    FROM (
      SELECT p.id, p.author_id, p.cuerpo, p.created_at,
             p.likes_count, p.comentarios_count
        FROM community_posts p
       WHERE p.community_id   = p_community_id
         AND p.parent_post_id IS NULL
         AND p.is_hidden      = FALSE
         AND p.author_id <> ALL (v_vetados)
         AND NOT EXISTS (SELECT 1 FROM profiles pf
                          WHERE pf.id = p.author_id AND pf.is_hidden)
         AND (cursor_time IS NULL
              OR (p.created_at, p.id) < (cursor_time, cursor_id))
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT v_limite
    ) k
    JOIN profiles au ON au.id = k.author_id
    LEFT JOIN community_post_likes l
           ON l.post_id = k.id AND l.user_id = v_viewer
   ORDER BY k.created_at DESC, k.id DESC;
END;
$function$;

comment on function public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer) is
  'Muro de una comunidad. Forma de fila IDENTICA a feed_comunidades_explorar. Publica: se lee sin pertenecer (decision 3). Privada: un no miembro recibe 42501 explicito, no una lista vacia. Un no miembro con bloqueo con quien manda recibe P0002, igual que si no existiera.';

-- ---------------------------------------------------------------------------
-- 7.3 feed_comunidades_explorar -- solo cambia el RETURNS (community_es_privada)
-- para que la forma de fila siga siendo byte a byte la del muro. Cuerpo vivo.
-- ---------------------------------------------------------------------------
drop function if exists public.feed_comunidades_explorar(timestamp with time zone, uuid, integer);
create function public.feed_comunidades_explorar(
  cursor_time  timestamp with time zone default null::timestamp with time zone,
  cursor_id    uuid                     default null::uuid,
  result_limit integer                  default 30
)
returns table (
  id uuid, community_id uuid, community_nombre text, community_es_privada boolean,
  author_id uuid, author_nombre text, author_foto text, author_trust_level text,
  cuerpo text, created_at timestamp with time zone,
  likes_count integer, comentarios_count integer, le_di_like boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer  UUID;
  v_limite  INT;
  v_vetados UUID[];
BEGIN
  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time y cursor_id se mandan juntos o no se mandan'
      USING ERRCODE = '22023';
  END IF;

  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN RETURN; END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_muro'));

  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
    ) x;

  RETURN QUERY
  WITH candidatas AS (
    SELECT p.p_id, p.p_created
      FROM community_members m
      JOIN communities c
        ON c.id = m.community_id
       AND c.is_hidden = FALSE
       AND c.archived_at IS NULL
      CROSS JOIN LATERAL (
        SELECT cp.id AS p_id, cp.created_at AS p_created
          FROM community_posts cp
         WHERE cp.community_id   = m.community_id
           AND cp.parent_post_id IS NULL
           AND cp.is_hidden      = FALSE
           AND cp.author_id <> ALL (v_vetados)
           AND NOT EXISTS (SELECT 1 FROM profiles pf
                            WHERE pf.id = cp.author_id AND pf.is_hidden)
           AND (cursor_time IS NULL
                OR (cp.created_at, cp.id) < (cursor_time, cursor_id))
         ORDER BY cp.created_at DESC, cp.id DESC
         LIMIT v_limite
      ) p
     WHERE m.user_id = v_viewer
       AND m.left_at IS NULL
  ),
  pagina AS MATERIALIZED (
    SELECT k.p_id, k.p_created FROM candidatas k
     ORDER BY k.p_created DESC, k.p_id DESC
     LIMIT v_limite
  )
  SELECT p.id, p.community_id, c.nombre, c.es_privada,
         p.author_id, au.nombre, au.foto,
         au.trust_level::TEXT,
         p.cuerpo, p.created_at,
         p.likes_count, p.comentarios_count,
         (l.user_id IS NOT NULL)
    FROM pagina g
    JOIN community_posts p  ON p.id  = g.p_id
    JOIN communities     c  ON c.id  = p.community_id
    JOIN profiles        au ON au.id = p.author_id
    LEFT JOIN community_post_likes l
           ON l.post_id = p.id AND l.user_id = v_viewer
   ORDER BY p.created_at DESC, p.id DESC;
END;
$function$;

comment on function public.feed_comunidades_explorar(timestamp with time zone, uuid, integer) is
  'Muro unificado de todas mis comunidades. Fan-out CROSS JOIN LATERAL acotado a membresias x limite (600 tuplas). Desde 20260912230000 devuelve community_es_privada para que la fila siga siendo identica a la de feed_muro_comunidad.';

-- ---------------------------------------------------------------------------
-- 7.4 mis_comunidades -- anade es_privada, soy_miembro y solicitud_pendiente
-- (siempre true / false aqui: se devuelven para que la tarjeta declare UN solo
-- tipo con descubrir_comunidades y detalle_comunidad).
-- ---------------------------------------------------------------------------
drop function if exists public.mis_comunidades();
create function public.mis_comunidades()
returns table (
  id uuid, nombre text, descripcion text, mi_rol text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  soy_fundador boolean, es_privada boolean, soy_miembro boolean,
  solicitud_pendiente boolean
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
         c.es_privada, TRUE, FALSE
    FROM community_members m
    JOIN communities c ON c.id = m.community_id
   WHERE m.user_id = v_viewer
     AND m.left_at IS NULL
     AND c.is_hidden   = FALSE
     AND c.archived_at IS NULL
   ORDER BY c.ultima_publicacion_at DESC NULLS LAST, c.nombre ASC
   LIMIT public.comunidades_limite('membresias_vivas') + 10;
END;
$function$;

comment on function public.mis_comunidades() is
  'Directorio de mis comunidades vivas, ordenado por actividad con NULLS LAST. mi_rol responde "que mando tengo aqui" y soy_fundador "la funde yo". es_privada, soy_miembro (true) y solicitud_pendiente (false) salen para que la tarjeta comparta tipo con descubrir_comunidades y detalle_comunidad.';

-- ---------------------------------------------------------------------------
-- 7.5 descubrir_comunidades -- anade es_privada, soy_miembro (siempre false:
-- las mias no se descubren), mi_rol (null) y solicitud_pendiente. Cuerpo vivo.
-- El EXISTS de solicitud_pendiente va en la lista de SELECT: se evalua solo
-- sobre las <=30 filas que salen, sondeando uq_community_join_requests_pendiente.
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
  es_privada boolean, soy_miembro boolean, mi_rol text, solicitud_pendiente boolean
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
                    AND r.status = 'pendiente')
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
  'Comunidades a <=5 km que no son mias. Radio CONSTANTE, entrada snapeada a 100 m, salida en cubos de 500 m, sin paginacion por cursor. Desde 20260912230000 devuelve es_privada, soy_miembro (false), mi_rol (null) y solicitud_pendiente para pintar Unete / Solicitar unirse / Solicitud enviada.';

-- ---------------------------------------------------------------------------
-- 7.6 detalle_comunidad -- la cabecera de /comunidades/[id] en UNA llamada.
--
-- Sin esto la pagina necesitaria tres consultas (communities, mi fila de
-- community_members y mi solicitud pendiente) y aun asi no sabria si esta
-- disponible para alguien que no pertenece y esta a mas de 5 km. Devuelve
-- CERO filas (no error) si la comunidad no existe, esta oculta o archivada y
-- no soy miembro ni mando, o si hay bloqueo con quien manda y no soy miembro:
-- no es un oraculo de existencia de ids. Un miembro de una archivada la ve
-- (disponible = false) para poder salir.
-- ---------------------------------------------------------------------------
create or replace function public.detalle_comunidad(p_community_id uuid)
returns table (
  id uuid, nombre text, descripcion text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  created_at timestamp with time zone,
  es_privada boolean, disponible boolean,
  soy_miembro boolean, mi_rol text, soy_fundador boolean, solicitud_pendiente boolean
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
                    AND r.status = 'pendiente')
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
  'Cabecera de /comunidades/[id]: la comunidad mas mi relacion con ella (soy_miembro, mi_rol, soy_fundador, solicitud_pendiente, disponible). Cero filas si no existe, no esta disponible y no soy miembro ni mando, o hay bloqueo con quien manda: no es un oraculo de existencia.';

-- ---------------------------------------------------------------------------
-- 7.7 centro_de_mi_comunidad -- cambia el RETURNS: anade el centro de fundacion
-- (para dibujar el circulo de 1 km en el mapa), es_privada y cuantos
-- movimientos quedan hoy (decision 10 aplicada tambien aqui: el boton se
-- deshabilita antes, no falla despues). Sigue devolviendo CERO filas si no
-- tienes el mando.
-- ---------------------------------------------------------------------------
drop function if exists public.centro_de_mi_comunidad(uuid);
create function public.centro_de_mi_comunidad(p_community_id uuid)
returns table (
  lat double precision, lng double precision,
  lat_fundacion double precision, lng_fundacion double precision,
  es_privada boolean, movimientos_restantes_24h integer, radio_metros integer
)
language sql
stable security definer
set search_path to 'public'
as $function$
  select ST_Y(c.centro::geometry), ST_X(c.centro::geometry),
         ST_Y(COALESCE(c.centro_fundacion, c.centro)::geometry),
         ST_X(COALESCE(c.centro_fundacion, c.centro)::geometry),
         c.es_privada,
         GREATEST(public.comunidades_limite('centros_24h')
                  - (select count(*)::int from public.community_post_quota q
                      where q.user_id = (select auth.uid()) and q.tipo = 'centro'
                        and q.created_at > now() - interval '24 hours'), 0),
         public.comunidades_limite('centro_radio_metros')
    from public.communities c
   where c.id = p_community_id
     and exists (select 1 from public.community_members m
                  where m.community_id = c.id
                    and m.user_id = (select auth.uid())
                    and m.left_at is null
                    and m.role = 'owner');
$function$;

comment on function public.centro_de_mi_comunidad(uuid) is
  'Unica salida de lat/lng crudos del diseno, solo para quien tiene el MANDO. Desde 20260912230000 devuelve tambien el centro de fundacion, es_privada, los movimientos de centro que quedan hoy y el radio permitido. Cero filas si no mandas, no un error.';

-- ---------------------------------------------------------------------------
-- 7.8 alternar_membresia_comunidad -- cuerpo vivo mas la guardia de privada en
-- la rama ENTRAR. Misma aridad: CREATE OR REPLACE, sin sobrecarga.
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

    -- PRIVADA (decision 3): no se entra directo. Salvo que exista una
    -- solicitud aceptada -- que es el camino por el que resolver_solicitud_union
    -- ya te metio, y que sigue valiendo si sales y vuelves -- o que quien entra
    -- tenga el mando (owner_id) y le falte su fila viva por alguna deriva.
    IF v_privada
       AND v_owner IS DISTINCT FROM v_viewer
       AND NOT EXISTS (SELECT 1 FROM community_join_requests r
                        WHERE r.community_id = p_community_id
                          AND r.user_id = v_viewer
                          AND r.status = 'aceptada') THEN
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
                            'miembros_count', COALESCE(v_total, 0));
END;
$function$;

comment on function public.alternar_membresia_comunidad(uuid) is
  'Unirse y salir en un solo boton, devolviendo el estado autoritativo. Salir es borrado SUAVE (left_at + role=member) y SIEMPRE posible. Entrar exige comunidad viva, cuenta no suspendida, sin bloqueo con quien manda, tope de 20 vivas, 10 altas por 24 h y -- desde 20260912230000 -- que la comunidad sea publica, o que exista una solicitud aceptada, o que quien entra tenga el mando (42501 si no). Dos llaves en orden fijo usuario -> comunidad.';

-- ---------------------------------------------------------------------------
-- 7.9 alternar_like_publicacion -- cuerpo vivo mas UNA guardia: reaccionar
-- exige pertenencia. Antes bastaba puedo_ver_publicacion, y al abrir esa a las
-- publicas una cuenta sin pertenecer subiria likes_count de un barrio ajeno.
-- ---------------------------------------------------------------------------
create or replace function public.alternar_like_publicacion(p_post_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer    UUID;
  v_madre     UUID;
  v_comunidad UUID;
  v_era       BOOLEAN;
  v_n         INT;
  v_total     INT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'Falta la publicacion.' USING ERRCODE = '22023';
  END IF;

  IF NOT public.puedo_ver_publicacion(p_post_id) THEN
    RAISE EXCEPTION 'No puedes reaccionar a esa publicacion.' USING ERRCODE = '42501';
  END IF;

  SELECT p.parent_post_id, p.community_id INTO v_madre, v_comunidad
    FROM community_posts p WHERE p.id = p_post_id;
  IF v_madre IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede reaccionar a un comentario.' USING ERRCODE = '22023';
  END IF;

  -- NUEVO: leer una publica es libre, reaccionar no. Mismo mensaje que
  -- publicar_en_comunidad para el mismo caso.
  IF NOT public.es_miembro_de_comunidad(v_comunidad) THEN
    RAISE EXCEPTION 'Unete a la comunidad para reaccionar.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:like:' || v_viewer::text, 0));

  DELETE FROM community_post_likes
   WHERE post_id = p_post_id AND user_id = v_viewer;

  IF FOUND THEN
    v_era := TRUE;
  ELSE
    SELECT count(*) INTO v_n
      FROM community_post_quota q
     WHERE q.user_id = v_viewer AND q.tipo = 'reaccion'
       AND q.created_at > now() - interval '24 hours';
    IF v_n >= public.comunidades_limite('reacciones_24h') THEN
      RAISE EXCEPTION 'Demasiadas reacciones en 24 horas.' USING ERRCODE = '23514';
    END IF;

    INSERT INTO community_post_likes (post_id, user_id)
    VALUES (p_post_id, v_viewer) ON CONFLICT DO NOTHING;
    INSERT INTO community_post_quota (user_id, tipo) VALUES (v_viewer, 'reaccion');
    v_era := FALSE;
  END IF;

  SELECT p.likes_count INTO v_total FROM community_posts p WHERE p.id = p_post_id;

  RETURN jsonb_build_object('le_di_like', NOT v_era,
                            'likes_count', COALESCE(v_total, 0));
END;
$function$;

comment on function public.alternar_like_publicacion(uuid) is
  'Unica via de escritura de community_post_likes. Exige ver la publicacion (puedo_ver_publicacion) Y pertenecer a la comunidad: leer una publica es libre, reaccionar no. La cuota de 300 reacciones en 24 h se cuenta contra el ledger y solo al dar, nunca al quitar.';

-- ---------------------------------------------------------------------------
-- 7.10 fundar_comunidad -- cuerpo vivo con las cuotas A, B y D delegadas en
-- comunidad_fundacion_estado (misma logica, mismos textos, mismos contadores).
-- La CUOTA C sigue inline. El orden de comprobacion pasa de A,B,C,D a A,B,D,C:
-- ninguna depende de otra, asi que el resultado es el mismo. Misma aridad.
-- ---------------------------------------------------------------------------
create or replace function public.fundar_comunidad(
  p_nombre      text,
  p_lat         double precision,
  p_lng         double precision,
  p_descripcion text default null::text
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer  UUID;
  v_nombre  TEXT;
  v_desc    TEXT;
  v_lat     FLOAT;
  v_lng     FLOAT;
  v_punto   geography;
  v_id      UUID;
  v_estado  JSONB;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;

  v_nombre := btrim(COALESCE(p_nombre, ''));
  IF char_length(v_nombre) < 3 OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 3 y 40 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_desc := NULLIF(btrim(COALESCE(p_descripcion, '')), '');
  IF v_desc IS NOT NULL AND char_length(v_desc) > 300 THEN
    RAISE EXCEPTION 'La descripcion no puede pasar de 300 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  v_lat   := round(p_lat::numeric, 2)::FLOAT;
  v_lng   := round(p_lng::numeric, 2)::FLOAT;
  v_punto := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:fundar:' || v_viewer::text, 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:membresia:' || v_viewer::text, 0));

  -- CUOTAS A, B y D: el mismo helper que consulta estado_cuota_fundacion().
  v_estado := public.comunidad_fundacion_estado(v_viewer);
  IF NOT (v_estado->>'puede_fundar')::boolean THEN
    RAISE EXCEPTION '%', v_estado->>'motivo' USING ERRCODE = '23514';
  END IF;

  -- CUOTA C: separacion de 1 km entre las propias. Depende del punto, asi que
  -- vive aqui y no en el helper.
  IF EXISTS (SELECT 1 FROM communities c
              WHERE c.fundador_id = v_viewer
                AND c.archived_at IS NULL
                AND ST_DWithin(c.centro, v_punto,
                               public.comunidades_limite('separacion_propias_metros'))) THEN
    RAISE EXCEPTION 'Ya tienes una comunidad a menos de 1 km de aqui.'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    INSERT INTO communities (nombre, descripcion, owner_id, fundador_id, centro)
    VALUES (v_nombre, v_desc, v_viewer, v_viewer, v_punto)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe una comunidad con ese nombre por aqui.'
      USING ERRCODE = '23505';
  END;

  INSERT INTO community_members (community_id, user_id, role)
  VALUES (v_id, v_viewer, 'owner');

  RETURN jsonb_build_object('id', v_id, 'nombre', v_nombre);
END;
$function$;

comment on function public.fundar_comunidad(text, double precision, double precision, text) is
  'Funda una comunidad (publica por defecto, decision 4) y mete a quien funda dentro, en la misma transaccion. Snapea el centro a ~1.1 km y fija centro_fundacion via el trigger. Cuatro cuotas bajo pg_advisory_xact_lock: A (3 vivas), B (1 cada 24 h) y D (20 membresias) via comunidad_fundacion_estado -- el MISMO helper que estado_cuota_fundacion() -- y C (1 km entre las propias) inline.';

-- ---------------------------------------------------------------------------
-- 7.11 estado_cuota_fundacion -- lo que el boton "+" necesita ANTES de intentar.
-- ---------------------------------------------------------------------------
create or replace function public.estado_cuota_fundacion()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE v_viewer UUID;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RETURN jsonb_build_object(
      'puede_fundar', false, 'motivo', 'Tu cuenta esta suspendida.',
      'siguiente_en', NULL,
      'fundadas_vivas', (SELECT count(*) FROM communities c
                          WHERE c.fundador_id = v_viewer AND c.archived_at IS NULL),
      'tope_vivas', public.comunidades_limite('comunidades_fundadas_vivas'));
  END IF;
  RETURN public.comunidad_fundacion_estado(v_viewer);
END;
$function$;

comment on function public.estado_cuota_fundacion() is
  '{puede_fundar, motivo, siguiente_en, fundadas_vivas, tope_vivas} con las MISMAS reglas y contadores que fundar_comunidad (cuotas A, B y D via comunidad_fundacion_estado). La CUOTA C depende del punto y no se puede anticipar aqui. Decision 10: el boton se deshabilita con el tiempo que falta.';

-- ---------------------------------------------------------------------------
-- 7.12 solicitar_union_comunidad -- la SEXTA superficie de escritura publica.
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
  'Pide entrar a una comunidad PRIVADA. Guardia de suspension (sexta superficie), bloqueo bidireccional con quien manda, 22023 si ya eres miembro o si es publica, cuota de 10 en 24 h contra el ledger (cancelar y volver a pedir gasta). Doble toque idempotente: devuelve la pendiente existente con repetida=true sin gastar cuota. Avisa al mando y a los moderadores sin bloqueo con quien pide.';

-- ---------------------------------------------------------------------------
-- 7.13 cancelar_solicitud_union
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_solicitud_union(p_request_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_status TEXT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  SELECT r.status INTO v_status
    FROM community_join_requests r
   WHERE r.id = p_request_id AND r.user_id = v_viewer
     FOR UPDATE;
  IF NOT FOUND THEN
    -- Ajena o inexistente: mismo mensaje, para no confirmar ids ajenos.
    RAISE EXCEPTION 'Esa solicitud no existe.' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'cancelada' THEN
    RETURN jsonb_build_object('id', p_request_id, 'status', 'cancelada');
  END IF;
  IF v_status <> 'pendiente' THEN
    RAISE EXCEPTION 'Esa solicitud ya fue resuelta.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE community_join_requests
     SET status = 'cancelada', resolved_at = now()
   WHERE id = p_request_id;

  RETURN jsonb_build_object('id', p_request_id, 'status', 'cancelada');
END;
$function$;

comment on function public.cancelar_solicitud_union(uuid) is
  'Cancela una solicitud propia pendiente. Idempotente si ya estaba cancelada; P0002 si no existe, es ajena o ya fue resuelta. NO devuelve cuota: el ledger cuenta eventos.';

-- ---------------------------------------------------------------------------
-- 7.14 resolver_solicitud_union -- owner o moderador. Al aceptar inserta la
-- membresia con el MISMO tope de 20 vivas que la rama ENTRAR; si no cabe, 23514
-- y la solicitud se queda pendiente (la excepcion deshace todo).
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

  -- Bloqueo bidireccional entre quien pide y quien resuelve: ni acepta ni
  -- rechaza; la cola ya no se la muestra (solicitudes_de_comunidad la filtra).
  IF public.hay_bloqueo_con(v_req.user_id) THEN
    RAISE EXCEPTION 'No puedes resolver esa solicitud.' USING ERRCODE = '42501';
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
  'Acepta o rechaza una solicitud pendiente. Owner o moderador; guardia de suspension; 42501 si hay bloqueo entre quien pide y quien resuelve. Al aceptar toma la llave comunidad:membresia:<solicitante> e inserta la membresia con el MISMO tope de 20 vivas que alternar_membresia_comunidad: si no cabe, 23514 y la solicitud sigue pendiente. Avisa a quien pidio.';

-- ---------------------------------------------------------------------------
-- 7.15 solicitudes_de_comunidad -- la cola, para owner/moderadores. Paginada
-- por (created_at desc, id desc) con cursor de tupla sobre
-- idx_community_join_requests_cola. Filtra bloqueos del visor y suspendidos.
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

  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
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
  'Cola de solicitudes pendientes de una comunidad, solo para owner/moderadores (42501 si no). Cursor de tupla (created_at, id) descendente. Oculta a quien tiene bloqueo con el visor y a cuentas suspendidas.';

-- ---------------------------------------------------------------------------
-- 7.16 mis_solicitudes_union -- mi historial (pendientes y resueltas).
-- ---------------------------------------------------------------------------
create or replace function public.mis_solicitudes_union()
returns table (
  id uuid, community_id uuid, community_nombre text, status text,
  mensaje text, created_at timestamp with time zone, resolved_at timestamp with time zone
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
  SELECT r.id, r.community_id, c.nombre, r.status, r.mensaje, r.created_at, r.resolved_at
    FROM community_join_requests r
    JOIN communities c ON c.id = r.community_id
   WHERE r.user_id = v_viewer
   ORDER BY r.created_at DESC, r.id DESC
   LIMIT 50;
END;
$function$;

comment on function public.mis_solicitudes_union() is
  'Mis solicitudes de union, pendientes y resueltas, mas recientes primero. Sin sesion, cero filas.';

-- ---------------------------------------------------------------------------
-- 7.17 nombrar_moderador_comunidad / quitar_moderador_comunidad -- solo owner.
-- La llave comunidad:mando:<id> serializa el tope de 5 y no introduce ciclo:
-- no se pide ninguna llave de usuario antes.
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

    UPDATE community_members SET role = 'moderator'
     WHERE community_id = p_community_id AND user_id = p_user_id AND left_at IS NULL;

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
  'Solo el owner. El nombrado tiene que ser miembro vivo (P0002 si no). Tope moderadores_por_comunidad = 5 (23514) bajo la llave comunidad:mando. Idempotente si ya era moderador. Avisa al nombrado salvo bloqueo.';

create or replace function public.quitar_moderador_comunidad(
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
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL OR p_user_id IS NULL THEN
    RAISE EXCEPTION 'Faltan datos.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM community_members m
                  WHERE m.community_id = p_community_id AND m.user_id = v_viewer
                    AND m.left_at IS NULL AND m.role = 'owner') THEN
    RAISE EXCEPTION 'Solo quien administra la comunidad puede quitar moderadores.' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:mando:' || p_community_id::text, 0));

  SELECT m.role INTO v_rol
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.user_id = p_user_id AND m.left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa persona no es miembro de la comunidad.' USING ERRCODE = 'P0002';
  END IF;
  IF v_rol = 'owner' THEN
    RAISE EXCEPTION 'El mando no se quita desde aqui.' USING ERRCODE = '22023';
  END IF;

  UPDATE community_members SET role = 'member'
   WHERE community_id = p_community_id AND user_id = p_user_id AND left_at IS NULL
     AND role = 'moderator';

  SELECT count(*) INTO v_n
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.left_at IS NULL AND m.role = 'moderator';

  RETURN jsonb_build_object('community_id', p_community_id, 'user_id', p_user_id,
                            'role', 'member', 'moderadores_count', v_n);
END;
$function$;

comment on function public.quitar_moderador_comunidad(uuid, uuid) is
  'Solo el owner. Devuelve a member a un moderador vivo. Idempotente si ya era member; 22023 si es el owner; P0002 si no es miembro.';

-- ---------------------------------------------------------------------------
-- 7.18 editar_centro_comunidad -- la SEPTIMA superficie de escritura publica.
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

  SELECT COALESCE(c.centro_fundacion, c.centro), c.celda
    INTO v_fundacion, v_celda_old
    FROM communities c WHERE c.id = p_community_id AND c.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- El limite se mide contra el punto PEDIDO (ver cabecera D): entre dos
  -- puntos de rejilla nunca hay menos de ~1.05 km, asi que medirlo contra el
  -- redondeado prohibiria mover siempre. El punto crudo no se guarda.
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
  'Mueve el centro. Solo el owner; guardia de suspension (septima superficie); limite de 1 km medido contra el centro de FUNDACION y contra el punto PEDIDO (entre celdas de la rejilla nunca hay menos de ~1.05 km, asi que medir contra el redondeado prohibiria mover siempre); se guarda redondeado a 2 decimales como en fundar_comunidad; cuota centros_24h = 2 en el ledger; el 23505 de uq_communities_celda_nombre se traduce a un mensaje legible. Abre el camino del trigger con set_config(vicino.mover_centro) local a la transaccion.';

-- ---------------------------------------------------------------------------
-- 7.19 delete_user_data -- cuerpo VIVO de 20260912220000 mas dos sentencias en
-- el bloque de comunidades: borrar las solicitudes propias y anular
-- resolved_by de las que esta persona resolvio, cada una con su entrada en
-- deleted_summary. Misma aridad: sin sobrecarga.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_user_data(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_summary JSONB := '{}'::JSONB;
  cnt INTEGER;
  v_comunidad  UUID;
  v_tocadas    INTEGER := 0;
  v_archivadas INTEGER := 0;
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() != target_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot delete another user''s data'
      USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL
     AND coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Unauthorized: sin sesion propia esta funcion solo la puede llamar service_role'
      USING ERRCODE = '42501';
  END IF;

  -- Messages authored by user
  DELETE FROM public.messages WHERE autor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('messages', cnt);

  -- Chats where user is buyer or seller
  DELETE FROM public.chats
    WHERE comprador_id = target_user_id OR vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('chats', cnt);

  -- Favorites
  DELETE FROM public.favorites WHERE usuario_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('favorites', cnt);

  -- Reviews authored by user
  DELETE FROM public.reviews WHERE reviewer_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_authored', cnt);

  DELETE FROM public.reviews
    WHERE product_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_on_user_products', cnt);

  UPDATE public.reviews
    SET reviewed_id = NULL,
        anonymized_at = NOW()
    WHERE reviewed_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_received_anonymized', cnt);

  -- Sale confirmations (English column names in this table)
  DELETE FROM public.sale_confirmations
    WHERE buyer_id = target_user_id OR seller_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('sale_confirmations', cnt);

  -- Coupons
  DELETE FROM public.coupons WHERE vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('coupons', cnt);

  -- Disputes
  DELETE FROM public.disputes
    WHERE reporter_id = target_user_id OR reported_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('disputes', cnt);

  -- Notifications
  DELETE FROM public.notifications WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('notifications', cnt);

  -- Verifications (seller + trust)
  DELETE FROM public.seller_verification WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('seller_verifications', cnt);

  DELETE FROM public.trust_level_verification WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('trust_verifications', cnt);

  -- Bookings
  DELETE FROM public.bookings
    WHERE comprador_id = target_user_id OR vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('bookings', cnt);

  -- Service availability (via user's listings)
  DELETE FROM public.service_availability
    WHERE servicio_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('service_availability', cnt);

  -- Product variants (via user's products)
  DELETE FROM public.product_variants
    WHERE producto_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('product_variants', cnt);

  -- Media assets for user's products/services
  DELETE FROM public.media_assets
    WHERE owner_type IN ('producto', 'servicio')
      AND owner_id IN (
        SELECT id FROM public.products_services WHERE creador_id = target_user_id
      );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('media_assets_products', cnt);

  -- Media assets for user's profile
  DELETE FROM public.media_assets
    WHERE owner_type = 'profile' AND owner_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('media_assets_profile', cnt);

  -- Products and services
  DELETE FROM public.products_services WHERE creador_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('products_services', cnt);

  -- Roles
  DELETE FROM public.user_roles WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('user_roles', cnt);

  -- ---------------------------------------------------------------------
  -- COMUNIDADES (bloque de 20260912220000, con las dos sentencias de
  -- solicitudes anadidas en 20260912230000). Primero el MANDO, luego el
  -- CONTENIDO.
  -- ---------------------------------------------------------------------
  FOR v_comunidad IN
    SELECT m.community_id
      FROM public.community_members m
     WHERE m.user_id = target_user_id
       AND m.left_at IS NULL
       AND m.role    = 'owner'
     ORDER BY m.community_id
  LOOP
    PERFORM public.comunidad_traspasa_mando(v_comunidad, target_user_id);
    v_tocadas := v_tocadas + 1;
    IF EXISTS (SELECT 1 FROM public.communities c
                WHERE c.id = v_comunidad AND c.owner_id IS NULL) THEN
      v_archivadas := v_archivadas + 1;
    END IF;
  END LOOP;
  deleted_summary := deleted_summary
    || jsonb_build_object('communities_traspasadas', v_tocadas)
    || jsonb_build_object('communities_archivadas',  v_archivadas);

  DELETE FROM public.community_post_likes WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_post_likes', cnt);

  DELETE FROM public.community_posts WHERE author_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_posts', cnt);

  -- NUEVO (20260912230000): las solicitudes propias se borran (la FK ya lo
  -- haria en cascada; se enumera para que el log de cumplimiento lo cuente) y
  -- las que esta persona RESOLVIO pierden el resolved_by (ON DELETE SET NULL
  -- tambien lo haria; se hace explicito y se cuenta, como reviews_received).
  DELETE FROM public.community_join_requests WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_join_requests', cnt);

  UPDATE public.community_join_requests SET resolved_by = NULL
   WHERE resolved_by = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_join_requests_resolved_anonymized', cnt);

  DELETE FROM public.community_members WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_memberships', cnt);

  DELETE FROM public.community_post_quota WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_post_quota', cnt);

  -- Profile (last, before auth.users)
  DELETE FROM public.profiles WHERE id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('profile', cnt);

  -- Audit log
  INSERT INTO public.account_deletion_log (
    deleted_user_id,
    deleted_at,
    summary
  ) VALUES (
    target_user_id,
    NOW(),
    deleted_summary
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'deleted_at', NOW(),
    'summary', deleted_summary
  );
END;
$function$;

COMMENT ON FUNCTION public.delete_user_data(uuid) IS
  'Borrado de cuenta. Enumera y cuenta a mano cada tabla porque deleted_summary se archiva en account_deletion_log como evidencia. Incluye el traspaso determinista del mando (comunidad_traspasa_mando) y, desde 20260912230000, las solicitudes de union propias y la anonimizacion de resolved_by. Solo service_role (o SQL directo como postgres).';


-- ===========================================================================
-- 8. GRANTS. Firma completa en cada REVOKE y GRANT; solo authenticated.
-- ===========================================================================
revoke execute on function public.comunidades_limite(text) from public, anon, authenticated;
grant  execute on function public.comunidades_limite(text) to authenticated;

revoke execute on function public.comunidades_publicas_ids() from public, anon, authenticated;
grant  execute on function public.comunidades_publicas_ids() to authenticated;   -- la llama la policy: la ejecuta el rol que consulta

revoke execute on function public.puedo_ver_publicacion(uuid) from public, anon, authenticated;
grant  execute on function public.puedo_ver_publicacion(uuid) to authenticated;

-- Internos: NO se conceden.
revoke execute on function public.comunidad_notifica(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.comunidad_fundacion_estado(uuid) from public, anon, authenticated;
revoke execute on function public.comunidad_normaliza() from public, anon, authenticated;

revoke execute on function public.editar_visibilidad_comunidad(uuid, boolean) from public, anon, authenticated;
grant  execute on function public.editar_visibilidad_comunidad(uuid, boolean) to authenticated;

revoke execute on function public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer) to authenticated;

revoke execute on function public.feed_comunidades_explorar(timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.feed_comunidades_explorar(timestamp with time zone, uuid, integer) to authenticated;

revoke execute on function public.mis_comunidades() from public, anon, authenticated;
grant  execute on function public.mis_comunidades() to authenticated;

revoke execute on function public.descubrir_comunidades(double precision, double precision, integer) from public, anon, authenticated;
grant  execute on function public.descubrir_comunidades(double precision, double precision, integer) to authenticated;

revoke execute on function public.detalle_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.detalle_comunidad(uuid) to authenticated;

revoke execute on function public.centro_de_mi_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.centro_de_mi_comunidad(uuid) to authenticated;

revoke execute on function public.alternar_membresia_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.alternar_membresia_comunidad(uuid) to authenticated;

revoke execute on function public.alternar_like_publicacion(uuid) from public, anon, authenticated;
grant  execute on function public.alternar_like_publicacion(uuid) to authenticated;

revoke execute on function public.fundar_comunidad(text, double precision, double precision, text) from public, anon, authenticated;
grant  execute on function public.fundar_comunidad(text, double precision, double precision, text) to authenticated;

revoke execute on function public.estado_cuota_fundacion() from public, anon, authenticated;
grant  execute on function public.estado_cuota_fundacion() to authenticated;

revoke execute on function public.solicitar_union_comunidad(uuid, text) from public, anon, authenticated;
grant  execute on function public.solicitar_union_comunidad(uuid, text) to authenticated;

revoke execute on function public.cancelar_solicitud_union(uuid) from public, anon, authenticated;
grant  execute on function public.cancelar_solicitud_union(uuid) to authenticated;

revoke execute on function public.resolver_solicitud_union(uuid, boolean) from public, anon, authenticated;
grant  execute on function public.resolver_solicitud_union(uuid, boolean) to authenticated;

revoke execute on function public.solicitudes_de_comunidad(uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.solicitudes_de_comunidad(uuid, timestamp with time zone, uuid, integer) to authenticated;

revoke execute on function public.mis_solicitudes_union() from public, anon, authenticated;
grant  execute on function public.mis_solicitudes_union() to authenticated;

revoke execute on function public.nombrar_moderador_comunidad(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.nombrar_moderador_comunidad(uuid, uuid) to authenticated;

revoke execute on function public.quitar_moderador_comunidad(uuid, uuid) from public, anon, authenticated;
grant  execute on function public.quitar_moderador_comunidad(uuid, uuid) to authenticated;

revoke execute on function public.editar_centro_comunidad(uuid, double precision, double precision) from public, anon, authenticated;
grant  execute on function public.editar_centro_comunidad(uuid, double precision, double precision) to authenticated;

REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_user_data(uuid) TO service_role;


-- ===========================================================================
-- 9. NINGUNA SOBRECARGA. Una firma de mas es un 300 PGRST203 para todas las
-- llamadas que no manden el argumento nuevo. Se afirma aqui, dentro de la
-- transaccion, para que la migracion no pueda entrar en verde con una.
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
           'comunidades_limite','comunidades_publicas_ids','puedo_ver_publicacion',
           'comunidad_notifica','comunidad_fundacion_estado','comunidad_normaliza',
           'editar_visibilidad_comunidad','feed_muro_comunidad','feed_comunidades_explorar',
           'mis_comunidades','descubrir_comunidades','detalle_comunidad','centro_de_mi_comunidad',
           'alternar_membresia_comunidad','alternar_like_publicacion','fundar_comunidad',
           'estado_cuota_fundacion','solicitar_union_comunidad','cancelar_solicitud_union',
           'resolver_solicitud_union','solicitudes_de_comunidad','mis_solicitudes_union',
           'nombrar_moderador_comunidad','quitar_moderador_comunidad','editar_centro_comunidad',
           'delete_user_data')
       GROUP BY p.proname
      HAVING count(*) <> 1
    ) x;
  IF duplicada IS NOT NULL THEN
    RAISE EXCEPTION 'hay sobrecargas donde tiene que haber una sola firma (%): PostgREST devolvera 300 PGRST203', duplicada;
  END IF;

  -- Y delete_user_data conserva el bloque de comunidades entero mas el nuevo.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'delete_user_data'
       AND position('community_join_requests' in pg_get_functiondef(p.oid)) > 0
       AND position('comunidad_traspasa_mando' in pg_get_functiondef(p.oid)) > 0
       AND position('community_post_quota' in pg_get_functiondef(p.oid)) > 0
  ) THEN
    RAISE EXCEPTION 'delete_user_data perdio alguna rama de comunidades';
  END IF;
END
$sin_sobrecargas$;

-- Sin esto PostgREST sigue sirviendo el esquema viejo.
notify pgrst, 'reload schema';

-- (fin del archivo: el COMMIT lo pone apply-migration.mjs)

-- ===========================================================================
-- VERIFY -- ejercido contra el proyecto de pruebas el 12-sep-2026 con tres
-- cuentas reales (A owner, B, C) y las que hizo falta crear. Todo bajo
-- BEGIN ... SET LOCAL ROLE authenticated ... ROLLBACK. Sustituir los uuids.
-- ===========================================================================
--
-- ---- A. PRIVILEGIOS -------------------------------------------------------
--   SELECT has_column_privilege('authenticated','public.communities','es_privada','SELECT'),        -- true
--          has_column_privilege('authenticated','public.communities','centro_fundacion','SELECT'),  -- false
--          has_column_privilege('authenticated','public.community_join_requests','resolved_by','SELECT'), -- false
--          has_column_privilege('authenticated','public.community_join_requests','mensaje','SELECT'),     -- true
--          has_table_privilege('authenticated','public.community_join_requests','INSERT'),          -- false
--          has_table_privilege('anon','public.community_join_requests','SELECT'),                   -- false
--          has_function_privilege('authenticated','public.comunidad_notifica(uuid,text,text,text,jsonb)','EXECUTE'), -- false
--          has_function_privilege('authenticated','public.comunidad_fundacion_estado(uuid)','EXECUTE'),  -- false
--          has_function_privilege('anon','public.solicitar_union_comunidad(uuid,text)','EXECUTE');       -- false
--   SELECT count(*) FROM cron.job WHERE jobname = 'purga_community_post_quota';                    -- 1
--   SELECT has_sequence_privilege('authenticated','public.community_post_quota_id_seq','SELECT');  -- false
--   SELECT count(*) FROM public.communities c WHERE c.fundador_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.fundador_id);                -- 0
--
-- ---- C. LOS CASOS ---------------------------------------------------------
--   -- C1. Entrar directo a una privada: 42501.
--   BEGIN; (A funda; A editar_visibilidad_comunidad(id, true))
--     SET LOCAL request.jwt.claims = '{"sub":"<B>","role":"authenticated"}';
--     SELECT public.alternar_membresia_comunidad('<priv>');   -- 42501 'Esta comunidad es privada...'
--     SELECT * FROM public.feed_muro_comunidad('<priv>');    -- 42501 'Solicita unirte...'
--   ROLLBACK;
--   -- C2. Publica ajena: B lee el muro sin pertenecer, por RPC y por REST; NO
--   --     reacciona ni publica sin unirse.
--   -- C3. solicitar -> aceptar -> es miembro (alternar devuelve soy_miembro
--   --     true la fila viva existe; la solicitud queda 'aceptada' con
--   --     resolved_by = A; B recibe notificacion comunidad_solicitud_resuelta;
--   --     A recibio comunidad_solicitud al pedir).
--   -- C4. solicitar dos veces: IDEMPOTENTE, mismo id, repetida = true, y el
--   --     ledger tiene UNA fila 'solicitud'.
--   -- C5. cancelar y volver a solicitar: id NUEVO y el ledger tiene DOS filas.
--   -- C6. 11a solicitud en 24 h: 23514 (10 comunidades privadas distintas, o
--   --     ciclos solicitar/cancelar sobre la misma).
--   -- C7. Moderador: A nombra a B; B acepta la solicitud de C; C es miembro.
--   -- C8. 6o moderador: 23514 (hacen falta 7 cuentas: A + 5 mods + la 6a).
--   -- C9. Mover centro: 900 m al norte OK (celda nueva); 1.5 km: 23514; misma
--   --     celda: movido=false sin gastar; 3a mudanza en 24 h: 23514.
--   -- C10. Mover a una celda donde otra cuenta ya fundo el mismo nombre: 23505
--   --      'Ya hay una comunidad con ese nombre en la zona...'
--   -- C11. Suspendida: ni solicita ni mueve ni cambia visibilidad (42501).
--   -- C12. delete_user_data(B): summary con community_join_requests y
--   --      community_join_requests_resolved_anonymized; las que resolvio B
--   --      quedan con resolved_by NULL.
--   -- C13. estado_cuota_fundacion coincide con fundar_comunidad: fundar hasta
--   --      que muerda y comparar motivo con SQLERRM; con siguiente_en > now().
--   -- C14. Aceptar a alguien con 20 vivas: 23514 y la solicitud sigue
--   --      'pendiente'.
--   -- C15. Bloqueo: B no puede solicitar a la comunidad de A si A lo bloqueo
--   --      (42501); A no ve la solicitud de C en la cola si hay bloqueo y no
--   --      puede resolverla (42501); la notificacion al bloqueado no se manda.
--   -- C16. Un UPDATE de mantenimiento sin la variable de sesion NO mueve el
--   --      centro (el trigger lo congela); con set_config lo mueve.
--
-- ---- E. EL PLAN -----------------------------------------------------------
--   -- E1. La policy del muro sigue siendo dos SubPlan hasheados, ni una
--   --     llamada DEFINER por fila. Como un authenticated sin membresias:
--   BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '...';
--     EXPLAIN (ANALYZE) SELECT id FROM public.community_posts LIMIT 1;
--     -- esperado: has_role x2 como InitPlan; mis_comunidades_ids y
--     -- comunidades_publicas_ids como "hashed SubPlan" con loops = 1.
--   ROLLBACK;
--   -- E2. EXPLAIN (ANALYZE) SELECT * FROM public.feed_muro_comunidad('<pub>');
--   --     como no miembro: Index Scan sobre idx_community_posts_muro.
--
-- ---- G. Y AL FINAL, SIEMPRE -----------------------------------------------
--   NOTIFY pgrst, 'reload schema';
--   Y fuera de la base: regenerar apps/web/types/database.types.ts.
-- ===========================================================================
