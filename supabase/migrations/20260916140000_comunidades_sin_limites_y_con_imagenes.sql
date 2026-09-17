-- Comunidades hiperlocales -- ARCHIVO 6: se caen dos cuotas, las publicaciones
-- llevan imagenes, y se devuelve una comunidad que quedo archivada en pruebas.
--
-- No reabre ninguno de los cinco archivos anteriores (20260912200000, 210000,
-- 220000, 230000, 240000): todo lo que cambia se recrea aqui copiando el cuerpo
-- VIVO, con CREATE OR REPLACE cuando la firma no se mueve y con DROP + CREATE
-- de firma completa cuando cambia el RETURNS o la ARIDAD. Idempotente de punta
-- a punta y sin begin/commit propios: apply-migration.mjs lo envuelve en UNA
-- transaccion con su fila del ledger.
--
-- ---------------------------------------------------------------------------
-- A. FUERA LA CUOTA DE 24 HORAS PARA FUNDAR (CUOTA B) -- POR QUE
--
-- Decision de producto de Pedro: "se eliminara la restriccion de esperar 24
-- horas para fundar una nueva comunidad". El producto esta en pre-lanzamiento y
-- esa espera bloquea las pruebas de la propia funcionalidad mas de lo que frena
-- a nadie: el techo real de fundacion sigue siendo la CUOTA A (3 vivas), que no
-- se puede rodear esperando.
--
-- La cuota se quita en UN SOLO SITIO. fundar_comunidad() NO cuenta las 24 horas
-- por su cuenta: desde 20260912230000 delega las cuotas A, B y D en
-- comunidad_fundacion_estado(), y ese helper es tambien el que consulta
-- estado_cuota_fundacion() para el boton "+". Se comprobo funcion por funcion
-- antes de escribir esto (no hay un segundo conteo de 24 h en ninguna de las
-- dos), asi que redefinir el helper deja el boton y la base diciendo lo mismo,
-- que es la propiedad entera por la que ese helper existe.
--
-- El campo 'siguiente_en' del jsonb NO se quita: es parte de la forma que
-- leen leerEstadoCuota() y el drawer de fundar, y quitarlo obligaria a tocar
-- dos componentes para nada. Pasa a ser SIEMPRE NULL, que ya es el valor que el
-- cliente sabe interpretar como "no hay cuenta atras".
--
-- Y el motivo de la CUOTA A deja de mandar a archivar: "Archiva una para fundar
-- otra" era el unico sitio del producto que empujaba a archivar, que es
-- irreversible desde la app (solo un admin des-archiva). Pasa a
-- "Ya fundaste N comunidades (limite maximo alcanzado)."
--
-- SOBREVIVEN las cuotas A (3 vivas), C (1 km entre las propias) y D (20
-- membresias): son las que impiden que una cuenta siembre el mapa.
--
-- ---------------------------------------------------------------------------
-- B. MOVER EL CENTRO SIN LIMITE DE VECES NI DE DISTANCIA -- POR QUE
--
-- Decision de producto de Pedro: "vamos a quitar esos dos movimientos, vamos a
-- ponerlo ilimitados, sin limites de distancia para moverla y sin limite de
-- veces que pueda moverla". Caen por tanto el radio de 1 km contra
-- centro_fundacion (el 23514 del archivo 4) y la cuota centros_24h = 2.
--
-- LO QUE NO CAE, Y ES LO QUE IMPORTA:
--   - la guardia de sesion y la de cuenta suspendida;
--   - que solo el MANDO (owner en su fila de membresia viva) mueva el centro;
--   - la validacion de coordenadas (NaN y rango) antes de tocar nada;
--   - el redondeo a la rejilla de 2 decimales, que es un CHECK de la tabla
--     (communities_centro_en_rejilla) y la unica razon por la que el centro no
--     es el domicilio de quien funda;
--   - la CUOTA C (1 km entre las comunidades propias vivas), que es lo que
--     impide sembrar la misma celda con tres comunidades propias -- y que
--     ahora es la UNICA regla geografica del movimiento, asi que gana
--     importancia en vez de perderla;
--   - el 23505 de uq_communities_celda_nombre traducido a un mensaje legible:
--     sin limite de distancia, mover a una celda donde ya hay una comunidad
--     viva con el mismo nombre normalizado deja de ser un caso raro y pasa a
--     ser algo que va a ocurrir;
--   - el set_config('vicino.mover_centro') local a la transaccion, que es el
--     UNICO camino que el trigger comunidad_normaliza deja abierto para que un
--     UPDATE cambie centro y celda.
--
-- LA LLAVE pg_advisory_xact_lock SOBREVIVE A LA CUOTA QUE LA JUSTIFICABA, y
-- ademas SE ADELANTA. Estaba puesta para serializar el conteo del ledger, pero
-- lo que de verdad protege es la CUOTA C, que es un leer-y-escribir: dos
-- movimientos simultaneos de la misma persona podian leer los dos "no hay nada
-- a menos de 1 km" y dejar despues dos comunidades propias en la misma celda.
-- En el archivo 4 la llave se tomaba DESPUES de comprobar la CUOTA C, o sea
-- fuera de la seccion critica; aqui se toma antes.
--
-- centro_de_mi_comunidad() sigue devolviendo movimientos_restantes_24h y
-- radio_metros. No se quitan aunque ya no signifiquen nada: cambiar el RETURNS
-- obliga a regenerar tipos y a tocar admin-panel y mover-centro-sheet en la
-- misma entrega, y el codegen de Supabase declara las columnas de un RETURNS
-- TABLE como NO nulables -- devolver NULL seria una mentira tipada, y en el
-- cliente `null <= 0` es TRUE, o sea que un NULL pintaria "sin movimientos"
-- justo despues de quitar el limite. Devuelven centinelas que significan "sin
-- limite" y que hacen pasar cualquier comparacion del cliente viejo:
--   movimientos_restantes_24h = 2147483647 (el maximo de int4)
--   radio_metros              = 20037509   (media circunferencia terrestre en
--                                           metros: no hay dos puntos en la
--                                           Tierra mas lejos, asi que ninguna
--                                           distancia real lo supera)
--
-- ---------------------------------------------------------------------------
-- C. PUBLICACIONES CON IMAGENES -- POR QUE Y CON QUE LIMITE
--
-- Pedro: "cuando yo quiera publicar un comentario o algo en la comunidad, en
-- las comunidades, no me deja subir imagenes". La migracion base lo dejo
-- escrito como decision explicita ("NO lleva imagen en v1", seccion 1.3), asi
-- que esto la revierte a proposito y no por descuido.
--
-- community_posts.imagenes es text[] de RUTAS del bucket, no de URL firmadas.
-- Una URL firmada caduca; guardarla dejaria la publicacion con un enlace muerto
-- a los pocos minutos y sin forma de volver a firmarlo. Es el mismo criterio
-- que messages.attachments (20260826370000): la fila guarda la ruta y el
-- servidor firma al pintar.
--
-- LA REGLA DE LA RUTA SE APLICA DOS VECES, y no es duplicacion gratuita:
--   1. En publicar_en_comunidad(), con mensajes para la persona.
--   2. En un CHECK de la tabla, via community_post_imagenes_validas(text[],
--      uuid), porque la funcion tiene que recorrer el array y un CHECK no
--      admite subconsultas. Mismo molde que chat_attachments_validos.
-- La segunda es la que vale cuando alguien entra por service_role, por un seed
-- o por un GRANT de INSERT concedido "por comodidad" el dia de manana: la ruta
-- tiene que empezar por el uuid de QUIEN FIRMA LA FILA, asi que una
-- publicacion no puede colgar el archivo de otra persona. Esa comprobacion
-- necesita author_id, que es columna de la MISMA fila, asi que cabe en el
-- CHECK; la de "el archivo existe" no cabe y no se hace (ver mas abajo).
--
-- EL CHECK DEL CUERPO SE RELAJA, Y HAY QUE VERLO. community_posts_cuerpo_largo
-- exigia char_length(btrim(cuerpo)) BETWEEN 1 AND 1500. Con imagenes, una
-- publicacion legitima puede no llevar texto, y cuerpo es NOT NULL sin default:
-- viaja como ''. Sin relajar el CHECK, la RPC aceptaria el caso y la tabla lo
-- rechazaria con un error del motor -- exactamente el modo de fallo que
-- messages_con_contenido cierra en el chat. Queda: el texto recortado no pasa
-- de 1500, y tiene que haber ALGO (texto no vacio o al menos una imagen). Es un
-- superconjunto de lo que se admitia, asi que las filas que ya existen pasan.
--
-- GRANTS: community_posts tiene GRANT SELECT de TABLA, no por columna (seccion
-- 6.3 de la base; la unica tabla del diseno con grants por columna es
-- communities). Un privilegio de tabla cubre tambien las columnas que se anadan
-- despues, asi que imagenes NO necesita GRANT propio -- y no se le da ninguno
-- de escritura, igual que al resto de la tabla: se escribe solo por RPC. Se
-- comprobo leyendo la seccion 6 de 20260912200000 antes de decidirlo.
--
-- LAS TRES RPC DE LECTURA CAMBIAN DE RETURNS, o sea DROP + CREATE con la firma
-- completa. feed_muro_comunidad y feed_comunidades_explorar tienen que seguir
-- devolviendo la MISMA forma de fila entre ellas (el cliente declara UN solo
-- tipo PostComunidad a partir del RETURNS del muro y pinta las dos pestanas con
-- el), asi que imagenes entra en las dos en la MISMA posicion, detras de
-- cuerpo. comentarios_de_publicacion la recibe en el mismo sitio.
--
-- Y publicar_en_comunidad GANA UN PARAMETRO, o sea cambia la ARIDAD. Eso NO se
-- puede hacer con CREATE OR REPLACE: dejaria las dos firmas vivas, y dos
-- sobrecargas del mismo nombre son un 300 PGRST203 de PostgREST para TODAS las
-- llamadas, incluidas las que mandan los tres argumentos de siempre. Va con
-- DROP FUNCTION de la firma vieja (uuid, text, uuid) primero, y el bloque de
-- comprobacion del final vuelve a contar las firmas dentro de la transaccion.
-- El parametro nuevo lleva DEFAULT, que es lo que hace que el codegen lo
-- declare OPCIONAL (p_imagenes?: string[]) y que el cliente que no manda
-- imagenes siga compilando sin un solo cast (20260826390000).
--
-- EL BUCKET community-media NACE NO PUBLICO. Molde: los dos archivos de fotos
-- de chat (20260826262000 y 20260826370000). Un bucket publico es una URL
-- eterna que circula sola, y aqui el contenido es una foto de un patio o de una
-- fachada con el barrio en el nombre de la comunidad. Se sirve por URL FIRMADA,
-- como el chat y como verification-documents.
--
-- SU LIMITE, ESCRITO PARA QUIEN CONSTRUYA ENCIMA: la policy de lectura es
-- "quien puede ver la publicacion", y se puede exigir de verdad porque la
-- ruta lleva la comunidad delante: <community_id>/<author_id>/<archivo>. Dos
-- helpers SECURITY DEFINER responden las dos preguntas que las policies
-- necesitan (puedo_ver_media_de_comunidad para leer, es_miembro_de_comunidad_por_ruta
-- para subir), porque una policy de storage.objects se evalua con el rol de
-- quien pide y consultar communities desde ahi pasaria por su propia RLS.
-- La policy de escritura cierra ademas la suplantacion: nadie deja un archivo
-- en la carpeta de otra persona ni en una comunidad a la que no pertenece, y
-- por eso la validacion de la RPC puede fiarse de los dos primeros tramos.
--
-- LO QUE NO SE COMPROBO A PROPOSITO: que el archivo EXISTA en el bucket. Se
-- valoro consultar storage.objects desde la RPC, y se descarto: storage.objects
-- tiene RLS y es de supabase_storage_admin, asi que leerla desde una funcion
-- SECURITY DEFINER de public depende de privilegios que esta migracion no
-- controla y que pueden cambiar con una actualizacion de la plataforma. Un
-- fallo ahi convertiria CADA publicacion en un 42501. Consecuencia aceptada: si
-- la subida fallo y el cliente llama igual, la publicacion queda con una ruta
-- que no resuelve, y el cliente tiene que tratar la imagen que no carga como
-- imagen que no carga, no como pagina rota.
--
-- ---------------------------------------------------------------------------
-- D. LA COMUNIDAD "Nenis Anahuac" VUELVE, CON SU MANDO -- POR QUE
--
-- Quedo archivada durante las pruebas del 12-sep, y archivar es irreversible
-- desde la app: archivar_comunidad() no tiene inversa y la migracion base lo
-- deja escrito ("des-archivar es manual y de admin"). Esto es esa mano de
-- admin, hecha con guardas en vez de a pelo en el editor SQL.
--
-- Va al FINAL del archivo, despues de los cambios de esquema, para que la
-- comunidad reviva ya bajo las reglas nuevas.
--
-- QUE PUEDE Y QUE NO PUEDE HACER ESTE BLOQUE:
--   - archived_at a NULL: si, no esta congelado por comunidad_normaliza.
--   - owner_id a la persona: si, tampoco esta congelado (es ON DELETE SET NULL
--     precisamente porque cambia).
--   - fundador_id: NO SE PUEDE, y no es un olvido. comunidad_normaliza congela
--     el RE-APUNTADO de fundador_id en todo UPDATE (solo deja pasar el vaciado
--     de la accion referencial), asi que si esa columna quedo en NULL no hay
--     forma de rellenarla desde aqui -- ni debe haberla: NULL significa "quien
--     la fundo ya no existe" y el diseno prohibe rellenarlo con quien manda
--     hoy. El bloque lo informa por RAISE NOTICE en vez de intentarlo y creer
--     que funciono.
--   - is_hidden: no se toca. archivar y ocultar son cosas distintas, y si esta
--     oculta es porque lo decidio moderacion. El estado se informa.
--
-- IDEMPOTENTE Y SIN EFECTOS SORPRESA: si la comunidad ya no existe, si ya esta
-- viva, si la persona ya no tiene perfil, o si des-archivarla choca con
-- uq_communities_celda_nombre (otra comunidad viva con el mismo nombre
-- normalizado en su celda), el bloque NO toca nada y lo dice. No lanza
-- excepcion: una reparacion de UNA fila no puede tumbar los tres bloques de
-- producto de arriba. Por eso lo que no puede hacer sale por RAISE WARNING y
-- no por RAISE NOTICE, y el VERIFY del final pregunta por el estado final en
-- vez de darlo por hecho.
--
-- CONSECUENCIA CONOCIDA de des-archivar, ya documentada en archivar_comunidad:
-- el tope de 20 membresias cuenta solo plazas en comunidades VIVAS, asi que
-- restaurar puede dejar a sus miembros con 21. Se acepta, es la misma nota que
-- el bloque F del VERIFY de la base ya avisa que puede salir en rojo.
--
-- ---------------------------------------------------------------------------
-- E. LOS TOPES QUE YA NO MUERDEN SIGUEN EN LA TABLA DE TOPES -- POR QUE
--
-- comunidades_limite() se redefine SOLO para marcar en el cuerpo y en el
-- COMMENT que comunidades_fundadas_24h y centros_24h ya no se aplican. No se
-- borran las claves: comunidades_limite() lanza 22023 con una clave
-- desconocida, asi que borrarlas convierte cualquier llamada que se me haya
-- pasado en un error en tiempo de ejecucion en vez de en un numero inofensivo.
-- Dejarlas SIN la nota era la otra opcion y es peor: un tope escrito en la
-- tabla de topes que nadie comprueba es una mentira esperando a que alguien la
-- lea. El valor 'centro_radio_metros' se queda por lo mismo.
--
-- El CHECK de community_post_quota.tipo conserva 'centro': el ledger es
-- append-only y ya hay filas con ese tipo; quitarlo del CHECK haria fallar la
-- revalidacion contra las filas que existen.
-- ---------------------------------------------------------------------------

