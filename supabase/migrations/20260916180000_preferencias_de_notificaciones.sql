-- Preferencias de notificaciones por persona.
--
-- NO APLICADA TODAVIA. A diferencia de 20260905100000, este archivo se escribe
-- ANTES de tocar la base. Aplicarla es trabajo del orquestador, y tiene que ir
-- ANTES del deploy del frontend: /configuracion/notificaciones lee la columna
-- nueva, y sin GRANT esa consulta muere entera con 42501.
--
-- ---------------------------------------------------------------------------
-- DECISION 1 -- UNA COLUMNA jsonb, NO UNA COLUMNA BOOLEANA POR TIPO
--
-- El catalogo de tipos va a crecer: hoy son cuatro (chat, ventas y citas,
-- comunidades, novedades) y la auditoria de docs/AUDITORIA-push-2026-09-16.md
-- ya nombra los que faltan. Con columnas booleanas, cada tipo nuevo cuesta una
-- migracion, y en esta tabla cuesta DOS cosas mas: su GRANT por columna y una
-- linea en cada SELECT que la incluya. Una columna que se olvide de su GRANT
-- rompe TODO SELECT que la nombre con un 42501, y esa es LA causa recurrente de
-- incidentes de este repo (modo_precio en agosto, has_seen_onboarding en julio).
--
-- Con jsonb, anadir un tipo es anadir una clave: cero migraciones, cero grants
-- nuevos, cero riesgo de 42501. Lo que se paga por ello es que la base ya no
-- conoce el catalogo, asi que la validacion de abajo es de FORMA (clave con
-- pinta de slug, valor estrictamente booleano, tope de claves) y no de
-- contenido. Es deliberado: si la funcion validara contra una lista de tipos,
-- anadir un tipo volveria a exigir una migracion y no habriamos ganado nada.
--
-- Quien la lee de verdad es la Edge Function send-push, con service_role, o sea
-- saltandose los grants. Para ella esta public.acepta_notificacion() al final,
-- que encierra en un solo sitio la semantica de "ausente = si".
--
-- ---------------------------------------------------------------------------
-- DECISION 2 -- LA ESCRITURA VA POR RPC, NO POR UN GRANT DE UPDATE
--
-- Se podria haber dado GRANT UPDATE (notification_preferences) y dejar que el
-- cliente escriba la columna. Se descarta por tres razones concretas:
--
--   1. Es jsonb. Un UPDATE directo acepta CUALQUIER jsonb valido, incluido un
--      arreglo, un escalar o megabytes de basura. El CHECK de abajo solo puede
--      exigir que sea un objeto: contar sus claves exige una subconsulta y en un
--      CHECK las subconsultas no se permiten. El tope de claves solo puede
--      vivir donde vive la escritura.
--   2. Un UPDATE de cliente manda el objeto COMPLETO. Dos interruptores
--      tocados casi a la vez se pisan: el segundo envio lleva la foto vieja del
--      primero y lo deshace. La funcion concatena con ||, asi que cada llamada
--      solo toca SU clave.
--   3. profiles solo concede UPDATE sobre (foto, fcm_token) y todo lo demas se
--      escribe por RPC (20260826240000). Abrir una tercera columna por comodidad
--      es empezar a deshacer ese cierre.
--
-- authenticated recibe SELECT y nada mas.
--
-- ---------------------------------------------------------------------------
-- DECISION 3 -- "AUSENTE" SIGNIFICA "SI"
--
-- El default es {} y la ausencia de una clave se lee como encendido. Asi los
-- perfiles que ya existen no necesitan relleno, y un tipo nuevo nace encendido
-- para todo el mundo sin backfill. Apagar es siempre explicito.
--
-- El precio es que esto falla ABIERTO: si la preferencia no se puede leer, se
-- notifica. Es el lado correcto del error -- un sistema de preferencias que se
-- traga un mensaje de quien quiere comprarte hace mas dano que uno que manda
-- un aviso de mas.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. La columna.
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_notification_preferences_check;

-- Solo la FORMA, y solo lo que un CHECK puede comprobar: aqui no caben
-- subconsultas, asi que jsonb_object_keys queda fuera y el tope de claves se
-- vigila en la funcion de escritura, que es el unico camino del cliente.
alter table public.profiles
  add constraint profiles_notification_preferences_check
  check (jsonb_typeof(notification_preferences) = 'object');

comment on column public.profiles.notification_preferences is
  'Interruptores de notificacion por tipo. Clave ausente = ENCENDIDO, y por eso el default {} no necesita relleno. La escribe guardar_preferencias_notificaciones (authenticated NO tiene UPDATE). La lee acepta_notificacion.';

