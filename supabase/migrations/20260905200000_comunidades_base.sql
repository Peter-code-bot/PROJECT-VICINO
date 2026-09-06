-- Comunidades hiperlocales -- ARCHIVO 1 de 3: el esquema, la RLS y las RPC.
--
-- ---------------------------------------------------------------------------
-- COMO SE APLICA ESTO, Y POR QUE ES IDEMPOTENTE DE PUNTA A PUNTA
--
-- `supabase db push` sigue bloqueado: el ledger de schema_migrations esta
-- desincronizado contra la base de produccion. El SQL se aplica a mano por la
-- Management API (POST /v1/projects/oxxdkwywprkfghhbnoto/database/query con el
-- token del .env) y este archivo queda como CONSTANCIA de lo que corre en la
-- base. Como la aplicacion es manual, tiene que poder pegarse dos veces sin
-- romper nada: por eso todo lleva `if not exists`, `drop ... if exists` antes
-- de crear, y `create or replace` en cada funcion.
--
-- ---------------------------------------------------------------------------
-- POR QUE SON TRES ARCHIVOS Y NO UNO
--
-- Reportar una publicacion de comunidad necesita un valor nuevo en el enum
-- `report_target_type`, y en Postgres un valor de enum recien anadido NO se
-- puede USAR hasta que la transaccion que lo anade haya commiteado. Si el
-- literal 'community_post' apareciera en este archivo, el ALTER TYPE y su
-- primer uso caerian en la misma transaccion y el motor lo rechazaria con un
-- error que parece de sintaxis y no lo es.
--
-- De ahi el reparto:
--
--   20260905200000_comunidades_base.sql          <- ESTE. Las 5 tablas (las 4
--     del producto mas el ledger de cuotas community_post_quota), sus CHECK,
--     los 17 indices explicitos, los 5 helpers de RLS mas hay_bloqueo_con,
--     comunidades_limite(), comunidad_traspasa_mando(), las 3 policies, los
--     grants, la purga programada del ledger, los 7 triggers que NO mencionan
--     el enum y las 13 RPC. No toca report_target_type, asi que si falla no ha
--     cambiado nada de moderacion.
--
--   20260905210000_comunidades_report_target.sql <- SOLO el ALTER TYPE. Va
--     solo y con su propio commit porque es IRREVERSIBLE: los valores de enum
--     de Postgres no se pueden borrar.
--
--   20260905220000_comunidades_moderacion.sql    <- auto_hide_on_threshold,
--     handle_child_safety_report, moderate_set_content_hidden (versionada por
--     primera vez), el trigger publicacion_cierra_sus_reportes y el parche a
--     delete_user_data. Todo eso escribe 'community_post' y por tanto no puede
--     correr antes de que el archivo 2 haya commiteado.
--
-- ---------------------------------------------------------------------------
-- LA IDEA DE SEGURIDAD, EN UN PARRAFO
--
-- `authenticated` no tiene ni un INSERT ni un UPDATE ni un DELETE sobre las
-- cinco tablas nuevas. Toda escritura entra por una RPC SECURITY DEFINER, que
-- es el unico sitio donde pueden vivir las cuotas anti-abuso: apps/web/lib/
-- rate-limit.ts es un no-op comprobado en produccion (48 de 48 peticiones a un
-- limite declarado de 20/min devolvieron 200 el 27-ago-2026), asi que cualquier
-- tope escrito en la capa de app es decorativo. Leer el muro exige pertenencia
-- y `anon` no recibe absolutamente nada: ni SELECT ni EXECUTE.
--
-- La geografia aparece en un solo sitio, `communities.centro`, y se guarda YA
-- redondeada a ~1.1 km con un CHECK que lo verifica. Esa columna no se concede
-- a ningun rol, ni para SELECT: sale como distancia en cubos de 500 m desde
-- descubrir_comunidades(), o cruda desde centro_de_mi_comunidad() y solo a
-- quien tiene el MANDO ACTUAL de la comunidad -- que tras un traspaso no es
-- necesariamente quien la fundo. Tampoco se conceden owner_id ni fundador_id:
-- el nombre de una comunidad es un toponimo de barrio, asi que la pareja
-- (nombre, owner_id) seria "X vive en Y" para toda la base en una peticion.
-- El motivo de fondo es que el centro sale de la cookie `vicino_location`,
-- que para la mayoria de la gente es su casa; guardarlo a 100 m, atado a su
-- nombre como fundadora y consultable para siempre, seria la fuga de ubicacion
-- mas fina de todo el producto.
--
-- Y se usa geography(POINT, 4326), nunca geometry. Con geography el tercer
-- argumento de ST_DWithin son METROS; con geometry en 4326 son GRADOS, o sea
-- que ST_DWithin(g, p, 5000) significaria 5000 grados -- catorce veces la
-- Tierra -- y NO daria error: devolveria la tabla entera. En un producto
-- entrenado para pintar "no hay nada cerca" cuando algo falla, un filtro que no
-- filtra pasa desapercibido durante meses.
--
-- ---------------------------------------------------------------------------
-- DESVIACIONES RESPECTO A LA ESPECIFICACION
--
-- Son dos, y las dos estan senaladas tambien en el sitio donde ocurren.
--
-- 1. DE FONDO, y es un arreglo real: la especificacion ordenaba las cuatro
--    sentencias de community_posts como "drop+add del indice unico" y luego
--    "drop+add de la clave foranea compuesta". Ese orden se aplica bien la
--    primera vez y REVIENTA la segunda, porque la foranea depende del indice
--    unico y el DROP sin CASCADE devuelve 2BP01 ("cannot drop ... because other
--    objects depend on it"). Como este archivo tiene que poder pegarse dos
--    veces por la Management API, se tira PRIMERO la foranea, se rehace el
--    indice unico y se vuelve a crear la foranea al final. No se uso CASCADE a
--    proposito: un CASCADE aqui se llevaria por delante lo que no nombra.
--
-- 2. DE PROSA: el comentario de uq_communities_celda_nombre en la
--    especificacion hablaba de "la comprobacion amable de crear_comunidad". Esa
--    funcion no existe (se llama fundar_comunidad) y esa comprobacion previa
--    tampoco: la seccion 7.7 decidio a proposito NO hacerla, porque bajo
--    concurrencia mentiria. El comentario se reescribio para decir lo que de
--    verdad pasa: manda el indice unico y la RPC solo traduce el 23505 a un
--    mensaje legible.
-- ---------------------------------------------------------------------------

begin;

-- ===========================================================================
-- 1. LAS CINCO TABLAS
--
-- Cuatro son el producto (communities, community_members, community_posts,
-- community_post_likes) y la quinta, community_post_quota, es el ledger
-- append-only que sostiene las cuotas de escritura del muro. Nace en la
-- revision adversarial (hallazgo C-3): las cuotas contaban filas VIVAS de
-- contenido que se borra en DURO, asi que se reseteaban borrando lo ya escrito.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1.1 communities: el contenedor. Es el UNICO sitio de toda la funcionalidad
-- donde vive geografia. Las publicaciones NO llevan punto propio: heredan el de
-- su comunidad. Eso reduce la superficie de triangulacion de N publicaciones a
-- una fila por comunidad, y esa fila guarda el centro ya redondeado a ~1.1 km.
--
-- El nombre es INMUTABLE: no hay RPC que lo cambie y no hay GRANT de UPDATE. Un
-- nombre editable es la jugada del cebo -- fundar "Vecinos Angelopolis", juntar
-- a medio barrio y renombrar a lo que sea con toda la gente ya dentro. La
-- descripcion si se edita.
-- ---------------------------------------------------------------------------

create table if not exists public.communities (
  id                    uuid primary key default gen_random_uuid(),
  nombre                text not null,
  nombre_norm           text not null default '',
  celda                 text not null default '',
  descripcion           text,
  owner_id              uuid references public.profiles(id) on delete set null,
  centro                geography(POINT, 4326) not null,
  is_hidden             boolean not null default false,
  archived_at           timestamptz,
  miembros_count        integer not null default 0,
  publicaciones_count   integer not null default 0,
  ultima_publicacion_at timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

alter table public.communities enable row level security;

-- ---------------------------------------------------------------------------
-- QUIEN FUNDO, SEPARADO DE QUIEN MANDA HOY (hallazgo C-4).
--
-- owner_id NO es inmutable: la rama SALIR de alternar_membresia_comunidad lo
-- reasigna al relevo o lo pone a NULL, y delete_user_data hace lo mismo. Con
-- las tres cuotas de fundacion colgadas de owner_id salian dos fallos en la
-- misma causa: (a) fundar -> salir -> fundar reseteaba las tres cuotas en dos
-- peticiones, sin techo; y (b) heredar el mando de una comunidad ajena --
-- traspaso AUTOMATICO y NO consentido -- gastaba la cuota de fundar la propia.
--
-- fundador_id es inmutable (lo congela comunidad_normaliza) y es la columna
-- sobre la que cuelgan las tres cuotas. Va con ADD COLUMN IF NOT EXISTS para
-- que el archivo se pueda pegar dos veces.
--
-- Y NO lleva backfill. Lo llevaba -- "set fundador_id = owner_id where
-- fundador_id is null" -- y era danino: el archivo esta escrito para pegarse
-- dos veces, esa linea no tiene guardia de una sola pasada, y en una comunidad
-- ya traspasada owner_id es el HEREDERO. Cada re-aplicacion re-anclaba las tres
-- cuotas de fundacion a quien no fundo nada, que es exactamente el fallo que
-- esta columna existe para cerrar. Tampoco tenia nada legitimo que rellenar:
-- las cinco tablas nacen en ESTE archivo, asi que no hay ni una fila anterior a
-- la columna. fundar_comunidad manda fundador_id explicitamente y
-- comunidad_normaliza lo respalda en el INSERT con COALESCE(fundador_id,
-- owner_id) para cualquier otro camino de servidor.
--
-- Corolario, y va escrito tambien en el COMMENT de la columna: fundador_id NULL
-- significa "quien la fundo ya no existe" (la accion referencial ON DELETE SET
-- NULL) y ese estado NO se rellena con quien manda hoy.
-- ---------------------------------------------------------------------------
alter table public.communities
  add column if not exists fundador_id uuid references public.profiles(id) on delete set null;

-- Las constraints van declaradas aparte, con DROP IF EXISTS delante, para que
-- el archivo entero se pueda pegar dos veces por la Management API sin que la
-- segunda pasada muera con "constraint already exists".
alter table public.communities drop constraint if exists communities_nombre_largo;
alter table public.communities add constraint communities_nombre_largo
  check (char_length(btrim(nombre)) between 3 and 40);

-- Sin saltos de linea ni tabuladores: un nombre multilinea rompe la lista de
-- descubrimiento y permite dibujar cosas que no son un nombre. Se escribe con
-- chr() porque este archivo va en ASCII puro y sin bytes raros.
alter table public.communities drop constraint if exists communities_nombre_una_linea;
alter table public.communities add constraint communities_nombre_una_linea
  check (position(chr(10) in nombre) = 0
     and position(chr(13) in nombre) = 0
     and position(chr(9)  in nombre) = 0);

alter table public.communities drop constraint if exists communities_descripcion_larga;
alter table public.communities add constraint communities_descripcion_larga
  check (descripcion is null or char_length(descripcion) <= 300);

alter table public.communities drop constraint if exists communities_contadores_no_negativos;
alter table public.communities add constraint communities_contadores_no_negativos
  check (miembros_count >= 0 and publicaciones_count >= 0);

-- EL CHECK QUE IMPORTA. El centro que se guarda esta en la rejilla de ~1.1 km,
-- y no es una promesa de la RPC: es una restriccion de la tabla. Si algun dia
-- alguien inserta por SQL directo, por un seed o por service_role saltandose
-- fundar_comunidad, la fila se rechaza en vez de guardar el domicilio de quien
-- funda. Va con tolerancia en vez de igualdad exacta porque son dobles: el
-- redondeo es idempotente, pero no quiero que un bit de representacion tire un
-- INSERT legitimo.
alter table public.communities drop constraint if exists communities_centro_en_rejilla;
alter table public.communities add constraint communities_centro_en_rejilla
  check (
    abs(ST_X(centro::geometry) - round(ST_X(centro::geometry)::numeric, 2)::double precision) < 1e-9
    and abs(ST_Y(centro::geometry) - round(ST_Y(centro::geometry)::numeric, 2)::double precision) < 1e-9
  );

comment on table public.communities is
  'Comunidades hiperlocales. La unica via de escritura es fundar_comunidad(): authenticated no tiene INSERT, UPDATE ni DELETE sobre esta tabla.';
comment on column public.communities.centro is
  'Centro geografico, YA redondeado a ~1.1 km por fundar_comunidad y verificado por communities_centro_en_rejilla. NO concedido a ningun rol, ni SELECT: sale como distancia bucketizada desde descubrir_comunidades(), o crudo desde centro_de_mi_comunidad() y solo a quien tiene el MANDO ACTUAL de la comunidad (owner en su fila de membresia viva), que tras un traspaso no es necesariamente quien la fundo.';
comment on column public.communities.nombre is
  'INMUTABLE. No hay RPC que lo cambie ni GRANT de UPDATE.';
comment on column public.communities.nombre_norm is
  'Nombre sin acentos, sin mayusculas y sin separadores. Lo escribe el trigger comunidad_normaliza. Si el nombre no tiene ni una letra ni un digito latino (emojis, cirilico, chino) la normalizacion daria CADENA VACIA y dos nombres que no se parecen en nada chocarian en uq_communities_celda_nombre: en ese caso el trigger pone el md5 del nombre recortado, con lo que dos nombres distintos siguen siendo distintos y dos identicos siguen chocando. Derivada: no concedida.';
comment on column public.communities.fundador_id is
  'Quien la fundo. INMUTABLE y distinto de owner_id, que es quien manda HOY y cambia con el traspaso. Las tres cuotas de fundacion cuelgan de esta columna: sobre owner_id, soltarla en una peticion resetea el contador, y heredar el mando de una comunidad ajena gasta la cuota de fundar la propia. La inmutabilidad la aplica comunidad_normaliza y bloquea el RE-APUNTADO, no el vaciado: NULL significa "quien la fundo ya no existe" y lo escribe la accion referencial ON DELETE SET NULL, que TIENE que poder pasar. Ese NULL no se rellena nunca con quien manda hoy. NO se concede a ningun rol: es columna de control, no de producto.';
comment on column public.communities.celda is
  'Celda de ~1.1 km derivada del centro. Existe para el indice unico (celda, nombre_norm), no para consultar. NO concedida: es posicion absoluta, no distancia relativa.';
comment on column public.communities.owner_id is
  'ON DELETE SET NULL a proposito: borrar una cuenta no puede evaporar el barrio de 500 personas. delete_user_data traspasa antes el mando al miembro vivo mas antiguo.';
comment on column public.communities.archived_at is
  'Cierre voluntario por quien tiene el MANDO (owner en su fila de membresia viva) o por un admin, o automatico al quedarse sin miembros. Distinto de is_hidden, que es moderacion.';
comment on column public.communities.ultima_publicacion_at is
  'Solo avanza. NO se recalcula al borrar una publicacion: es una senal de actividad para ordenar el directorio, no un invariante, y un MAX() por cada borrado seria un escaneo.';
comment on column public.communities.is_hidden is
  'Moderacion. Distinto de archived_at: ocultar NO libera el nombre en su celda, para no regalarselo a un imitador.';


-- ---------------------------------------------------------------------------
-- 1.2 community_members: la pertenencia.
--
-- La PK es (user_id, community_id) EN ESE ORDEN, y no al reves: es el driver
-- del fan-out de feed_comunidades_explorar, que arranca con WHERE user_id = :yo
-- y necesita esas <=20 filas por un solo rango de indice. Con la PK invertida
-- seria un escaneo.
--
-- left_at es un borrado SUAVE, y no es cosmetico: con DELETE, la cuota de "10
-- altas en 24 h" se autoborraria sola, porque salir borra la fila que la
-- sostiene. El ciclo unirse -> volcar el muro -> salir -> repetir cosecharia
-- los muros de toda la ciudad sin tocar el tope nunca. Con la fila persistente,
-- unirse a N comunidades DISTINTAS en 24 h esta topado de verdad, y salir sigue
-- siendo instantaneo y gratis para quien se va.
-- ---------------------------------------------------------------------------

create table if not exists public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id      uuid not null references public.profiles(id)    on delete cascade,
  role         text not null default 'member',
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (user_id, community_id)
);

alter table public.community_members enable row level security;

-- NOT NULL con DEFAULT, nunca nullable. Una columna de estado que admite NULL
-- rompe a la vez el CHECK (en SQL, NULL <> 'x' da NULL, y un CHECK solo rechaza
-- con FALSE), el indice parcial y cualquier guardia que la mire.
alter table public.community_members drop constraint if exists community_members_role_valido;
alter table public.community_members add constraint community_members_role_valido
  check (role in ('member', 'moderator', 'owner'));

comment on table public.community_members is
  'Pertenencia. El padron NO es publico: solo ves tu propia fila, o el padron entero si moderas esa comunidad. En un barrio, saber quien es miembro es saber quien vive cerca.';
comment on column public.community_members.left_at is
  'Borrado suave. left_at IS NOT NULL = ya no es miembro. La fila se conserva para que la cuota de altas por 24 h no se pueda borrar saliendo y volviendo a entrar.';
comment on column public.community_members.role is
  'member | moderator | owner. Va desde el dia uno a proposito: anadirlo despues obliga a backfill Y a reescribir cada policy que lo mira.';
comment on column public.community_members.joined_at is
  'NO se resetea al volver a entrar. Si se reseteara, salir y volver borraria la prueba del alta y la cuota de 24 h volveria a ser burlable.';


-- ---------------------------------------------------------------------------
-- 1.3 community_posts: publicaciones de muro Y comentarios, en la misma tabla.
--
--   parent_post_id NULL  = publicacion de muro
--   parent_post_id lleno = comentario a esa publicacion (profundidad 1)
--
-- POR QUE NO SON DOS TABLAS. Cada tipo de contenido nuevo cuesta, ademas de la
-- tabla: un valor en report_target_type que NO se puede borrar nunca, una rama
-- en auto_hide_on_threshold, otra en handle_child_safety_report, otra en
-- moderate_set_content_hidden, una clave en el objeto de CUATRO claves fijas
-- del panel de admin, una rama en checkSelfReport, tres espejos de TypeScript y
-- una linea en delete_user_data. Un comentario y una publicacion tienen la
-- misma forma y la misma politica de moderacion: separarlos duplicaba las ocho
-- cosas para no ganar ni una columna.
--
-- NO lleva geometria: la geografia es de la comunidad.
-- NO lleva imagen en v1.
-- NO lleva updated_at ni se edita: solo se borra. Un UPDATE necesitaria un
-- WITH CHECK identico al USING o seria un secuestro de fila -- que es
-- literalmente como el comprador reasignaba vendedor_id de una reserva a un
-- tercero (20260827130000:57-62).
-- ---------------------------------------------------------------------------

create table if not exists public.community_posts (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities(id) on delete cascade,
  author_id         uuid not null references public.profiles(id)    on delete cascade,
  parent_post_id    uuid,
  cuerpo            text not null,
  is_hidden         boolean not null default false,
  likes_count       integer not null default 0,
  comentarios_count integer not null default 0,
  created_at        timestamptz not null default now()
);

alter table public.community_posts enable row level security;

alter table public.community_posts drop constraint if exists community_posts_cuerpo_largo;
alter table public.community_posts add constraint community_posts_cuerpo_largo
  check (char_length(btrim(cuerpo)) between 1 and 1500);

alter table public.community_posts drop constraint if exists community_posts_contadores_no_negativos;
alter table public.community_posts add constraint community_posts_contadores_no_negativos
  check (likes_count >= 0 and comentarios_count >= 0);

-- EL ORDEN DE ESTAS CUATRO SENTENCIAS NO ES CASUAL, y es lo que hace que el
-- archivo se pueda pegar dos veces. La clave foranea compuesta de abajo DEPENDE
-- del indice unico de aqui, asi que en la segunda pasada un
-- "drop constraint community_posts_id_comunidad_key" a secas moriria con 2BP01
-- ("cannot drop ... because other objects depend on it"). Se tira primero la
-- foranea, se rehace el unico, y se vuelve a poner la foranea al final. Sin
-- CASCADE en ningun sitio: un CASCADE aqui se llevaria por delante lo que no
-- nombra.
alter table public.community_posts drop constraint if exists community_posts_parent_fkey;

-- Redundante como indice (id ya es PK), imprescindible como DESTINO de la clave
-- foranea compuesta de abajo: Postgres exige un indice unico sobre exactamente
-- las columnas referenciadas.
alter table public.community_posts drop constraint if exists community_posts_id_comunidad_key;
alter table public.community_posts add constraint community_posts_id_comunidad_key
  unique (id, community_id);

-- Un comentario NO PUEDE pertenecer a otra comunidad que su publicacion madre,
-- y esto no es una promesa del codigo: es una clave foranea. Con MATCH SIMPLE
-- (el default), si parent_post_id es NULL la restriccion ni se evalua, asi que
-- las publicaciones de muro pasan sin tocarla.
--
-- Importa porque la visibilidad se decide por community_id: un comentario con
-- el community_id equivocado se leeria bajo la pertenencia equivocada. Hoy lo
-- garantiza ademas la RPC, y eso deja de bastar el dia que alguien conceda un
-- INSERT por comodidad.
--
-- (El DROP de esta misma foranea ya se hizo arriba, antes de rehacer el indice
-- unico del que depende. Aqui solo se vuelve a crear.)
alter table public.community_posts add constraint community_posts_parent_fkey
  foreign key (parent_post_id, community_id)
  references public.community_posts (id, community_id) on delete cascade;

comment on table public.community_posts is
  'Muro de comunidad. parent_post_id NULL = publicacion; lleno = comentario (profundidad 1, la impone publicar_en_comunidad). Se escribe y se borra solo por RPC.';
comment on column public.community_posts.parent_post_id is
  'NULL = publicacion de muro. Lleno = comentario a esa publicacion. Profundidad 1: publicar_en_comunidad rechaza responder a un comentario.';
comment on column public.community_posts.is_hidden is
  'Moderacion. Misma semantica que products_services.is_hidden. Lo escriben auto_hide_on_threshold, handle_child_safety_report y moderate_set_content_hidden; el cliente no tiene UPDATE sobre esta tabla.';
comment on column public.community_posts.likes_count is
  'Denormalizado, mantenido por trigger incremental con rama de DELETE. Contar en vivo era la alternativa y es la que muere: una publicacion con 10.000 likes recorreria 10.000 entradas de indice en CADA render del muro, siempre las mismas.';
comment on column public.community_posts.comentarios_count is
  'Denormalizado. Cuenta solo comentarios NO ocultos, por eso el trigger cubre tambien UPDATE OF is_hidden: un incremental sin rama de UPDATE se desincroniza en cuanto modera alguien, que es como se desincronizo reviews_count.';


-- ---------------------------------------------------------------------------
-- 1.4 community_post_likes: el corazon.
--
-- Copia la forma de favorites (par unico actor/objeto, sin UPDATE: un like no
-- se edita, se borra) pero SIN su columna id, que alli existe por inercia: la
-- PK compuesta ES la unicidad, ES el indice del LEFT JOIN que resuelve
-- "le_di_like" y ES el indice de la FK a community_posts. Un uuid sustituto
-- anadiria 16 bytes por fila y un indice mas que mantener sobre la tabla mas
-- escrita del producto, sin resolver ni una consulta.
--
-- RLS ACTIVA Y CERO POLICIES, CERO GRANTS, ni siquiera SELECT. No es un
-- descuido: "quien dio like" no se muestra. En una comunidad vecinal eso dice
-- quien esta en casa, quien conoce a quien y quien estuvo de acuerdo con algo
-- polemico. Con RLS activa y sin policies, ninguna consulta de anon ni de
-- authenticated devuelve una sola fila pase lo que pase con los grants: es la
-- unica configuracion en la que esa privacidad no depende de que nadie se
-- olvide de nada mas adelante. Precedente de tabla solo-service_role:
-- storage_cleanup_pending (20260826280000).
-- ---------------------------------------------------------------------------

create table if not exists public.community_post_likes (
  post_id    uuid not null references public.community_posts(id) on delete cascade,
  user_id    uuid not null references public.profiles(id)        on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.community_post_likes enable row level security;

comment on table public.community_post_likes is
  'Me gusta de publicaciones de comunidad. RLS activa y CERO policies a proposito: no es una tabla legible, es el respaldo de community_posts.likes_count. Se escribe solo por alternar_like_publicacion() y se lee solo desde las RPC del muro, que son SECURITY DEFINER.';


-- ---------------------------------------------------------------------------
-- 1.5 community_post_quota: el ledger que sostiene las tres cuotas de
-- escritura del muro (hallazgo C-3).
--
-- POR QUE EXISTE. Las cuotas contaban filas VIVAS del propio contenido:
-- publicar contaba community_posts, reaccionar contaba community_post_likes. Y
-- las dos tablas se borran en DURO -- eliminar_publicacion_comunidad hace
-- DELETE y esta permitido al autor sin cuota ninguna, y quitar un like borra su
-- fila. Un bucle de dos peticiones (publicar/eliminar, o like/unlike) devolvia
-- el contador a cero en cada vuelta, asi que los tres topes -- 10
-- publicaciones, 60 comentarios y 300 reacciones en 24 h -- no mordian NUNCA.
-- Y cada comentario deja una fila PERMANENTE en public.notifications que nada
-- borra: bombardeo ilimitado de bandeja contra una persona elegida, sin rastro
-- en el muro porque el atacante borra a los 200 ms.
--
-- Es exactamente el agujero que el diseno cerro a conciencia para las
-- membresias con left_at ("con DELETE, la cuota de 10 altas en 24 h se
-- autoborraria"), no trasladado al otro lado del muro. Aqui se cuentan
-- EVENTOS, no contenido superviviente: sin contenido, solo el hecho.
--
-- Una sola tabla con columna 'tipo', en vez de un booleano es_comentario: asi
-- cubre tambien las reacciones sin una segunda tabla -- y por eso la edicion de
-- descripcion, que llego despues como quinta superficie de escritura publica,
-- entro con un valor mas y no con una tabla mas.
--
-- LA PURGA VA EN ESTA MIGRACION, unas lineas mas abajo. Vivia en un comentario
-- que mandaba el trabajo "al cron de mantenimiento" y no habia tal cron: nada
-- del repo lo programaba. Sin purga, este ledger es una fila con marca de
-- tiempo por cada publicacion, comentario y reaccion del producto, para
-- siempre: un diario de actividad por persona que sobrevive al borrado del
-- contenido POR DISENO. Guardarlo 48 h es una cuota; guardarlo indefinidamente
-- es un perfil de rutinas que nadie decidio conservar.
-- ---------------------------------------------------------------------------

create table if not exists public.community_post_quota (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  tipo       text not null,
  created_at timestamptz not null default now()
);

alter table public.community_post_quota enable row level security;

alter table public.community_post_quota drop constraint if exists community_post_quota_tipo_valido;
alter table public.community_post_quota add constraint community_post_quota_tipo_valido
  check (tipo in ('publicacion','comentario','reaccion','descripcion'));

comment on table public.community_post_quota is
  'Ledger append-only que sostiene las cuotas de escritura publica. Existe porque community_posts y community_post_likes se borran en DURO: una cuota que cuenta filas vivas se resetea borrando lo que ya publicaste. Sin contenido, solo el hecho. RLS activa, CERO policies y CERO grants: solo lo escriben publicar_en_comunidad, alternar_like_publicacion y editar_descripcion_comunidad, que son SECURITY DEFINER. El indice (user_id, tipo, created_at desc) sirve a la vez la ventana y la FK a profiles; el de (created_at) sirve la purga. Retencion 48 h, aplicada por el job de pg_cron purga_community_post_quota que crea esta misma migracion.';
comment on column public.community_post_quota.tipo is
  'publicacion | comentario | reaccion | descripcion. Los cuatro topes viven en comunidades_limite(): publicaciones_24h, comentarios_24h, reacciones_24h y descripciones_24h.';

-- ---------------------------------------------------------------------------
-- LA PURGA, PROGRAMADA DE VERDAD Y AQUI.
--
-- Molde de 20260826190000_cron_expire_purchase_requests.sql, y por el mismo
-- motivo que aquel deja escrito: es SQL directo contra la base, no un
-- net.http_post a una Edge Function, asi que no le aplican ni el timeout de
-- pg_net ni la ceguera de net._http_response que tumbo a los otros tres jobs.
--
-- Idempotente sin ceremonia: cron.schedule con un jobname que ya existe
-- REEMPLAZA su definicion por esta misma. No hace falta un unschedule previo
-- envuelto en un bloque que se traga excepciones -- y un bloque asi seria justo
-- el fallo silencioso que este proyecto ya se ha comido dos veces.
--
-- La ventana de la cuota es de 24 h y la retencion de 48: el doble, para que un
-- desfase de reloj o un job que no corre un dia no borre cuota todavia viva.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'purga_community_post_quota',
  '17 4 * * *',
  $job$
  DELETE FROM public.community_post_quota
   WHERE created_at < now() - interval '48 hours'
  $job$
);


-- ===========================================================================
-- 2. INDICES
--
-- Ninguno lleva CONCURRENTLY: CREATE INDEX CONCURRENTLY no corre dentro de una
-- transaccion (esta escrito en 20260827140000:23) y esta migracion va envuelta
-- en begin;/commit;. Sobre tablas nuevas y vacias se construyen instantaneos,
-- asi que no hay nada que ganar y si un archivo que no se puede aplicar de una
-- sola pieza.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 2.1 communities
-- ---------------------------------------------------------------------------

-- Justifica: descubrir_comunidades().
--   ST_DWithin(c.centro, :punto, 5100)  -> sargable contra la caja del GiST
--   ORDER BY c.centro <-> :punto        -> KNN
-- Parcial porque una comunidad oculta o archivada no se descubre nunca, asi que
-- no tiene por que ocupar el indice ni ensuciar sus cajas.
create index if not exists idx_communities_centro
  on public.communities using gist (centro)
  where is_hidden = false and archived_at is null;

-- Justifica: el indice de la FK owner_id (la regla que dejo escrita
-- 20260827140000_once_claves_foraneas_sin_indice.sql). Ya NO es el rango de las
-- cuotas de fundacion: desde el hallazgo C-4 esas cuelgan de fundador_id, y su
-- indice es el de aqui abajo.
create index if not exists idx_communities_owner
  on public.communities (owner_id, created_at desc);

-- Justifica DOS cosas a la vez:
--   1. Es el indice de la FK fundador_id.
--   2. Es el rango que resuelven las tres cuotas de fundacion: cuantas tiene
--      vivas, cuantas fundo en las ultimas 24 horas y la separacion de 1 km.
create index if not exists idx_communities_fundador
  on public.communities (fundador_id, created_at desc);

-- Justifica: el anti-duplicado duro. No hay dos comunidades con el mismo nombre
-- normalizado en la misma celda de ~1.1 km. Global no: "Centro" y "Los Pinos"
-- existen legitimamente en veinte colonias distintas del pais.
--
-- Parcial por archived_at (archivar LIBERA el nombre) pero NO por is_hidden:
-- ocultar por moderacion no puede liberarle el nombre a un imitador.
--
-- Este indice es el que MANDA sobre el duplicado. fundar_comunidad NO hace una
-- comprobacion previa "amable": seria best-effort bajo concurrencia y mentiria
-- justo cuando importa. Lo unico que hace la RPC es atrapar el 23505 y
-- traducirlo a un mensaje legible.
create unique index if not exists uq_communities_celda_nombre
  on public.communities (celda, nombre_norm)
  where archived_at is null;


-- ---------------------------------------------------------------------------
-- 2.2 community_members
-- ---------------------------------------------------------------------------

-- La PK (user_id, community_id) ya resuelve la comprobacion de pertenencia y el
-- arranque del fan-out. Este es el parcial que lo hace INDEX ONLY: el driver de
-- feed_comunidades_explorar filtra left_at IS NULL, y sin el parcial esa
-- comprobacion obliga a bajar al heap por cada membresia.
create index if not exists idx_community_members_vivas
  on public.community_members (user_id, community_id)
  where left_at is null;

-- Justifica DOS cosas:
--   1. Es el padron de una comunidad.
--   2. Es el relevo de mando: "el miembro vivo mas antiguo" necesita orden
--      determinista por joined_at, y el desempate por user_id lo cierra.
--
-- Lo que NO justifica, aunque antes lo afirmara: la FK community_id. Este
-- indice es PARCIAL (WHERE left_at is null) y el chequeo que ejecuta una
-- cascada es 'community_id = $1' a secas, sin ese predicado: el planificador no
-- puede demostrarlo desde la consulta, asi que el indice queda INUSABLE ahi. Un
-- indice parcial nunca cubre una cascada. Por eso existe el de aqui abajo.
create index if not exists idx_community_members_padron
  on public.community_members (community_id, joined_at asc, user_id asc)
  where left_at is null;

-- Justifica: la clave foranea community_members.community_id -> communities.id
-- ON DELETE CASCADE (hallazgo I-13). TOTAL y no parcial a proposito, por el
-- motivo escrito justo arriba.
create index if not exists idx_community_members_comunidad
  on public.community_members (community_id);

-- Justifica: la cuota de altas por ventana de 24 h, que cuenta filas VIVAS Y
-- MUERTAS. Por eso este NO es parcial: si lo fuera, salir volveria a borrar la
-- prueba y la cuota se autoborraria otra vez.
create index if not exists idx_community_members_altas
  on public.community_members (user_id, joined_at desc);


-- ---------------------------------------------------------------------------
-- 2.3 community_posts
-- ---------------------------------------------------------------------------

-- ESTE INDICE ES EL PRODUCTO. Lo usan las dos RPC de muro, y sin el "Explorar"
-- pasa de milisegundos a cientos SIN devolver error, que es la unica forma en
-- que este tipo de fallo llega a produccion.
--
-- Cuatro decisiones dentro, y ninguna es de adorno:
--
--  (a) community_id de PREFIJO: el fan-out hace una exploracion de rango POR
--      comunidad y corta en result_limit. Sin ese prefijo no hay corte y hay
--      que ordenar todas las publicaciones de todas mis comunidades.
--
--  (b) created_at DESC, id DESC casa exactamente con el ORDER BY, y eso hace
--      que la comparacion de TUPLAS (created_at, id) < (cursor_time, cursor_id)
--      sea una CONDICION DE ARRANQUE del indice. Escrita en la forma expandida
--      (a < x OR (a = x AND b < y)) deja de serlo y degrada a filtro, que
--      recorre el rango entero desde el principio en cada pagina. Es la
--      diferencia entre O(log n) y O(n) en una sola linea, y las dos formas se
--      ven igual de razonables en una revision.
--
--  (c) INCLUDE (author_id): con eso, las tres columnas que necesita la fase de
--      candidatas (id, created_at, author_id) salen del propio indice y la
--      exploracion es Index Only Scan. Cero accesos al heap para las hasta 600
--      tuplas candidatas de una pagina.
--
--  (d) WHERE parent_post_id IS NULL AND is_hidden = FALSE: los dos predicados
--      fijos de toda lectura de muro. El indice no paga por los comentarios
--      (que van a ser mayoria) ni por lo oculto.
create index if not exists idx_community_posts_muro
  on public.community_posts (community_id, created_at desc, id desc)
  include (author_id)
  where parent_post_id is null and is_hidden = false;

-- Justifica: comentarios_de_publicacion(). ASCENDENTE, al reves que el muro,
-- porque un hilo se lee del mas viejo al mas nuevo y su cursor va con > en vez
-- de <. Es el unico sitio del diseno donde se invierte el sentido, y por eso
-- lleva indice propio en vez de reutilizar el de arriba.
create index if not exists idx_community_posts_hilo
  on public.community_posts (parent_post_id, created_at asc, id asc)
  where parent_post_id is not null and is_hidden = false;

-- Justifica: el indice de la FK author_id, las dos cuotas por ventana (10
-- publicaciones y 60 comentarios en 24 h, que son rangos sobre este mismo
-- indice) y el DELETE masivo de delete_user_data. Sin el, cada publicacion que
-- alguien escribe cuesta un seq scan para contar su ventana.
create index if not exists idx_community_posts_autor
  on public.community_posts (author_id, created_at desc);

-- Justifica: la clave foranea COMPUESTA community_posts_parent_fkey (hallazgo
-- I-13). El chequeo que ejecuta la cascada es 'parent_post_id = $1 AND
-- community_id = $2', y ni idx_community_posts_hilo (parcial por is_hidden, que
-- NO aparece en esa consulta, asi que el planificador no puede demostrar el
-- predicado) ni idx_community_posts_muro (parcial por parent_post_id IS NULL,
-- que la igualdad contradice) son utilizables. Sin este indice, cada
-- eliminar_publicacion_comunidad sobre una publicacion de muro es un Seq Scan
-- completo de community_posts, y delete_user_data encadena uno por publicacion.
--
-- El predicado de ESTE si es demostrable desde la igualdad (= es estricto, asi
-- que parent_post_id = $1 implica parent_post_id IS NOT NULL), de modo que
-- queda usable y ademas no paga por las publicaciones de muro.
create index if not exists idx_community_posts_padre
  on public.community_posts (parent_post_id, community_id)
  where parent_post_id is not null;

-- Justifica: la clave foranea community_posts.community_id -> communities.id
-- ON DELETE CASCADE. TOTAL y no parcial, por el MISMO motivo que
-- idx_community_members_comunidad: el chequeo que ejecuta la cascada es
-- 'community_id = $1' a secas y no puede usar el parcial de
-- idx_community_posts_muro (parent_post_id IS NULL AND is_hidden = FALSE, dos
-- predicados que esa consulta no trae), ni idx_community_posts_padre, que lleva
-- parent_post_id de prefijo.
--
-- Faltaba: la regla "un indice parcial nunca cubre una cascada" estaba escrita
-- tres veces y aplicada dos, y la que faltaba era la de la tabla GRANDE. Hoy no
-- hay DELETE de comunidad, igual que no lo hay para community_members, pero el
-- dia que lo haya (o un SQL manual) es un Seq Scan completo tomando FOR KEY
-- SHARE sobre lo que toca.
create index if not exists idx_community_posts_comunidad
  on public.community_posts (community_id);


-- ---------------------------------------------------------------------------
-- 2.4 community_post_likes
-- ---------------------------------------------------------------------------

-- La PK (post_id, user_id) es a la vez la unicidad, el indice del LEFT JOIN que
-- resuelve le_di_like con un sondeo unico por fila de la pagina, y el indice de
-- la FK a community_posts. No hace falta nada mas por ese lado, y en particular
-- NO existe un indice para "contar los likes de una publicacion": ese conteo no
-- se hace nunca, esta denormalizado en community_posts.likes_count.

-- Justifica: el indice de la FK a profiles, el borrado de cuenta, y la cuota de
-- 300 reacciones en 24 h.
create index if not exists idx_community_post_likes_usuario
  on public.community_post_likes (user_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 2.5 community_post_quota
-- ---------------------------------------------------------------------------

-- Justifica DOS cosas: la ventana de 24 h de las tres cuotas de escritura
-- (user_id, tipo, rango de created_at) y el indice de la FK a profiles, que
-- lleva user_id de prefijo.
create index if not exists idx_community_post_quota_ventana
  on public.community_post_quota (user_id, tipo, created_at desc);

-- Justifica: la purga de arriba, que filtra SOLO por created_at y por tanto no
-- tiene prefijo utilizable en el indice de la ventana. Sin este, el DELETE de
-- mantenimiento recorre entera la tabla mas escrita del producto en cada pasada
-- -- y pg_cron reporta exito sin leer la respuesta, asi que un job lento no
-- deja senal en ningun sitio.
create index if not exists idx_community_post_quota_purga
  on public.community_post_quota (created_at);


-- ---------------------------------------------------------------------------
-- 2.6 profiles (indice de apoyo, no es una tabla nueva)
-- ---------------------------------------------------------------------------

-- Justifica: el ANTI-JOIN de suspendidos de las tres RPC de muro. Cada fila
-- candidata lo SONDEA -- NOT EXISTS (select 1 from profiles pf where pf.id =
-- <autor> and pf.is_hidden) -- en vez de enumerar el conjunto entero.
--
-- El diseno original metia el censo de suspendidos DENTRO del arreglo
-- v_vetados, que es lo que este indice servia: un array_agg del conjunto GLOBAL
-- de suspendidos, ordenado, reconstruido en CADA peticion, y despues recorrido
-- LINEALMENTE por cada una de las hasta 600 candidatas. Con 5.000 suspendidos
-- -- is_hidden solo crece, nadie lo purga -- eran 3 millones de comparaciones y
-- un sort de 5.000 uuids por scroll y por usuario, sin dar error: solo lento,
-- en funcion de una variable que nadie mira (hallazgo I-7). Ahora el indice
-- sirve para SONDEAR ese conjunto, que es sargable, en vez de para listarlo.
--
-- Hace falta de verdad: el indice que ya existe, idx_profiles_hidden, es
-- PARCIAL sobre WHERE is_hidden = FALSE, o sea el conjunto CONTRARIO.
--
-- OJO: profiles es la unica tabla POBLADA que toca esta migracion. Sin
-- CONCURRENTLY (que no cabe dentro de begin;/commit;), este CREATE INDEX toma
-- un SHARE sobre profiles y bloquea las ESCRITURAS mientras se construye. Es un
-- indice parcial sobre un conjunto minusculo -- hoy hay muy pocos suspendidos
-- -- asi que se construye en milisegundos, pero conviene aplicar esta migracion
-- fuera de un pico de registros en vez de descubrirlo en caliente.
create index if not exists idx_profiles_suspendidos
  on public.profiles (id) where is_hidden = true;


-- ===========================================================================
-- 3. LOS CINCO HELPERS DE RLS (MAS hay_bloqueo_con), Y LA TABLA DE CUOTAS
--
-- Cinco los usan las policies y estan concedidos a authenticated. El sexto,
-- hay_bloqueo_con, nace en el hallazgo I-14: no lo llama ninguna policy ni el
-- cliente, solo dos RPC DEFINER, y por eso NO se concede a nadie.
--
-- Los helpers tienen UN SOLO argumento, y eso no es estilo. Con firma
-- (comunidad, usuario) serian ORACULOS DE PADRON: cualquiera podria probar
-- "esta Fulano en la comunidad de la calle X?" uuid a uuid, que es exactamente
-- la enumeracion que la RLS de community_members impide. Con un argumento solo
-- pueden responder por quien llama.
--
-- Van ANTES de las policies a proposito: Postgres resuelve la funcion en el
-- momento de crear la policy, asi que si no existieran el CREATE POLICY moriria
-- con "function does not exist".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 3.1 es_miembro_de_comunidad: SIN esto el diseno no arranca.
--
-- Una policy sobre community_members que consulte community_members provoca
-- "infinite recursion detected in policy" (42P17). Y aunque no recursara, un
-- subselect dentro de una policy corre bajo la RLS de la tabla referenciada: si
-- esa RLS esconde filas, la comprobacion pasa y la policy se abre sola. Es el
-- fallo que 20260826420000:15-32 documenta para chat-media.
--
-- No filtra nada que el llamante no supiera ya: solo responde por si mismo.
-- ---------------------------------------------------------------------------
create or replace function public.es_miembro_de_comunidad(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_members m
     where m.community_id = p_community_id
       and m.user_id      = (select auth.uid())
       and m.left_at is null
  );
$function$;

comment on function public.es_miembro_de_comunidad(uuid) is
  'SECURITY DEFINER obligatorio: la usan las policies, y un subselect normal a community_members desde su propia policy recursaria (42P17). Un solo argumento para que no sea un oraculo de padron. La llaman las RPC; la policy de community_posts usa mis_comunidades_ids(), que responde lo mismo una sola vez por consulta en vez de una por fila.';


-- ---------------------------------------------------------------------------
-- 3.1b mis_comunidades_ids: la MISMA pregunta que es_miembro_de_comunidad, pero
-- del reves, para que la policy de community_posts la resuelva UNA vez.
--
-- es_miembro_de_comunidad(community_id) depende de la fila, asi que en una
-- policy se ejecuta una vez POR FILA -- y es SECURITY DEFINER, o sea que nunca
-- se puede inlinear. Con las 500.000 filas de la escala de referencia, un
-- GET /rest/v1/community_posts?select=id&limit=1 de un authenticated sin
-- ninguna membresia son 500.000 EXISTS sobre community_members por una peticion
-- de ~200 bytes, repetible en bucle: el LIMIT se aplica DESPUES del filtro de
-- RLS. Envolverla en (select ...) NO lo arregla, porque la subconsulta seria
-- CORRELACIONADA y seguiria corriendo por fila; lo que hay que quitar es la
-- dependencia de la fila, y eso es esto.
--
-- Sin argumentos, asi que sigue sin ser un oraculo de padron: solo puede
-- responder por quien llama.
--
-- Devuelve SETOF y no un array a proposito, para que la policy pueda usar la
-- forma "community_id in (select ...)" -- que es el patron documentado de RLS y
-- se planifica como SubPlan hasheado: la funcion corre UNA vez y cada fila solo
-- sondea la tabla hash de <=20 uuids. La forma con array obliga a escribir
-- "= ANY ((select ...))", y ese doble parentesis lo lee el analizador como una
-- SUBCONSULTA y no como un array, asi que la comparacion acaba siendo
-- uuid = uuid[]. Un arreglo que no se puede escribir sin ambiguedad no es el
-- arreglo mas simple.
-- ---------------------------------------------------------------------------
create or replace function public.mis_comunidades_ids()
returns setof uuid
language sql
stable
security definer
set search_path to ''
as $function$
  select m.community_id
    from public.community_members m
   where m.user_id = (select auth.uid())
     and m.left_at is null;
$function$;

comment on function public.mis_comunidades_ids() is
  'Las comunidades vivas de quien llama. Existe para que la policy de community_posts resuelva la pertenencia UNA vez por consulta (SubPlan hasheado) en vez de una llamada SECURITY DEFINER por fila. Sin argumentos: no es un oraculo de padron.';


-- ---------------------------------------------------------------------------
-- 3.2 es_moderador_de_comunidad: quien manda DENTRO de una comunidad, y solo
-- ahi.
--
-- Se apoya en la fila de membresia con role, no en communities.owner_id, porque
-- owner_id puede quedar en NULL tras un borrado de cuenta: la verdad operativa
-- del mando tiene que sobrevivir a eso.
-- ---------------------------------------------------------------------------
create or replace function public.es_moderador_de_comunidad(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select exists (
    select 1
      from public.community_members m
     where m.community_id = p_community_id
       and m.user_id      = (select auth.uid())
       and m.left_at is null
       and m.role in ('owner', 'moderator')
  );
$function$;

comment on function public.es_moderador_de_comunidad(uuid) is
  'Mando LOCAL de una comunidad: owner o moderator en la fila de membresia viva. No mira communities.owner_id porque esa columna puede quedar NULL tras un borrado de cuenta.';


-- ---------------------------------------------------------------------------
-- 3.3 hay_bloqueo_con y autor_vetado_para_mi. La segunda da TRUE si hay bloqueo
-- en CUALQUIERA de las dos direcciones, o si el autor esta suspendido; la
-- primera responde SOLO por el bloqueo.
--
-- ESTA FUNCION CIERRA UN AGUJERO QUE YA ESTA ABIERTO EN PRODUCCION.
-- public.user_blocks tiene la policy "users_manage_own_blocks" FOR ALL TO
-- authenticated USING (auth.uid() = blocker_id) (20260429120001:57-61), y no
-- hay ninguna otra que le deje leer la fila al bloqueado. Por tanto, un NOT
-- EXISTS bidireccional escrito DENTRO de una policy solo ve la mitad en la que
-- YO bloqueo: la direccion contraria queda filtrada y el NOT EXISTS da true por
-- falta de PERMISO, no por falta de bloqueo. Es exactamente lo que le pasa hoy
-- a block_aware_profiles_select (20260429120001:87-95) y a sus tres hermanas.
--
-- Se fusionan bloqueo y suspension en una sola funcion por dos motivos: una
-- llamada por fila en vez de dos, y -- lo importante -- porque asi la
-- comprobacion de profiles.is_hidden ocurre DENTRO de un DEFINER, que corre
-- como su dueno y NO necesita el GRANT de columna del llamante. profiles tiene
-- grants por columna: una policy que referenciara is_hidden directamente
-- moriria con 42501 si ese grant no estuviera.
--
-- Fuga aceptada y declarada: permite averiguar "X me bloqueo" probando un uuid
-- que ya conoces. Es un bit por sonda sobre alguien cuyo id ya tienes, y el
-- bloqueo ya se manifiesta como invisibilidad. A cambio se cierra el agujero
-- real, que es que el bloqueo inverso no aplique.
-- ---------------------------------------------------------------------------
-- SE PARTE EN DOS (hallazgo I-14). autor_vetado_para_mi mezcla dos preguntas
-- distintas -- "esta suspendido" y "hay bloqueo entre nosotros" -- y hay dos
-- sitios donde la pregunta es sobre el MANDO de una comunidad entera, no sobre
-- un autor: descubrir_comunidades y la rama ENTRAR de
-- alternar_membresia_comunidad. Ahi, mirar la suspension apaga el
-- descubrimiento y el alta de una comunidad viva de 500 personas por lo que
-- hizo UNA cuenta -- y borrar esa misma cuenta la reenciende, porque owner_id
-- pasa a NULL por el ON DELETE SET NULL y la rama "owner_id IS NULL OR ..."
-- vuelve a dejarla pasar. Suspender castigaria mas que borrar.
--
-- El bloqueo bidireccional NO se duplica a mano en esos dos sitios: eso es
-- exactamente el patron que este diseno condena (el bug vivo de
-- block_aware_profiles_select). Se saca a un helper y autor_vetado_para_mi
-- delega en el, para que la definicion del bloqueo siga siendo UNA.
create or replace function public.hay_bloqueo_con(p_otro uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.user_blocks ub
        where (ub.blocker_id = (select auth.uid()) and ub.blocked_id = p_otro)
           or (ub.blocker_id = p_otro and ub.blocked_id = (select auth.uid()))
     );
$function$;

comment on function public.hay_bloqueo_con(uuid) is
  'Bloqueo BIDIRECCIONAL y SOLO bloqueo, sin la suspension. DEFINER por el mismo motivo que autor_vetado_para_mi: user_blocks tiene RLS USING (auth.uid() = blocker_id) y la direccion contraria se filtraria por falta de permiso. Existe porque hay dos sitios donde la pregunta es sobre el MANDO de una comunidad de 500 personas, y la suspension de UNA cuenta no puede apagarla para todos -- ni reencenderla al borrarla.';


create or replace function public.autor_vetado_para_mi(p_autor uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    exists (select 1 from public.profiles pf
             where pf.id = p_autor and pf.is_hidden = true)
    or public.hay_bloqueo_con(p_autor);
$function$;

comment on function public.autor_vetado_para_mi(uuid) is
  'Bloqueo BIDIRECCIONAL o autor suspendido. DEFINER porque user_blocks tiene RLS USING (auth.uid() = blocker_id): dentro de una policy, la direccion contraria se filtra y el NOT EXISTS da true por falta de permiso, no por falta de bloqueo. Y porque profiles tiene grants por columna.';


-- ---------------------------------------------------------------------------
-- 3.4 puedo_ver_publicacion: resuelve de un golpe comunidad viva y no oculta +
-- pertenencia + publicacion no oculta + autor no vetado. Es la comprobacion que
-- impide comentar o reaccionar a algo que no deberia verse.
--
-- NO incluye la rama de admin/moderador global a proposito: un moderador que
-- necesite ver un comentario de una publicacion oculta entra por la rama
-- has_role de la propia policy, para que este helper siga significando una sola
-- cosa.
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
       and exists (select 1 from public.community_members m
                    where m.community_id = p.community_id
                      and m.user_id      = (select auth.uid())
                      and m.left_at is null)
       and not public.autor_vetado_para_mi(p.author_id)
  );
$function$;

comment on function public.puedo_ver_publicacion(uuid) is
  'Comunidad viva y visible + pertenencia + publicacion no oculta + autor no vetado, en una sola llamada. Comentar y reaccionar exigen exactamente lo mismo que ver, y esta es la unica definicion de ese "lo mismo".';


-- ---------------------------------------------------------------------------
-- 3.5 comunidades_limite: todos los topes del producto, en una sola funcion
-- IMMUTABLE.
--
-- No es azucar. Dos de estos numeros son la MISMA invariante desde dos lados:
-- 'membresias_vivas' (20) x 'pagina_muro' (30) es la cota dura del fan-out del
-- muro unificado, 600 tuplas candidatas por pagina. Si alguien sube uno sin el
-- otro, o el muro empieza a ignorar comunidades del usuario EN SILENCIO, o el
-- coste por pagina crece sin que nadie lo haya pedido. Con los dos numeros aqui
-- hay un solo sitio que tocar y un solo sitio que leer.
--
-- Una clave desconocida REVIENTA. Un COALESCE por defecto habria convertido una
-- errata en "sin limite", que es el peor valor posible para una cuota.
-- ---------------------------------------------------------------------------
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
         ELSE NULL
       END;
  IF v IS NULL THEN
    RAISE EXCEPTION 'limite desconocido: %', p_clave USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$function$;

comment on function public.comunidades_limite(text) is
  'Tabla de cuotas del producto, en un solo sitio. membresias_vivas x pagina_muro = 600 es la cota dura del fan-out del muro unificado: subir uno sin el otro degrada el feed en silencio. Una clave desconocida lanza 22023 a proposito, porque un COALESCE habria convertido una errata en "sin limite".';


-- ===========================================================================
-- 4. TRIGGERS DE DERIVADAS, CONTADORES Y AVISOS
--
-- Son SIETE (el septimo, comunidad_releva_mando, entra por el hallazgo I-9). El
-- octavo, publicacion_cierra_sus_reportes, vive en el archivo 3 (20260905220000)
-- porque su cuerpo escribe el literal 'community_post', que no existe hasta que
-- el archivo 2 haya commiteado el ALTER TYPE.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4.1 Derivadas de la comunidad. El nombre se recorta y la celda se deriva
-- SIEMPRE del centro, tambien en UPDATE, para que no puedan desincronizarse. Un
-- trigger BEFORE corre antes de que se comprueben NOT NULL y CHECK, asi que
-- fundar_comunidad no manda ni nombre_norm ni celda.
--
-- El mapa de acentos se construye con chr() en vez de con un literal para que
-- este archivo quede en ASCII puro: un literal acentuado se veria identico en el
-- editor y podria llegar mutilado a produccion sin que nada lo delate (mismo
-- motivo escrito en 20260826400000:37-47).
-- ---------------------------------------------------------------------------
create or replace function public.comunidad_normaliza()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_acentos CONSTANT TEXT := chr(225)||chr(224)||chr(226)||chr(228)||chr(233)||chr(232)||chr(234)||chr(235)||chr(237)||chr(236)||chr(238)||chr(239)||chr(243)||chr(242)||chr(244)||chr(246)||chr(250)||chr(249)||chr(251)||chr(252)||chr(241)||chr(231);
  v_llanos  CONSTANT TEXT := 'aaaaeeeeiiiioooouuuunc';
BEGIN
  NEW.nombre      := btrim(NEW.nombre);
  NEW.nombre_norm := regexp_replace(
                       translate(lower(NEW.nombre), v_acentos, v_llanos),
                       '[^a-z0-9]+', '', 'g');

  -- Hallazgo I-6. Un nombre sin una sola letra ni digito latino (tres emojis,
  -- cirilico, chino, solo signos) pasa el CHECK de 3 a 40 caracteres y
  -- normaliza a CADENA VACIA. Entonces DOS nombres que no se parecen en nada
  -- chocarian en uq_communities_celda_nombre y fundar_comunidad traduciria ese
  -- 23505 a "ya existe una comunidad con ese nombre por aqui" MINTIENDO,
  -- ocupando ademas la ranura del nombre vacio para toda la celda de ~1.1 km y
  -- para siempre (el nombre es inmutable y no hay DELETE de comunidad en v1).
  --
  -- Con el md5 del nombre recortado la semantica del indice se conserva exacta:
  -- dos nombres distintos siguen siendo distintos y dos identicos siguen
  -- chocando. No se rechaza en el origen porque eso obligaria a duplicar el
  -- mapa de 22 acentos dentro de fundar_comunidad -- una segunda copia que
  -- deriva -- y prohibiria nombres legitimos en otros alfabetos. Y no lleva
  -- CHECK de no vacio: con esto el invariante ya se cumple siempre, y el CHECK
  -- solo anadiria un modo de fallo.
  IF NEW.nombre_norm = '' THEN
    NEW.nombre_norm := md5(lower(btrim(NEW.nombre)));
  END IF;

  NEW.celda       := round(ST_Y(NEW.centro::geometry)::numeric, 2)::text || ',' ||
                     round(ST_X(NEW.centro::geometry)::numeric, 2)::text;
  NEW.updated_at  := now();

  IF TG_OP = 'INSERT' THEN
    -- Quien funda queda fijado aqui, no en la RPC: fundador_id es la columna
    -- de la que cuelgan las tres cuotas de fundacion (hallazgo C-4). El
    -- COALESCE deja pasar el valor que manda fundar_comunidad y cubre
    -- cualquier INSERT de servidor que se olvide de mandarlo.
    NEW.fundador_id := COALESCE(NEW.fundador_id, NEW.owner_id);
    -- La moderacion no la decide quien funda.
    NEW.is_hidden   := FALSE;
    NEW.archived_at := NULL;
  ELSE
    -- fundador_id es INMUTABLE: si pudiera cambiar volveria a ser owner_id con
    -- otro nombre y las cuotas se resetearian otra vez.
    --
    -- Pero se congela el RE-APUNTADO, no el vaciado, y el IF es la diferencia
    -- entre las dos cosas. La accion referencial ON DELETE SET NULL de la FK a
    -- profiles NO es magia del motor: Postgres la ejecuta como un UPDATE
    -- ordinario sobre esta tabla, que dispara este mismo BEFORE. Congelando a
    -- secas, NEW.fundador_id volvia al valor viejo, la clave quedaba IGUAL y el
    -- motor se saltaba la comprobacion referencial (RI_FKey_check_upd corta en
    -- ri_KeysEqual antes de mirar nada). Resultado: la fila apuntaba para
    -- siempre a un perfil borrado, sin un solo error, y ni siquiera se podia
    -- reparar con un UPDATE porque este trigger lo revertia tambien.
    --
    -- Ningun otro camino escribe NULL aqui: authenticated no tiene UPDATE sobre
    -- communities y ninguna de las cinco RPC que la actualizan toca la columna.
    IF NEW.fundador_id IS NOT NULL THEN
      NEW.fundador_id := OLD.fundador_id;
    END IF;
    -- El nombre es inmutable. No hay GRANT de UPDATE, asi que esto solo puede
    -- dispararlo un camino de servidor; aun asi se blinda, porque el dia que
    -- alguien escriba un UPDATE de mantenimiento no puede renombrar por error
    -- ni mover el centro de una comunidad ya poblada.
    NEW.nombre      := OLD.nombre;
    NEW.nombre_norm := OLD.nombre_norm;
    NEW.centro      := OLD.centro;
    NEW.celda       := OLD.celda;
  END IF;

  RETURN NEW;
END;
$function$;

comment on function public.comunidad_normaliza() is
  'BEFORE INSERT OR UPDATE en communities. Deriva nombre_norm (con md5 del nombre recortado cuando la normalizacion daria cadena vacia, para que dos nombres no latinos distintos no choquen en el indice unico de la celda) y celda del centro, fija fundador_id desde owner_id en el INSERT, y CONGELA nombre, nombre_norm, centro y celda en cualquier UPDATE, mas fundador_id contra cualquier RE-APUNTADO. El unico cambio de fundador_id que se deja pasar es el vaciado a NULL de la accion referencial ON DELETE SET NULL: revertirlo dejaria la fila apuntando a un perfil borrado sin que el motor se queje, porque la comprobacion referencial se salta cuando la clave no cambia.';

drop trigger if exists comunidad_normaliza on public.communities;
create trigger comunidad_normaliza
  before insert or update on public.communities
  for each row execute function public.comunidad_normaliza();


-- ---------------------------------------------------------------------------
-- 4.2 miembros_count. Cuenta solo las filas VIVAS (left_at IS NULL), asi que
-- tiene que cubrir tambien el UPDATE que marca la salida y el que marca el
-- regreso. Un incremental que solo mira INSERT/DELETE se desincroniza en cuanto
-- alguien sale: es exactamente como se desincronizo reviews_count.
-- ---------------------------------------------------------------------------
create or replace function public.comunidad_cuenta_miembros()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.left_at IS NULL THEN
      UPDATE communities SET miembros_count = miembros_count + 1
       WHERE id = NEW.community_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.left_at IS NULL THEN
      UPDATE communities SET miembros_count = GREATEST(miembros_count - 1, 0)
       WHERE id = OLD.community_id;
    END IF;
    RETURN OLD;

  ELSE
    IF OLD.left_at IS NULL AND NEW.left_at IS NOT NULL THEN
      UPDATE communities SET miembros_count = GREATEST(miembros_count - 1, 0)
       WHERE id = NEW.community_id;
    ELSIF OLD.left_at IS NOT NULL AND NEW.left_at IS NULL THEN
      UPDATE communities SET miembros_count = miembros_count + 1
       WHERE id = NEW.community_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$function$;

comment on function public.comunidad_cuenta_miembros() is
  'Mantiene communities.miembros_count contando SOLO filas vivas. Cubre INSERT, DELETE y UPDATE OF left_at: sin la rama de UPDATE el contador se desincroniza en cuanto alguien sale, que es como se desincronizo reviews_count.';

drop trigger if exists comunidad_cuenta_miembros on public.community_members;
create trigger comunidad_cuenta_miembros
  after insert or delete or update of left_at on public.community_members
  for each row execute function public.comunidad_cuenta_miembros();


-- ---------------------------------------------------------------------------
-- 4.2b El relevo de mando, colgado de la TABLA y no de una funcion (hallazgo
-- I-9).
--
-- El traspaso vivia SOLO dentro de delete_user_data. Pero communities.owner_id
-- es ON DELETE SET NULL y community_members.user_id es ON DELETE CASCADE contra
-- profiles, que cuelga de auth.users. Un admin que borra a la fundadora desde
-- el boton "Delete user" del Dashboard de Supabase -- o cualquier DELETE sobre
-- auth.users que no llame antes a la Edge Function -- dispara la cascada:
-- desaparece la unica fila con role='owner' y owner_id queda NULL, sin que
-- reaccione nada.
--
-- El estado que queda es el peor posible y es SILENCIOSO: comunidad con
-- archived_at NULL, sus 200 miembros vivos, cero filas role='owner' y owner_id
-- NULL. es_moderador_de_comunidad devuelve false para todos, archivar_comunidad
-- falla para todos, y cuando el ultimo se vaya la rama de traspaso no se
-- ejecuta y la comunidad tampoco se archiva: miembros_count = 0, invisible en
-- el descubrimiento (que filtra miembros_count > 0) y ocupando su nombre en la
-- celda para siempre, porque uq_communities_celda_nombre es parcial por
-- archived_at IS NULL.
--
-- Mismo argumento con el que publicacion_cierra_sus_reportes se puso como
-- trigger: lo que tiene que valer tambien para la cascada no puede vivir dentro
-- de una RPC. Va en ESTE archivo y no en el de moderacion porque solo depende
-- de communities y community_members, asi que el invariante existe desde el
-- instante en que existen las tablas.
--
-- NO se dispara al SALIR: salir es un UPDATE de left_at, no un DELETE.
--
-- UN SOLO CAMINO DE TRASPASO. El traspaso estaba escrito TRES veces -- aqui, en
-- la rama SALIR de alternar_membresia_comunidad y en delete_user_data (archivo
-- 3) -- con tres corazas distintas, y las tres divergieron: una tomaba la llave
-- de mando y las otras dos no, una comprobaba left_at en el UPDATE y las otras
-- dos no, y la unica con "cinturon y tirantes" archivaba una comunidad viva de
-- 200 personas cuando el relevo desaparecia. Ahora la logica vive UNA vez, en
-- comunidad_traspasa_mando, y los tres sitios la llaman.
-- ---------------------------------------------------------------------------
create or replace function public.comunidad_traspasa_mando(
  p_community_id uuid,
  p_saliente     uuid
)
returns void
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE v_relevo uuid;
BEGIN
  -- LA LLAVE DE MANDO, AQUI Y NO EN CADA LLAMANTE. El mando es un invariante
  -- POR COMUNIDAD, no por usuario: dos salidas simultaneas de la misma
  -- comunidad tienen que serializarse aunque sean de dos personas distintas.
  -- Tomarla dentro es lo que garantiza que ningun camino se la olvide.
  --
  -- No introduce ciclo: esta funcion no pide ninguna llave de usuario, asi que
  -- el orden global usuario -> comunidad se sigue respetando. Y si el llamante
  -- ya la tiene (alternar_membresia_comunidad), volver a pedirla es un no-op:
  -- los advisory locks son reentrantes dentro de la misma transaccion.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:mando:' || p_community_id::text, 0));

  -- Mismo criterio determinista en los tres caminos: el miembro vivo mas
  -- antiguo por (joined_at, user_id). Que sea el MISMO es lo que hace el
  -- traspaso idempotente entre ellos.
  --
  -- FOR UPDATE es la coraza entera, y sustituye a las dos que habia. Bloquea la
  -- fila elegida en el mismo paso en que se elige, asi que no queda hueco entre
  -- el SELECT y el UPDATE: el borrado de esa fila -- delete_user_data o la
  -- cascada desde auth.users, los dos unicos caminos que NO toman la llave de
  -- mando -- ya no puede colarse en medio. Si la fila se borra o sale mientras
  -- tanto, LockRows la descarta y devuelve la SIGUIENTE candidata, que es
  -- exactamente lo que hay que hacer. Por eso ya no hace falta ningun
  -- IF NOT FOUND: v_relevo NULL significa "no queda nadie", nunca "fallo el
  -- UPDATE", y archivar deja de ser un efecto colateral de una carrera perdida.
  SELECT m.user_id INTO v_relevo
    FROM community_members m
   WHERE m.community_id = p_community_id
     AND m.user_id <> p_saliente
     AND m.left_at IS NULL
   ORDER BY m.joined_at ASC, m.user_id ASC
   LIMIT 1
     FOR UPDATE OF m;

  IF v_relevo IS NULL THEN
    UPDATE communities
       SET archived_at = COALESCE(archived_at, now()), owner_id = NULL
     WHERE id = p_community_id;
  ELSE
    UPDATE community_members SET role = 'owner'
     WHERE community_id = p_community_id AND user_id = v_relevo;
    UPDATE communities SET owner_id = v_relevo WHERE id = p_community_id;
  END IF;
END;
$function$;

comment on function public.comunidad_traspasa_mando(uuid, uuid) is
  'EL UNICO traspaso de mando del producto: lo llaman la rama SALIR de alternar_membresia_comunidad, el trigger comunidad_releva_mando y delete_user_data. Toma la llave comunidad:mando:<id> y elige al miembro vivo mas antiguo con FOR UPDATE, asi que la fila no puede desaparecer entre elegir y coronar. Si no queda nadie vivo, y SOLO en ese caso, archiva la comunidad y pone owner_id a NULL: archivar una comunidad con gente dentro no tiene vuelta atras en producto. No se concede a ningun rol: la llaman funciones SECURITY DEFINER y un trigger.';

create or replace function public.comunidad_releva_mando()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF OLD.role <> 'owner' OR OLD.left_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  -- Si la propia comunidad se esta borrando en cascada no hay nada que relevar,
  -- y la fila ya no esta para actualizarla.
  IF NOT EXISTS (SELECT 1 FROM communities c WHERE c.id = OLD.community_id) THEN
    RETURN OLD;
  END IF;

  PERFORM public.comunidad_traspasa_mando(OLD.community_id, OLD.user_id);
  RETURN OLD;
END;
$function$;

comment on function public.comunidad_releva_mando() is
  'AFTER DELETE en community_members. El traspaso de mando colgado de la TABLA y no de delete_user_data, porque el borrado en cascada desde auth.users (el boton Delete user del Dashboard) no pasa por ninguna RPC y dejaria la comunidad viva, con miembros y sin ni una fila role=owner. Delega en comunidad_traspasa_mando, que es donde viven la llave de mando y el FOR UPDATE. No se dispara al SALIR, que es un UPDATE de left_at.';

drop trigger if exists comunidad_releva_mando on public.community_members;
create trigger comunidad_releva_mando
  after delete on public.community_members
  for each row execute function public.comunidad_releva_mando();


-- ---------------------------------------------------------------------------
-- 4.3 La publicacion nace limpia. Aunque hoy no haya INSERT concedido a nadie,
-- esto ya esta puesto para el dia que se conceda por comodidad: el trigger no
-- puede equivocarse en esa direccion, solo pisa lo que nombra. El molde es
-- contadores_nacen_en_cero (20260827130000:138-157), que existe porque
-- authenticated podia nacer con 99999 ventas.
-- ---------------------------------------------------------------------------
create or replace function public.publicacion_nace_limpia()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  NEW.is_hidden         := FALSE;
  NEW.likes_count       := 0;
  NEW.comentarios_count := 0;
  NEW.created_at        := now();
  RETURN NEW;
END;
$function$;

comment on function public.publicacion_nace_limpia() is
  'BEFORE INSERT en community_posts. Fuerza is_hidden, los dos contadores y created_at desde el servidor, para que nadie pueda nacer con prueba social falsa ni con la fecha falseada.';

drop trigger if exists publicacion_nace_limpia on public.community_posts;
create trigger publicacion_nace_limpia
  before insert on public.community_posts
  for each row execute function public.publicacion_nace_limpia();


-- ---------------------------------------------------------------------------
-- 4.4 Los dos contadores que dependen de community_posts, en un solo trigger
-- porque comparten las tres transiciones (alta, baja y ocultado):
--   - communities.publicaciones_count   <- solo filas de muro (parent NULL)
--   - community_posts.comentarios_count <- solo comentarios, sobre su madre
--
-- Nota sobre el borrado en cascada: al borrar una publicacion de muro, sus
-- comentarios se van por la FK compuesta y este trigger intenta decrementar el
-- contador de una fila madre que ya no existe. El UPDATE afecta 0 filas y no
-- pasa nada. Es correcto y es deliberado.
-- ---------------------------------------------------------------------------
create or replace function public.publicacion_cuenta()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.parent_post_id IS NULL THEN
      UPDATE communities
         SET publicaciones_count   = publicaciones_count + 1,
             ultima_publicacion_at = GREATEST(COALESCE(ultima_publicacion_at, NEW.created_at),
                                              NEW.created_at)
       WHERE id = NEW.community_id;
    ELSE
      UPDATE community_posts SET comentarios_count = comentarios_count + 1
       WHERE id = NEW.parent_post_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.is_hidden = FALSE THEN
      IF OLD.parent_post_id IS NULL THEN
        UPDATE communities SET publicaciones_count = GREATEST(publicaciones_count - 1, 0)
         WHERE id = OLD.community_id;
      ELSE
        UPDATE community_posts SET comentarios_count = GREATEST(comentarios_count - 1, 0)
         WHERE id = OLD.parent_post_id;
      END IF;
    END IF;
    RETURN OLD;

  ELSE
    IF NEW.is_hidden AND NOT OLD.is_hidden THEN
      IF NEW.parent_post_id IS NULL THEN
        UPDATE communities SET publicaciones_count = GREATEST(publicaciones_count - 1, 0)
         WHERE id = NEW.community_id;
      ELSE
        UPDATE community_posts SET comentarios_count = GREATEST(comentarios_count - 1, 0)
         WHERE id = NEW.parent_post_id;
      END IF;
    ELSIF OLD.is_hidden AND NOT NEW.is_hidden THEN
      IF NEW.parent_post_id IS NULL THEN
        UPDATE communities SET publicaciones_count = publicaciones_count + 1
         WHERE id = NEW.community_id;
      ELSE
        UPDATE community_posts SET comentarios_count = comentarios_count + 1
         WHERE id = NEW.parent_post_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
END;
$function$;

comment on function public.publicacion_cuenta() is
  'Mantiene communities.publicaciones_count y community_posts.comentarios_count. Cubre INSERT, DELETE y UPDATE OF is_hidden: ocultar por moderacion tiene que descontar, o el contador miente en cuanto modera alguien.';

drop trigger if exists publicacion_cuenta on public.community_posts;
create trigger publicacion_cuenta
  after insert or delete or update of is_hidden on public.community_posts
  for each row execute function public.publicacion_cuenta();


-- ---------------------------------------------------------------------------
-- 4.5 likes_count. Mismo razonamiento, mas simple: un like no se edita, solo
-- nace y muere. Al borrar la publicacion, sus likes se van en cascada y este
-- trigger intenta actualizar una fila que ya no esta: 0 filas afectadas y nada
-- que arreglar.
-- ---------------------------------------------------------------------------
create or replace function public.publicacion_cuenta_likes()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET likes_count = likes_count + 1
     WHERE id = NEW.post_id;
    RETURN NEW;
  ELSE
    UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0)
     WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
END;
$function$;

comment on function public.publicacion_cuenta_likes() is
  'Mantiene community_posts.likes_count. Es lo que permite que el muro nunca cuente likes en vivo: una publicacion viral recorreria 10.000 entradas de indice en cada render.';

drop trigger if exists publicacion_cuenta_likes on public.community_post_likes;
create trigger publicacion_cuenta_likes
  after insert or delete on public.community_post_likes
  for each row execute function public.publicacion_cuenta_likes();


-- ---------------------------------------------------------------------------
-- 4.6 Aviso al autor cuando comentan su publicacion. Los LIKES no avisan:
-- notify_new_message se borro entero (20260511000001) por llenar notifications
-- de filas que la UI nunca pintaba, y un post con 40 likes serian 40 avisos sin
-- agrupacion posible (no hay tabla de agregacion ni cron que consolide).
--
-- SECURITY DEFINER obligatorio: notifications NO tiene NINGUNA policy de INSERT
-- y authenticated solo conserva GRANT UPDATE (leida), asi que un INSERT desde
-- el cliente muere con 42501 SIEMPRE. No se llama create_notification, que esta
-- revocada para todos (20260826080000:26-27) por haber sido phishing dentro del
-- producto, y que ademas no valida nada.
--
-- El EXCEPTION que se traga el error es del molde notify_appointment_created
-- (20260826140000:89-95): que falle el aviso no puede deshacer un comentario
-- que la persona ya vio publicado.
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

  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, data, leida, created_at)
  VALUES (v_autor_madre,
          'comunidad_comentario',
          'Nuevo comentario',
          COALESCE(NULLIF(btrim(v_quien), ''), 'Alguien') || ' comento tu publicacion en ' ||
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
  'AFTER INSERT en community_posts. Avisa al autor de la publicacion madre, y SOLO por comentario: los likes no notifican. Ignora el auto-comentario, respeta el bloqueo bidireccional y se traga sus propios errores con RAISE WARNING, porque un aviso fallido no puede deshacer un comentario ya publicado.';

drop trigger if exists notificar_comentario_de_comunidad on public.community_posts;
create trigger notificar_comentario_de_comunidad
  after insert on public.community_posts
  for each row execute function public.notificar_comentario_de_comunidad();


-- ===========================================================================
-- 5. POLICIES
--
-- Una policy por verbo, y TO authenticated explicito en todas.
--
-- LA REGLA ES "TODO LO QUE NO DEPENDE DE LA FILA VA ENVUELTO EN (select ...)",
-- no solo auth.uid(). Envuelto asi, Postgres lo evalua una vez por consulta
-- (InitPlan) y no una por fila (20260602000001:5-8).
--
-- El hallazgo I-12 es que el patron se aplico al auth.uid() de dentro y NO a
-- has_role(), que es lo caro porque consulta user_roles. Como la policy es una
-- cadena de OR, para toda fila que no sea del propio usuario Postgres evaluaba
-- las dos llamadas a has_role ANTES de llegar al bloque de pertenencia: un GET
-- /rest/v1/community_posts?select=id&limit=1 de un authenticated sin ninguna
-- membresia recorria la tabla entera -- el LIMIT se aplica DESPUES del filtro
-- de RLS -- con tres funciones SECURITY DEFINER por fila. Con las 500.000 filas
-- de la escala de referencia son 1,5 millones de llamadas por una peticion de
-- ~200 bytes, repetible en bucle por cualquiera con cuenta. No da error: se
-- pone lenta.
--
-- El arreglo se completo despues: la PERTENENCIA tambien colgaba de la fila y
-- por tanto seguia costando una llamada SECURITY DEFINER por fila. Ahi no valia
-- envolver -- una subconsulta correlacionada corre igual por fila --, habia que
-- quitar la dependencia de la fila, y por eso existe mis_comunidades_ids().
--
-- Lo que SI sigue dependiendo de la fila -- es_moderador_de_comunidad(
-- community_id) en la policy de membresias, autor_vetado_para_mi(author_id)
-- aqui -- se queda como esta: envolverlo no cambiaria nada y solo confundiria.
-- La primera se evalua solo para filas ajenas (el OR corta antes en la propia)
-- y la segunda solo despues del filtro de pertenencia, que ya es un InitPlan.
--
-- Van con DROP POLICY IF EXISTS delante para poder repegarse, y porque hay
-- precedente vivo de policies creadas desde el Dashboard que conviven con las
-- del repo y se OR-ean con ellas: las permissive no cierran, ABREN.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 5.1 communities
--
-- SELECT: quien tiene sesion ve el directorio de comunidades vivas. Es la
-- pestana "Otras comunidades" y tiene que funcionar sin pertenecer a ellas.
--
-- Lo que NO se ve por aqui es centro, nombre_norm ni celda: eso lo corta el
-- GRANT por columna, no la policy. Postgres exige privilegio de columna tambien
-- en el WHERE y en el ORDER BY, asi que ?centro=not.is.null y ?order=centro
-- mueren con 42501 igual que un select explicito.
-- ---------------------------------------------------------------------------
drop policy if exists "comunidades: el directorio es para quien tiene sesion" on public.communities;
create policy "comunidades: el directorio es para quien tiene sesion"
  on public.communities for select to authenticated
  using (
    (is_hidden = false and archived_at is null)
    or owner_id = (select auth.uid())
    or (select public.has_role((select auth.uid()), 'admin'::app_role))
    or (select public.has_role((select auth.uid()), 'moderator'::app_role))
  );

-- NO hay policy de INSERT, UPDATE ni DELETE, y tampoco GRANT de esos verbos.
-- Fundar, editar la descripcion y archivar pasan por RPC SECURITY DEFINER: es
-- la unica forma de que las cuotas anti-abuso existan. Con REST directo, un
-- authenticated recibe 42501 por dos motivos independientes (no tiene el
-- privilegio Y no hay policy que le abra la fila).
--
-- Un privilegio SIN policy tampoco valdria: filtra todas las filas y afecta
-- cero SIN devolver error, que es el fallo silencioso de 20260826240000:30-42.
-- Aqui no se deja ni uno de los dos.


-- ---------------------------------------------------------------------------
-- 5.2 community_members
--
-- SELECT: la mia, o el padron entero si modero esa comunidad, o admin. El
-- padron no es enumerable por un miembro cualquiera: en un barrio, "quien es
-- miembro" equivale a "quien vive cerca".
-- ---------------------------------------------------------------------------
drop policy if exists "membresias: la mia, o el padron si modero esa comunidad" on public.community_members;
create policy "membresias: la mia, o el padron si modero esa comunidad"
  on public.community_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.es_moderador_de_comunidad(community_id)
    or (select public.has_role((select auth.uid()), 'admin'::app_role))
  );

-- Sin policies de escritura. Unirse y salir es alternar_membresia_comunidad(),
-- que lleva dentro el tope de 20 simultaneas y la ventana de 10 altas por 24 h.


-- ---------------------------------------------------------------------------
-- 5.3 community_posts
--
-- Esta policy NO es decorativa aunque las lecturas vayan por RPC: authenticated
-- tiene GRANT SELECT sobre la tabla, asi que GET /rest/v1/community_posts es una
-- llamada real que alguien va a hacer. Es la respuesta a "que puede leer por
-- REST un authenticated malicioso".
--
-- Los cinco filtros van escritos aqui y REPETIDOS a mano dentro de las RPC,
-- porque las RPC son SECURITY DEFINER y no pasan por RLS. No es duplicacion
-- gratuita: son dos superficies distintas y las dos tienen que cerrar.
-- ---------------------------------------------------------------------------
drop policy if exists "publicaciones: solo dentro de mi comunidad" on public.community_posts;
create policy "publicaciones: solo dentro de mi comunidad"
  on public.community_posts for select to authenticated
  using (
    author_id = (select auth.uid())
    or (select public.has_role((select auth.uid()), 'admin'::app_role))
    or (select public.has_role((select auth.uid()), 'moderator'::app_role))
    or (
      is_hidden = false
      -- La pertenencia, resuelta UNA vez por consulta. Con
      -- es_miembro_de_comunidad(community_id) aqui -- que depende de la fila y
      -- es SECURITY DEFINER, o sea nunca inlineable -- este OR costaba una
      -- llamada POR FILA: 500.000 por un select de 200 bytes. Envolver esa
      -- llamada en (select ...) no habria servido de nada, porque la
      -- subconsulta seria CORRELACIONADA y correria igual por fila; lo que hay
      -- que quitar es la dependencia de la fila. Esta forma -- la documentada
      -- para RLS -- es una subconsulta SIN correlacion, asi que se planifica
      -- como SubPlan hasheado: una ejecucion y un sondeo hash por fila.
      and community_id in (select public.mis_comunidades_ids())
      and not public.autor_vetado_para_mi(author_id)
      and exists (
        select 1 from public.communities c
         where c.id = community_posts.community_id
           and c.is_hidden = false
           and c.archived_at is null
      )
    )
  );

-- NO hay policy de INSERT: publicar y comentar pasan por publicar_en_comunidad(),
-- que es donde viven la pertenencia, la profundidad 1, la coherencia de
-- comunidad y las dos cuotas por ventana.
--
-- NO hay policy de UPDATE, y por eso tampoco GRANT de UPDATE: en v1 no se
-- edita. Un UPDATE sin WITH CHECK identico al USING deja al autor reasignar
-- community_id y meter su publicacion en un muro ajeno; es el mismo secuestro
-- de fila que dejaba al comprador reasignar vendedor_id de una reserva
-- (20260827130000:57-62).
--
-- NO hay policy de DELETE tampoco: borrar pasa por
-- eliminar_publicacion_comunidad(), porque el borrado tiene que poder hacerlo
-- tambien el moderador local, y la comprobacion de rol no cabe en un USING sin
-- volver a apoyarse en la RLS de community_members.


-- ---------------------------------------------------------------------------
-- 5.4 community_post_likes
--
-- CERO POLICIES. A proposito, y documentado en el COMMENT de la tabla. Con RLS
-- activa y sin ninguna policy, ninguna consulta de anon ni de authenticated
-- devuelve una sola fila, pase lo que pase con los grants. Es la unica
-- configuracion en la que la privacidad de "quien dio like" no depende de que
-- nadie se olvide de nada mas adelante.
--
-- service_role sigue entrando: se salta RLS y grants por completo, que es lo
-- esperado para seeds y Edge Functions.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- 6. GRANTS
--
-- El ACL por defecto del esquema public le da HOY a authenticated INSERT,
-- UPDATE y DELETE de TABLA sobre TODAS las columnas de cualquier tabla nueva
-- (20260826360000:15-21; 20260826420000:139-140 solo recorto anon). Nada de eso
-- se hereda: se revoca y se declara a mano, en la MISMA migracion que crea la
-- tabla.
--
-- El REVOKE va FROM PUBLIC, anon, authenticated -- no solo de los dos roles
-- nominales. Todo rol hereda de PUBLIC, asi que revocar solo a anon y
-- authenticated deja el agujero abierto Y la comprobacion en verde, porque las
-- entradas nominales de la ACL si desaparecen (20260826261000:16-20).
--
-- TRUNCATE queda fuera de los dos roles siempre: NO esta sujeto a RLS. No
-- filtra, vacia.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 6.1 communities: GRANTS POR COLUMNA. Es la unica tabla del diseno que los
-- lleva, precisamente porque es la unica con columnas que el cliente no puede
-- ver jamas.
--
-- CONSECUENCIA QUE HAY QUE SABER: el cliente NUNCA puede hacer select("*")
-- sobre communities. Muere ENTERO con 42501, no solo la columna. Y toda columna
-- que se le anada en el futuro necesita su GRANT en la MISMA migracion: es la
-- causa raiz de la saga de onboarding (has_seen_onboarding) y del incidente de
-- modo_precio.
-- ---------------------------------------------------------------------------
revoke all on public.communities from public, anon, authenticated;
grant select (id, nombre, descripcion, is_hidden, archived_at,
              miembros_count, publicaciones_count, ultima_publicacion_at,
              created_at, updated_at)
  on public.communities to authenticated;
-- centro, nombre_norm, celda, owner_id y fundador_id quedan FUERA. Ese es el
-- punto entero.
--
-- owner_id SALE de la lista (hallazgo I-11). La policy de arriba abre toda
-- comunidad viva a cualquier authenticated, sin filtro de distancia, asi que
-- con owner_id concedido una sola peticion --
-- GET /rest/v1/communities?select=id,nombre,owner_id&limit=100000 -- devolvia
-- el censo nacional de comunidades con el uuid de quien manda en cada una. Los
-- nombres son toponimos de barrio por diseno ("Vecinos Angelopolis" es el
-- ejemplo de la propia especificacion), asi que eso es "la persona X vive en el
-- barrio Y" para todos los fundadores del producto a la vez: exactamente la
-- inferencia que el resto del diseno paga carisimo por impedir (centro snapeado
-- a ~1.1 km con CHECK, centro sin GRANT, radio constante, distancia en cubos de
-- 500 m). Y no lo pide ningun consumidor: descubrir_comunidades NO devuelve
-- owner_id, y lo que la pantalla necesita de mis_comunidades -- si mando aqui,
-- para pintar el boton de administrar -- ya sale resuelto en mi_rol. (Este
-- argumento decia "soy_fundador ya resuelto" y dejo de ser cierto cuando esa
-- columna paso a responder por fundador_id: lo que sustituye a owner_id es
-- mi_rol, no soy_fundador.)
--
-- fundador_id NO se anade por el mismo motivo, y ademas es columna de control.
--
-- La policy referencia owner_id en su USING, y eso NO exige el privilegio de
-- columna al llamante: el ACL se comprueba sobre las columnas de la consulta
-- del usuario, no sobre las que el motor anade con la policy. Aun asi la
-- comprobacion esta en el VERIFY (bloque C12) y es OBLIGATORIA antes de dar
-- esto por bueno: si diera 42501, la rama "owner_id = (select auth.uid())" se
-- mueve a un helper SECURITY DEFINER de un argumento, como los otros cuatro.
--
-- anon: nada. Comunidades es una capa social con sesion, no el escaparate.

-- ---------------------------------------------------------------------------
-- 6.2 community_members: SELECT de TABLA, no por columna.
--
-- Aqui no hay ni una columna secreta: la proteccion es de FILA (solo ves la
-- tuya, o el padron si moderas). Poner grants por columna donde nada es
-- sensible no protege nada y anade el modo de fallo mas caro del repo.
-- ---------------------------------------------------------------------------
revoke all on public.community_members from public, anon, authenticated;
grant select on public.community_members to authenticated;

-- ---------------------------------------------------------------------------
-- 6.3 community_posts: SELECT de TABLA. Sin INSERT, sin UPDATE, sin DELETE.
-- ---------------------------------------------------------------------------
revoke all on public.community_posts from public, anon, authenticated;
grant select on public.community_posts to authenticated;

-- ---------------------------------------------------------------------------
-- 6.4 community_post_likes: NADA. Ni SELECT.
-- ---------------------------------------------------------------------------
revoke all on public.community_post_likes from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6.4b community_post_quota: NADA tampoco, y por el mismo motivo elevado al
-- cuadrado. Es el ledger de las cuotas: si el cliente pudiera leerlo sabria
-- cuanto le queda, y si pudiera borrar una fila la cuota volveria a ser el
-- agujero que este ledger existe para cerrar. RLS activa y cero policies, asi
-- que ni con un grant accidental devolveria una fila.
-- ---------------------------------------------------------------------------
revoke all on public.community_post_quota from public, anon, authenticated;
-- Y la SECUENCIA de la identidad, que es un objeto APARTE con su propia ACL y
-- que el ALTER DEFAULT PRIVILEGES del esquema public tambien reparte (USAGE,
-- SELECT, UPDATE a anon y authenticated). El REVOKE de la tabla no la cubre.
-- Es la unica de las cinco tablas con clave sustituta, o sea la unica que tiene
-- secuencia y la unica donde cabe el descuido. Lo que se cerraria de mas: SELECT
-- expone last_value, que es el numero total de escrituras del producto -- justo
-- el dato que el COMMENT de la tabla dice no querer publicar -- y UPDATE
-- habilita setval() para cualquiera que llegue por SQL como authenticated.
revoke all on sequence public.community_post_quota_id_seq from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6.5 Helpers de RLS. El GRANT a authenticated es OBLIGATORIO aunque solo se
-- invoquen desde policies: una funcion llamada dentro de una policy la ejecuta
-- el ROL QUE CONSULTA. Sin este grant, toda lectura del muro muere con un 42501
-- que parece de RLS y se depura durante horas.
--
-- Y el REVOKE va FROM PUBLIC ademas de los dos roles: el permiso vive en
-- PUBLIC, y revocarselo solo a anon y authenticated deja el agujero abierto Y
-- la comprobacion en verde (20260827100000:8-24).
-- ---------------------------------------------------------------------------
revoke execute on function public.es_miembro_de_comunidad(uuid)    from public, anon, authenticated;
grant  execute on function public.es_miembro_de_comunidad(uuid)    to authenticated;

revoke execute on function public.mis_comunidades_ids()            from public, anon, authenticated;
grant  execute on function public.mis_comunidades_ids()            to authenticated;

revoke execute on function public.es_moderador_de_comunidad(uuid)  from public, anon, authenticated;
grant  execute on function public.es_moderador_de_comunidad(uuid)  to authenticated;

revoke execute on function public.autor_vetado_para_mi(uuid)       from public, anon, authenticated;
grant  execute on function public.autor_vetado_para_mi(uuid)       to authenticated;

-- hay_bloqueo_con se REVOCA y NO se concede: no la llama ninguna policy ni el
-- cliente, solo autor_vetado_para_mi y dos RPC, y las tres son SECURITY DEFINER
-- (corren como su dueno, que conserva el EXECUTE siempre). Concederla de mas
-- seria regalar un oraculo de bloqueo por REST sin que nada lo necesite.
revoke execute on function public.hay_bloqueo_con(uuid)            from public, anon, authenticated;

-- comunidad_traspasa_mando tampoco se concede, y por el mismo patron: la llaman
-- una RPC DEFINER, un trigger y delete_user_data. Concederla dejaria a
-- cualquiera destituir al mando de una comunidad ajena con una peticion.
revoke execute on function public.comunidad_traspasa_mando(uuid, uuid)
  from public, anon, authenticated;

revoke execute on function public.puedo_ver_publicacion(uuid)      from public, anon, authenticated;
grant  execute on function public.puedo_ver_publicacion(uuid)      to authenticated;

revoke execute on function public.comunidades_limite(text)         from public, anon, authenticated;
grant  execute on function public.comunidades_limite(text)         to authenticated;

-- ---------------------------------------------------------------------------
-- 6.6 Los triggers NO se conceden a nadie: los ejecuta el motor, y el
-- privilegio se comprueba al CREAR el trigger, no al dispararlo. El dueno de la
-- funcion (que es quien aplica esta migracion) lo conserva siempre.
--
-- publicacion_cierra_sus_reportes() NO aparece aqui: nace en el archivo 3, y su
-- REVOKE va en ese archivo, junto a su CREATE.
-- ---------------------------------------------------------------------------
revoke execute on function public.comunidad_normaliza()               from public, anon, authenticated;
revoke execute on function public.comunidad_cuenta_miembros()         from public, anon, authenticated;
revoke execute on function public.comunidad_releva_mando()            from public, anon, authenticated;
revoke execute on function public.publicacion_nace_limpia()           from public, anon, authenticated;
revoke execute on function public.publicacion_cuenta()                from public, anon, authenticated;
revoke execute on function public.publicacion_cuenta_likes()          from public, anon, authenticated;
revoke execute on function public.notificar_comentario_de_comunidad() from public, anon, authenticated;


-- ===========================================================================
-- 7. LAS TRECE RPC
--
-- Reglas que cumplen las trece sin excepcion:
--
-- Los argumentos obligatorios van primero y sin default; el resto lleva
-- DEFAULT, y los nulables DEFAULT NULL::<tipo> con el cast explicito. Es la
-- unica forma de que el codegen los tipe como opcionales: database.types.ts
-- saca con "?" exactamente los que tienen default, y el codegen NO declara
-- nulables los argumentos por si mismo.
--
-- Todo parametro nuevo va al final y con DEFAULT, y NUNCA se cambia la aridad
-- con CREATE OR REPLACE: eso crea una SOBRECARGA y PostgREST devuelve 300
-- PGRST203 a todas las llamadas que no manden el parametro nuevo. Ya paso, y la
-- home cargo con 200 y el feed vacio (20260826410000).
--
-- La firma va COMPLETA en el REVOKE y en el GRANT. Un GRANT a la firma
-- equivocada deja la funcion inaccesible con un 42501 que parece de RLS.
--
-- SECURITY DEFINER con SET search_path fijo, sin excepcion. Consecuencia: NO
-- pasan por RLS, asi que cada filtro va escrito a mano dentro -- publicacion
-- oculta, comunidad oculta o archivada, autor suspendido, bloqueo en las dos
-- direcciones, y pertenencia. Lo que se olvide, simplemente aparece en el muro.
--
-- El techo de filas se acota DENTRO de la funcion. No se confia en el cliente:
-- no hay rate limiting real en produccion.
--
-- Sin sesion, cero filas, y es una diferencia deliberada con
-- search_nearby_products_v4: alli v_viewer IS NULL significa "anon ve el feed
-- publico"; aqui significa que no hay nada.
--
-- CALIFICAR SIEMPRE LAS COLUMNAS. En plpgsql, los nombres declarados en
-- RETURNS TABLE(...) son VARIABLES, y una referencia sin calificar que coincida
-- con uno de ellos aborta con 42702 ambiguous column reference -- en tiempo de
-- EJECUCION, no de despliegue, asi que el CREATE pasa y la pagina revienta.
-- Aqui colisionan id, community_id, author_id, cuerpo, created_at, likes_count
-- y comentarios_count, o sea casi todo.
--
-- ALIAS QUE NO SE SOLAPAN NUNCA: c = comunidad, p = publicacion, hijo =
-- comentario, au = perfil del autor, l = like, m = membresia, k = subconsulta
-- de candidatas. La migracion 20260826181000:18-21 avisa de que en dos RPC
-- hermanas "pr" significaba cosas distintas y de que filtrar la columna
-- equivocada pasaria desapercibido porque las dos tablas tienen is_hidden.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7.1 feed_comunidades_explorar -- la sub-pestana "Explorar".
--
-- Muro unificado con lo mas reciente de TODAS mis comunidades. No lleva
-- argumentos geograficos y es correcto que no los lleve: el filtro es la
-- pertenencia, no la distancia, asi que esta pestana funciona igual sin permiso
-- de ubicacion. Devuelve escalares y no un blob jsonb: cada columna jsonb que
-- devuelve un RPC cuesta un validador escrito a mano en el cliente, porque el
-- codegen las tipa como Json.
--
-- Es STABLE SECURITY DEFINER con search_path 'public' porque tiene que leer
-- user_blocks de terceros y profiles.is_hidden de gente que la RLS le
-- esconderia.
-- ---------------------------------------------------------------------------
create or replace function public.feed_comunidades_explorar(
  cursor_time  timestamp with time zone default null::timestamp with time zone,
  cursor_id    uuid                     default null::uuid,
  result_limit integer                  default 30
)
returns table (
  id uuid, community_id uuid, community_nombre text,
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
  -- Validacion atomica del cursor, lo PRIMERO que hace el cuerpo, igual que en
  -- las otras dos RPC de lectura. Medio cursor es un cursor roto, y esto falla
  -- ruidoso en vez de paginar mal en silencio.
  --
  -- Va por encima del corte de sesion a proposito (hallazgo S-20): antes iba
  -- debajo, asi que una llamada sin sesion con medio cursor devolvia cero filas
  -- aqui y 22023 en las otras dos -- comportamiento distinto para la misma
  -- entrada malformada, y design.md afirmando que las tres lo lanzan como
  -- primera instruccion.
  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time y cursor_id se mandan juntos o no se mandan'
      USING ERRCODE = '22023';
  END IF;

  -- Envuelto en SELECT: se evalua una vez (InitPlan), no una por fila.
  v_viewer := (SELECT auth.uid());

  -- Sin sesion, cero filas. Un muro de comunidad no existe para anon.
  IF v_viewer IS NULL THEN RETURN; END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_muro'));

  -- -----------------------------------------------------------------------
  -- EL ARREGLO DE VETADOS. SOLO los bloqueos del visor, en las dos
  -- direcciones, resueltos UNA sola vez con dos exploraciones de indice.
  --
  -- search_nearby_products_v4 y feed_nearby_requests hacen el NOT EXISTS
  -- bidireccional POR FILA CANDIDATA. Aqui hay hasta 600 candidatas por
  -- pagina: serian 1200 sondeos de indice para descartar casi nada. Con el
  -- arreglo, el filtro dentro del lateral es una comparacion en memoria.
  --
  -- LOS SUSPENDIDOS YA NO ENTRAN AQUI (hallazgo I-7). Este arreglo esta
  -- ACOTADO al visor -- sus bloqueos, unos pocos --; el censo de suspendidos
  -- del producto no lo esta, no tiene ninguna correlacion con el visor ni con
  -- las comunidades de la pagina, y hay que ordenarlo para el array_agg
  -- DISTINCT. Metido dentro, "author_id <> ALL (v_vetados)" pasa a ser un
  -- recorrido LINEAL de 600 x N por pagina, mas un sort de N uuids en CADA
  -- peticion. Con 5.000 suspendidos -- is_hidden solo crece, nadie lo purga --
  -- son 3 millones de comparaciones por scroll y por usuario. La version
  -- elegida era peor que la que decia descartar en cuanto N pasa de ~2, y sin
  -- dar error: solo lenta. Van por anti-join sargable ahi abajo.
  -- -----------------------------------------------------------------------
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
    ) x;

  RETURN QUERY
  WITH candidatas AS (
    -- ===================================================================
    -- FAN-OUT ACOTADO. Una exploracion de rango POR comunidad, cada una
    -- cortada en v_limite.
    --
    -- POR QUE ES EXACTO Y NO UNA HEURISTICA: el top-K global de una union
    -- esta contenido en la union de los top-K por particion, siempre que
    -- cada particion aporte al menos K. Con K = v_limite en las dos, la
    -- pagina es identica a la que daria ordenar las 500.000 filas.
    --
    -- COROLARIO QUE NO SE PUEDE INCUMPLIR: TODO filtro de FILA va DENTRO
    -- del lateral. Un filtro por fuera puede vaciar el top-K de una
    -- comunidad, perder filas que si debian salir Y devolver una pagina
    -- corta -- y el cliente decide hasMore con items.length === limit, asi
    -- que una pagina corta APAGA el feed. Los filtros de PARTICION
    -- (comunidad oculta o archivada) si van fuera: descartar una particion
    -- entera antes del fan-out no puede perder nada de otra.
    -- ===================================================================
    SELECT p.p_id, p.p_created
      FROM community_members m
      JOIN communities c
        ON c.id = m.community_id
       AND c.is_hidden = FALSE          -- filtro de PARTICION
       AND c.archived_at IS NULL        -- filtro de PARTICION
      CROSS JOIN LATERAL (
        SELECT cp.id AS p_id, cp.created_at AS p_created
          FROM community_posts cp
         WHERE cp.community_id   = m.community_id
           AND cp.parent_post_id IS NULL       -- filtro de FILA: dentro
           AND cp.is_hidden      = FALSE       -- filtro de FILA: dentro
           AND cp.author_id <> ALL (v_vetados) -- filtro de FILA: dentro
           -- Suspendidos por ANTI-JOIN y NO dentro de v_vetados: ese arreglo
           -- es del visor (sus bloqueos) y esta acotado; el censo de
           -- suspendidos del producto no lo esta, y metido ahi convierte el
           -- filtro en una comparacion lineal de 600 x N por pagina que solo
           -- crece. Sondea idx_profiles_suspendidos (id) WHERE is_hidden, que
           -- esta migracion ya crea. Sigue siendo un filtro de FILA DENTRO del
           -- lateral, asi que el corolario de arriba se respeta.
           AND NOT EXISTS (SELECT 1 FROM profiles pf
                            WHERE pf.id = cp.author_id AND pf.is_hidden)
           -- Comparacion de TUPLAS, no (a < x OR (a = x AND b < y)). La
           -- forma de tupla es una CONDICION DE ARRANQUE del indice; la
           -- expandida degrada a filtro y recorre el rango entero. Esta
           -- linea es la diferencia entre O(log n) y O(n), y las dos formas
           -- se ven igual de razonables en una revision.
           AND (cursor_time IS NULL
                OR (cp.created_at, cp.id) < (cursor_time, cursor_id))
         ORDER BY cp.created_at DESC, cp.id DESC
         LIMIT v_limite
      ) p
     WHERE m.user_id = v_viewer
       AND m.left_at IS NULL
  ),
  pagina AS MATERIALIZED (
    -- MATERIALIZED es una barrera explicita: garantiza que los joins de
    -- hidratacion corren sobre estas <=30 filas y no se empujan hacia abajo.
    SELECT k.p_id, k.p_created FROM candidatas k
     ORDER BY k.p_created DESC, k.p_id DESC
     LIMIT v_limite
  )
  -- =====================================================================
  -- HIDRATACION. Aqui es donde moriria un N+1: el perfil del autor, el
  -- nombre de la comunidad y le_di_like se resuelven con tres joins sobre 30
  -- filas, no con una consulta por publicacion ni sobre las 600 candidatas.
  --
  -- le_di_like es un LEFT JOIN contra la PK (post_id, user_id): 30 sondeos
  -- unicos, exactos, sin contar nada.
  --
  -- likes_count y comentarios_count salen ya calculados de la fila. Contarlos
  -- aqui haria que una publicacion viral con 10.000 likes recorriera 10.000
  -- entradas de indice en cada render del muro.
  -- =====================================================================
  SELECT p.id, p.community_id, c.nombre,
         p.author_id, au.nombre, au.foto,
         -- Cast explicito del enum a TEXT. La migracion
         -- 20260618080003_hotfix_search_v4_types.sql existe SOLO para esto:
         -- sin el cast, "return type mismatch".
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
  'Muro unificado de todas mis comunidades. Fan-out CROSS JOIN LATERAL acotado a membresias x limite (600 tuplas), NO community_id = ANY(array) ni un indice global por fecha: los dos degradan sin dar error. Todo filtro de FILA va dentro del lateral o la pagina sale corta y el cliente apaga el feed.';

revoke execute on function public.feed_comunidades_explorar(
  timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.feed_comunidades_explorar(
  timestamp with time zone, uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.2 feed_muro_comunidad -- el muro de UNA comunidad, /comunidades/[id].
--
-- La forma de fila es byte a byte la misma que la de Explorar, a proposito: el
-- cliente declara un solo tipo y reutiliza la misma tarjeta, el mismo
-- useInfiniteCursor y el mismo makeFeedCursor en las dos sub-pestanas. Sin
-- fan-out: una sola exploracion de rango, que es el caso para el que
-- idx_community_posts_muro esta hecho.
-- ---------------------------------------------------------------------------
create or replace function public.feed_muro_comunidad(
  p_community_id uuid,
  cursor_time    timestamp with time zone default null::timestamp with time zone,
  cursor_id      uuid                     default null::uuid,
  result_limit   integer                  default 30
)
returns table (
  id uuid, community_id uuid, community_nombre text,
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
  v_vetados UUID[];
BEGIN
  v_viewer := (SELECT auth.uid());

  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time y cursor_id se mandan juntos o no se mandan'
      USING ERRCODE = '22023';
  END IF;

  -- El permiso se COMPRUEBA, no se deduce de un NULL. Deducirlo es como
  -- delete_user_data fallaba ABIERTA: "IF auth.uid() IS NOT NULL AND ..." era
  -- falso para anon y la ejecucion seguia derecha a los DELETE
  -- (20260827100000:26-30).
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  SELECT c.nombre INTO v_nombre
    FROM communities c
   WHERE c.id = p_community_id
     AND c.is_hidden = FALSE
     AND c.archived_at IS NULL;
  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- Un NO miembro recibe un 42501 explicito y no una lista vacia: la lista
  -- vacia se lee como bug, y ademas ya sabe que la comunidad existe porque la
  -- acaba de ver en "Otras comunidades".
  IF NOT public.es_miembro_de_comunidad(p_community_id) THEN
    RAISE EXCEPTION 'Unete a la comunidad para ver su muro.' USING ERRCODE = '42501';
  END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_muro'));

  -- Solo los bloqueos del visor. Los suspendidos van por anti-join dentro de
  -- la subconsulta de candidatas, no en este arreglo: ver el motivo largo en
  -- feed_comunidades_explorar (hallazgo I-7).
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
    ) x;

  RETURN QUERY
  SELECT k.id, p_community_id, v_nombre,
         k.author_id, au.nombre, au.foto, au.trust_level::TEXT,
         k.cuerpo, k.created_at,
         k.likes_count, k.comentarios_count,
         (l.user_id IS NOT NULL)
    FROM (
      -- Una sola exploracion de rango. El ORDER BY y el predicado del cursor
      -- son exactamente el par que declara idx_community_posts_muro, asi que
      -- hay recuperacion ordenada por indice y no hay nodo Sort.
      SELECT p.id, p.author_id, p.cuerpo, p.created_at,
             p.likes_count, p.comentarios_count
        FROM community_posts p
       WHERE p.community_id   = p_community_id
         AND p.parent_post_id IS NULL
         AND p.is_hidden      = FALSE
         AND p.author_id <> ALL (v_vetados)
         -- Suspendidos por anti-join sargable contra idx_profiles_suspendidos,
         -- no dentro de v_vetados (hallazgo I-7).
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
  'Muro de una comunidad. Forma de fila IDENTICA a feed_comunidades_explorar para que el cliente declare un solo tipo y reutilice la misma tarjeta. Un no miembro recibe 42501 explicito, no una lista vacia: la lista vacia se lee como bug.';

revoke execute on function public.feed_muro_comunidad(
  uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.feed_muro_comunidad(
  uuid, timestamp with time zone, uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.3 comentarios_de_publicacion -- el hilo, paginado.
--
-- Es la otra mitad de la respuesta al N+1: el muro devuelve solo
-- comentarios_count (denormalizado, coste cero) y el hilo se pide UNA vez al
-- abrir la hoja. Lo que NO se hace es traer los ultimos N comentarios embebidos
-- en cada fila del muro, que multiplica por N el trabajo de una pantalla en la
-- que casi nadie abre los hilos.
--
-- puedo_borrar se calcula en la base para que el cliente no reimplemente la
-- regla de permisos en TypeScript y se equivoque.
-- ---------------------------------------------------------------------------
create or replace function public.comentarios_de_publicacion(
  p_post_id    uuid,
  cursor_time  timestamp with time zone default null::timestamp with time zone,
  cursor_id    uuid                     default null::uuid,
  result_limit integer                  default 30
)
returns table (
  id uuid, author_id uuid, author_nombre text, author_foto text,
  cuerpo text, created_at timestamp with time zone, puedo_borrar boolean
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer      UUID;
  v_limite      INT;
  v_autor_madre UUID;
  v_comunidad   UUID;
  v_mando       BOOLEAN;
  v_vetados     UUID[];
BEGIN
  v_viewer := (SELECT auth.uid());

  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time y cursor_id se mandan juntos o no se mandan'
      USING ERRCODE = '22023';
  END IF;

  IF v_viewer IS NULL THEN RETURN; END IF;

  -- Devuelve vacio en vez de error, al reves que feed_muro_comunidad: alli el
  -- uuid de la comunidad ya lo viste en el descubrimiento; aqui un uuid de
  -- publicacion ajena solo se conoce si te lo pasaron, y confirmar que existe
  -- no aporta nada.
  IF NOT public.puedo_ver_publicacion(p_post_id) THEN RETURN; END IF;

  SELECT p.author_id, p.community_id INTO v_autor_madre, v_comunidad
    FROM community_posts p WHERE p.id = p_post_id;

  -- El autor de la publicacion entra a proposito: es el unico que esta mirando
  -- su propio hilo y el que puede limpiar spam sin esperar a nadie.
  v_mando := (v_autor_madre = v_viewer)
             OR public.es_moderador_de_comunidad(v_comunidad)
             OR public.has_role(v_viewer, 'admin'::app_role)
             OR public.has_role(v_viewer, 'moderator'::app_role);

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_muro'));

  -- Solo los bloqueos del visor. Los suspendidos van por anti-join sobre el
  -- alias hijo, no en este arreglo (hallazgo I-7).
  SELECT COALESCE(array_agg(DISTINCT u), ARRAY[]::UUID[]) INTO v_vetados
    FROM (
      SELECT ub.blocked_id AS u FROM user_blocks ub WHERE ub.blocker_id = v_viewer
      UNION ALL
      SELECT ub.blocker_id     FROM user_blocks ub WHERE ub.blocked_id = v_viewer
    ) x;

  RETURN QUERY
  SELECT k.id, k.author_id, au.nombre, au.foto, k.cuerpo, k.created_at,
         (v_mando OR k.author_id = v_viewer)
    FROM (
      -- ASCENDENTE y con > en el cursor: un hilo se lee del mas viejo al mas
      -- nuevo. Es el unico sitio del diseno donde se invierte el sentido, y por
      -- eso idx_community_posts_hilo existe aparte del indice del muro.
      SELECT hijo.id, hijo.author_id, hijo.cuerpo, hijo.created_at
        FROM community_posts hijo
       WHERE hijo.parent_post_id = p_post_id
         AND hijo.is_hidden = FALSE
         AND hijo.author_id <> ALL (v_vetados)
         -- Suspendidos por anti-join sargable contra idx_profiles_suspendidos,
         -- no dentro de v_vetados (hallazgo I-7).
         AND NOT EXISTS (SELECT 1 FROM profiles pf
                          WHERE pf.id = hijo.author_id AND pf.is_hidden)
         AND (cursor_time IS NULL
              OR (hijo.created_at, hijo.id) > (cursor_time, cursor_id))
       ORDER BY hijo.created_at ASC, hijo.id ASC
       LIMIT v_limite
    ) k
    JOIN profiles au ON au.id = k.author_id
   ORDER BY k.created_at ASC, k.id ASC;
END;
$function$;

comment on function public.comentarios_de_publicacion(uuid, timestamp with time zone, uuid, integer) is
  'Hilo de una publicacion, ASCENDENTE y con cursor > (unico sitio del diseno donde se invierte el sentido). puedo_borrar se calcula aqui para que el cliente no reimplemente la regla de permisos en TypeScript.';

revoke execute on function public.comentarios_de_publicacion(
  uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.comentarios_de_publicacion(
  uuid, timestamp with time zone, uuid, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.4 mis_comunidades -- la sub-pestana "Tus comunidades".
--
-- Directorio mas rail horizontal del home. Esta es la RPC que justifica los
-- cuatro contadores denormalizados: sin ellos habria un COUNT por comunidad
-- para miembros, otro para publicaciones y un MAX(created_at) por comunidad
-- para ordenar por actividad -- sesenta subconsultas agregadas por render. Con
-- ellos es un rango de indice mas veinte sondeos a la PK de communities.
-- ---------------------------------------------------------------------------
create or replace function public.mis_comunidades()
returns table (
  id uuid, nombre text, descripcion text, mi_rol text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  soy_fundador boolean
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
         -- fundador_id y NO m.role. Desde el hallazgo C-4 son dos hechos
         -- distintos: el mando se traspasa y quien fundo no cambia nunca. Con
         -- (m.role = 'owner') esta columna mentia en las DOS direcciones --
         -- quien hereda una comunidad ajena recibia la insignia de fundador y
         -- quien la fundo la perdia al traspasarla -- y era la unica salida al
         -- cliente de una distincion que la base paga con una columna, un
         -- indice y un congelador. Lo que la pantalla necesita para el boton de
         -- administrar es mi_rol, que ya sale por su propia columna.
         --
         -- COALESCE porque fundador_id puede quedar NULL (ON DELETE SET NULL) y
         -- una columna booleana de salida no debe llegar NULL al cliente.
         --
         -- La firma NO cambia: mismo nombre, mismo tipo y misma aridad, asi que
         -- no hay DROP FUNCTION, ni sobrecarga, ni 300 PGRST203.
         COALESCE(c.fundador_id = v_viewer, FALSE)
    FROM community_members m
    JOIN communities c ON c.id = m.community_id
   WHERE m.user_id = v_viewer
     AND m.left_at IS NULL
     AND c.is_hidden   = FALSE
     AND c.archived_at IS NULL
   -- Ordenado por actividad, con NULLS LAST para que una comunidad recien
   -- fundada y todavia sin publicaciones no encabece el directorio. Es tambien
   -- lo que hace que, si alguien se muda, las comunidades de la ciudad vieja se
   -- hundan solas sin necesidad de expulsar a nadie por GPS.
   ORDER BY c.ultima_publicacion_at DESC NULLS LAST, c.nombre ASC
   -- El +10 deja aire sobre el tope y sigue siendo un techo: nada se corta en
   -- silencio, pero tampoco hay una consulta sin LIMIT.
   LIMIT public.comunidades_limite('membresias_vivas') + 10;
END;
$function$;

comment on function public.mis_comunidades() is
  'Directorio de mis comunidades vivas, ordenado por actividad con NULLS LAST. Es la RPC que justifica los cuatro contadores denormalizados: sin ellos serian sesenta subconsultas agregadas por render. mi_rol responde "que mando tengo aqui" y soy_fundador responde "la funde yo", contra fundador_id: desde el hallazgo C-4 son dos hechos distintos y esta es la unica salida al cliente del segundo.';

revoke execute on function public.mis_comunidades() from public, anon, authenticated;
grant  execute on function public.mis_comunidades() to authenticated;


-- ---------------------------------------------------------------------------
-- 7.5 descubrir_comunidades -- la sub-pestana "Otras comunidades".
--
-- NO HAY PARAMETRO DE RADIO, y esa ausencia es la defensa principal. El ataque
-- que el snap de la entrada intenta frenar es la busqueda binaria de la
-- distancia: variar el radio entre llamadas y mirar si una comunidad conocida
-- entra o sale. Si el radio no se puede variar, ese oraculo no existe de raiz.
-- Un radius_meters con LEAST/GREATEST acota el oraculo a unos cuantos escalones
-- en vez de eliminarlo, ademas de anadir un argumento a la firma -- y en este
-- repo cada argumento es una sobrecarga futura y un 300 PGRST203 esperando.
-- El producto dice 5 km, no "un radio".
-- ---------------------------------------------------------------------------
create or replace function public.descubrir_comunidades(
  p_lat        double precision,
  p_lng        double precision,
  result_limit integer default 30
)
returns table (
  id uuid, nombre text, descripcion text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  distancia_m integer
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
  -- 5 km, CONSTANTE. Y +100 m de colchon, que es el mismo de todo el feed: el
  -- snap de coordenadas desplaza el punto hasta ~77 m en esta latitud, y sin el
  -- colchon expulsaria comunidades que si estaban dentro de los 5 km.
  c_radio  CONSTANT INT := public.comunidades_limite('radio_descubrir_metros') + 100;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN RETURN; END IF;

  -- Rango Y NaN, explicitos. BETWEEN ya rechaza NaN en float8 (en Postgres,
  -- NaN > 90 es TRUE), pero no conviene apoyarse en esa sutileza. Y esta
  -- validacion HOY solo existe en TypeScript, duplicada en dos flujos de
  -- vender/actions.ts y sin equivalente en la base.
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_descubrir'));

  -- Snap de la ENTRADA a la rejilla de 100 m, identico al del feed para que
  -- Comunidades hable de la misma zona que "Cerca de ti".
  --
  -- El ::numeric antes de round(x, 3) NO es adorno: Postgres no tiene
  -- round(double precision, integer) y sin el cast la funcion revienta con
  -- 42883.
  --
  -- Va en la ENTRADA porque redondear solo la salida NO detiene el ataque: el
  -- conjunto de resultados es en si un oraculo binario (20260515000001:2-6).
  v_lat := round(p_lat::numeric, 3)::FLOAT;
  v_lng := round(p_lng::numeric, 3)::FLOAT;

  -- ST_SetSRID explicito en vez del cast implicito que usa el resto del repo.
  -- Aquel funciona porque PostGIS asume 4326 al castear desde SRID 0, pero es
  -- una suposicion que falla en tiempo de EJECUCION, no de despliegue.
  v_punto := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         -- Cubos de 500 m, no de 100. El centro guardado YA es una celda de
         -- ~1.1 km, asi que reportar a 100 m seria inventar una precision que
         -- el dato no tiene. Y desde luego NO (CEIL(ST_Distance(...)))::INT,
         -- que es lo que sigue haciendo feed_nearby_requests y expone la
         -- distancia AL METRO: con tres consultas desde tres celdas distintas
         -- se trilatera. Copiar el molde de solicitudes sin mirar habria
         -- copiado ese agujero.
         (CEIL(ST_Distance(c.centro, v_punto) / 500) * 500)::INT
    FROM communities c
   WHERE c.is_hidden   = FALSE
     AND c.archived_at IS NULL
     -- Una comunidad sin nadie dentro no se ofrece. Es tambien lo que hace que
     -- la que se queda vacia desaparezca sola del descubrimiento.
     AND c.miembros_count > 0
     -- ST_DWithin, NUNCA ST_Distance(...) <= r: solo la primera es sargable
     -- contra el GiST; la otra fuerza un escaneo y calcula geodesica
     -- esferoidal por fila.
     AND ST_DWithin(c.centro, v_punto, c_radio)
     -- Las mias no se descubren.
     AND NOT EXISTS (SELECT 1 FROM community_members m
                      WHERE m.community_id = c.id
                        AND m.user_id      = v_viewer
                        AND m.left_at IS NULL)
     -- Ni las de alguien con quien hay bloqueo en cualquiera de los dos
     -- sentidos. owner_id puede ser NULL (fundador que borro su cuenta).
     --
     -- hay_bloqueo_con y NO autor_vetado_para_mi (hallazgo I-14): esta pregunta
     -- es sobre el MANDO de una comunidad, no sobre un autor. Con
     -- autor_vetado_para_mi, suspender a quien manda apagaba el descubrimiento
     -- de una comunidad viva de 500 vecinos para TODO el mundo, sin un error
     -- visible ni una entrada de log -- y BORRAR esa misma cuenta la reencendia,
     -- porque owner_id pasa a NULL y la rama de arriba vuelve a dejarla pasar.
     -- Suspender castigaba mas que borrar. Si producto quiere apagar una
     -- comunidad entera, el mecanismo es communities.is_hidden = TRUE por
     -- moderacion, que ya existe y deja rastro, no deducirlo del estado de una
     -- cuenta.
     AND (c.owner_id IS NULL OR NOT public.hay_bloqueo_con(c.owner_id))
   -- Distancia primero, y luego DOS desempates deterministas.
   --
   -- Anadir desempates anula el KNN asistido por indice y mete un nodo Sort, y
   -- aqui se acepta a conciencia: con radio fijo de 5 km y LIMIT 30 el conjunto
   -- candidato son decenas de filas, asi que el Sort no cuesta nada, mientras
   -- que ORDER BY <-> a secas con el centro guardado en celdas de ~1.1 km
   -- produce EMPATES EXACTOS y una lista que se reordena sola en cada render.
   -- Entre "streaming ordenado por indice" y "orden estable", con 30 filas gana
   -- el orden estable.
   ORDER BY c.centro <-> v_punto, c.miembros_count DESC, c.id
   LIMIT v_limite;

  -- Y NO pagina por cursor, a proposito: un keyset solo es correcto sobre la
  -- MISMA tupla por la que se ordena. Mezclar orden por distancia con un cursor
  -- (created_at, id) es la trampa que ya vive latente en la rama
  -- sort_by_distance de search_nearby_products_v4, donde "cargar mas" puede
  -- saltarse y repetir filas. Una pagina de 30 y se acabo.
END;
$function$;

comment on function public.descubrir_comunidades(double precision, double precision, integer) is
  'Comunidades a <=5 km. El radio es una CONSTANTE, no un parametro: sin radio variable no hay busqueda binaria de la distancia. La entrada se snapea a 100 m y la salida sale en cubos de 500 m, nunca al metro como feed_nearby_requests. Sin paginacion por cursor: mezclar orden por distancia con un keyset (created_at, id) salta y repite filas.';

revoke execute on function public.descubrir_comunidades(
  double precision, double precision, integer) from public, anon, authenticated;
grant  execute on function public.descubrir_comunidades(
  double precision, double precision, integer) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.6 centro_de_mi_comunidad.
--
-- La UNICA salida de coordenadas crudas de todo el diseno, y solo para quien
-- tiene el MANDO ACTUAL, para pintar el mapa de "donde puse el centro". Molde
-- exacto: get_product_location (20260826264000). Sin ella, communities.centro
-- seria una columna que nadie puede leer jamas y el flujo de fundar-y-revisar
-- no cerraria.
--
-- OJO CON LA PROMESA (hallazgo S-19): la guardia es "role = owner en la fila de
-- membresia viva", o sea el mando de HOY, y los dos caminos de relevo del
-- diseno promueven a un tercero a ese rol. El comentario decia "solo a quien la
-- fundo" y no era cierto: tras un traspaso, el centro que A eligio desde su
-- cookie vicino_location lo lee B. Se corrige la PROSA y no el codigo porque el
-- criterio "manda la fila de membresia" es el del resto del diseno (es lo mismo
-- que dice es_moderador_de_comunidad). Si producto decide que el centro NO se
-- hereda, la alternativa es una linea -- anadir "and c.fundador_id = (select
-- auth.uid())" al WHERE, que la columna fundador_id ya permite -- pero cambia
-- semantica y por eso no entra sola.
--
-- La comprobacion de propiedad va DENTRO aunque la pagina ya la haya hecho,
-- precisamente porque es DEFINER y brinca la RLS. Devuelve CERO FILAS y no un
-- error si no tienes el mando, para no convertirla en un oraculo de existencia
-- de ids.
--
-- PostgREST devuelve geography como EWKB hexadecimal y no hay ni un lector de
-- esa columna en el cliente, asi que el desempaquetado va aqui. El cast a
-- ::geometry es obligatorio: ST_X/ST_Y no tienen sobrecarga para geography.
-- ---------------------------------------------------------------------------
create or replace function public.centro_de_mi_comunidad(p_community_id uuid)
returns table (lat double precision, lng double precision)
language sql
stable security definer
set search_path to 'public'
as $function$
  select ST_Y(c.centro::geometry), ST_X(c.centro::geometry)
    from public.communities c
   where c.id = p_community_id
     and exists (select 1 from public.community_members m
                  where m.community_id = c.id
                    and m.user_id = (select auth.uid())
                    and m.left_at is null
                    and m.role = 'owner');
$function$;

comment on function public.centro_de_mi_comunidad(uuid) is
  'Unica salida de lat/lng crudos del diseno, y solo para quien tiene el MANDO (owner en su fila de membresia viva), que tras un traspaso no es necesariamente quien fundo. Devuelve CERO FILAS si no lo eres, no un error, para no ser un oraculo de existencia de ids.';

revoke execute on function public.centro_de_mi_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.centro_de_mi_comunidad(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.7 fundar_comunidad -- el boton "+".
--
-- Aqui viven las cuatro cuotas de fundar -- tres de fundacion y el tope de
-- membresias, que no es lo mismo --, y viven aqui porque no pueden
-- vivir en ningun otro sitio: lib/rate-limit.ts es un no-op comprobado, y un
-- trigger BEFORE INSERT con conteo tendria el mismo agujero de concurrencia Y
-- ademas obligaria a conceder INSERT para tener algo que interceptar.
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
  v_viewer    UUID;
  v_nombre    TEXT;
  v_desc      TEXT;
  v_lat       FLOAT;
  v_lng       FLOAT;
  v_punto     geography;
  v_id          UUID;
  v_vivas       INT;
  v_recientes   INT;
  v_membresias  INT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  -- Una cuenta suspendida no funda. Hoy suspender solo pone
  -- profiles.is_hidden = TRUE y NO impide seguir publicando, porque ninguna
  -- policy de INSERT del proyecto mira esa columna. Aqui si se mira.
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

  -- IS NULL explicito, NUNCA truthiness. El modo editar de publicaciones usa
  -- "if (ubicLat && ubicLng)" y por eso lat 0 se lee como "no toco el mapa"
  -- (vender/actions.ts:631-637). Aqui el centro es obligatorio y esa confusion
  -- no se hereda.
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  -- -----------------------------------------------------------------------
  -- EL SNAP QUE IMPORTA: DOS decimales (~1.1 km), no tres.
  --
  -- La ubicacion que llega es la cookie vicino_location, que la escribe el
  -- navegador con document.cookie, no es HttpOnly, no va firmada, y que para la
  -- mayoria de la gente es SU CASA. Guardarla a 100 m, atada a su nombre como
  -- fundadora y consultable para siempre, seria la fuga de ubicacion mas fina
  -- de todo el producto. A ~1 km el centro deja de ser una direccion y pasa a
  -- ser un barrio, que es lo que la comunidad dice ser.
  --
  -- El snap de 3 decimales del feed protege el PUNTO DE CONSULTA de quien
  -- busca; este protege un dato PERSISTIDO y PUBLICADO. No es el mismo problema
  -- y no lleva el mismo numero.
  --
  -- communities_centro_en_rejilla lo verifica en la tabla, asi que esto no es
  -- una promesa: es un invariante.
  -- -----------------------------------------------------------------------
  v_lat   := round(p_lat::numeric, 2)::FLOAT;
  v_lng   := round(p_lng::numeric, 2)::FLOAT;
  v_punto := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;

  -- -----------------------------------------------------------------------
  -- SERIALIZA LAS FUNDACIONES DE ESTA PERSONA.
  --
  -- Sin esto la cuota es best-effort bajo READ COMMITTED y dos peticiones a la
  -- vez la superan -- que es el caveat que enforce_max_request_categories dejo
  -- escrito y aceptado (20260710000001:64-67). Alli se acepto porque el insert
  -- ocurre una vez desde un solo cliente. Aqui NO se puede aceptar: la cuota de
  -- fundacion es la unica defensa contra que una cuenta plante 500 comunidades
  -- por todo Puebla, y contra un atacante "simultaneo" es el caso normal.
  --
  -- La llave es por usuario y por accion, asi que nunca hay dos en juego a la
  -- vez y no puede haber interbloqueo. La carrera ENTRE usuarios distintos por
  -- el mismo nombre la cierra el indice unico, no este lock.
  -- -----------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:fundar:' || v_viewer::text, 0));
  -- Y la MISMA llave que usa alternar_membresia_comunidad, porque la CUOTA D
  -- de aqui abajo cuenta membresias y esa cuenta la comparten las dos
  -- funciones: con llaves distintas, un fundar y un unirse simultaneos de la
  -- misma persona leen los dos 19 y los dos entran, que es justo el agujero
  -- que la CUOTA D cierra. El orden fundar -> membresia es fijo, y ninguna
  -- transaccion pide 'comunidad:fundar' teniendo 'comunidad:membresia', asi
  -- que sigue sin poder haber ciclo.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:membresia:' || v_viewer::text, 0));

  -- -----------------------------------------------------------------------
  -- LAS TRES CUOTAS DE FUNDACION VAN SOBRE fundador_id, NO SOBRE owner_id
  -- (hallazgo C-4). La cuarta, la CUOTA D de aqui abajo, no cuelga de ninguna
  -- de las dos columnas: cuenta filas de community_members.
  --
  -- owner_id significa "manda aqui hoy" y se puede SOLTAR en una peticion: la
  -- rama SALIR de alternar_membresia_comunidad lo reasigna al relevo o lo pone
  -- a NULL. Con las cuotas colgadas de ahi, fundar -> salir -> fundar las
  -- ponia las tres a cero en dos peticiones, sin techo -- y con un complice la
  -- comunidad quedaba ADEMAS viva y descubrible. Es el dano que la seccion
  -- 2.0(e) de la especificacion declara irreversible sin intervencion manual.
  --
  -- Y al reves: heredar el mando es AUTOMATICO y NO consentido, asi que una
  -- vecina que se une la primera a tres comunidades cuyos fundadores se van se
  -- quedaba sin poder fundar la suya, en su propio barrio, para siempre.
  --
  -- fundador_id es tuyo para siempre, asi que una comunidad que fundaste y
  -- traspasaste sigue contando y una que heredaste no cuenta. Por eso van
  -- sobre fundador_id A SECAS: la variante "fundador_id = v_viewer OR owner_id
  -- = v_viewer" reintroduciria el segundo fallo sin arreglar nada.
  -- -----------------------------------------------------------------------

  -- CUOTA A: cuantas tiene vivas.
  SELECT count(*) INTO v_vivas
    FROM communities c WHERE c.fundador_id = v_viewer AND c.archived_at IS NULL;
  IF v_vivas >= public.comunidades_limite('comunidades_fundadas_vivas') THEN
    RAISE EXCEPTION 'Ya fundaste % comunidades. Archiva una para fundar otra.',
                    public.comunidades_limite('comunidades_fundadas_vivas')
      USING ERRCODE = '23514';
  END IF;

  -- CUOTA B: ventana de 24 h. Cuenta TAMBIEN las archivadas, para que
  -- fundar-archivar-fundar no sea un bucle gratis.
  SELECT count(*) INTO v_recientes
    FROM communities c
   WHERE c.fundador_id = v_viewer AND c.created_at > now() - interval '24 hours';
  IF v_recientes >= public.comunidades_limite('comunidades_fundadas_24h') THEN
    RAISE EXCEPTION 'Solo puedes fundar una comunidad cada 24 horas.'
      USING ERRCODE = '23514';
  END IF;

  -- CUOTA C: separacion. Impide sembrar tres comunidades en la misma esquina
  -- para acaparar el descubrimiento de una manzana.
  --
  -- Solo restringe al MISMO fundador. Una regla de densidad global seria un
  -- arma para el atacante: ocupando el sitio primero dejaria a los vecinos
  -- legitimos sin poder fundar la suya.
  IF EXISTS (SELECT 1 FROM communities c
              WHERE c.fundador_id = v_viewer
                AND c.archived_at IS NULL
                AND ST_DWithin(c.centro, v_punto,
                               public.comunidades_limite('separacion_propias_metros'))) THEN
    RAISE EXCEPTION 'Ya tienes una comunidad a menos de 1 km de aqui.'
      USING ERRCODE = '23514';
  END IF;

  -- CUOTA D: fundar TAMBIEN ocupa una membresia (hallazgo I-5). Sin esto,
  -- "membresias_vivas x pagina_muro" no es una cota: unirse a 20 (la 21 da
  -- 23514) y fundar 3 a lo largo de tres dias esta permitido, y son 23 filas
  -- vivas -> 23 x 30 = 690 tuplas candidatas por pagina en el fan-out de
  -- feed_comunidades_explorar, que no lleva LIMIT sobre las membresias y saca
  -- su cota UNICAMENTE de esta cuota. El VERIFY F afirmaba 600 multiplicando
  -- dos constantes, asi que no podia detectar su propia falsedad.
  --
  -- Va DENTRO del advisory lock que ya se tomo y ANTES del INSERT en
  -- communities, para no dejar una comunidad huerfana si salta.
  --
  -- El conteo lleva el MISMO join a communities que la rama ENTRAR de
  -- alternar_membresia_comunidad: si contara plazas de comunidades archivadas u
  -- ocultas -- de las que no se puede salir sin C-2 -- quien las tuviera
  -- quedaria atrapado tambien aqui.
  SELECT count(*) INTO v_membresias
    FROM community_members m
    JOIN communities c ON c.id = m.community_id
   WHERE m.user_id = v_viewer AND m.left_at IS NULL
     AND c.is_hidden = FALSE AND c.archived_at IS NULL;
  IF v_membresias >= public.comunidades_limite('membresias_vivas') THEN
    RAISE EXCEPTION 'Ya perteneces a % comunidades. Sal de alguna para fundar otra.',
                    public.comunidades_limite('membresias_vivas')
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    -- nombre_norm y celda NO se mandan: los deriva comunidad_normaliza, y un
    -- trigger BEFORE corre antes de que se comprueben NOT NULL y CHECK.
    -- fundador_id SI se manda, aunque el trigger lo pondria igual: aqui es
    -- donde se ve que quien funda y quien manda nacen siendo la misma persona
    -- y se separan despues.
    INSERT INTO communities (nombre, descripcion, owner_id, fundador_id, centro)
    VALUES (v_nombre, v_desc, v_viewer, v_viewer, v_punto)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    -- uq_communities_celda_nombre. Es el que MANDA sobre el duplicado: no hay
    -- una comprobacion previa "amable" porque seria best-effort y mentiria bajo
    -- concurrencia. Se traduce el 23505 a un mensaje legible y ya.
    RAISE EXCEPTION 'Ya existe una comunidad con ese nombre por aqui.'
      USING ERRCODE = '23505';
  END;

  -- Fundar es unirse, y va en la MISMA transaccion. Si se dejara al cliente,
  -- una peticion perdida dejaria a alguien fuera de su propia comunidad y sin
  -- forma obvia de entrar: no saldria ni en "Otras" ni en "Tus comunidades".
  -- Ademas es lo que pone miembros_count en 1 y la hace descubrible.
  INSERT INTO community_members (community_id, user_id, role)
  VALUES (v_id, v_viewer, 'owner');

  RETURN jsonb_build_object('id', v_id, 'nombre', v_nombre);
END;
$function$;

comment on function public.fundar_comunidad(text, double precision, double precision, text) is
  'Funda una comunidad y mete a quien funda dentro, en la misma transaccion. Snapea el centro a ~1.1 km (verificado ademas por communities_centro_en_rejilla) y aplica bajo pg_advisory_xact_lock CUATRO cuotas: las TRES de fundacion, esas si sobre fundador_id y no sobre owner_id, que se puede soltar en una peticion (3 vivas, 1 cada 24 h contando archivadas, 1 km de separacion entre las propias), mas el tope de 20 membresias vivas -- que se cuenta sobre community_members y no sobre ninguna de las dos columnas de mando -- porque fundar tambien ocupa una plaza y sin eso la cota del fan-out del muro no es una cota.';

revoke execute on function public.fundar_comunidad(
  text, double precision, double precision, text) from public, anon, authenticated;
grant  execute on function public.fundar_comunidad(
  text, double precision, double precision, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.8 alternar_membresia_comunidad.
--
-- Unirse y salir en un solo boton. Devuelve el estado AUTORITATIVO
-- {soy_miembro, miembros_count} en vez de void: es el mismo contrato que
-- toggleFavorite devolviendo {isFavorite}, que es lo que useOptimisticMutation
-- reconcilia en onSuccess. Sin eso, la tarjeta se queda con el estado optimista
-- cuando la base decidio otra cosa -- por ejemplo, porque la cuota la rechazo.
--
-- DECISION EXPLICITA: NO se exige cercania geografica para unirse. Seria teatro
-- y conviene decirlo en voz alta en vez de fingir un control: la ubicacion sale
-- de una cookie que escribe el navegador, no es HttpOnly y no va firmada --
-- cualquiera se teletransporta con una linea en la consola. Y a cambio romperia
-- casos legitimos (estoy en el trabajo, viajo, la comunidad es la de casa de
-- mis padres). El control real es el tope de 20 y la ventana de 10 altas por
-- 24 h, que van sobre un dato que el servidor si controla.
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

  -- -----------------------------------------------------------------------
  -- "EXISTE" Y "ESTA DISPONIBLE" SON DOS PREGUNTAS DISTINTAS (hallazgo C-2).
  --
  -- Antes esto era un solo SELECT con is_hidden = FALSE AND archived_at IS
  -- NULL, colocado ANTES de la bifurcacion, asi que bloqueaba las DOS ramas.
  -- Consecuencia: de una comunidad archivada u oculta NO se podia salir. Quien
  -- fundo "Vecinos Angelopolis" pulsaba archivar y los 200 miembros recibian
  -- P0002 para siempre; y como el tope de 20 membresias contaba esas plazas
  -- muertas, con 20 archivadas encima el usuario recibia 23514 al intentar
  -- unirse a CUALQUIER otra, sin ver ni una de la que salir. No habia escape
  -- alternativo: community_members no tiene GRANT de UPDATE ni DELETE ni
  -- policy de escritura, y esta RPC es la unica salida que existe.
  -- Recuperacion solo con SQL manual contra produccion.
  -- -----------------------------------------------------------------------
  SELECT c.owner_id, (c.is_hidden = FALSE AND c.archived_at IS NULL)
    INTO v_owner, v_disponible
    FROM communities c WHERE c.id = p_community_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- -----------------------------------------------------------------------
  -- DOS LLAVES, SIEMPRE EN ESTE ORDEN (hallazgo I-8).
  --
  -- La llave de usuario serializa las cuotas, que son POR USUARIO. Pero el
  -- mando es un invariante POR COMUNIDAD, y con solo la primera dos salidas
  -- simultaneas de la MISMA comunidad no se serializan: A (owner) lee el
  -- relevo B, B sale a la vez y commitea, y el UPDATE de promocion de A -- que
  -- no llevaba "AND left_at IS NULL" -- re-lee la version nueva bajo READ
  -- COMMITTED y corona igual a quien ya se fue. La comunidad de 198 personas
  -- se queda SIN mando local: nadie puede archivarla, ni editar la
  -- descripcion, ni borrar spam. Irrecuperable sin SQL manual.
  --
  -- El orden fijo usuario -> comunidad es lo que excluye el interbloqueo. La
  -- llave de comunidad la toma tambien comunidad_traspasa_mando, que es a donde
  -- se mudo el traspaso, pero esa funcion NO pide ninguna llave de usuario, asi
  -- que ninguna transaccion sostiene la de comunidad mientras pide la de
  -- usuario y no hay ciclo posible. Aqui se toma ANTES de leer la propia fila,
  -- y eso es lo que cierra el otro lado de la carrera: nadie puede promover al
  -- llamante entre esta lectura y su salida.
  -- -----------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:membresia:' || v_viewer::text, 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:mando:' || p_community_id::text, 0));

  SELECT m.role, (m.left_at IS NULL) INTO v_rol, v_activa
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.user_id = v_viewer;

  IF COALESCE(v_activa, FALSE) THEN
    -- --------------------------------------------------------------------
    -- SALIR. Es SIEMPRE posible, este la comunidad archivada u oculta: esta
    -- RPC es la unica salida que existe y no puede quedar condicionada por el
    -- estado de la comunidad. La rama es correcta tal cual para una archivada:
    -- archivar no cambia roles, y el traspaso y el archivado son idempotentes
    -- por el COALESCE(archived_at, now()).
    --
    -- Quien tiene el mando TAMBIEN puede salir: prohibirselo es un callejon
    -- (no puede irse de una comunidad viva de 200 personas, y archivarla
    -- castiga a los otros 199). El traspaso es UNA sola llamada, a la unica
    -- implementacion que existe: alli viven la llave de mando, el criterio
    -- determinista (joined_at, user_id) y el archivado, que ocurre si y solo
    -- si no queda nadie vivo.
    -- --------------------------------------------------------------------
    IF v_rol = 'owner' THEN
      PERFORM public.comunidad_traspasa_mando(p_community_id, v_viewer);
    END IF;

    -- Borrado SUAVE. Ver el comentario de la columna: con DELETE, la cuota de
    -- altas se autoborraria y el ciclo unirse -> volcar -> salir cosecharia los
    -- muros de toda la ciudad sin tocar el tope nunca.
    UPDATE community_members
       SET left_at = now(), role = 'member'
     WHERE community_id = p_community_id AND user_id = v_viewer;

    -- Las publicaciones NO se borran al salir. Borrarlas seria destructivo y
    -- sorprendente, y dejaria huecos en hilos ajenos. La consecuencia asumida
    -- es que un no-miembro puede figurar como autor en el muro, que es lo que
    -- hace todo el mundo y lo que la gente espera.
    v_activa := FALSE;

  ELSE
    -- --------------------------------------------------------------------
    -- ENTRAR. Aqui SI se exige comunidad viva y visible. La asimetria con
    -- SALIR es el hallazgo C-2: de una comunidad muerta se sale siempre, pero
    -- a una comunidad muerta no se entra.
    -- --------------------------------------------------------------------
    IF NOT v_disponible THEN
      RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
    END IF;

    -- Una cuenta suspendida no entra a comunidades nuevas (hallazgo I-10).
    -- Antes esta guardia no existia aqui: alguien suspendido con
    -- moderate_set_content_hidden seguia pudiendo unirse a comunidades nuevas y
    -- leer sus muros por feed_muro_comunidad, que es justo lo que la suspension
    -- pretende cortar, y sin dejar rastro. Va SOLO en esta rama: una cuenta
    -- suspendida tiene que poder SALIR de las suyas, solo no entrar a mas. Es
    -- la misma asimetria entrar/salir de arriba.
    IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
      RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
    END IF;

    -- Bloqueo bidireccional con quien manda: no se entra a la comunidad de
    -- alguien a quien bloqueaste ni de alguien que te bloqueo.
    --
    -- hay_bloqueo_con y NO autor_vetado_para_mi (hallazgo I-14): la pregunta
    -- es sobre el MANDO de una comunidad, no sobre un autor. Con la version
    -- vieja, suspender a quien la fundo cerraba el alta de una comunidad viva
    -- de 500 vecinos para todo el mundo -- y borrar esa cuenta la reabria,
    -- porque owner_id pasa a NULL. Ver el motivo largo en descubrir_comunidades.
    IF v_owner IS NOT NULL AND public.hay_bloqueo_con(v_owner) THEN
      RAISE EXCEPTION 'No puedes unirte a esa comunidad.' USING ERRCODE = '42501';
    END IF;

    -- El tope cuenta SOLO plazas que de verdad se pueden soltar (hallazgo
    -- C-2): sin el join a communities, una membresia en una comunidad
    -- archivada u oculta gastaba una de las 20 para siempre y ni siquiera se
    -- pintaba en mis_comunidades, que filtra esas dos cosas. Es el MISMO
    -- conteo que la CUOTA D de fundar_comunidad, y tiene que seguir siendolo.
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

    -- La ventana cuenta filas VIVAS Y MUERTAS: es lo que impide la cosecha por
    -- unirse-volcar-salir. Volver a la misma comunidad no gasta un slot nuevo
    -- (la fila ya existe y joined_at no se toca); unirse a una comunidad
    -- DISTINTA si.
    SELECT count(*) INTO v_altas
      FROM community_members m
     WHERE m.user_id = v_viewer AND m.joined_at > now() - interval '24 hours';
    IF v_altas >= public.comunidades_limite('membresias_altas_24h') THEN
      RAISE EXCEPTION 'Te uniste a demasiadas comunidades hoy. Intentalo manana.'
        USING ERRCODE = '23514';
    END IF;

    -- ON CONFLICT y no un 23505 al aire: el doble toque en una conexion lenta
    -- es la primera cosa que golpea esto, y toggleFavorite ya dejo escrito que
    -- aqui el 23505 es EXITO idempotente, no error.
    --
    -- joined_at NO se toca al volver: si se reseteara, salir y volver borraria
    -- la prueba de la alta y la cuota volveria a ser burlable.
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
  'Unirse y salir en un solo boton, devolviendo el estado autoritativo para que el cliente reconcilie el optimista. Salir es borrado SUAVE (left_at): con DELETE la cuota de 10 altas en 24 h se autoborraria y el ciclo unirse-volcar-salir cosecharia los muros de toda la ciudad. SALIR es siempre posible, este la comunidad archivada u oculta -- es la unica salida que existe --; ENTRAR exige comunidad viva, cuenta no suspendida, sin bloqueo con quien manda, y el tope de 20 membresias contando solo las que se pueden soltar. Toma DOS llaves, en orden fijo usuario -> comunidad, porque el mando es un invariante por comunidad y no por usuario, y la de comunidad se toma ANTES de leer la propia fila. Quien tiene el mando tambien puede salir: el traspaso lo hace comunidad_traspasa_mando, la unica implementacion del traspaso que existe, y la comunidad se archiva si y solo si no queda ni un miembro vivo.';

revoke execute on function public.alternar_membresia_comunidad(uuid)
  from public, anon, authenticated;
grant  execute on function public.alternar_membresia_comunidad(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.9a editar_descripcion_comunidad.
--
-- Solo la descripcion. El NOMBRE no se toca y no hay RPC que lo cambie: un
-- nombre editable es la jugada del cebo. El CENTRO tampoco se mueve: moverlo
-- reubicaria la comunidad entera fuera del radio de quienes ya estan dentro.
-- Las dos cosas las blinda ademas comunidad_normaliza en cualquier UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.editar_descripcion_comunidad(
  p_community_id uuid,
  p_descripcion  text default null::text
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_desc   TEXT;
  v_n      INT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  -- LA QUINTA SUPERFICIE DE ESCRITURA PUBLICA, y le faltaba la guardia. La
  -- descripcion es texto libre publicado: esta en el GRANT por columna a
  -- authenticated y la devuelven descubrir_comunidades (a cualquier
  -- authenticated a <=5 km, sin pertenencia) y mis_comunidades. O sea un cartel
  -- de 300 caracteres visible para todo el barrio, mas permanente que una
  -- publicacion de muro. Sin esto, suspender a alguien no le quitaba el cartel:
  -- lo seguia editando, y ni siquiera hay forma de callarlo desde moderacion,
  -- porque moderate_set_content_hidden no tiene rama para 'community'.
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;

  IF NOT public.es_moderador_de_comunidad(p_community_id) THEN
    RAISE EXCEPTION 'No administras esa comunidad.' USING ERRCODE = '42501';
  END IF;

  v_desc := NULLIF(btrim(COALESCE(p_descripcion, '')), '');
  IF v_desc IS NOT NULL AND char_length(v_desc) > 300 THEN
    RAISE EXCEPTION 'La descripcion no puede pasar de 300 caracteres.' USING ERRCODE = '22023';
  END IF;

  -- Y la cuota, con la misma forma que las otras cuatro superficies: llave por
  -- usuario y por accion, ventana contra el ledger. Sin ella esto admitia
  -- reescritura en bucle sin techo -- cada llamada es un UPDATE sobre
  -- communities que dispara comunidad_normaliza y deja una version muerta de la
  -- fila -- y era la unica escritura publica del diseno sin ningun tope.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:descripcion:' || v_viewer::text, 0));

  SELECT count(*) INTO v_n
    FROM community_post_quota q
   WHERE q.user_id = v_viewer
     AND q.tipo = 'descripcion'
     AND q.created_at > now() - interval '24 hours';
  IF v_n >= public.comunidades_limite('descripciones_24h') THEN
    RAISE EXCEPTION 'Llegaste al limite de % ediciones de descripcion en 24 horas.',
                    public.comunidades_limite('descripciones_24h')
      USING ERRCODE = '23514';
  END IF;

  UPDATE communities SET descripcion = v_desc
   WHERE id = p_community_id AND archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- El asiento va DESPUES del UPDATE y dentro del mismo lock, igual que en
  -- publicar_en_comunidad: si el UPDATE no entra, la transaccion se va entera y
  -- no se gasta cuota.
  INSERT INTO community_post_quota (user_id, tipo) VALUES (v_viewer, 'descripcion');

  RETURN jsonb_build_object('id', p_community_id, 'descripcion', v_desc);
END;
$function$;

comment on function public.editar_descripcion_comunidad(uuid, text) is
  'Unica escritura permitida sobre una comunidad ya fundada, y solo para su mando local. El nombre es inmutable por diseno y el centro no se mueve: moverlo reubicaria la comunidad fuera del radio de quienes ya estan dentro. Es la QUINTA superficie de escritura publica -- la descripcion la ven a <=5 km quienes no pertenecen --, asi que lleva la guardia de cuenta suspendida y su propia cuota por ventana de 24 h contra community_post_quota, igual que las otras cuatro.';

revoke execute on function public.editar_descripcion_comunidad(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.editar_descripcion_comunidad(uuid, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.9b archivar_comunidad.
--
-- Cierre voluntario. Es lo que evita que una comunidad creada por error sea
-- inmortal. Archivar LIBERA el nombre en su celda (el indice unico es parcial
-- por archived_at); ocultar por moderacion NO lo libera, para no regalarselo a
-- un imitador.
--
-- No hay DELETE de comunidad en v1: un borrado en cascada de un muro entero por
-- un toque accidental no tiene vuelta. Archivar es reversible por un admin y no
-- destruye nada: las publicaciones siguen ahi y dejan de leerse porque
-- puedo_ver_publicacion exige archived_at IS NULL.
--
-- CONSECUENCIA DE ESA REVERSIBILIDAD, ESCRITA AQUI PARA QUE NO SORPRENDA: el
-- tope de 20 membresias cuenta SOLO plazas en comunidades vivas (hallazgo C-2),
-- asi que archivar libera plazas y des-archivar NO las vuelve a comprobar. Si
-- una comunidad de 200 personas se archiva, esas 200 se unen a otra y despues
-- un admin la restaura, cada una queda con 21 membresias vivas. La cota del
-- fan-out (membresias_vivas x pagina_muro) es por tanto una cota NOMINAL, no un
-- invariante duro, y el bloque F del VERIFY puede salir en rojo sin que nadie
-- haya hecho nada malo. Se acepta a proposito: acotar el fan-out con un LIMIT
-- sobre las membresias haria que el muro IGNORARA comunidades del usuario en
-- silencio, que es peor que 30 tuplas candidatas de mas y es justo el fallo que
-- el comentario de comunidades_limite() advierte. Des-archivar es manual y de
-- admin: si el rojo aparece, la respuesta es mirar quien se paso, no relajar la
-- asercion.
-- ---------------------------------------------------------------------------
create or replace function public.archivar_comunidad(p_community_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE v_viewer UUID;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  IF NOT (EXISTS (SELECT 1 FROM community_members m
                   WHERE m.community_id = p_community_id
                     AND m.user_id = v_viewer
                     AND m.left_at IS NULL
                     AND m.role = 'owner')
          OR public.has_role(v_viewer, 'admin'::app_role)) THEN
    -- El mensaje dice "administra" y no "fundo" porque la guardia de arriba
    -- comprueba el MANDO (owner en la fila de membresia viva) o admin, no la
    -- autoria. Quien fundo y traspaso recibia un mensaje que le negaba haber
    -- fundado, y quien heredo el mando archivaba sin haber fundado nada.
    RAISE EXCEPTION 'Solo quien administra la comunidad puede archivarla.' USING ERRCODE = '42501';
  END IF;

  UPDATE communities SET archived_at = now()
   WHERE id = p_community_id AND archived_at IS NULL;
  -- Cero filas significa que el uuid no existe o que ya estaba archivada
  -- (hallazgo I-16). Sin este IF, un admin -- que entra por la rama has_role de
  -- arriba y por tanto se salta la comprobacion de membresia -- recibia
  -- {"archivada": true} y creia haber archivado algo que sigue vivo: el mismo
  -- sintoma que el IF NOT FOUND de moderate_set_content_hidden existe para
  -- impedir, y que sus dos hermanas de este archivo ya comprobaban.
  --
  -- CONTRATO PARA LA UI: aqui el segundo toque NO es exito idempotente, al
  -- reves que en alternar_like_publicacion y alternar_membresia_comunidad.
  -- Archivar va detras de una confirmacion y no es un boton de alternar, asi
  -- que el P0002 significa "ya estaba archivada" y se pinta como tal, no como
  -- error rojo.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('id', p_community_id, 'archivada', TRUE);
END;
$function$;

comment on function public.archivar_comunidad(uuid) is
  'Cierre voluntario por el owner (o un admin). Archivar libera el nombre en su celda; ocultar por moderacion no. No existe DELETE de comunidad en v1: un borrado en cascada de un muro entero por un toque accidental no tiene vuelta.';

revoke execute on function public.archivar_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.archivar_comunidad(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.10 publicar_en_comunidad.
--
-- Unica puerta de escritura del muro: publica (p_parent_post_id NULL) o comenta
-- una publicacion. Concentra pertenencia, profundidad 1, coherencia de
-- comunidad y las dos cuotas por ventana.
--
-- Es lo que permite que community_posts no tenga GRANT de INSERT para nadie:
-- is_hidden, los contadores y created_at los pone el servidor, y no hay forma
-- de que un cliente nazca con prueba social falsa ni con la fecha falseada.
-- ---------------------------------------------------------------------------
create or replace function public.publicar_en_comunidad(
  p_community_id   uuid,
  p_texto          text,
  p_parent_post_id uuid default null::uuid
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_texto  TEXT;
  v_madre  RECORD;
  v_n      INT;
  v_id     UUID;
  v_creado TIMESTAMPTZ;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;
  IF p_community_id IS NULL THEN
    RAISE EXCEPTION 'Falta la comunidad.' USING ERRCODE = '22023';
  END IF;

  v_texto := btrim(COALESCE(p_texto, ''));
  IF char_length(v_texto) < 1 OR char_length(v_texto) > 1500 THEN
    RAISE EXCEPTION 'El texto debe tener entre 1 y 1500 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM communities c
                  WHERE c.id = p_community_id
                    AND c.is_hidden = FALSE
                    AND c.archived_at IS NULL) THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- Leer exige pertenencia y escribir tambien. Un no-miembro que llame a este
  -- RPC con un uuid que vio en "Otras comunidades" se queda aqui.
  IF NOT public.es_miembro_de_comunidad(p_community_id) THEN
    RAISE EXCEPTION 'Unete a la comunidad para publicar.' USING ERRCODE = '42501';
  END IF;

  IF p_parent_post_id IS NOT NULL THEN
    -- ------------------------------------------------------------------
    -- COMENTAR EXIGE EXACTAMENTE LO MISMO QUE VER (hallazgo C-1).
    --
    -- Esta guardia no estaba, y era el agujero mas grave de la entrega. Las
    -- unicas comprobaciones sobre la publicacion madre eran NOT FOUND,
    -- is_hidden, coherencia de comunidad y profundidad: ni bloqueo ni
    -- suspension. alternar_like_publicacion SI llamaba a
    -- puedo_ver_publicacion, y la policy de community_posts SI exige "not
    -- autor_vetado_para_mi(author_id)" -- pero esta RPC es SECURITY DEFINER y
    -- no pasa por RLS.
    --
    -- Escenario: A y B en la misma comunidad, A bloquea a B; B conserva el
    -- uuid de un post de A (lo vio antes, o su propio comentario previo es
    -- legible por REST porque la policy abre author_id = auth.uid() y esa fila
    -- lleva parent_post_id). B comenta y entra con 200. El barrio entero lee
    -- el comentario colgado de la publicacion de A; A ve subir
    -- comentarios_count y al abrir el hilo no ve nada, porque
    -- comentarios_de_publicacion filtra por la direccion inversa; y A no puede
    -- borrarlo aunque eliminar_publicacion_comunidad se lo permita como autor
    -- de la madre, porque no hay forma de obtener el id de un comentario que
    -- su propia RPC le oculta. El bloqueo se convertia en un canal de acoso
    -- unidireccional que la victima no podia ni ver ni limpiar. El mismo hueco
    -- dejaba comentar publicaciones de cuentas suspendidas.
    --
    -- Va PRIMERO y con el MISMO mensaje y codigo que el NOT FOUND de abajo,
    -- para que un bloqueado no pueda distinguir "me bloquearon" de "ya no
    -- existe": si no, la guardia seria un oraculo de bloqueo. Y NO sustituye a
    -- las tres de abajo -- puedo_ver_publicacion no mira ni la coherencia de
    -- comunidad ni la profundidad.
    -- ------------------------------------------------------------------
    IF NOT public.puedo_ver_publicacion(p_parent_post_id) THEN
      RAISE EXCEPTION 'Esa publicacion ya no esta disponible.' USING ERRCODE = 'P0002';
    END IF;

    SELECT p.id, p.community_id, p.parent_post_id, p.is_hidden
      INTO v_madre
      FROM community_posts p WHERE p.id = p_parent_post_id;

    IF NOT FOUND OR v_madre.is_hidden THEN
      RAISE EXCEPTION 'Esa publicacion ya no esta disponible.' USING ERRCODE = 'P0002';
    END IF;
    IF v_madre.community_id <> p_community_id THEN
      RAISE EXCEPTION 'Esa publicacion es de otra comunidad.' USING ERRCODE = '22023';
    END IF;
    -- PROFUNDIDAD 1. Un comentario de nivel 2 no lo leeria ninguna pantalla (el
    -- muro filtra parent_post_id IS NULL y la hoja filtra parent_post_id = :id),
    -- asi que seria basura invisible: el modo de fallo que este repo persigue
    -- por encima de los demas. La FK compuesta garantiza la comunidad; esta
    -- comprobacion garantiza la profundidad.
    IF v_madre.parent_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede responder a un comentario.' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:publicar:' || v_viewer::text, 0));

  -- -----------------------------------------------------------------------
  -- LA VENTANA SE CUENTA CONTRA EL LEDGER, NO CONTRA EL CONTENIDO (C-3).
  --
  -- Antes se contaban filas VIVAS de community_posts, y
  -- eliminar_publicacion_comunidad hace DELETE en DURO y esta permitido al
  -- autor sin cuota ninguna: un bucle de dos peticiones (publicar, borrar)
  -- devolvia el contador a cero en cada vuelta y los dos topes no mordian
  -- NUNCA. Peor con comentarios: cada uno dispara
  -- notificar_comentario_de_comunidad, que inserta una fila PERMANENTE en
  -- public.notifications que nada borra y que no tiene FK al comentario --
  -- bombardeo ilimitado de bandeja, badge y push contra una persona elegida,
  -- sin rastro en el muro porque el atacante borra a los 200 ms.
  --
  -- community_post_quota guarda el HECHO, no el contenido, asi que borrar no
  -- devuelve cuota. Es el mismo razonamiento que left_at en las membresias.
  --
  -- Las cuotas cuentan sobre TODAS las comunidades del autor, no por
  -- comunidad: si no, quien se une a 20 multiplica su cuota por 20.
  -- -----------------------------------------------------------------------
  SELECT count(*) INTO v_n
    FROM community_post_quota q
   WHERE q.user_id = v_viewer
     AND q.tipo = CASE WHEN p_parent_post_id IS NULL THEN 'publicacion' ELSE 'comentario' END
     AND q.created_at > now() - interval '24 hours';

  IF p_parent_post_id IS NULL
     AND v_n >= public.comunidades_limite('publicaciones_24h') THEN
    RAISE EXCEPTION 'Llegaste al limite de % publicaciones en 24 horas.',
                    public.comunidades_limite('publicaciones_24h')
      USING ERRCODE = '23514';
  END IF;
  IF p_parent_post_id IS NOT NULL
     AND v_n >= public.comunidades_limite('comentarios_24h') THEN
    RAISE EXCEPTION 'Llegaste al limite de % comentarios en 24 horas.',
                    public.comunidades_limite('comentarios_24h')
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO community_posts (community_id, author_id, parent_post_id, cuerpo)
  VALUES (p_community_id, v_viewer, p_parent_post_id, v_texto)
  RETURNING id, created_at INTO v_id, v_creado;

  -- El asiento va DESPUES del INSERT y dentro del mismo advisory lock: si el
  -- INSERT falla, la transaccion entera se va y no se gasta cuota; si entra,
  -- el hecho queda escrito aunque la publicacion se borre un segundo despues.
  INSERT INTO community_post_quota (user_id, tipo)
  VALUES (v_viewer,
          CASE WHEN p_parent_post_id IS NULL THEN 'publicacion' ELSE 'comentario' END);

  RETURN jsonb_build_object('id', v_id, 'created_at', v_creado);
END;
$function$;

comment on function public.publicar_en_comunidad(uuid, text, uuid) is
  'Unica puerta de escritura del muro: publica o comenta. Concentra pertenencia, profundidad 1, coherencia de comunidad, la guardia de cuenta suspendida, puedo_ver_publicacion sobre la publicacion madre -- comentar exige exactamente lo mismo que ver, incluido el bloqueo BIDIRECCIONAL y la suspension del autor de la madre, que la policy aplica y este SECURITY DEFINER se saltaba -- y las dos cuotas por ventana (10 publicaciones y 60 comentarios en 24 h, sobre TODAS las comunidades del autor). Las cuotas se cuentan contra el ledger community_post_quota y no contra community_posts, que se borra en DURO: contando contenido vivo, publicar-borrar-publicar las reseteaba en cada vuelta.';

revoke execute on function public.publicar_en_comunidad(uuid, text, uuid)
  from public, anon, authenticated;
grant  execute on function public.publicar_en_comunidad(uuid, text, uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.11 eliminar_publicacion_comunidad.
--
-- Borra una publicacion o un comentario: su autor, el autor de la publicacion
-- madre (para limpiar su propio hilo sin esperar a nadie), el moderador local,
-- o un admin/moderador global.
--
-- Borrado DURO y no blando: un deleted_at obliga a que TODAS las lecturas y
-- TODOS los contadores lo filtren, y basta olvidarse en un sitio para resucitar
-- contenido. Los reportes que apuntaban a el los cierra el trigger
-- publicacion_cierra_sus_reportes, que llega en el archivo 3 y que cubre
-- tambien las cascadas.
-- ---------------------------------------------------------------------------
create or replace function public.eliminar_publicacion_comunidad(p_post_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer      UUID;
  v_autor       UUID;
  v_comunidad   UUID;
  v_madre       UUID;
  v_autor_madre UUID;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  SELECT p.author_id, p.community_id, p.parent_post_id
    INTO v_autor, v_comunidad, v_madre
    FROM community_posts p WHERE p.id = p_post_id;

  -- Idempotente, y ademas no confirma la existencia de ids ajenos.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('borrado', FALSE);
  END IF;

  IF v_madre IS NOT NULL THEN
    SELECT p.author_id INTO v_autor_madre
      FROM community_posts p WHERE p.id = v_madre;
  END IF;

  IF NOT (v_autor = v_viewer
          OR COALESCE(v_autor_madre = v_viewer, FALSE)
          OR public.es_moderador_de_comunidad(v_comunidad)
          OR public.has_role(v_viewer, 'admin'::app_role)
          OR public.has_role(v_viewer, 'moderator'::app_role)) THEN
    RAISE EXCEPTION 'No puedes borrar eso.' USING ERRCODE = '42501';
  END IF;

  -- Si es una publicacion de muro, la FK compuesta se lleva sus comentarios,
  -- incluidos los de otras personas. Es lo que hace todo el mundo, pero es
  -- destruccion de contenido ajeno por accion de un tercero y la UI tiene que
  -- advertirlo antes de borrar.
  DELETE FROM community_posts WHERE id = p_post_id;

  RETURN jsonb_build_object('borrado', TRUE);
END;
$function$;

comment on function public.eliminar_publicacion_comunidad(uuid) is
  'Borrado DURO de publicacion o comentario. Puede el autor, el autor de la madre, el mando local o admin/moderator global. Un id inexistente devuelve {"borrado": false} en vez de error: idempotente, y no confirma la existencia de ids ajenos.';

revoke execute on function public.eliminar_publicacion_comunidad(uuid)
  from public, anon, authenticated;
grant  execute on function public.eliminar_publicacion_comunidad(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 7.12 alternar_like_publicacion -- el corazon.
--
-- Devuelve {le_di_like, likes_count} autoritativo -- el contador ya actualizado
-- por el trigger dentro de la misma transaccion -- para que la tarjeta
-- reconcilie el optimista sin una segunda peticion.
--
-- Es la unica via de escritura de community_post_likes, que no tiene ni un
-- grant ni una policy.
-- ---------------------------------------------------------------------------
create or replace function public.alternar_like_publicacion(p_post_id uuid)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_madre  UUID;
  v_era    BOOLEAN;
  v_n      INT;
  v_total  INT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  -- Una cuenta suspendida no reacciona (hallazgo I-10). No lo cubria
  -- puedo_ver_publicacion, que comprueba si el AUTOR de la publicacion esta
  -- vetado y jamas si el LLAMANTE esta suspendido: son cosas distintas. Sin
  -- esto, alguien suspendido seguia pudiendo dar 300 likes cada 24 h, que
  -- suben likes_count de publicaciones ajenas -- prueba social real y visible
  -- para todo el barrio, escrita por una cuenta suspendida -- y sin rastro.
  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;
  IF p_post_id IS NULL THEN
    RAISE EXCEPTION 'Falta la publicacion.' USING ERRCODE = '22023';
  END IF;

  -- puedo_ver_publicacion resuelve de un golpe comunidad viva, pertenencia,
  -- publicacion no oculta y autor no vetado. Reaccionar exige exactamente lo
  -- mismo que ver.
  IF NOT public.puedo_ver_publicacion(p_post_id) THEN
    RAISE EXCEPTION 'No puedes reaccionar a esa publicacion.' USING ERRCODE = '42501';
  END IF;

  -- En v1 solo se reacciona a publicaciones de muro, no a comentarios.
  SELECT p.parent_post_id INTO v_madre FROM community_posts p WHERE p.id = p_post_id;
  IF v_madre IS NOT NULL THEN
    RAISE EXCEPTION 'No se puede reaccionar a un comentario.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:like:' || v_viewer::text, 0));

  DELETE FROM community_post_likes
   WHERE post_id = p_post_id AND user_id = v_viewer;

  IF FOUND THEN
    v_era := TRUE;
  ELSE
    -- La cuota se comprueba SOLO al dar like, nunca al quitarlo: si no, quitar
    -- likes contaria contra el limite y quedarias atrapado. Eso se conserva.
    --
    -- Lo que cambia es CONTRA QUE se cuenta (hallazgo C-3): antes se contaban
    -- filas vivas de community_post_likes, y la linea de arriba borra esa misma
    -- fila al quitar el like. Un bucle de dos peticiones (like, unlike) devolvia
    -- el contador a cero en cada vuelta, asi que el tope de 300 no mordia nunca
    -- -- y cada vuelta disparaba publicacion_cuenta_likes, o sea dos versiones
    -- nuevas de la MISMA fila de community_posts: hinchazon dirigida y
    -- contencion de bloqueo sobre la publicacion mas caliente del barrio.
    SELECT count(*) INTO v_n
      FROM community_post_quota q
     WHERE q.user_id = v_viewer AND q.tipo = 'reaccion'
       AND q.created_at > now() - interval '24 hours';
    IF v_n >= public.comunidades_limite('reacciones_24h') THEN
      RAISE EXCEPTION 'Demasiadas reacciones en 24 horas.' USING ERRCODE = '23514';
    END IF;

    -- ON CONFLICT y no un 23505 al aire: el doble toque del pulgar es lo
    -- primero que golpea esto.
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
  'Unica via de escritura de community_post_likes, que no tiene ni un grant ni una policy. Devuelve el contador ya actualizado por el trigger en la misma transaccion. Comprueba tambien que el LLAMANTE no este suspendido, que es cosa distinta de que lo este el autor. La cuota de 300 reacciones en 24 h se cuenta contra el ledger community_post_quota -- contando likes vivos, el ciclo like/unlike la reseteaba -- y se comprueba SOLO al dar, nunca al quitar: si no, quitar likes contaria contra el limite y quedarias atrapado.';

revoke execute on function public.alternar_like_publicacion(uuid)
  from public, anon, authenticated;
grant  execute on function public.alternar_like_publicacion(uuid) to authenticated;


-- ===========================================================================
-- 8. Y AL FINAL, SIEMPRE.
--
-- Sin esto PostgREST sigue sirviendo el esquema viejo: las tablas, las RPC y
-- los grants nuevos NO existen para la API por mucho que existan en la base.
-- ===========================================================================
notify pgrst, 'reload schema';

commit;

-- ===========================================================================
-- VERIFY -- correr DESPUES de aplicar, en el editor SQL o por la Management
-- API. No es "deberia funcionar": ejercita los ataques.
--
-- Con set_config a secas, el editor SQL corre como postgres, bypasea RLS y el
-- test MIENTE EN VERDE -- un ataque que debia dar UPDATE 0 dio UPDATE 3 y paso
-- como correcto durante la sesion 5a. Por eso todo lo que ejercita permisos va
-- dentro de BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims
-- = ...; ROLLBACK;
--
-- Sustituir <no-miembro>, <miembro>, <miembro-raso>, <no-fundador>,
-- <comunidad>, <comunidad-B>, <post> y <post-de-comunidad-A> por uuids reales
-- antes de correrlo. Los ataques nuevos (bloque C, del 12 en adelante) anaden
-- <cuenta-A>, <cuenta-B>, <A-bloqueador>, <B-bloqueado>, <post-de-A>,
-- <suspendido>, <comunidad-archivada>, <miembro-de-archivada>, <fundador> y
-- <tercero>.
-- ===========================================================================
--
-- ---- A. PRIVILEGIOS -------------------------------------------------------
-- Se comprueba con has_*_privilege, NUNCA leyendo la ACL: la ACL puede quedar
-- limpia y el privilegio seguir llegando por PUBLIC. Y role_table_grants NO
-- muestra nada para tablas con grants por columna, asi que engana la auditoria.
--
--   -- A1. centro, celda, nombre_norm, owner_id y fundador_id invisibles; el
--   --     resto visible. owner_id y fundador_id salen del grant por el
--   --     hallazgo I-11: (nombre, owner_id) es "X vive en el barrio Y" para
--   --     toda la base en una peticion, y el nombre es un toponimo por diseno.
--   SELECT has_column_privilege('authenticated','public.communities','centro','SELECT')         AS ve_centro,   -- false
--          has_column_privilege('authenticated','public.communities','celda','SELECT')          AS ve_celda,    -- false
--          has_column_privilege('authenticated','public.communities','nombre_norm','SELECT')    AS ve_norm,     -- false
--          has_column_privilege('authenticated','public.communities','owner_id','SELECT')       AS ve_owner,    -- false
--          has_column_privilege('authenticated','public.communities','fundador_id','SELECT')    AS ve_fundador, -- false
--          has_column_privilege('authenticated','public.communities','nombre','SELECT')         AS ve_nombre,   -- true
--          has_column_privilege('authenticated','public.communities','miembros_count','SELECT') AS ve_conteo;   -- true
--
--   -- A2. anon a cero en las CINCO tablas, y sin escritura ni TRUNCATE nadie.
--   --     community_post_quota entra aqui: es el ledger de las cuotas y no lo
--   --     puede leer ni tocar nadie salvo las RPC DEFINER que lo escriben.
--   SELECT t AS tabla,
--          has_table_privilege('anon', t, 'SELECT')             AS anon_lee,       -- false x5
--          has_table_privilege('authenticated', t, 'SELECT')    AS auth_lee,       -- ver nota
--          has_table_privilege('authenticated', t, 'INSERT')    AS auth_inserta,   -- false x5
--          has_table_privilege('authenticated', t, 'UPDATE')    AS auth_actualiza, -- false x5
--          has_table_privilege('authenticated', t, 'DELETE')    AS auth_borra,     -- false x5
--          has_table_privilege('authenticated', t, 'TRUNCATE')  AS auth_trunca     -- false x5
--     FROM unnest(ARRAY['public.communities','public.community_members',
--                       'public.community_posts','public.community_post_likes',
--                       'public.community_post_quota']) t;
--   -- Nota sobre auth_lee: has_table_privilege mira el privilegio de TABLA, y
--   -- communities lo tiene por COLUMNA, asi que ahi sale false y no es un
--   -- fallo -- por eso A1 existe y usa has_column_privilege. Esperado:
--   -- communities false, community_members true, community_posts true,
--   -- community_post_likes false, community_post_quota false.
--
--   -- A2b. La SECUENCIA del ledger tampoco es de nadie. El REVOKE de la tabla
--   --      no la cubre: es un objeto aparte con su propia ACL, y el ALTER
--   --      DEFAULT PRIVILEGES del esquema public reparte tambien secuencias.
--   SELECT has_sequence_privilege('anon',         'public.community_post_quota_id_seq','USAGE')  AS anon_usa,    -- false
--          has_sequence_privilege('authenticated','public.community_post_quota_id_seq','SELECT') AS auth_lee,    -- false
--          has_sequence_privilege('authenticated','public.community_post_quota_id_seq','UPDATE') AS auth_setval; -- false
--
--   -- A2c. Y el ledger tiene fecha de caducidad de verdad, no un comentario.
--   SELECT jobname, schedule, active FROM cron.job
--    WHERE jobname = 'purga_community_post_quota';
--   -- esperado: 1 fila, '17 4 * * *', active = true. Si sale 0 filas, la
--   -- retencion de 48 h no la aplica nadie y el ledger es un diario de
--   -- actividad por persona que crece para siempre.
--
--   -- A3. community_post_likes: NADA, ni SELECT.
--   SELECT has_table_privilege('authenticated','public.community_post_likes','SELECT');  -- false
--
--   -- A4. Los helpers TIENEN que estar concedidos a authenticated o toda
--   --     lectura del muro muere con un 42501 que parece de RLS.
--   SELECT f, has_function_privilege('authenticated', f, 'EXECUTE') AS auth,  -- true x6
--             has_function_privilege('anon',          f, 'EXECUTE') AS anon   -- false x6
--     FROM unnest(ARRAY['public.es_miembro_de_comunidad(uuid)',
--                       'public.mis_comunidades_ids()',
--                       'public.es_moderador_de_comunidad(uuid)',
--                       'public.autor_vetado_para_mi(uuid)',
--                       'public.puedo_ver_publicacion(uuid)',
--                       'public.comunidades_limite(text)']) f;
--   -- mis_comunidades_ids() la llama la policy de community_posts, asi que la
--   -- ejecuta el ROL QUE CONSULTA: sin ese grant, toda lectura del muro por
--   -- REST muere con un 42501 que parece de RLS.
--
--   -- A4b. Lo que NO se concede a nadie: hay_bloqueo_con (solo la llaman
--   --      autor_vetado_para_mi y dos RPC, las tres DEFINER) y
--   --      comunidad_traspasa_mando (una RPC, un trigger y delete_user_data).
--   --      Concedida, esta ultima dejaria destituir al mando de una comunidad
--   --      ajena con una peticion.
--   SELECT has_function_privilege('authenticated','public.hay_bloqueo_con(uuid)','EXECUTE'),  -- false
--          has_function_privilege('anon',         'public.hay_bloqueo_con(uuid)','EXECUTE'),  -- false
--          has_function_privilege('authenticated','public.comunidad_traspasa_mando(uuid,uuid)','EXECUTE'),  -- false
--          has_function_privilege('anon',         'public.comunidad_traspasa_mando(uuid,uuid)','EXECUTE');  -- false
--
--   -- A5. Ni una RPC abierta a anon.
--   SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE')
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND (p.proname LIKE '%comunidad%' OR p.proname LIKE '%comunidades%'
--           OR p.proname LIKE '%publicacion%');
--   -- esperado: false en TODAS
--
--   -- A6. Y ni una sobrecarga: una fila por nombre. Una sobrecarga accidental
--   --     es un 300 PGRST203 en todas las llamadas viejas.
--   SELECT p.proname, count(*)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public'
--      AND p.proname IN ('fundar_comunidad','alternar_membresia_comunidad',
--                        'publicar_en_comunidad','alternar_like_publicacion',
--                        'feed_comunidades_explorar','feed_muro_comunidad',
--                        'descubrir_comunidades','comentarios_de_publicacion',
--                        'eliminar_publicacion_comunidad','mis_comunidades',
--                        'centro_de_mi_comunidad','archivar_comunidad',
--                        'editar_descripcion_comunidad','comunidades_limite',
--                        'es_miembro_de_comunidad','es_moderador_de_comunidad',
--                        'mis_comunidades_ids','autor_vetado_para_mi',
--                        'puedo_ver_publicacion','hay_bloqueo_con',
--                        'comunidad_releva_mando','comunidad_traspasa_mando')
--    GROUP BY 1 HAVING count(*) <> 1;
--   -- esperado: 0 filas
--
--
-- ---- B. POLICIES ----------------------------------------------------------
-- El nombre de una policy puede mentir: "Rankings are publicly readable" estaba
-- TO authenticated y anon leia 0 filas. Se mira el rol REAL.
--
--   SELECT tablename, policyname, cmd, roles FROM pg_policies
--    WHERE tablename IN ('communities','community_members','community_posts',
--                        'community_post_likes','community_post_quota')
--    ORDER BY tablename, cmd;
--   -- esperado EXACTAMENTE:
--   --   communities          | select | {authenticated}
--   --   community_members    | select | {authenticated}
--   --   community_posts      | select | {authenticated}
--   --   community_post_likes | (ninguna fila)
--   --   community_post_quota | (ninguna fila)
--   -- Cualquier fila de mas es una policy creada desde el Dashboard, y las
--   -- permissive se OR-ean: no cierran, ABREN.
--
--   -- Y que los dos has_role de cada policy sean InitPlan y no una llamada por
--   -- fila (hallazgo I-12): en el texto del USING tienen que aparecer como
--   -- "( SELECT has_role(...))", no como "has_role(...)" a secas.
--   SELECT tablename, policyname, qual FROM pg_policies
--    WHERE tablename IN ('communities','community_members','community_posts');
--
--   SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
--    WHERE oid IN ('public.communities'::regclass,'public.community_members'::regclass,
--                  'public.community_posts'::regclass,'public.community_post_likes'::regclass,
--                  'public.community_post_quota'::regclass);
--   -- esperado: relrowsecurity = true en las cinco
--
--
-- ---- C. LOS ATAQUES, EJERCITADOS DE VERDAD --------------------------------
--
--   -- C1. Un NO miembro no lee el muro por REST.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<no-miembro>","role":"authenticated"}';
--     SELECT count(*) FROM public.community_posts WHERE community_id = '<comunidad>';
--     -- esperado: 0
--     SELECT count(*) FROM public.community_posts;
--     -- esperado: 0 (o solo las suyas). Si sale el corpus entero, la policy no cierra.
--     SELECT * FROM public.feed_muro_comunidad('<comunidad>');
--     -- esperado: 42501 'Unete a la comunidad para ver su muro.'
--   ROLLBACK;
--
--   -- C2. Nadie escribe por REST directo.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     INSERT INTO public.community_posts (community_id, author_id, cuerpo)
--       VALUES ('<comunidad>','<miembro>','a mano');            -- esperado 42501
--     UPDATE public.community_posts SET is_hidden = false WHERE true;  -- esperado 42501
--     INSERT INTO public.community_post_likes (post_id, user_id)
--       VALUES ('<post>','<miembro>');                          -- esperado 42501
--     INSERT INTO public.communities (nombre, owner_id, centro)
--       VALUES ('Pirata','<miembro>', ST_SetSRID(ST_MakePoint(-98.21,19.04),4326)::geography);
--                                                               -- esperado 42501
--   ROLLBACK;
--
--   -- C3. El centro no sale, NI SIQUIERA filtrando u ordenando por el.
--   --     Postgres exige privilegio de columna tambien en el WHERE y en el
--   --     ORDER BY, asi que los cuatro tienen que morir igual.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     SELECT centro FROM public.communities LIMIT 1;                      -- 42501
--     SELECT id FROM public.communities WHERE centro IS NOT NULL LIMIT 1; -- 42501
--     SELECT id FROM public.communities ORDER BY centro LIMIT 1;          -- 42501
--     SELECT * FROM public.communities LIMIT 1;                           -- 42501 (select * muere ENTERO)
--   ROLLBACK;
--
--   -- C4. El centro de otro no se lee ni por la RPC del dueno.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<no-fundador>","role":"authenticated"}';
--     SELECT * FROM public.centro_de_mi_comunidad('<comunidad>');   -- esperado: 0 filas
--   ROLLBACK;
--
--   -- C5. El padron no es enumerable por un miembro cualquiera.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro-raso>","role":"authenticated"}';
--     SELECT count(*) FROM public.community_members WHERE community_id = '<comunidad>';
--     -- esperado: 1 (solo la suya), NO el padron entero
--   ROLLBACK;
--
--   -- C6. Las cuotas muerden, y muerden a la segunda.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     SELECT public.fundar_comunidad('Barrio de prueba', 19.041, -98.206);  -- ok
--     SELECT public.fundar_comunidad('Otro barrio',      19.081, -98.246);  -- 23514 (1 cada 24 h)
--   ROLLBACK;
--
--   -- C6b. El duplicado por celda, con DOS CUENTAS (hallazgo S-17).
--   --      La version vieja de esta prueba usaba un solo 'sub' y era
--   --      INALCANZABLE: dentro de la misma transaccion la fila de la primera
--   --      llamada ya es visible para la segunda, asi que moria antes en CUOTA
--   --      B (comunidades_fundadas_24h = 1, 23514), y aunque se subiera ese
--   --      tope moriria en CUOTA C, porque round(19.041,2) = round(19.0415,2) y
--   --      round(-98.206,2) = round(-98.2065,2): mismo punto, distancia 0 <
--   --      1000 m. Nunca se llegaba al indice unico, que es el UNICO control
--   --      anti-suplantacion de nombre de la entrega. Con dos cuentas si se
--   --      evalua, y ademas es el caso real: CUOTA C solo restringe al mismo
--   --      fundador.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<cuenta-A>","role":"authenticated"}';
--     SELECT public.fundar_comunidad('Barrio de prueba', 19.041, -98.206);
--     SET LOCAL request.jwt.claims = '{"sub":"<cuenta-B>","role":"authenticated"}';
--     SELECT public.fundar_comunidad('BARRIO DE PRUEBA', 19.0415, -98.2065);
--     -- esperado: 23505 'Ya existe una comunidad con ese nombre por aqui'
--     -- (BARRIO y Barrio normalizan igual y 19.0415/-98.2065 cae en la misma
--     --  celda '19.04,-98.21' que 19.041/-98.206).
--   ROLLBACK;
--
--   -- C6c. Y dos nombres NO LATINOS distintos en la misma celda SI entran los
--   --      dos (hallazgo I-6). Sin el md5, los dos normalizarian a cadena
--   --      vacia, el segundo daria 23505 y el mensaje mentiria: la ranura del
--   --      nombre vacio quedaba ocupada para toda la celda y para siempre.
--   --      Sustituir los dos literales por nombres de 3 a 40 caracteres sin
--   --      ninguna letra ni digito latino (cirilico, chino, emojis).
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<cuenta-A>","role":"authenticated"}';
--     SELECT public.fundar_comunidad('<nombre-no-latino-1>', 19.041, -98.206);
--     SET LOCAL request.jwt.claims = '{"sub":"<cuenta-B>","role":"authenticated"}';
--     SELECT public.fundar_comunidad('<nombre-no-latino-2>', 19.0415, -98.2065);
--     -- esperado: las DOS entran.
--     RESET ROLE;   -- nombre_norm no esta concedida a authenticated: 42501
--     SELECT nombre_norm FROM public.communities
--      WHERE celda = '19.04,-98.21' ORDER BY created_at DESC LIMIT 2;
--     -- esperado: dos md5 DISTINTOS, ninguno cadena vacia.
--   ROLLBACK;
--
--   -- C7. El doble toque es idempotente, no un error.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     SELECT public.alternar_like_publicacion('<post>');  -- {"le_di_like":true, "likes_count":N+1}
--     SELECT public.alternar_like_publicacion('<post>');  -- {"le_di_like":false,"likes_count":N}
--     SELECT public.alternar_like_publicacion('<post>');  -- {"le_di_like":true, "likes_count":N+1}
--     -- ninguna de las tres puede lanzar excepcion
--   ROLLBACK;
--
--   -- C8. Un comentario no puede colarse en otra comunidad. Lo impide la FK
--   --     compuesta, no el codigo. (Va sin SET ROLE a proposito: se quiere ver
--   --     que ni siquiera el dueno de la tabla puede.)
--   BEGIN;
--     INSERT INTO public.community_posts (community_id, author_id, parent_post_id, cuerpo)
--     VALUES ('<comunidad-B>','<miembro>','<post-de-comunidad-A>','cruzado');
--     -- esperado: 23503, violacion de community_posts_parent_fkey
--   ROLLBACK;
--
--   -- C9. Y no hay comentarios de nivel 2.
--   SELECT count(*) FROM public.community_posts hijo
--     JOIN public.community_posts madre ON madre.id = hijo.parent_post_id
--    WHERE madre.parent_post_id IS NOT NULL;
--   -- esperado: 0
--
--   -- C10. El descubrimiento no se puede ensanchar y no expone precision falsa.
--   SELECT DISTINCT distancia_m % 500 FROM public.descubrir_comunidades(19.041,-98.206,50);
--   -- esperado: una sola fila, 0
--   SELECT max(distancia_m) FROM public.descubrir_comunidades(19.041,-98.206,50);
--   -- esperado: <= 5500. El radio duro son 5100 m (5000 del producto + 100 de
--   -- colchon por el snap de la entrada) y el cubo de 500 m redondea hacia
--   -- ARRIBA: CEIL(5100/500)*500 = 5500. Decia <= 5100 (hallazgo S-18), que la
--   -- funcion NO puede garantizar: cualquier comunidad en (5000, 5100] -- que
--   -- el propio ST_DWithin deja pasar -- sale como 5500 y pondria la asercion
--   -- en rojo sin que nada este roto. Y no hay forma de pedir mas: no hay
--   -- parametro de radio. Si algun dia se quiere que el numero publicado no
--   -- exceda el radio anunciado, la unica via coherente con el cubo es bajar el
--   -- colchon de c_radio a un multiplo de 500, NO acotar la salida con LEAST:
--   -- eso devolveria 5100 y rompe la asercion hermana de aqui arriba.
--
--   -- C11. El centro guardado esta en la rejilla, y el CHECK lo impone incluso
--   --      saltandose la RPC.
--   BEGIN;
--     INSERT INTO public.communities (nombre, owner_id, centro)
--     VALUES ('Domicilio exacto', NULL,
--             ST_SetSRID(ST_MakePoint(-98.20631, 19.04127),4326)::geography);
--     -- esperado: 23514, communities_centro_en_rejilla
--   ROLLBACK;
--
--   -- C12. La policy de communities SIGUE devolviendo filas sin el privilegio
--   --      de columna sobre owner_id, que su USING referencia (hallazgo I-11).
--   --      OBLIGATORIA antes de dar por bueno el grant recortado: si diera
--   --      42501, el motor estaria exigiendo el privilegio tambien para la
--   --      expresion de la policy, y entonces la rama "owner_id = (select
--   --      auth.uid())" se mueve a un helper SECURITY DEFINER de un solo
--   --      argumento, como los otros cuatro.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     SELECT id, nombre FROM public.communities LIMIT 1;   -- esperado: 1 fila
--     SELECT owner_id FROM public.communities LIMIT 1;     -- esperado: 42501
--   ROLLBACK;
--
--   -- C13. COMENTAR NO SE SALTA EL BLOQUEO (hallazgo C-1). A y B en la misma
--   --      comunidad, A bloqueo a B. B conserva el uuid de un post de A.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<B-bloqueado>","role":"authenticated"}';
--     SELECT public.publicar_en_comunidad('<comunidad>','acoso','<post-de-A>');
--     -- esperado: P0002 'Esa publicacion ya no esta disponible.'
--     -- (mismo mensaje y codigo que el post inexistente, a proposito: si
--     --  fueran distintos la guardia seria un oraculo de bloqueo)
--     -- Antes del arreglo esto devolvia el id del comentario, con 200.
--   ROLLBACK;
--
--   -- C14. DE UNA COMUNIDAD ARCHIVADA SE PUEDE SALIR (hallazgo C-2). Es la
--   --      unica salida que existe: community_members no tiene GRANT de UPDATE
--   --      ni DELETE ni policy de escritura.
--   BEGIN;
--     -- Se archiva por UPDATE directo y no por la RPC a proposito: aqui todavia
--     -- se corre como postgres, y archivar_comunidad exige auth.uid().
--     UPDATE public.communities SET archived_at = now()
--      WHERE id = '<comunidad-archivada>' AND archived_at IS NULL;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro-de-archivada>","role":"authenticated"}';
--     SELECT public.alternar_membresia_comunidad('<comunidad-archivada>');
--     -- esperado: {"soy_miembro": false, ...}. Antes: P0002 para siempre, y
--     -- esa plaza muerta seguia gastando una de las 20 membresias.
--     SELECT public.alternar_membresia_comunidad('<comunidad-archivada>');
--     -- esperado: P0002 al intentar VOLVER a entrar. Salir si, entrar no.
--   ROLLBACK;
--
--   -- C15. PUBLICAR-BORRAR-PUBLICAR NO RESETEA LA CUOTA (hallazgo C-3).
--   --      Repetir 10 veces el par publicar/eliminar y comprobar que la 11a
--   --      publicacion sigue dando 23514: la cuota cuenta EVENTOS en
--   --      community_post_quota, no filas vivas de community_posts.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     DO $bucle$
--     DECLARE r jsonb; i int;
--     BEGIN
--       FOR i IN 1..10 LOOP
--         r := public.publicar_en_comunidad('<comunidad>', 'prueba ' || i);
--         PERFORM public.eliminar_publicacion_comunidad((r->>'id')::uuid);
--       END LOOP;
--     END $bucle$;
--     SELECT count(*) FROM public.community_posts WHERE author_id = '<miembro>';  -- 0
--     SELECT public.publicar_en_comunidad('<comunidad>','la once');
--     -- esperado: 23514 'Llegaste al limite de 10 publicaciones en 24 horas.'
--     -- Antes: 200, en bucle infinito, con el muro aparentemente limpio.
--   ROLLBACK;
--
--   -- C16. 300 CICLOS DE LIKE/UNLIKE Y EL 301 MUERDE (hallazgo C-3).
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     DO $bucle$
--     DECLARE i int;
--     BEGIN
--       FOR i IN 1..300 LOOP
--         PERFORM public.alternar_like_publicacion('<post>');   -- da
--         PERFORM public.alternar_like_publicacion('<post>');   -- quita
--       END LOOP;
--     END $bucle$;
--     SELECT public.alternar_like_publicacion('<post>');
--     -- esperado: 23514 'Demasiadas reacciones en 24 horas.'
--     -- Quitar sigue sin gastar ni comprobar cuota, asi que nadie queda
--     -- atrapado: eso es lo bueno de la decision original y se conserva.
--   ROLLBACK;
--
--   -- C17. FUNDAR-SOLTAR-FUNDAR NO RESETEA LAS CUOTAS (hallazgo C-4). Las
--   --      cuotas cuelgan de fundador_id, que es inmutable, no de owner_id,
--   --      que se suelta en una peticion.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<cuenta-A>","role":"authenticated"}';
--     -- El id se toma del jsonb que devuelve la propia RPC: fundador_id NO
--     -- esta concedida a authenticated, asi que un SELECT sobre esa columna
--     -- moriria con 42501 y esconderia lo que se quiere medir.
--     DO $ciclo$
--     DECLARE r jsonb;
--     BEGIN
--       r := public.fundar_comunidad('Barrio uno', 19.041, -98.206);
--       PERFORM public.alternar_membresia_comunidad((r->>'id')::uuid);
--     END $ciclo$;
--     SELECT public.fundar_comunidad('Barrio dos', 19.081, -98.246);
--     -- esperado: 23514 por CUOTA B. Antes, con las cuotas sobre owner_id:
--     -- salir ponia owner_id a NULL, las tres daban 0 y entraba -- un bucle de
--     -- dos peticiones por comunidad, sin techo.
--   ROLLBACK;
--
--   -- C17b. TRASPASAR EL MANDO NO TRASPASA LA AUTORIA. soy_fundador responde
--   --       por fundador_id, no por m.role: antes el heredero recibia la
--   --       insignia de fundador y quien la fundo la perdia.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<relevo>","role":"authenticated"}';
--     SELECT id, mi_rol, soy_fundador FROM public.mis_comunidades()
--      WHERE id = '<comunidad-traspasada>';
--     -- esperado: mi_rol = 'owner' y soy_fundador = false.
--   ROLLBACK;
--
--   -- C18. UNA CUENTA SUSPENDIDA NO REACCIONA NI SE UNE, PERO SI SALE (I-10).
--   BEGIN;
--     UPDATE public.profiles SET is_hidden = TRUE WHERE id = '<suspendido>';
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<suspendido>","role":"authenticated"}';
--     SELECT public.alternar_like_publicacion('<post>');            -- 42501
--     SELECT public.alternar_membresia_comunidad('<comunidad-B>');  -- 42501 (entrar)
--     SELECT public.alternar_membresia_comunidad('<comunidad>');    -- OK (salir)
--   ROLLBACK;
--
--   -- C18b. NI EDITA EL CARTEL DE SU COMUNIDAD. Es la QUINTA superficie de
--   --       escritura publica y era la unica sin guardia: la descripcion la ve
--   --       cualquiera a <=5 km por descubrir_comunidades, sin pertenecer, y
--   --       moderate_set_content_hidden no tiene rama para 'community', asi
--   --       que callar ese texto exigia SQL manual.
--   BEGIN;
--     UPDATE public.profiles SET is_hidden = TRUE WHERE id = '<suspendido-owner>';
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<suspendido-owner>","role":"authenticated"}';
--     SELECT public.editar_descripcion_comunidad('<su-comunidad>','texto nuevo');
--     -- esperado: 42501 'Tu cuenta esta suspendida.'
--   ROLLBACK;
--
--   -- C19. SUSPENDER A QUIEN FUNDO NO APAGA LA COMUNIDAD PARA TERCEROS (I-14).
--   --      Antes, suspender una cuenta la borraba del descubrimiento para todo
--   --      el mundo y cerraba el alta -- y BORRAR esa misma cuenta la reencendia.
--   BEGIN;
--     UPDATE public.profiles SET is_hidden = TRUE WHERE id = '<fundador>';
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<tercero>","role":"authenticated"}';
--     SELECT count(*) FROM public.descubrir_comunidades(19.041,-98.206,50)
--      WHERE id = '<comunidad>';                                   -- esperado: 1
--     SELECT public.alternar_membresia_comunidad('<comunidad>');   -- esperado: entra
--   ROLLBACK;
--
--   -- C20. archivar_comunidad no miente (hallazgo I-16).
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     SELECT public.archivar_comunidad('<comunidad>');   -- ok la primera
--     SELECT public.archivar_comunidad('<comunidad>');   -- esperado: P0002
--     -- Antes la segunda devolvia {"archivada": true} con el UPDATE afectando
--     -- 0 filas, y la UI pintaba "comunidad archivada".
--   ROLLBACK;
--
--   -- C21. EL BORRADO POR CASCADA DEL FUNDADOR TRASPASA EL MANDO (hallazgo
--   --      I-9). Es el camino que NO pasa por delete_user_data: el boton
--   --      "Delete user" del Dashboard de Supabase, o cualquier DELETE sobre
--   --      auth.users. Antes dejaba la comunidad viva, con sus miembros, con
--   --      cero filas role='owner' y owner_id NULL: sin mando local para
--   --      siempre y sin que nada lo dijera. Lo cierra el trigger
--   --      comunidad_releva_mando, que cuelga de la TABLA.
--   BEGIN;
--     DELETE FROM auth.users WHERE id = '<fundador>';
--     SELECT c.id, c.owner_id, c.archived_at,
--            (SELECT count(*) FROM public.community_members m
--              WHERE m.community_id = c.id AND m.left_at IS NULL AND m.role = 'owner')
--       FROM public.communities c WHERE c.id = '<comunidad>';
--     -- esperado: exactamente UNA fila role='owner' viva y owner_id apuntando
--     -- a esa persona; o archived_at con fecha y owner_id NULL si no quedaba
--     -- nadie a quien traspasar. Nunca cero owners con archived_at NULL.
--   ROLLBACK;
--
--
-- ---- D. CONTADORES: QUE NO MIENTAN ----------------------------------------
--
--   SELECT c.id, c.miembros_count, count(m.*) AS real
--     FROM public.communities c
--     LEFT JOIN public.community_members m ON m.community_id = c.id AND m.left_at IS NULL
--    GROUP BY c.id, c.miembros_count HAVING c.miembros_count <> count(m.*);
--   -- esperado: 0 filas
--
--   SELECT p.id
--     FROM public.community_posts p
--    WHERE p.parent_post_id IS NULL
--      AND (p.likes_count <> (SELECT count(*) FROM public.community_post_likes l
--                              WHERE l.post_id = p.id)
--        OR p.comentarios_count <> (SELECT count(*) FROM public.community_posts h
--                                    WHERE h.parent_post_id = p.id AND h.is_hidden = FALSE));
--   -- esperado: 0 filas
--
--   SELECT c.id, c.publicaciones_count, count(p.*) AS real
--     FROM public.communities c
--     LEFT JOIN public.community_posts p
--       ON p.community_id = c.id AND p.parent_post_id IS NULL AND p.is_hidden = FALSE
--    GROUP BY c.id, c.publicaciones_count HAVING c.publicaciones_count <> count(p.*);
--   -- esperado: 0 filas
--
--   -- D4. NI UNA referencia colgante en fundador_id. La FK no la detecta sola:
--   --     si el congelador de comunidad_normaliza revirtiera el SET NULL de la
--   --     accion referencial, la clave quedaria igual y la comprobacion
--   --     referencial se saltaria sin dar error. Barata y no borra nada.
--   SELECT count(*) FROM public.communities c
--    WHERE c.fundador_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = c.fundador_id);
--   -- esperado: 0, siempre.
--
--   -- D5. EL INVARIANTE DEL MANDO, que es lo unico que detecta sobre datos
--   --     reales una carrera de traspaso perdida: una comunidad viva tiene
--   --     EXACTAMENTE una fila role='owner' con left_at IS NULL. Cero owners
--   --     vivos con archived_at NULL es el estado terminal y silencioso --
--   --     nadie puede archivar, ni editar la descripcion, ni borrar spam -- y
--   --     no se sale de el sin SQL manual.
--   SELECT c.id, c.archived_at, c.owner_id,
--          (SELECT count(*) FROM public.community_members m
--            WHERE m.community_id = c.id AND m.left_at IS NULL AND m.role = 'owner') AS owners_vivos
--     FROM public.communities c
--    WHERE c.archived_at IS NULL
--      AND (SELECT count(*) FROM public.community_members m
--            WHERE m.community_id = c.id AND m.left_at IS NULL AND m.role = 'owner') <> 1;
--   -- esperado: 0 filas
--
--   -- D6. Y al reves: no se archiva una comunidad con gente dentro salvo que
--   --     alguien pulsara archivar. Antes lo hacia una rama de "cinturon y
--   --     tirantes" cuando perdia una carrera, y eso no tiene vuelta atras en
--   --     producto: no existe RPC de desarchivar.
--   SELECT c.id, c.miembros_count FROM public.communities c
--    WHERE c.archived_at IS NOT NULL AND c.miembros_count > 1;
--   -- esperado: 0 filas salvo archivados voluntarios por archivar_comunidad
--
--
-- ---- E. EL PLAN -----------------------------------------------------------
-- El unico riesgo real de esta entrega es que degrade SIN dar error, asi que se
-- afirma un numero medido, no una intencion.
--
--   EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
--     SELECT * FROM public.feed_comunidades_explorar(NULL, NULL, 30);
--   -- esperado:
--   --   * Index Only Scan using idx_community_posts_muro dentro de un nested loop
--   --   * Index Only Scan using idx_community_members_vivas como driver
--   --   * Heap Fetches bajo (si sube, autovacuum va atrasado en community_posts)
--   --   * NI Seq Scan NI Bitmap Heap Scan sobre community_posts
--   --   * el Sort intermedio con rows <= membresias x 30
--
--   EXPLAIN (ANALYZE, BUFFERS)
--     SELECT * FROM public.descubrir_comunidades(19.041, -98.206, 30);
--   -- esperado: Index Scan using idx_communities_centro con
--   --   Index Cond: (centro && _st_expand($punto, 5100))
--   -- NUNCA un Seq Scan sobre communities.
--
--   -- E3. El censo de suspendidos NO puede mover el tiempo de una pagina
--   --     (hallazgo I-7). Antes entraba entero en v_vetados: un array_agg
--   --     ordenado del conjunto GLOBAL en cada peticion, mas 600 x N
--   --     comparaciones lineales por pagina.
--   BEGIN;
--     UPDATE public.profiles SET is_hidden = TRUE
--      WHERE id IN (SELECT id FROM public.profiles WHERE is_hidden = FALSE LIMIT 5000);
--     EXPLAIN (ANALYZE, BUFFERS)
--       SELECT * FROM public.feed_comunidades_explorar(NULL, NULL, 30);
--     -- esperado: el tiempo NO se mueve respecto a E1, y los suspendidos
--     -- aparecen como sondeo de idx_profiles_suspendidos dentro del lateral,
--     -- no como un array_agg + Sort en el arranque.
--   ROLLBACK;
--
--   -- E4. NI UNA funcion SECURITY DEFINER por fila en la policy del muro
--   --     (hallazgo I-12). Correr como un authenticated SIN ninguna membresia.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<no-miembro>","role":"authenticated"}';
--     EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM public.community_posts LIMIT 1;
--     -- esperado, y esto es lo que hay que MIRAR en el texto del plan:
--     --   * los dos has_role como InitPlan
--     --   * mis_comunidades_ids como "SubPlan N" con "hashed SubPlan", y con
--     --     loops = 1 en su nodo: UNA ejecucion, no una por fila
--     --   * NI 'has_role(' NI 'es_miembro_de_comunidad(' dentro del Filter
--     -- La version anterior de esta asercion solo miraba los dos has_role, asi
--     -- que daba verde con el escaneo completo intacto: es_miembro_de_comunidad
--     -- seguia ejecutandose una vez por fila. Con 500.000 filas eso es medio
--     -- millon de llamadas DEFINER por una peticion de ~200 bytes, repetible en
--     -- bucle, porque el LIMIT se aplica DESPUES del filtro de RLS.
--   ROLLBACK;
--
--   -- E5. Borrar una publicacion con comentarios no recorre la tabla
--   --     (hallazgo I-13): la cascada de community_posts_parent_fkey necesita
--   --     idx_community_posts_padre, porque los dos indices parciales que
--   --     existian no son utilizables para 'parent_post_id = $1 AND
--   --     community_id = $2'.
--   BEGIN;
--     EXPLAIN (ANALYZE) DELETE FROM public.community_posts WHERE id = '<post>';
--   ROLLBACK;
--   -- esperado: ni un Seq Scan sobre community_posts. Antes: uno por borrado,
--   -- y delete_user_data encadenaba uno por publicacion de la cuenta.
--
--
-- ---- F. LA INVARIANTE DEL FAN-OUT -----------------------------------------
-- membresias_vivas x pagina_muro es la cota dura de tuplas candidatas por
-- pagina. Los dos numeros viven en comunidades_limite() precisamente para que
-- nadie pueda subir uno sin ver el otro.
--
-- Y AHORA SE MIDE EL HECHO, NO LA CONSTANTE (hallazgo I-5). La version vieja
-- multiplicaba los dos limites y afirmaba 600, asi que no podia detectar su
-- propia falsedad: fundar_comunidad metia su fila de 'owner' SIN pasar por el
-- tope de 20, y 20 + 3 fundadas = 23 x 30 = 690 tuplas candidatas por pagina,
-- no 600. La CUOTA D de fundar_comunidad cierra el camino; esto lo comprueba
-- sobre los datos reales.
--
--   SELECT max(n) FROM (
--     SELECT count(*) AS n
--       FROM public.community_members m
--       JOIN public.communities c ON c.id = m.community_id
--      WHERE m.left_at IS NULL
--        AND c.is_hidden = FALSE AND c.archived_at IS NULL
--      GROUP BY m.user_id) t;
--   -- esperado: <= public.comunidades_limite('membresias_vivas')
--   -- El join repite EXACTAMENTE los dos filtros de PARTICION del fan-out (una
--   -- comunidad oculta o archivada no aporta ni una candidata) y es el MISMO
--   -- conteo que aplican la CUOTA D de fundar_comunidad y la rama ENTRAR de
--   -- alternar_membresia_comunidad. Si los tres dejan de coincidir, esta
--   -- asercion deja de medir la cota.
--   --
--   -- LA COTA ES NOMINAL, NO UN INVARIANTE DURO, y este rojo tiene una causa
--   -- legitima: como el conteo mira solo comunidades vivas, archivar libera
--   -- plazas y RESTAURAR una comunidad (que un admin puede hacer, y que no
--   -- vuelve a comprobar el tope de nadie) puede dejar a sus miembros por
--   -- encima de 20. El motivo por el que se acepta esta escrito en la cabecera
--   -- de archivar_comunidad: acotarlo con un LIMIT sobre las membresias haria
--   -- que el muro ignorara comunidades del usuario EN SILENCIO. Si sale en
--   -- rojo, la pregunta es "que comunidad se restauro", no "relajo la
--   -- asercion".
--
--   SELECT public.comunidades_limite('membresias_vivas')
--          * public.comunidades_limite('pagina_muro') AS cota_fanout;
--   -- esperado: 600. Si sube, hay que volver a medir el EXPLAIN del punto E.
--
--
-- ---- G. Y AL FINAL, SIEMPRE -----------------------------------------------
--   NOTIFY pgrst, 'reload schema';
--
-- Los enganches de moderacion (auto_hide_on_threshold,
-- handle_child_safety_report, moderate_set_content_hidden, delete_user_data y
-- publicacion_cierra_sus_reportes) NO se verifican aqui: viven en el archivo 3
-- y llevan su propio bloque VERIFY.
-- ===========================================================================