-- (sin begin/commit propios: apply-migration.mjs envuelve el archivo entero en UNA transaccion junto con su fila del ledger)

-- ===========================================================================
-- 0. PREFLIGHT: los cinco archivos anteriores tienen que estar aplicados, y
--    con las firmas EXACTAS que este archivo va a redefinir. Sin esto, un
--    DROP FUNCTION de una firma que no existe se traga el IF EXISTS en verde y
--    deja viva la version vieja con otra aridad: dos firmas, 300 PGRST203.
-- ===========================================================================
DO $preflight$
BEGIN
  IF to_regclass('public.community_posts') IS NULL
     OR to_regclass('public.community_join_requests') IS NULL THEN
    RAISE EXCEPTION 'faltan los archivos de comunidades: no existen sus tablas'
      USING ERRCODE = '42P01';
  END IF;

  IF to_regprocedure('public.comunidad_fundacion_estado(uuid)') IS NULL
     OR to_regprocedure('public.editar_centro_comunidad(uuid, double precision, double precision)') IS NULL
     OR to_regprocedure('public.centro_de_mi_comunidad(uuid)') IS NULL
     OR to_regprocedure('public.publicar_en_comunidad(uuid, text, uuid)') IS NULL
     OR to_regprocedure('public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer)') IS NULL
     OR to_regprocedure('public.feed_comunidades_explorar(timestamp with time zone, uuid, integer)') IS NULL
     OR to_regprocedure('public.comentarios_de_publicacion(uuid, timestamp with time zone, uuid, integer)') IS NULL THEN
    RAISE EXCEPTION 'falta aplicar 20260912200000..240000: no estan las firmas que este archivo redefine'
      USING ERRCODE = '42883';
  END IF;

  -- La columna que 20260912230000 anadio: las tres RPC de lectura la devuelven,
  -- y sin ella el CREATE de abajo moriria a media migracion.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'communities'
                    AND column_name = 'es_privada') THEN
    RAISE EXCEPTION 'falta aplicar 20260912230000: communities.es_privada no existe'
      USING ERRCODE = '42703';
  END IF;
END
$preflight$;


-- ===========================================================================
-- 1. LOS TOPES: las dos claves que dejan de aplicarse quedan marcadas (E).
--    Cuerpo vivo de 20260912240000, mismos valores, misma firma.
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
         -- YA NO SE APLICA (20260916140000): fundar no tiene ventana de 24 h.
         -- La clave sobrevive para que una llamada olvidada devuelva un numero
         -- en vez de un 22023.
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
         -- YA NO SE APLICAN (20260916140000): mover el centro es ilimitado en
         -- veces y en distancia. Mismo motivo que arriba para no borrarlas.
         WHEN 'centros_24h'                THEN 2
         WHEN 'centro_radio_metros'        THEN 1000
         WHEN 'pagina_solicitudes'         THEN 30
         -- Archivo 5:
         WHEN 'moderadores_24h'            THEN 10
         -- Archivo 6:
         WHEN 'imagenes_por_publicacion'   THEN 4
         WHEN 'ruta_imagen_caracteres'     THEN 512
         ELSE NULL
       END;
  IF v IS NULL THEN
    RAISE EXCEPTION 'limite desconocido: %', p_clave USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$function$;

comment on function public.comunidades_limite(text) is
  'Tabla de cuotas del producto, en un solo sitio. membresias_vivas x pagina_muro = 600 es la cota dura del fan-out del muro unificado. Desde 20260912240000 incluye moderadores_24h; desde 20260916140000, imagenes_por_publicacion (4) y ruta_imagen_caracteres (512). DOS CLAVES SIGUEN AQUI SIN APLICARSE, a proposito: comunidades_fundadas_24h y centros_24h (mas centro_radio_metros) se conservan para que una llamada olvidada devuelva un numero en vez de un 22023, pero fundar ya no tiene ventana de 24 h y mover el centro no tiene limite de veces ni de distancia. Una clave desconocida lanza 22023 a proposito.';