-- ---------------------------------------------------------------------------
-- 2. El GRANT, que es lo que hace que esto no rompa la app.
--
-- profiles concede privilegios COLUMNA POR COLUMNA y una columna nueva nace
-- SIN NINGUNO. Postgres rechaza la consulta ENTERA cuando una sola de las
-- columnas pedidas no tiene privilegio, asi que sin esta linea cualquier
-- SELECT que nombre notification_preferences devuelve 42501 y la pantalla se
-- queda en el estado de error, no en el de "sin preferencias".
--
-- SELECT si, UPDATE no: ver DECISION 2. INSERT tampoco hace falta -- la columna
-- tiene DEFAULT y ningun INSERT del cliente la nombra (el alta de profiles la
-- hace handle_new_user, SECURITY DEFINER propiedad de postgres).
-- ---------------------------------------------------------------------------

grant select (notification_preferences) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. La escritura.
--
-- Recibe SOLO las claves que cambian, nunca el objeto completo: es lo que evita
-- que dos interruptores tocados casi a la vez se pisen (DECISION 2, punto 2).
--
-- Funcion nueva: no hay firma anterior que retirar. Si algun dia cambia su
-- aridad hay que hacer DROP FUNCTION de la firma vieja primero -- un
-- CREATE OR REPLACE con un parametro mas crea una SOBRECARGA y PostgREST
-- responde 300 sin poder elegir.
-- ---------------------------------------------------------------------------