-- ===========================================================================
-- 2. FUNDAR: FUERA LA CUOTA B (A)
--
-- Cuerpo vivo de 20260912230000 sin la ventana de 24 h. fundar_comunidad() no
-- se toca: delega en este helper y no cuenta nada por su cuenta, asi que el
-- boton y la base no pueden divergir. Solo se actualizan sus COMMENT, que
-- prometian una cuota que ya no existe.
-- ===========================================================================
create or replace function public.comunidad_fundacion_estado(p_viewer uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_tope_vivas INT := public.comunidades_limite('comunidades_fundadas_vivas');
  v_tope_memb  INT := public.comunidades_limite('membresias_vivas');
  v_vivas      INT;
  v_membresias INT;
BEGIN
  -- CUOTA A: cuantas tiene vivas (sobre fundador_id, que es inmutable). Es el
  -- unico techo de fundacion que queda, y no se rodea esperando: el motivo ya
  -- NO manda a archivar, porque archivar no tiene vuelta desde la app.
  SELECT count(*) INTO v_vivas
    FROM communities c WHERE c.fundador_id = p_viewer AND c.archived_at IS NULL;
  IF v_vivas >= v_tope_vivas THEN
    RETURN jsonb_build_object(
      'puede_fundar', false,
      'motivo', format('Ya fundaste %s comunidades (limite maximo alcanzado).', v_tope_vivas),
      'siguiente_en', NULL,
      'fundadas_vivas', v_vivas, 'tope_vivas', v_tope_vivas);
  END IF;

  -- La CUOTA B (una fundacion cada 24 h) vivia aqui y se elimina en
  -- 20260916140000. 'siguiente_en' se queda en la respuesta porque es parte de
  -- la forma que lee el cliente, y vale NULL siempre: sin ventana no hay
  -- cuenta atras que dar.

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
  'Cuotas A (3 vivas) y D (20 membresias) de fundar_comunidad, en un solo sitio para que estado_cuota_fundacion() y fundar_comunidad() no diverjan. La CUOTA B (una fundacion cada 24 horas) se ELIMINO en 20260916140000: siguiente_en se conserva en la respuesta por la forma que lee el cliente y vale NULL siempre. La CUOTA C (separacion de 1 km) depende del punto y vive en fundar_comunidad. No concedida a nadie.';

-- Los dos COMMENT que prometian la cuota B. Se corrigen sin redefinir las
-- funciones: sus cuerpos no cambian, y un CREATE OR REPLACE de mas es una
-- ocasion de mas de copiar mal un cuerpo vivo.
comment on function public.fundar_comunidad(text, double precision, double precision, text) is
  'Funda una comunidad (publica por defecto, decision 4) y mete a quien funda dentro, en la misma transaccion. Snapea el centro a ~1.1 km y fija centro_fundacion via el trigger. TRES cuotas bajo pg_advisory_xact_lock desde 20260916140000: A (3 vivas) y D (20 membresias) via comunidad_fundacion_estado -- el MISMO helper que estado_cuota_fundacion() -- y C (1 km entre las propias) inline. La cuota B (una cada 24 h) ya no existe.';

comment on function public.estado_cuota_fundacion() is
  '{puede_fundar, motivo, siguiente_en, fundadas_vivas, tope_vivas} con las MISMAS reglas y contadores que fundar_comunidad (cuotas A y D via comunidad_fundacion_estado). siguiente_en vale NULL siempre desde 20260916140000: ya no hay ventana de 24 horas que esperar. La CUOTA C depende del punto y no se puede anticipar aqui.';


-- ===========================================================================
-- 3. MOVER EL CENTRO: SIN LIMITE DE DISTANCIA NI DE VECES (B)
--
-- Cuerpo vivo de 20260912240000 menos la distancia contra centro_fundacion y
-- menos el ledger 'centro'. Misma firma: CREATE OR REPLACE, sin sobrecarga.
-- ===========================================================================
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
  v_nuevo     geography;
  v_celda_old TEXT;
  v_celda_new TEXT;
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

  -- Esto SI se queda aunque no haya limite de distancia: un NaN pasa cualquier
  -- comparacion sin ser falso y ST_MakePoint lo aceptaria, dejando una celda
  -- 'NaN,NaN' que ningun indice geografico vuelve a encontrar.
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  SELECT c.celda, c.fundador_id
    INTO v_celda_old, v_fundador
    FROM communities c WHERE c.id = p_community_id AND c.archived_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Esa comunidad no esta disponible.' USING ERRCODE = 'P0002';
  END IF;

  -- El limite de 1 km contra centro_fundacion (y su medicion contra el punto
  -- PEDIDO) vivia aqui y se elimina en 20260916140000. centro_fundacion sigue
  -- guardandose y saliendo por centro_de_mi_comunidad: es el punto de origen
  -- que el mapa dibuja, ya no una frontera.

  -- Mismo redondeo que fundar_comunidad, mismo CHECK de rejilla en la tabla.
  -- Este SI es innegociable: es la unica razon por la que el centro no es el
  -- domicilio de quien funda.
  v_lat   := round(p_lat::numeric, 2)::FLOAT;
  v_lng   := round(p_lng::numeric, 2)::FLOAT;
  v_nuevo := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;
  v_celda_new := round(v_lat::numeric, 2)::text || ',' || round(v_lng::numeric, 2)::text;

  -- Misma celda: no hay nada que mover. Sigue saliendo por aqui aunque ya no
  -- haya cuota que ahorrar, para no disparar el UPDATE ni el trigger por nada.
  IF v_celda_new = v_celda_old THEN
    RETURN jsonb_build_object('id', p_community_id, 'lat', v_lat, 'lng', v_lng, 'movido', FALSE);
  END IF;

  -- LA LLAVE, ANTES DE LEER LA CUOTA C. En el archivo 4 se tomaba despues, o
  -- sea fuera de la seccion critica: dos movimientos simultaneos de la misma
  -- persona leian los dos "no hay nada a menos de 1 km" y dejaban dos
  -- comunidades propias en la misma celda. Ahora la CUOTA C es la UNICA regla
  -- geografica del movimiento, asi que su carrera importa mas que antes.
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:centro:' || v_viewer::text, 0));

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

  -- Abre el unico camino que comunidad_normaliza deja pasar, local a la
  -- transaccion, y lo cierra en cuanto termina el UPDATE.
  PERFORM set_config('vicino.mover_centro', p_community_id::text, true);
  BEGIN
    UPDATE communities SET centro = v_nuevo WHERE id = p_community_id;
  EXCEPTION WHEN unique_violation THEN
    -- uq_communities_celda_nombre: en la celda destino ya hay una comunidad
    -- viva con el mismo nombre_norm. Sin limite de distancia esto deja de ser
    -- un caso raro: mover a la otra punta de la ciudad cae con mucha mas
    -- facilidad en una celda ya ocupada por ese nombre.
    RAISE EXCEPTION 'Ya hay una comunidad con ese nombre en la zona a la que la quieres mover.'
      USING ERRCODE = '23505';
  END;
  PERFORM set_config('vicino.mover_centro', '', true);

  -- El asiento en community_post_quota con tipo 'centro' vivia aqui y se
  -- elimina: no hay cuota que contar. Las filas ya escritas se quedan (el
  -- ledger es append-only) y el CHECK sigue admitiendo el tipo.

  RETURN jsonb_build_object('id', p_community_id, 'lat', v_lat, 'lng', v_lng, 'movido', TRUE);
END;
$function$;

comment on function public.editar_centro_comunidad(uuid, double precision, double precision) is
  'Mueve el centro. Desde 20260916140000 SIN limite de distancia y SIN limite de veces (caen el radio de 1 km contra centro_fundacion y la cuota centros_24h). Sigue exigiendo: sesion, cuenta no suspendida, ser el MANDO (owner en su fila viva), coordenadas validas, redondeo a la rejilla de 2 decimales (CHECK de la tabla) y la CUOTA C de fundar -- 1 km entre las propias vivas, del fundador y de quien mueve -- que ahora es la unica regla geografica y cuya llave pg_advisory_xact_lock se toma ANTES de comprobarla. El 23505 de uq_communities_celda_nombre se traduce a un mensaje legible. Abre el camino del trigger con set_config(vicino.mover_centro) local a la transaccion.';

-- ---------------------------------------------------------------------------
-- 3.1 centro_de_mi_comunidad -- MISMAS columnas, valores que significan "sin
-- limite". Cambiar el RETURNS obligaria a tocar admin-panel y
-- mover-centro-sheet en esta misma entrega, y devolver NULL seria una mentira
-- tipada (el codegen declara las columnas de un RETURNS TABLE como NO
-- nulables, y en el cliente `null <= 0` es TRUE: pintaria "sin movimientos"
-- justo despues de quitar el limite). Misma firma y mismo RETURNS: CREATE OR
-- REPLACE, sin DROP.
-- ---------------------------------------------------------------------------
create or replace function public.centro_de_mi_comunidad(p_community_id uuid)
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
         -- El maximo de int4: "quedan todos". Cualquier comparacion del cliente
         -- viejo (> 0, - 1) sigue dando el resultado correcto.
         2147483647,
         -- Media circunferencia terrestre en metros: no hay dos puntos en la
         -- Tierra mas lejos, asi que ninguna distancia real lo supera y el
         -- cliente viejo nunca marca "fuera de radio".
         20037509
    from public.communities c
   where c.id = p_community_id
     and exists (select 1 from public.community_members m
                  where m.community_id = c.id
                    and m.user_id = (select auth.uid())
                    and m.left_at is null
                    and m.role = 'owner');
$function$;

comment on function public.centro_de_mi_comunidad(uuid) is
  'Unica salida de lat/lng crudos del diseno, solo para quien tiene el MANDO. Devuelve tambien el centro de fundacion (el punto de origen que dibuja el mapa) y es_privada. Cero filas si no mandas, no un error. movimientos_restantes_24h y radio_metros SE CONSERVAN SIN SIGNIFICADO desde 20260916140000, con centinelas de "sin limite" (2147483647 y 20037509 metros): el movimiento ya no tiene tope de veces ni de distancia, y la columna se queda para no cambiar el RETURNS -- devolver NULL seria una mentira tipada, porque el codegen declara estas columnas como no nulables y en el cliente null <= 0 es TRUE.';


-- ===========================================================================
-- 4. PUBLICACIONES CON IMAGENES (C)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 4.1 La columna. text[] de RUTAS del bucket, NO de URL firmadas: una URL
-- firmada caduca y dejaria la publicacion con un enlace muerto sin forma de
-- volver a firmarlo. Mismo criterio que messages.attachments.
--
-- NOT NULL con DEFAULT array vacio, nunca nullable: un array que admite NULL
-- obliga a cada lector a distinguir "sin imagenes" de "no se sabe", y en SQL
-- coalesce(array_length(NULL,1),0) y NULL <> '{}' se comportan distinto en cada
-- sitio donde alguien se olvide.
-- ---------------------------------------------------------------------------
alter table public.community_posts
  add column if not exists imagenes text[] not null default (array[]::text[]);

comment on column public.community_posts.imagenes is
  'Rutas dentro del bucket community-media (no URL firmadas: caducan). Formato <community_id>/<author_id>/<algo>, lo exige community_post_imagenes_validas desde un CHECK y lo vuelve a exigir publicar_en_comunidad. Hasta 4 por publicacion. Se escribe SOLO por RPC: community_posts no tiene GRANT de INSERT ni de UPDATE para ningun rol. El SELECT lo cubre el grant de TABLA de la seccion 6.3 de 20260912200000, que alcanza tambien a las columnas anadidas despues.';

-- ---------------------------------------------------------------------------
-- 4.2 El validador. Va como funcion porque un CHECK no admite subconsultas y
-- hay que recorrer el array. IMMUTABLE de verdad: solo mira lo que recibe, no
-- toca ni una tabla. Mismo molde que chat_attachments_validos
-- (20260826370000), y por el mismo motivo: lo que tiene que valer tambien para
-- service_role, para un seed y para el dia que alguien conceda un INSERT "por
-- comodidad" no puede vivir solo dentro de la RPC.
--
-- La regla fuerte es la de la ruta: cada imagen tiene que colgar de
-- <community_id>/<author_id>/, y se puede exigir porque las dos son columnas de
-- la MISMA fila. Asi una publicacion no puede adjuntar el archivo de otra
-- persona, ni colar en una comunidad un archivo subido para otra. Y con la
-- comunidad delante, la policy de lectura del bucket puede exigir pertenencia.
-- ---------------------------------------------------------------------------
create or replace function public.community_post_imagenes_validas(
  p_imagenes     text[],
  p_author_id    uuid,
  p_community_id uuid
) returns boolean
language sql
immutable
set search_path = ''
as $function$
  SELECT CASE
    WHEN p_imagenes IS NULL                                   THEN true
    -- EL ARRAY VACIO SE RESUELVE ANTES QUE array_ndims, y no es cosmetico: con
    -- un array vacio array_ndims NO devuelve 1 (la implementacion sale por la
    -- guarda de ndim <= 0), asi que ponerlo despues rechazaria el DEFAULT de la
    -- columna y ninguna publicacion sin imagenes podria escribirse. El
    -- COALESCE de abajo cubre las dos lecturas posibles de esa guarda.
    WHEN COALESCE(array_length(p_imagenes, 1), 0) = 0         THEN true
    -- Un text[][] pasaria array_length(x,1) sin ser una lista de rutas.
    WHEN COALESCE(array_ndims(p_imagenes), 1) <> 1            THEN false
    -- Los dos numeros salen de comunidades_limite() y NO van escritos aqui, que
    -- era la otra opcion y es la que se descarto: con el 4 y el 512 copiados en
    -- la funcion y en la RPC, subir el tope en un solo sitio deja a la RPC
    -- aceptando lo que la tabla rechaza, y la persona recibe un error del motor
    -- en vez de un mensaje. comunidades_limite es IMMUTABLE de verdad (es una
    -- tabla de constantes), asi que el CHECK la admite.
    WHEN COALESCE(array_length(p_imagenes, 1), 0)
           > public.comunidades_limite('imagenes_por_publicacion') THEN false
    WHEN p_author_id IS NULL OR p_community_id IS NULL        THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM unnest(p_imagenes) AS r(ruta)
      WHERE r.ruta IS NULL
         OR btrim(r.ruta) = ''
         OR length(r.ruta) > public.comunidades_limite('ruta_imagen_caracteres')
         -- '..' es el unico tramo que sale de la carpeta propia sin dejar de
         -- empezar por ella.
         OR position('..' in r.ruta) > 0
         -- LA COMUNIDAD VA DELANTE, y no es cosmetico: es lo que permite
         -- que la policy de lectura del bucket exija pertenencia. Con la ruta
         -- <uid>/<archivo> de la primera version, de un objeto no se podia
         -- deducir a que comunidad pertenecia, y la unica policy posible era
         -- "cualquiera con sesion": las fotos de una comunidad PRIVADA
         -- quedaban legibles para quien conociera la ruta. Con
         -- <community_id>/<author_id>/<archivo> las dos cosas se comprueban.
         OR r.ruta NOT LIKE p_community_id::text || '/' || p_author_id::text || '/%'
         -- '<comunidad>/<uuid>/' a secas no es un archivo, es la carpeta.
         OR length(r.ruta) <= length(p_community_id::text) + length(p_author_id::text) + 2
    )
  END
$function$;

comment on function public.community_post_imagenes_validas(text[], uuid, uuid) is
  'Valida community_posts.imagenes desde un CHECK: array de una dimension, con como maximo comunidades_limite(imagenes_por_publicacion) rutas, cada una no vacia, de comunidades_limite(ruta_imagen_caracteres) caracteres como maximo, sin dos puntos seguidos y OBLIGATORIAMENTE bajo <community_id>/<author_id>/ -- las dos son columnas de la misma fila, asi que una publicacion no puede adjuntar el archivo de otra persona ni colar en una comunidad el archivo subido para otra. La comunidad va delante para que la policy de lectura del bucket pueda exigir pertenencia. Los topes se leen de comunidades_limite y no se copian aqui, para que subirlos no deje a la RPC aceptando lo que la tabla rechaza. Se usa desde un CHECK porque un CHECK no admite subconsultas y hay que recorrer el array. NO comprueba que el archivo exista en el bucket: leer storage.objects desde aqui dependeria de privilegios que esta migracion no controla. Se concede a authenticated a proposito (ver el bloque de grants).';

alter table public.community_posts drop constraint if exists community_posts_imagenes_validas;
alter table public.community_posts add constraint community_posts_imagenes_validas
  check (public.community_post_imagenes_validas(imagenes, author_id, community_id));

-- ---------------------------------------------------------------------------
-- 4.3 El cuerpo deja de ser obligatorio cuando hay imagen.
--
-- cuerpo es NOT NULL y sin default, asi que una publicacion de solo imagen
-- viaja con ''. Sin relajar este CHECK, la RPC aceptaria el caso y la tabla lo
-- rechazaria con un error del motor -- el mismo modo de fallo que
-- messages_con_contenido cierra en el chat.
--
-- Lo que queda es un SUPERCONJUNTO de lo que se admitia (el texto recortado no
-- pasa de 1500, y tiene que haber texto o imagen), asi que la revalidacion
-- contra las filas que ya existen pasa. Se mide sobre btrim, como antes, para
-- no rechazar una fila vieja con espacios de cola.
-- ---------------------------------------------------------------------------
alter table public.community_posts drop constraint if exists community_posts_cuerpo_largo;
alter table public.community_posts add constraint community_posts_cuerpo_largo
  check (
    char_length(btrim(cuerpo)) <= 1500
    and (btrim(cuerpo) <> '' or coalesce(array_length(imagenes, 1), 0) > 0)
  );

comment on column public.community_posts.cuerpo is
  'Texto de la publicacion o del comentario, recortado. Hasta 1500 caracteres. Desde 20260916140000 puede ser CADENA VACIA, y solo si la fila trae al menos una imagen: lo garantiza community_posts_cuerpo_largo, no la RPC. Una fila sin texto y sin imagen no existe.';