create or replace function public.guardar_preferencias_notificaciones(
  p_preferencias jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to ''
as $function$
DECLARE
  v_uid   uuid := auth.uid();
  v_clave text;
  v_final jsonb;
  v_n     int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  -- jsonb acepta arreglos y escalares. Sin esto, un [1,2] enviado a mano
  -- llegaria al || de abajo y reemplazaria el objeto entero por un arreglo,
  -- dejando la columna en una forma que ninguna lectura entiende.
  IF p_preferencias IS NULL OR jsonb_typeof(p_preferencias) <> 'object' THEN
    RAISE EXCEPTION 'No se pudo guardar esa preferencia.' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_n FROM jsonb_object_keys(p_preferencias);
  IF v_n < 1 OR v_n > 8 THEN
    RAISE EXCEPTION 'No se pudo guardar esa preferencia.' USING ERRCODE = '22023';
  END IF;

  FOR v_clave IN SELECT k FROM jsonb_object_keys(p_preferencias) AS k LOOP
    -- Con pinta de slug y nada mas. La base NO conoce el catalogo a proposito
    -- (DECISION 1): validar contra una lista devolveria el coste de una
    -- migracion a cada tipo nuevo.
    IF v_clave !~ '^[a-z][a-z0-9_]{1,39}$' THEN
      RAISE EXCEPTION 'Tipo de notificacion invalido: %', v_clave USING ERRCODE = '22023';
    END IF;

    -- Booleano de jsonb, no la cadena "false". Sin esto se guarda {"chat":"no"}
    -- y despues ->> 'chat' = 'true' lo lee como apagado por casualidad, no por
    -- diseno: el mismo dato valdria o no segun quien lo hubiera escrito.
    IF jsonb_typeof(p_preferencias -> v_clave) <> 'boolean' THEN
      RAISE EXCEPTION 'La preferencia % tiene que ser si o no.', v_clave USING ERRCODE = '22023';
    END IF;
  END LOOP;

  UPDATE public.profiles
     SET notification_preferences = notification_preferences || p_preferencias
   WHERE id = v_uid
  RETURNING notification_preferences INTO v_final;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  -- El tope se comprueba DESPUES del UPDATE y no antes: leer, contar y despues
  -- escribir deja una ventana entre las dos operaciones. El RAISE aborta la
  -- llamada y con ella el UPDATE, asi que la fila nunca queda por encima del
  -- tope. Sin este tope, un cliente con sesion puede inventar claves hasta
  -- hinchar su propia fila.
  SELECT count(*) INTO v_n FROM jsonb_object_keys(v_final);
  IF v_n > 40 THEN
    RAISE EXCEPTION 'Demasiados tipos de notificacion.' USING ERRCODE = '22023';
  END IF;

  RETURN v_final;
END;
$function$;

comment on function public.guardar_preferencias_notificaciones(jsonb) is
  'Unico camino del cliente para escribir profiles.notification_preferences. Recibe solo las claves que cambian y las concatena con ||, asi dos interruptores tocados a la vez no se pisan. Valida forma (objeto, 1-8 claves, clave slug, valor booleano) y no contenido: el catalogo de tipos vive en la app.';

-- La firma va COMPLETA en cada REVOKE y en el GRANT. Con una firma equivocada
-- la funcion queda inaccesible con un 42501 que parece de RLS.
revoke execute on function public.guardar_preferencias_notificaciones(jsonb)
  from public, anon, authenticated;
grant  execute on function public.guardar_preferencias_notificaciones(jsonb)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 4. La lectura del push.
--
-- La semantica de "clave ausente = encendido" vive AQUI y en un solo sitio. Si
-- cada llamador la reimplementa, basta con que uno escriba = false en vez de
-- <> true para que los perfiles sin preferencias dejen de recibir push y nadie
-- se entere: el modo de fallo es silencio, que es justo lo que se estuvo
-- diagnosticando con el push de hoy.
--
-- Solo service_role: la consume la Edge Function send-push. Ningun usuario
-- tiene por que poder preguntar que ha configurado otro.
-- ---------------------------------------------------------------------------

create or replace function public.acepta_notificacion(
  p_user_id uuid,
  p_tipo    text
)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  -- Perfil sin la clave, o perfil que no existe: las dos cosas dan true. Falla
  -- abierto a proposito (DECISION 3).
  SELECT COALESCE(
    (SELECT (p.notification_preferences ->> p_tipo) = 'true'
       FROM public.profiles p
      WHERE p.id = p_user_id),
    true);
$function$;

comment on function public.acepta_notificacion(uuid, text) is
  'Si esa persona quiere ese tipo de notificacion. Clave ausente o perfil ausente = true (falla abierto). Solo service_role: la usa send-push. Pendiente de conectar -- ver docs/AUDITORIA-push-2026-09-16.md.';

revoke execute on function public.acepta_notificacion(uuid, text)
  from public, anon, authenticated;
grant  execute on function public.acepta_notificacion(uuid, text)
  to service_role;

-- PostgREST cachea el esquema. Sin esto, la columna y las funciones existen en
-- la base pero la API sigue respondiendo 404 hasta el siguiente reinicio.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- VERIFICACION (correr despues de aplicar, en el mismo editor)
--
--   -- 1. La columna existe, es objeto y su default no es NULL.
--   SELECT column_name, data_type, is_nullable, column_default
--     FROM information_schema.columns
--    WHERE table_schema='public' AND table_name='profiles'
--      AND column_name='notification_preferences';
--   -- esperado: jsonb | NO | '{}'::jsonb
--
--   -- 2. EL GRANT. Esto es lo que evita el 42501 que rompe la app entera.
--   SELECT has_column_privilege('authenticated','public.profiles',
--            'notification_preferences','SELECT') AS lee,
--          has_column_privilege('authenticated','public.profiles',
--            'notification_preferences','UPDATE') AS escribe;
--   -- esperado: lee = true, escribe = false
--
--   -- 3. Y que el SELECT de la app sobrevive de verdad, bajo el rol real.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid-real>","role":"authenticated"}';
--     SELECT notification_preferences FROM public.profiles WHERE id = '<uuid-real>';
--   ROLLBACK;
--   -- esperado: una fila. Un 42501 aqui significa que el grant no se aplico.
--
--   -- 4. Las dos funciones y sus privilegios.
--   SELECT has_function_privilege('authenticated',
--            'public.guardar_preferencias_notificaciones(jsonb)','EXECUTE') AS guarda,
--          has_function_privilege('anon',
--            'public.guardar_preferencias_notificaciones(jsonb)','EXECUTE') AS guarda_anon,
--          has_function_privilege('authenticated',
--            'public.acepta_notificacion(uuid,text)','EXECUTE') AS lee_ajena;
--   -- esperado: true, false, false
--
--   -- 5. Que NO hay sobrecarga (una sobrecarga da 300 en PostgREST).
--   SELECT p.proname, count(*)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('guardar_preferencias_notificaciones','acepta_notificacion')
--    GROUP BY 1;
--   -- esperado: una fila por funcion, count = 1 en las dos
--
--   -- 6. El merge por clave: la segunda llamada NO borra la primera.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid-real>","role":"authenticated"}';
--     SELECT public.guardar_preferencias_notificaciones('{"chat":false}'::jsonb);
--     SELECT public.guardar_preferencias_notificaciones('{"comunidades":false}'::jsonb);
--     -- esperado en la segunda: {"chat": false, "comunidades": false}
--   ROLLBACK;
--
--   -- 7. Lo que tiene que ser rechazado (los cuatro con 22023).
--   SELECT public.guardar_preferencias_notificaciones('[1,2]'::jsonb);
--   SELECT public.guardar_preferencias_notificaciones('{"chat":"no"}'::jsonb);
--   SELECT public.guardar_preferencias_notificaciones('{"Chat":false}'::jsonb);
--   SELECT public.guardar_preferencias_notificaciones('{}'::jsonb);
--
--   -- 8. La semantica de ausente = si.
--   SELECT public.acepta_notificacion('<uuid-real>','nunca_visto') AS ausente,
--          public.acepta_notificacion(gen_random_uuid(),'chat')    AS sin_perfil;
--   -- esperado: true en las dos
-- ---------------------------------------------------------------------------