-- ---------------------------------------------------------------------------
-- 4.4 publicar_en_comunidad -- GANA UN PARAMETRO, o sea CAMBIA LA ARIDAD.
--
-- DROP FUNCTION de la firma vieja PRIMERO. Con CREATE OR REPLACE quedarian las
-- dos firmas vivas, y dos sobrecargas del mismo nombre son un 300 PGRST203 de
-- PostgREST para TODAS las llamadas, tambien para las que mandan los tres
-- argumentos de siempre: la pantalla del muro dejaria de publicar entera. El
-- bloque de comprobacion del final vuelve a contar las firmas dentro de la
-- transaccion.
--
-- El parametro nuevo lleva DEFAULT para que el codegen lo declare OPCIONAL
-- (p_imagenes?: string[]) y el cliente que no manda imagenes siga compilando
-- sin un solo cast (20260826390000).
--
-- Cuerpo vivo de 20260912200000 mas la validacion de las imagenes y la regla
-- nueva del texto. Todo lo demas se conserva palabra por palabra: pertenencia,
-- profundidad 1, coherencia de comunidad, puedo_ver_publicacion sobre la madre
-- y las dos cuotas contra el ledger.
-- ---------------------------------------------------------------------------
drop function if exists public.publicar_en_comunidad(uuid, text, uuid);
create function public.publicar_en_comunidad(
  p_community_id   uuid,
  p_texto          text,
  p_parent_post_id uuid   default null::uuid,
  p_imagenes       text[] default (array[]::text[])
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_texto  TEXT;
  v_imgs   TEXT[];
  v_n_img  INT;
  v_ruta   TEXT;
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

  -- COALESCE y no p_imagenes a secas: el cliente puede mandar null explicito
  -- en el jsonb de PostgREST, y entonces array_length daria NULL en vez de 0.
  v_imgs  := COALESCE(p_imagenes, ARRAY[]::TEXT[]);
  v_n_img := COALESCE(array_length(v_imgs, 1), 0);
  -- La comprobacion de dimensiones va DETRAS del conteo y solo si hay algo:
  -- sobre un array vacio array_ndims no devuelve 1 (sale por su guarda de
  -- ndim <= 0), asi que comprobarla antes rechazaria el caso normal -- toda
  -- publicacion sin imagenes -- por un valor que no significa lo que parece.
  IF v_n_img > 0 AND COALESCE(array_ndims(v_imgs), 1) <> 1 THEN
    RAISE EXCEPTION 'No se pudo leer la lista de imagenes.' USING ERRCODE = '22023';
  END IF;
  IF v_n_img > public.comunidades_limite('imagenes_por_publicacion') THEN
    RAISE EXCEPTION 'Puedes adjuntar hasta % imagenes.',
                    public.comunidades_limite('imagenes_por_publicacion')
      USING ERRCODE = '22023';
  END IF;

  -- LA RUTA TIENE QUE SER <comunidad>/<quien publica>/<archivo>. Sin esto, la ruta es un
  -- dato del cliente y una publicacion podria colgar el archivo de otra
  -- persona: quien conoce una ruta ajena la adjunta a su propia publicacion y
  -- la reparte por el muro. Un solo mensaje para todos los fallos de forma, a
  -- proposito: distinguir "ese uuid no es el tuyo" de "esa ruta esta mal"
  -- convertiria el error en un oraculo, y ninguno de los dos casos lo produce
  -- un cliente que funcione.
  FOREACH v_ruta IN ARRAY v_imgs LOOP
    IF v_ruta IS NULL
       OR btrim(v_ruta) = ''
       OR length(v_ruta) > public.comunidades_limite('ruta_imagen_caracteres')
       OR position('..' in v_ruta) > 0
       OR v_ruta NOT LIKE p_community_id::text || '/' || v_viewer::text || '/%'
       OR length(v_ruta) <= length(p_community_id::text) + length(v_viewer::text) + 2 THEN
      RAISE EXCEPTION 'Alguna imagen no se subio bien. Vuelve a intentarlo.'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- EL TEXTO ES OBLIGATORIO SALVO QUE HAYA IMAGEN. Las dos ramas van separadas
  -- para que el mensaje diga lo que hay que hacer: "pasaste de 1500" y "no
  -- mandaste nada" son dos arreglos distintos, y el CHECK de la tabla
  -- (community_posts_cuerpo_largo) exige exactamente esto mismo.
  v_texto := btrim(COALESCE(p_texto, ''));
  IF char_length(v_texto) > 1500 THEN
    RAISE EXCEPTION 'El texto no puede pasar de 1500 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_texto) < 1 AND v_n_img = 0 THEN
    RAISE EXCEPTION 'Escribe algo o adjunta una imagen.' USING ERRCODE = '22023';
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
    -- COMENTAR EXIGE EXACTAMENTE LO MISMO QUE VER (hallazgo C-1 de la base).
    -- Va PRIMERO y con el MISMO mensaje y codigo que el NOT FOUND de abajo,
    -- para que un bloqueado no pueda distinguir "me bloquearon" de "ya no
    -- existe". Y NO sustituye a las tres de abajo: puedo_ver_publicacion no
    -- mira ni la coherencia de comunidad ni la profundidad.
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
    -- PROFUNDIDAD 1. Un comentario de nivel 2 no lo leeria ninguna pantalla.
    IF v_madre.parent_post_id IS NOT NULL THEN
      RAISE EXCEPTION 'No se puede responder a un comentario.' USING ERRCODE = '22023';
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:publicar:' || v_viewer::text, 0));

  -- LA VENTANA SE CUENTA CONTRA EL LEDGER, NO CONTRA EL CONTENIDO (C-3):
  -- community_posts se borra en DURO, asi que contando contenido vivo el ciclo
  -- publicar-borrar-publicar devolvia el contador a cero en cada vuelta. Las
  -- cuotas cuentan sobre TODAS las comunidades del autor, no por comunidad.
  --
  -- Las imagenes NO anaden cuota propia: van dentro de la publicacion, y quien
  -- quiera abusar del almacenamiento choca con las mismas 10 publicaciones y 60
  -- comentarios por 24 horas. El tope de peso por archivo lo pone el bucket.
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

  INSERT INTO community_posts (community_id, author_id, parent_post_id, cuerpo, imagenes)
  VALUES (p_community_id, v_viewer, p_parent_post_id, v_texto, v_imgs)
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

comment on function public.publicar_en_comunidad(uuid, text, uuid, text[]) is
  'Unica puerta de escritura del muro: publica o comenta, desde 20260916140000 con hasta 4 imagenes. Concentra pertenencia, profundidad 1, coherencia de comunidad, la guardia de cuenta suspendida, puedo_ver_publicacion sobre la publicacion madre -- comentar exige exactamente lo mismo que ver, incluido el bloqueo BIDIRECCIONAL y la suspension del autor de la madre -- y las dos cuotas por ventana (10 publicaciones y 60 comentarios en 24 h, contra el ledger community_post_quota y no contra community_posts, que se borra en DURO). El texto sigue siendo obligatorio (1..1500) SALVO que venga al menos una imagen, y entonces se admite vacio. Cada ruta tiene que colgar de <auth.uid()>/, sin dos puntos seguidos y con 512 caracteres como maximo, con UN solo mensaje para todos los fallos de forma para no volverlo un oraculo; la misma regla la vuelve a exigir el CHECK community_posts_imagenes_validas. Gano el cuarto parametro con DROP + CREATE: un CREATE OR REPLACE habria dejado dos firmas vivas y PostgREST responde 300 PGRST203 a TODAS las llamadas cuando hay sobrecarga.';

-- ---------------------------------------------------------------------------
-- 4.5 feed_muro_comunidad -- cambia el RETURNS (imagenes), asi que DROP +
-- CREATE. Cuerpo vivo de 20260912230000 sin un solo cambio de logica: los
-- cursores, los dos anti-joins (bloqueados y suspendidos), la rama de privada
-- y el orden se copian tal cual.
--
-- imagenes entra DETRAS de cuerpo, y en el MISMO sitio en explorar: el cliente
-- declara un unico tipo PostComunidad a partir del RETURNS de esta funcion y
-- pinta las dos pestanas con el.
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
  cuerpo text, imagenes text[], created_at timestamp with time zone,
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
         k.cuerpo, k.imagenes, k.created_at,
         k.likes_count, k.comentarios_count,
         (l.user_id IS NOT NULL)
    FROM (
      SELECT p.id, p.author_id, p.cuerpo, p.imagenes, p.created_at,
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
  'Muro de una comunidad. Forma de fila IDENTICA a feed_comunidades_explorar, imagenes incluida y en la misma posicion: el cliente declara UN solo tipo a partir de este RETURNS y pinta las dos pestanas con el. Publica: se lee sin pertenecer (decision 3). Privada: un no miembro recibe 42501 explicito, no una lista vacia. Un no miembro con bloqueo con quien manda recibe P0002, igual que si no existiera. Desde 20260916140000 devuelve imagenes (rutas del bucket community-media: el servidor firma al pintar).';

-- ---------------------------------------------------------------------------
-- 4.6 feed_comunidades_explorar -- solo cambia el RETURNS (imagenes), para que
-- la fila siga siendo la MISMA que la del muro. Cuerpo vivo, fan-out incluido.
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
  cuerpo text, imagenes text[], created_at timestamp with time zone,
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
         p.cuerpo, p.imagenes, p.created_at,
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
  'Muro unificado de todas mis comunidades. Fan-out CROSS JOIN LATERAL acotado a membresias x limite (600 tuplas). Devuelve community_es_privada y, desde 20260916140000, imagenes, para que la fila siga siendo identica a la de feed_muro_comunidad: el cliente pinta las dos pestanas con un solo tipo.';

-- ---------------------------------------------------------------------------
-- 4.7 comentarios_de_publicacion -- cambia el RETURNS (imagenes): un
-- comentario tambien puede llevarlas. Cuerpo vivo de 20260912200000, con su
-- sentido ASCENDENTE y su cursor con > intactos.
-- ---------------------------------------------------------------------------
drop function if exists public.comentarios_de_publicacion(uuid, timestamp with time zone, uuid, integer);
create function public.comentarios_de_publicacion(
  p_post_id    uuid,
  cursor_time  timestamp with time zone default null::timestamp with time zone,
  cursor_id    uuid                     default null::uuid,
  result_limit integer                  default 30
)
returns table (
  id uuid, author_id uuid, author_nombre text, author_foto text,
  cuerpo text, imagenes text[], created_at timestamp with time zone,
  puedo_borrar boolean
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
  SELECT k.id, k.author_id, au.nombre, au.foto, k.cuerpo, k.imagenes, k.created_at,
         (v_mando OR k.author_id = v_viewer)
    FROM (
      -- ASCENDENTE y con > en el cursor: un hilo se lee del mas viejo al mas
      -- nuevo. Es el unico sitio del diseno donde se invierte el sentido, y por
      -- eso idx_community_posts_hilo existe aparte del indice del muro.
      SELECT hijo.id, hijo.author_id, hijo.cuerpo, hijo.imagenes, hijo.created_at
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
  'Hilo de una publicacion, ASCENDENTE y con cursor > (unico sitio del diseno donde se invierte el sentido). puedo_borrar se calcula aqui para que el cliente no reimplemente la regla de permisos en TypeScript. Desde 20260916140000 devuelve imagenes: un comentario tambien puede llevarlas.';


-- ===========================================================================
-- 5. EL BUCKET community-media (C)
--
-- Molde: 20260826262000 y 20260826370000 (fotos de chat). NO publico: un bucket
-- publico es una URL eterna que circula sola, y aqui la foto puede ser un patio
-- o una fachada de un barrio que el nombre de la comunidad ya nombra. Se sirve
-- por URL FIRMADA generada en el servidor, como chat-media y
-- verification-documents.
--
-- Tope de 5 MB por archivo y solo imagenes: es lo que ya usan avatars y
-- review-media, y el tope de peso es la unica cuota real del almacenamiento
-- (las publicaciones ya estan topadas a 10 por 24 h, y cada una a 4 imagenes).
-- ===========================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community-media', 'community-media', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Y las tres propiedades se imponen tambien si el bucket ya existia (creado a
-- mano en el Dashboard, por ejemplo, donde el default es PUBLICO). Re-aplicar
-- esta migracion las vuelve a imponer: si algun dia hay que subir el tope, se
-- sube aqui y no en el Dashboard, o la siguiente pasada lo deshace.
update storage.buckets
   set public             = false,
       file_size_limit    = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'community-media';


-- ---------------------------------------------------------------------------
-- Y el hermano para SUBIR: pertenecer no es lo mismo que poder ver. Una
-- comunidad publica se lee sin ser miembro, pero publicar (y por tanto subir)
-- exige pertenencia, igual que publicar_en_comunidad.
-- ---------------------------------------------------------------------------
create or replace function public.es_miembro_de_comunidad_por_ruta(p_ruta text)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.communities c
      JOIN public.community_members m ON m.community_id = c.id
     WHERE c.id::text = split_part(p_ruta, '/', 1)
       AND c.is_hidden = FALSE
       AND c.archived_at IS NULL
       AND m.user_id = (SELECT auth.uid())
       AND m.left_at IS NULL
  )
$function$;

comment on function public.es_miembro_de_comunidad_por_ruta(text) is
  'Responde si quien consulta pertenece a la comunidad del primer tramo de una ruta de community-media. La usa la policy de INSERT del bucket: subir exige pertenencia aunque la comunidad sea publica, igual que publicar_en_comunidad. SECURITY DEFINER por el mismo motivo que puedo_ver_media_de_comunidad.';

-- ---------------------------------------------------------------------------
-- QUIEN PUEDE VER UNA IMAGEN: el mismo que puede ver la publicacion.
--
-- Este helper existe porque una policy de storage.objects se evalua con el rol
-- de quien pide el archivo, y consultar communities o community_members desde
-- ahi pasaria por SU RLS: un miembro legitimo podria no ver la fila y quedarse
-- sin la imagen, o al reves. SECURITY DEFINER resuelve la pregunta una vez y
-- con la misma regla que la policy de community_posts: se ve lo de una
-- comunidad viva a la que pertenezco, y lo de una comunidad publica.
--
-- Recibe la RUTA, no el id, para que la policy no tenga que castear el primer
-- tramo: una ruta escrita a mano con basura devuelve false en vez de reventar
-- la consulta con un error de conversion.
-- ---------------------------------------------------------------------------
create or replace function public.puedo_ver_media_de_comunidad(p_ruta text)
returns boolean
language sql
stable security definer
set search_path = ''
as $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.communities c
     WHERE c.id::text = split_part(p_ruta, '/', 1)
       AND c.is_hidden = FALSE
       AND c.archived_at IS NULL
       AND (
         c.es_privada = FALSE
         OR EXISTS (
           SELECT 1 FROM public.community_members m
            WHERE m.community_id = c.id
              AND m.user_id = (SELECT auth.uid())
              AND m.left_at IS NULL
         )
       )
  )
$function$;

comment on function public.puedo_ver_media_de_comunidad(text) is
  'Responde si quien consulta puede ver un archivo de community-media, a partir de su ruta <community_id>/<author_id>/<archivo>. Misma regla que la policy de SELECT de community_posts: comunidad viva y publica, o comunidad viva de la que soy miembro. SECURITY DEFINER porque una policy de storage.objects se evalua con el rol de quien pide y consultar communities desde ahi pasaria por su propia RLS. Recibe la ruta y compara como texto para que una ruta con basura devuelva false en vez de un error de conversion.';

-- SUBIR: a mi carpeta, y dentro de una comunidad de la que soy miembro. El
-- primer tramo es la comunidad y el segundo el uuid de quien sube; eso es lo
-- que permite que publicar_en_comunidad y el CHECK de la tabla se fien de la
-- ruta para decidir de quien es el archivo y a donde pertenece.
drop policy if exists "community media: subir a mi carpeta" on storage.objects;
create policy "community media: subir a mi carpeta"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'community-media'
    and (storage.foldername(name))[2] = ((select auth.uid()))::text
    and public.es_miembro_de_comunidad_por_ruta(name)
  );

-- LEER: quien puede ver la publicacion. Con la ruta <community_id>/<uid>/ ya se
-- puede exigir de verdad: las imagenes de una comunidad privada solo las firma
-- quien pertenece a ella, no cualquiera que conozca la ruta. anon queda fuera
-- porque la policy de SELECT de community_posts tambien es solo para
-- authenticated: sin sesion no hay muro, asi que no hay imagen que ensenar.
drop policy if exists "community media: leer con sesion" on storage.objects;
drop policy if exists "community media: leer lo de mis comunidades" on storage.objects;
create policy "community media: leer lo de mis comunidades"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'community-media'
    and public.puedo_ver_media_de_comunidad(name)
  );

-- BORRAR: solo lo propio. Es para el caso real de una subida que deja el
-- archivo y falla al publicar: sin esto ese huerfano se queda para siempre, que
-- es como se juntaron los archivos sueltos de chat-media. No se exige
-- pertenencia: si alguien sale de la comunidad, seguir pudiendo borrar SU
-- archivo es lo correcto.
drop policy if exists "community media: borrar lo mio" on storage.objects;
create policy "community media: borrar lo mio"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'community-media'
    and (storage.foldername(name))[2] = ((select auth.uid()))::text
  );

-- NO hay policy de UPDATE, a proposito: sin ella un upsert sobre una ruta que
-- ya existe FALLA en vez de pisar el archivo de una publicacion viva. El
-- cliente tiene que subir con un nombre nuevo cada vez (y no con upsert: true),
-- que ademas es lo que hace que borrar el huerfano sea seguro.


-- ===========================================================================
-- 6. GRANTS. Firma completa en cada REVOKE y GRANT; solo authenticated.
-- ===========================================================================
revoke execute on function public.comunidades_limite(text) from public, anon, authenticated;
grant  execute on function public.comunidades_limite(text) to authenticated;

-- comunidad_fundacion_estado no se concede a nadie: la envuelven dos RPC
-- DEFINER (fundar_comunidad y estado_cuota_fundacion), que corren como su dueno
-- y conservan el EXECUTE siempre.
revoke execute on function public.comunidad_fundacion_estado(uuid) from public, anon, authenticated;

revoke execute on function public.editar_centro_comunidad(uuid, double precision, double precision) from public, anon, authenticated;
grant  execute on function public.editar_centro_comunidad(uuid, double precision, double precision) to authenticated;

revoke execute on function public.centro_de_mi_comunidad(uuid) from public, anon, authenticated;
grant  execute on function public.centro_de_mi_comunidad(uuid) to authenticated;

revoke execute on function public.publicar_en_comunidad(uuid, text, uuid, text[]) from public, anon, authenticated;
grant  execute on function public.publicar_en_comunidad(uuid, text, uuid, text[]) to authenticated;

revoke execute on function public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.feed_muro_comunidad(uuid, timestamp with time zone, uuid, integer) to authenticated;

revoke execute on function public.feed_comunidades_explorar(timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.feed_comunidades_explorar(timestamp with time zone, uuid, integer) to authenticated;

revoke execute on function public.comentarios_de_publicacion(uuid, timestamp with time zone, uuid, integer) from public, anon, authenticated;
grant  execute on function public.comentarios_de_publicacion(uuid, timestamp with time zone, uuid, integer) to authenticated;

-- community_post_imagenes_validas SI se concede a authenticated, al contrario
-- que los demas helpers internos, y el motivo es el CHECK: una expresion de
-- CHECK se evalua en la sesion de quien escribe la fila, y si el EXECUTE
-- llegara a comprobarse ahi un REVOKE convertiria cada escritura legitima en un
-- 42501 -- el mismo tropiezo que los grants por columna de profiles. Concederla
-- no abre nada: no lee ninguna tabla, es IMMUTABLE y solo devuelve true/false
-- sobre los argumentos que recibe, asi que por REST no es oraculo de nada.
-- Precedente exacto: chat_attachments_validos (20260826370000).
revoke execute on function public.puedo_ver_media_de_comunidad(text) from public, anon, authenticated;
grant  execute on function public.puedo_ver_media_de_comunidad(text) to authenticated;   -- la llama la policy del bucket: la ejecuta el rol que consulta

revoke execute on function public.es_miembro_de_comunidad_por_ruta(text) from public, anon, authenticated;
grant  execute on function public.es_miembro_de_comunidad_por_ruta(text) to authenticated;   -- idem, para la policy de INSERT

revoke execute on function public.community_post_imagenes_validas(text[], uuid, uuid) from public, anon, authenticated;
grant  execute on function public.community_post_imagenes_validas(text[], uuid, uuid) to authenticated;

-- community_posts.imagenes NO lleva GRANT por columna: esta tabla tiene GRANT
-- SELECT de TABLA (seccion 6.3 de 20260912200000) y un privilegio de tabla
-- cubre tambien las columnas anadidas despues. La unica tabla del diseno con
-- grants por columna es communities, y ahi si haria falta. Se re-declara el
-- SELECT de tabla igualmente, porque es barato y porque deja la promesa escrita
-- en la misma migracion que anade la columna.
grant select on public.community_posts to authenticated;


-- ===========================================================================
-- 7. LA COMUNIDAD "Nenis Anahuac" VUELVE, CON SU MANDO (D)
--
-- Al final del archivo para que reviva ya bajo las reglas nuevas. Idempotente y
-- sin excepciones: una reparacion de UNA fila no puede tumbar los tres bloques
-- de producto de arriba, asi que lo que no se puede hacer sale por RAISE
-- WARNING y el VERIFY pregunta por el estado final.
-- ===========================================================================
DO $restaurar$
DECLARE
  k_comunidad CONSTANT uuid := '7c7ca723-215f-45fe-b7b7-c5be8993b4bb';
  k_persona   CONSTANT uuid := '7db68a49-2aa9-443a-a99c-3b654a43ec95';
  v_existe    BOOLEAN;
  v_archivada TIMESTAMPTZ;
  v_oculta    BOOLEAN;
  v_fundador  UUID;
  v_owner     UUID;
  v_celda     TEXT;
  v_norm      TEXT;
  v_choque    UUID;
  v_otros     TEXT;
BEGIN
  SELECT c.archived_at, c.is_hidden, c.fundador_id, c.owner_id, c.celda, c.nombre_norm
    INTO v_archivada, v_oculta, v_fundador, v_owner, v_celda, v_norm
    FROM public.communities c
   WHERE c.id = k_comunidad;
  -- FOUND se guarda ANTES de cualquier otra sentencia: la siguiente lo pisa.
  v_existe := FOUND;

  -- Otra comunidad VIVA con el mismo nombre normalizado en la misma celda hace
  -- imposible des-archivar: uq_communities_celda_nombre es parcial por
  -- archived_at IS NULL, o sea que el nombre se libero al archivar y alguien
  -- pudo tomarlo.
  IF v_existe AND v_archivada IS NOT NULL THEN
    SELECT c.id INTO v_choque
      FROM public.communities c
     WHERE c.id <> k_comunidad
       AND c.archived_at IS NULL
       AND c.celda = v_celda
       AND c.nombre_norm = v_norm
     LIMIT 1;
  END IF;

  IF NOT v_existe THEN
    RAISE NOTICE 'Nenis Anahuac: la comunidad % no existe. No se restaura nada.', k_comunidad;

  ELSIF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = k_persona) THEN
    RAISE WARNING 'Nenis Anahuac (%): la persona % no tiene perfil, asi que no se le puede devolver el mando (owner_id y community_members tienen FK a profiles). No se toca nada.',
      k_comunidad, k_persona;

  ELSIF v_choque IS NOT NULL THEN
    RAISE WARNING 'Nenis Anahuac (%): no se des-archiva porque la comunidad viva % ocupa (celda %, nombre_norm %) y uq_communities_celda_nombre lo rechazaria. Hay que decidir a mano cual se queda con el nombre.',
      k_comunidad, v_choque, v_celda, v_norm;

  ELSE
    -- archived_at y owner_id NO estan congelados por comunidad_normaliza (solo
    -- lo estan nombre, nombre_norm, centro, celda, centro_fundacion y el
    -- RE-APUNTADO de fundador_id), asi que este UPDATE si pasa.
    UPDATE public.communities
       SET archived_at = NULL,
           owner_id    = k_persona
     WHERE id = k_comunidad
       AND (archived_at IS NOT NULL OR owner_id IS DISTINCT FROM k_persona);

    -- La membresia vuelve a estar viva y con el mando. El UPDATE del conflicto
    -- nombra left_at a proposito: el trigger comunidad_cuenta_miembros esta
    -- declarado AFTER ... UPDATE OF left_at, y solo suma si venia de NO NULL,
    -- asi que re-aplicar esto no infla miembros_count.
    INSERT INTO public.community_members (community_id, user_id, role)
    VALUES (k_comunidad, k_persona, 'owner')
    ON CONFLICT (user_id, community_id) DO UPDATE
      SET left_at = NULL,
          role    = 'owner';

    IF v_archivada IS NOT NULL THEN
      RAISE NOTICE 'Nenis Anahuac (%): des-archivada (estaba archivada desde %) y el mando devuelto a %.',
        k_comunidad, v_archivada, k_persona;
    ELSE
      RAISE NOTICE 'Nenis Anahuac (%): ya estaba viva; solo se confirmo el mando de % (owner_id era %).',
        k_comunidad, k_persona, v_owner;
    END IF;

    -- Lo que este bloque NO puede arreglar, dicho en voz alta en vez de
    -- intentado y dado por bueno.
    IF v_fundador IS DISTINCT FROM k_persona THEN
      RAISE WARNING 'Nenis Anahuac (%): fundador_id sigue siendo % y NO se puede cambiar desde aqui: comunidad_normaliza congela el re-apuntado de esa columna en todo UPDATE. Las cuotas de fundacion cuelgan de ella, asi que esta comunidad no cuenta contra el tope de % si no es quien la fundo.',
        k_comunidad, v_fundador, k_persona;
    END IF;

    IF v_oculta THEN
      RAISE WARNING 'Nenis Anahuac (%): is_hidden sigue en TRUE y este bloque no lo toca: ocultar es moderacion y archivar no, son estados distintos. Mientras siga oculta no se lee ni se descubre.',
        k_comunidad;
    END IF;

    SELECT string_agg(m.user_id::text, ', ' ORDER BY m.user_id) INTO v_otros
      FROM public.community_members m
     WHERE m.community_id = k_comunidad
       AND m.user_id <> k_persona
       AND m.left_at IS NULL
       AND m.role = 'owner';
    IF v_otros IS NOT NULL THEN
      RAISE WARNING 'Nenis Anahuac (%): quedan otras filas con role=owner (%). No se degradan desde aqui: quitarle el mando a alguien no es una reparacion de datos. owner_id apunta a %, asi que hay dos versiones del mando hasta que se decida.',
        k_comunidad, v_otros, k_persona;
    END IF;
  END IF;
END
$restaurar$;


-- ===========================================================================
-- 8. NINGUNA SOBRECARGA Y LOS TRIGGERS SIGUEN ENGANCHADOS. Dentro de la
--    transaccion, para que la migracion no pueda entrar en verde a medias.
--
--    Una firma de mas es un 300 PGRST203 para TODAS las llamadas de esa
--    funcion, tambien las que no usan el argumento nuevo. Es el riesgo real de
--    este archivo: publicar_en_comunidad cambia de aridad y tres RPC de lectura
--    cambian de RETURNS.
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
           'comunidades_limite','comunidad_fundacion_estado','fundar_comunidad',
           'estado_cuota_fundacion','editar_centro_comunidad','centro_de_mi_comunidad',
           'publicar_en_comunidad','feed_muro_comunidad','feed_comunidades_explorar',
           'comentarios_de_publicacion','community_post_imagenes_validas')
       GROUP BY p.proname
      HAVING count(*) <> 1
    ) x;
  IF duplicada IS NOT NULL THEN
    RAISE EXCEPTION 'hay sobrecargas donde tiene que haber una sola firma (%): PostgREST devolvera 300 PGRST203', duplicada;
  END IF;

  -- La firma vieja de tres argumentos tiene que haber desaparecido, y la nueva
  -- de cuatro tiene que existir. El conteo de arriba no lo distingue: una sola
  -- firma que fuera la VIEJA tambien contaria 1.
  IF to_regprocedure('public.publicar_en_comunidad(uuid, text, uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'la firma vieja publicar_en_comunidad(uuid, text, uuid) sigue viva';
  END IF;
  IF to_regprocedure('public.publicar_en_comunidad(uuid, text, uuid, text[])') IS NULL THEN
    RAISE EXCEPTION 'no quedo creada publicar_en_comunidad(uuid, text, uuid, text[])';
  END IF;

  -- La columna nueva y sus dos CHECK.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'community_posts'
                    AND column_name = 'imagenes') THEN
    RAISE EXCEPTION 'community_posts.imagenes no quedo creada';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_posts'::regclass
                    AND conname = 'community_posts_imagenes_validas') THEN
    RAISE EXCEPTION 'falta el CHECK community_posts_imagenes_validas';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.community_posts'::regclass
                    AND conname = 'community_posts_cuerpo_largo') THEN
    RAISE EXCEPTION 'falta el CHECK community_posts_cuerpo_largo';
  END IF;

  -- El bucket, no publico, y sus tres policies.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets b
                  WHERE b.id = 'community-media' AND b.public = false) THEN
    RAISE EXCEPTION 'el bucket community-media no existe o quedo publico';
  END IF;
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
         AND policyname LIKE 'community media:%') <> 3 THEN
    RAISE EXCEPTION 'las policies de community-media no quedaron las tres';
  END IF;

  -- Los triggers de community_posts siguen enganchados: la columna nueva y los
  -- CHECK rehechos no los tocan, pero si alguna vez alguien mete un
  -- DROP TRIGGER por descuido, esto lo dice aqui y no en produccion.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.community_posts'::regclass
                    AND p.proname = 'publicacion_nace_limpia' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'publicacion_nace_limpia perdio su trigger en community_posts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                  WHERE t.tgrelid = 'public.community_posts'::regclass
                    AND p.proname = 'notificar_comentario_de_comunidad' AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION 'notificar_comentario_de_comunidad perdio su trigger en community_posts';
  END IF;
END
$sin_sobrecargas$;

-- Sin esto PostgREST sigue sirviendo el esquema viejo: las RPC nuevas NO
-- existen para la API por mucho que existan en la base, y la de cuatro
-- argumentos responderia PGRST202.
notify pgrst, 'reload schema';

-- (fin del archivo: el COMMIT lo pone apply-migration.mjs)


-- ===========================================================================
-- VERIFY -- correr DESPUES de aplicar. No es "deberia funcionar": ejercita lo
-- que se toco. Todo lo que ejercita permisos va dentro de
--   BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--   ... ROLLBACK;
-- porque el editor SQL corre como postgres, bypasea RLS y el test MIENTE EN
-- VERDE. Sustituir <miembro>, <comunidad>, <post>, <otra-cuenta>.
-- ===========================================================================
--
-- ---- A. LAS FIRMAS VIVAS -------------------------------------------------
--   SELECT p.oid::regprocedure::text
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('publicar_en_comunidad','feed_muro_comunidad',
--                        'feed_comunidades_explorar','comentarios_de_publicacion',
--                        'centro_de_mi_comunidad','editar_centro_comunidad',
--                        'comunidad_fundacion_estado','community_post_imagenes_validas')
--    ORDER BY 1;
--   -- esperado: UNA fila por nombre, y publicar_en_comunidad con (uuid, text, uuid, text[]).
--
--   -- Y que el cuerpo vivo ya no menciona lo que se quito:
--   SELECT pg_get_functiondef('public.comunidad_fundacion_estado(uuid)'::regprocedure)
--            LIKE '%24 hours%'                AS cuota_b_viva,       -- false
--          pg_get_functiondef('public.editar_centro_comunidad(uuid, double precision, double precision)'::regprocedure)
--            LIKE '%centro_radio_metros%'     AS radio_vivo,         -- false
--          pg_get_functiondef('public.editar_centro_comunidad(uuid, double precision, double precision)'::regprocedure)
--            LIKE '%centros_24h%'             AS cuota_centro_viva,  -- false
--          pg_get_functiondef('public.editar_centro_comunidad(uuid, double precision, double precision)'::regprocedure)
--            LIKE '%vicino.mover_centro%'     AS camino_abierto,     -- true
--          pg_get_functiondef('public.editar_centro_comunidad(uuid, double precision, double precision)'::regprocedure)
--            LIKE '%separacion_propias_metros%' AS cuota_c_viva;     -- true
--
-- ---- B. PRIVILEGIOS ------------------------------------------------------
--   SELECT has_function_privilege('authenticated','public.publicar_en_comunidad(uuid, text, uuid, text[])','EXECUTE'),        -- true
--          has_function_privilege('anon','public.publicar_en_comunidad(uuid, text, uuid, text[])','EXECUTE'),                 -- false
--          has_function_privilege('authenticated','public.community_post_imagenes_validas(text[], uuid, uuid)','EXECUTE'),          -- true
--          has_function_privilege('authenticated','public.comunidad_fundacion_estado(uuid)','EXECUTE'),                       -- false
--          has_function_privilege('authenticated','public.centro_de_mi_comunidad(uuid)','EXECUTE');                           -- true
--
--   -- La columna nueva: SELECT si, escritura no. Se pregunta con
--   -- has_column_privilege y NO leyendo la ACL: un privilegio de TABLA por
--   -- encima no aparece en role_column_grants y engana a la auditoria.
--   SELECT has_column_privilege('authenticated','public.community_posts','imagenes','SELECT') AS lee,      -- true
--          has_column_privilege('authenticated','public.community_posts','imagenes','INSERT') AS inserta,  -- false
--          has_column_privilege('authenticated','public.community_posts','imagenes','UPDATE') AS actualiza,-- false
--          has_column_privilege('anon','public.community_posts','imagenes','SELECT')          AS anon_lee; -- false
--
-- ---- C. FUNDAR SIN VENTANA DE 24 HORAS -----------------------------------
--   -- C1. Con 0 comunidades vivas, fundar DOS seguidas (en celdas a mas de
--   --     1 km) tiene que entrar las dos veces. Antes la segunda daba 23514
--   --     'Solo puedes fundar una comunidad cada 24 horas.'
--   -- C2. Con el tope de 3 vivas alcanzado, estado_cuota_fundacion() ->
--   --     {puede_fundar:false, siguiente_en:null,
--   --      motivo:'Ya fundaste 3 comunidades (limite maximo alcanzado).'}
--   --     y fundar -> 23514 con ese MISMO texto. Los dos textos tienen que
--   --     coincidir: es la propiedad por la que existe el helper.
--   -- C3. siguiente_en tiene que ser null en TODAS las respuestas:
--   --     SELECT public.estado_cuota_fundacion() -> 'siguiente_en' IS NULL.
--
-- ---- D. MOVER EL CENTRO SIN LIMITES --------------------------------------
--   -- D1. Mover una comunidad de Puebla a Monterrey (>700 km) entra. Antes:
--   --     23514 'El centro solo se puede mover hasta 1 km...'.
--   -- D2. Moverla CINCO veces seguidas entra las cinco. Antes la tercera daba
--   --     23514 'Solo puedes mover el centro 2 veces en 24 horas.'
--   -- D3. El ledger NO crece: SELECT count(*) FROM community_post_quota
--   --      WHERE tipo='centro' AND created_at > now() - interval '1 hour';  -- 0
--   -- D4. La CUOTA C sigue mordiendo: con 'Uno' en (19.04,-98.21) y 'Dos' en
--   --     otra celda, editar_centro(Dos, 19.0449, -98.206) -> 23514 'Ya tienes
--   --     otra comunidad a menos de 1 km de ahi.' y la celda de Dos intacta.
--   -- D5. La rejilla sigue: editar_centro(x, 19.04789, -98.21234) guarda
--   --     celda '19.05,-98.21' y el CHECK communities_centro_en_rejilla no
--   --     salta. SELECT celda, ST_AsText(centro::geometry) FROM communities...
--   -- D6. Un no-owner -> 42501; NaN -> 22023 'Ubicacion invalida.'
--   -- D7. centro_de_mi_comunidad(<comunidad>) -> movimientos_restantes_24h =
--   --     2147483647 y radio_metros = 20037509, y las siete columnas siguen
--   --     estando (el cliente viejo tiene que seguir compilando).
--
-- ---- E. IMAGENES ---------------------------------------------------------
--   -- E1. Feliz: publicar_en_comunidad(<comunidad>, 'hola',
--   --     p_imagenes => array['<comunidad>/<mi-uuid>/a.jpg']) entra, y
--   --     feed_muro_comunidad(<comunidad>) devuelve imagenes = {<comunidad>/<mi-uuid>/a.jpg}.
--   -- E2. Solo imagen, sin texto: p_texto => '' con una imagen ENTRA, y sin
--   --     imagen -> 22023 'Escribe algo o adjunta una imagen.'
--   -- E3. Cinco imagenes -> 22023 'Puedes adjuntar hasta 4 imagenes.'
--   -- E4. Ruta de OTRA persona: array['<otra-cuenta>/a.jpg'] -> 22023 'Alguna
--   --     imagen no se subio bien. Vuelve a intentarlo.' Igual con
--   --     '<comunidad>/<mi-uuid>/../x', con '' y con una ruta de 600 caracteres.
--   -- E5. La tabla lo rechaza tambien por debajo de la RPC (esto SI se puede
--   --     correr como postgres, es un CHECK y no un permiso):
--   --       INSERT INTO community_posts (community_id, author_id, cuerpo, imagenes)
--   --       VALUES ('<comunidad>','<miembro>','x', array['<otra-cuenta>/a.jpg']);
--   --     -> 23514 community_posts_imagenes_validas.
--   -- E6. Omitir el parametro sigue funcionando (es la llamada del cliente
--   --     viejo): SELECT public.publicar_en_comunidad('<comunidad>','hola');
--   -- E7. Un comentario con imagen sale por comentarios_de_publicacion, y las
--   --     dos RPC del muro devuelven la MISMA lista de columnas:
--   --       SELECT p.proname, pg_get_function_result(p.oid) FROM pg_proc p
--   --        JOIN pg_namespace n ON n.oid = p.pronamespace
--   --        WHERE n.nspname='public' AND p.proname IN
--   --              ('feed_muro_comunidad','feed_comunidades_explorar');
--   --     -- los dos resultados tienen que diferir SOLO en nada: misma lista.
--
-- ---- F. EL BUCKET -------------------------------------------------------
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'community-media';
--   -- esperado: public = false, 5242880, {image/jpeg,image/png,image/webp}
--
--   SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='storage' AND tablename='objects'
--      AND policyname LIKE 'community media:%' ORDER BY policyname;
--   -- esperado: borrar lo mio (DELETE), leer con sesion (SELECT),
--   --           subir a mi carpeta (INSERT). NINGUNA de UPDATE.
--
--   -- Y con sesion de <miembro>, por la API de Storage (no por SQL):
--   --   upload a '<miembro>/x.jpg'      -> 200
--   --   upload a '<otra-cuenta>/x.jpg'  -> 403
--   --   createSignedUrl de lo subido    -> 200
--   --   upload del mismo path otra vez  -> 409 (no hay policy de UPDATE)
--
-- ---- G. LA COMUNIDAD RESTAURADA -----------------------------------------
--   SELECT c.id, c.nombre, c.archived_at, c.is_hidden, c.owner_id, c.fundador_id,
--          c.miembros_count, c.celda
--     FROM public.communities c
--    WHERE c.id = '7c7ca723-215f-45fe-b7b7-c5be8993b4bb';
--   -- esperado: archived_at NULL, owner_id = 7db68a49-2aa9-443a-a99c-3b654a43ec95.
--
--   SELECT m.user_id, m.role, m.joined_at, m.left_at
--     FROM public.community_members m
--    WHERE m.community_id = '7c7ca723-215f-45fe-b7b7-c5be8993b4bb'
--    ORDER BY m.joined_at;
--   -- esperado: la fila de Javier con left_at NULL y role 'owner'.
--
--   -- miembros_count tiene que cuadrar con las filas vivas (el trigger lo
--   -- mantiene incremental, y esto es lo que detecta que se desincronizo):
--   SELECT c.miembros_count,
--          (SELECT count(*) FROM public.community_members m
--            WHERE m.community_id = c.id AND m.left_at IS NULL) AS vivas
--     FROM public.communities c
--    WHERE c.id = '7c7ca723-215f-45fe-b7b7-c5be8993b4bb';
--   -- los dos numeros iguales.
--
--   -- Y LEER LOS AVISOS del bloque 7 en la salida de la migracion: si salio un
--   -- WARNING de fundador_id, de is_hidden, de otro owner o de choque de
--   -- nombre, la comunidad NO quedo como se esperaba y hay una decision
--   -- pendiente. Un NOTICE 'no existe' significa que el uuid esta mal.
--
-- ---- H. Y AL FINAL, SIEMPRE ---------------------------------------------
--   NOTIFY pgrst, 'reload schema';
--   Y fuera de la base: regenerar apps/web/types/database.types.ts DESDE
--   PRODUCCION tras aplicar. Cambian de forma publicar_en_comunidad (un
--   argumento mas), feed_muro_comunidad, feed_comunidades_explorar y
--   comentarios_de_publicacion (imagenes), y aparece
--   community_post_imagenes_validas.
-- ===========================================================================
