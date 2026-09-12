-- Comunidades: los enganches de moderacion.
--
-- TERCERA y ultima migracion de la entrega de comunidades. El orden de
-- aplicacion NO es negociable:
--
--   1. 20260905200000_comunidades_base.sql          (tablas, indices, policies,
--                                                    grants, triggers y RPC)
--   2. 20260905210000_comunidades_report_target.sql (ALTER TYPE)  <-- COMMIT
--   3. 20260905220000_comunidades_moderacion.sql    (este archivo)
--
-- Todo lo que hay aqui escribe el literal 'community_post', y un valor de enum
-- recien anadido NO se puede usar dentro de la transaccion que lo anade. Si
-- este archivo corriera antes del commit del 210000, la primera funcion que
-- mencionara ese literal fallaria con un error que parece de sintaxis y no lo
-- es. Por eso el archivo arranca con un preflight que se niega a seguir si
-- alguno de los dos anteriores no esta puesto: fallar aqui con un mensaje que
-- dice que falta aplicar es infinitamente mas barato que fallar dentro de una
-- funcion seis semanas despues.
--
-- ---------------------------------------------------------------------------
-- POR QUE ESTE ARCHIVO EXISTE, Y POR QUE VA EN LA MISMA ENTREGA
--
-- La leccion cara del proyecto se llama purchase_requests. Esa tabla lleva
-- desde el 10 de julio siendo contenido generado por usuario, con texto libre e
-- imagen, y no tiene ni columna is_hidden, ni valor en report_target_type, ni
-- una sola rama en las funciones de moderacion, ni aparece en ningun panel. No
-- fue una decision: fue lo que no entro en la migracion que creo la tabla, y lo
-- que no entra ahi no entra nunca. Un muro de barrio sin enganches de
-- moderacion seria exactamente el mismo agujero, con la diferencia de que ahora
-- ya sabemos como se abre.
--
-- Lo que se engancha, y a que sirve cada cosa:
--
--   auto_hide_on_threshold        3 reportes activos ocultan la publicacion.
--                                 Los terminos publicos ya lo prometen
--                                 (terminos/page.tsx:116, "3 o mas reportes ->
--                                 oculto"), asi que no cubrir comunidades seria
--                                 incumplir algo ya publicado.
--
--   handle_child_safety_report    Seguridad infantil: ocultado al PRIMER
--                                 reporte y encolado en critical_reports. Es la
--                                 seccion 15 de los terminos y una obligacion
--                                 de tienda, no una preferencia.
--
--   moderate_set_content_hidden   El boton "ocultar" del panel de admin. Sin su
--                                 rama, resolveReport(hideTarget: true)
--                                 devuelve "Tipo de contenido no soportado" y
--                                 el moderador CREE que oculto algo que sigue
--                                 publico. Es el peor sintoma de toda la
--                                 entrega y el mas facil de olvidar.
--
--   publicacion_cierra_sus_reportes  Al borrar contenido, sus reportes dejan de
--                                 quedarse 'pending' para siempre apuntando a
--                                 nada. reports.target_id no tiene clave
--                                 foranea (el polimorfismo es a proposito), asi
--                                 que hoy el panel los pinta como "no
--                                 encontrado" y nadie los cierra jamas.
--
--   delete_user_data              Enumera las tablas A MANO y devuelve un
--                                 deleted_summary que es evidencia de
--                                 cumplimiento: lo que no aparece ahi, no se
--                                 cuenta. Ademas hay un paso que la cascada no
--                                 puede hacer sola, que es el traspaso de mando
--                                 de las comunidades que esa persona manda.
--                                 Las tablas de comunidades son CINCO (las
--                                 mismas cinco que crea 20260905200000), pero
--                                 el bloque deja SEIS entradas en
--                                 deleted_summary, porque communities aporta
--                                 dos -- communities_traspasadas y
--                                 communities_archivadas: no se borra, se
--                                 traspasa o se archiva. Las otras cuatro son
--                                 community_memberships, community_posts,
--                                 community_post_likes y community_post_quota,
--                                 esta ultima aunque su cascada ya la borre,
--                                 porque el log tiene que contarla.
--
-- ---------------------------------------------------------------------------
-- LAS CUATRO FUNCIONES SE COPIAN DEL CUERPO VIVO, NO SE REESCRIBEN A OJO
--
-- Las cuatro se recuperaron con pg_get_functiondef contra produccion
-- (oxxdkwywprkfghhbnoto) el 5-sep-2026, y lo que hay abajo es ese cuerpo mas la
-- rama nueva. Ni una linea menos. Un CREATE OR REPLACE escrito de memoria BORRA
-- EN SILENCIO cualquier rama que produccion tuviera y el archivo no: no falla,
-- no avisa, simplemente deja de hacer algo que hacia. Las tres ramas que hoy
-- viven en handle_child_safety_report y la exclusion deliberada de 'user' son
-- justo el tipo de cosa que nadie recuerda haber puesto.
--
-- Y una de las cuatro NO TENIA ARCHIVO EN EL REPO:
-- moderate_set_content_hidden se aplico fuera de banda y solo existia en
-- apps/web/types/database.types.ts y en las llamadas del panel; un grep de
-- p_target_type sobre las 149 migraciones devolvia cero. Aqui queda versionada
-- por primera vez, con su cuerpo real, para que deje de ser un objeto fantasma.
--
-- OJO CON SU VOCABULARIO: moderate_set_content_hidden NO habla el idioma del
-- enum de reportes. Su p_target_type es TEXTO y sus valores vivos son
-- 'profile', 'product', 'review' y 'message' -- fijate en que 'listing' del
-- enum es 'product' aqui. El panel traduce entre los dos idiomas con el mapa
-- MODERATION_TARGET (apps/web/app/admin/moderation/actions.ts:23-28). El valor
-- nuevo se llama 'community_post' en los dos idiomas porque la tabla se llama
-- asi, y aun asi hay que anadirlo a ESE MAPA: sin la clave, el panel ni llega a
-- llamar a la funcion.
--
-- ---------------------------------------------------------------------------
-- LO QUE ESTA MIGRACION NO PUEDE ARREGLAR
--
-- Un reporte de tipo 'community_post' es INVISIBLE hasta que se toquen cinco
-- sitios de TypeScript, y NINGUNO lo detecta el build:
--   1. packages/shared/src/validators/moderation.ts:5      REPORT_TARGET_TYPES
--   2. packages/shared/src/validators/moderation.ts:45-78  REPORT_REASONS_BY_TARGET
--      (report-modal.tsx:40 indexa ese objeto SIN guardia: si falta la clave es
--       un undefined.map en la cara del usuario)
--   3. packages/shared/src/validators/moderation.ts:80-85  REPORT_TARGET_LABELS
--   4. apps/web/app/admin/moderation/actions.ts:23-28      MODERATION_TARGET
--   5. apps/web/app/api/reports/route.ts:159-221           checkSelfReport
--      (sin su rama cae en el return "ok" final y se acepta cualquier uuid
--       inventado: basura en reports MAS un correo por Resend por cada uno)
--
-- Y admin/moderation/page.tsx:16-25 cuenta con un objeto de CUATRO CLAVES
-- FIJAS: un target_type nuevo no se cuenta en ningun lado y el reporte se
-- vuelve invisible sin que nada falle. La verificacion de esos cinco es manual
-- y obligatoria; el VERIFY de abajo no la cubre.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 0. PREFLIGHT
--
-- Este archivo no puede correr solo. Se comprueba lo que necesita ANTES de
-- tocar nada, porque el fallo natural (una funcion que se rompe al usarse) es
-- tardio, confuso y lejos de aqui.
--
-- El valor del enum se comprueba leyendo pg_enum como TEXTO, nunca casteando
-- el literal: castearlo seria "usarlo", que es justo lo que no se puede hacer
-- si el ALTER TYPE todavia no ha commiteado.
-- ---------------------------------------------------------------------------

DO $preflight$
BEGIN
  IF to_regclass('public.community_posts') IS NULL THEN
    RAISE EXCEPTION
      'falta aplicar 20260905200000_comunidades_base.sql: no existe public.community_posts'
      USING ERRCODE = '42P01';
  END IF;

  -- El ledger de cuotas se comprueba aparte y no por simetria: delete_user_data
  -- lo nombra, y plpgsql NO resuelve los nombres de tabla al definir la
  -- funcion, solo la primera vez que la sentencia se ejecuta. Sin esta linea,
  -- una base con la version vieja del archivo base aceptaria la migracion
  -- entera en verde y el fallo saldria meses despues, dentro de un borrado de
  -- cuenta real, con la transaccion a medias.
  IF to_regclass('public.community_post_quota') IS NULL THEN
    RAISE EXCEPTION
      'falta aplicar la version actual de 20260905200000_comunidades_base.sql: no existe public.community_post_quota'
      USING ERRCODE = '42P01';
  END IF;

  -- Y la funcion de traspaso, por el mismo motivo que la tabla de arriba:
  -- delete_user_data ya no lleva su propia copia del traspaso, la LLAMA, y
  -- plpgsql tampoco resuelve nombres de funcion al definir. Sin esta linea, una
  -- base con la version vieja del archivo base aceptaria la migracion en verde
  -- y el fallo saldria dentro de un borrado de cuenta real.
  IF to_regprocedure('public.comunidad_traspasa_mando(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION
      'falta aplicar la version actual de 20260905200000_comunidades_base.sql: no existe public.comunidad_traspasa_mando(uuid, uuid)'
      USING ERRCODE = '42883';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_enum e      ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typname = 'report_target_type'
       AND e.enumlabel = 'community_post'
  ) THEN
    RAISE EXCEPTION
      'falta aplicar (y COMMITEAR) 20260905210000_comunidades_report_target.sql: report_target_type no tiene community_post'
      USING ERRCODE = '42704';
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------------
-- 1. auto_hide_on_threshold -- el umbral de 3 reportes activos
--
-- Cuerpo VIVO de produccion, identico, mas una sola rama nueva.
--
-- POR QUE community_post SI ENTRA EN EL UMBRAL, cuando 'user' y 'message' no.
-- Una publicacion de muro es contenido publicado, como un anuncio, no una
-- persona: ocultarla no silencia a nadie y quien la escribio puede volver a
-- publicar. Ocultar un perfil, en cambio, borra un negocio del mapa por una
-- denuncia anonima, y esa asimetria es una decision que este proyecto ya habia
-- tomado (20260827120000). Ademas los terminos publicos ya prometen el umbral
-- de tres, asi que dejar comunidades fuera seria incumplir algo publicado.
--
-- La rama no distingue entre publicacion de muro y comentario, y eso no es
-- pereza: es exactamente lo que se compro al meter los dos en la misma tabla
-- con parent_post_id. Un comentario y una publicacion tienen la misma forma y
-- la misma politica de moderacion.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.auto_hide_on_threshold()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cnt INT;
BEGIN
  IF NEW.reason = 'child_safety'::report_reason THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO cnt
    FROM public.reports
   WHERE target_type = NEW.target_type
     AND target_id = NEW.target_id
     AND status IN ('pending', 'reviewed');

  IF cnt >= 3 THEN
    IF NEW.target_type = 'listing'::report_target_type THEN
      UPDATE public.products_services
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;
    ELSIF NEW.target_type = 'review'::report_target_type THEN
      UPDATE public.reviews
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;

    -- RAMA NUEVA. Publicacion de muro o comentario, sin distinguir.
    ELSIF NEW.target_type = 'community_post'::report_target_type THEN
      UPDATE public.community_posts
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;
    END IF;

    -- 'user' y 'message' siguen fuera a proposito: accion manual del admin,
    -- porque ahi el riesgo de abuso pesa mas que el beneficio.
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.auto_hide_on_threshold() IS
  'Trigger AFTER INSERT sobre reports (trg_reports_auto_hide). Oculta el objetivo al acumular 3 reportes activos. Cubre listing, review y community_post; user y message quedan fuera a proposito. child_safety sale por la puerta de handle_child_safety_report.';

-- El bloque de comprobacion de esta funcion, ampliado con la rama nueva. Si
-- algun dia alguien la reemplaza y se come la rama de comunidades, esto revienta
-- y la transaccion entera se deshace. Sin la linea nueva, esa perdida pasaria en
-- verde, que es peor que no tener comprobacion.
DO $comprobacion_umbral$
DECLARE
  cuerpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO cuerpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'auto_hide_on_threshold';

  IF cuerpo IS NULL THEN
    RAISE EXCEPTION 'auto_hide_on_threshold desaparecio';
  END IF;

  IF position('public.community_posts' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'auto_hide_on_threshold no conoce community_posts';
  END IF;

  IF position('public.products_services' in cuerpo) = 0
     OR position('public.reviews' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'se perdio alguna rama de contenido que debia conservarse';
  END IF;

  -- La exclusion de perfiles es una decision, no un olvido: que siga siendolo.
  IF position('public.profiles' in cuerpo) > 0 THEN
    RAISE EXCEPTION 'auto_hide_on_threshold empezo a ocultar perfiles enteros';
  END IF;

  -- Sin trigger enganchado, nada de lo anterior corre nunca.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.reports'::regclass
       AND NOT tgisinternal
       AND tgfoid = 'public.auto_hide_on_threshold'::regproc
  ) THEN
    RAISE EXCEPTION 'el trigger del umbral ya no esta enganchado a reports';
  END IF;
END
$comprobacion_umbral$;

-- ---------------------------------------------------------------------------
-- 2. handle_child_safety_report -- seguridad infantil, al primer reporte
--
-- Cuerpo VIVO de produccion (el que dejo 20260827120000), identico, mas una
-- sola rama nueva. Lo que NO se toca, y conviene decirlo en voz alta porque
-- invita a "limpiarlo":
--
--   * El limite de 3 reportes de child_safety por cuenta y 24 h. Existe porque
--     ocultar al primer reporte es un boton de apagado por anuncio disponible
--     para cualquiera con una cuenta nueva.
--   * Que el encolado en critical_reports pase SIEMPRE, se haya ocultado o no.
--     Es lo unico que hace aceptable el limite de arriba: la denuncia nunca se
--     pierde, solo deja de ser automatica.
--   * Que 'user' NO se auto-oculte. Se quito a proposito en agosto.
--
-- La rama nueva es de contenido, como las otras tres, asi que entra sin
-- discusion: ocultar una publicacion de muro afecta a una publicacion.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.handle_child_safety_report()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  reportes_recientes INT;
  auto_ocultar BOOLEAN;
BEGIN
  IF NEW.reason <> 'child_safety'::report_reason THEN
    RETURN NEW;
  END IF;

  -- Cuantos child_safety ha levantado esta misma cuenta en las ultimas 24h.
  -- Se excluye la fila actual porque el trigger es AFTER INSERT y ya esta.
  SELECT count(*) INTO reportes_recientes
    FROM public.reports
   WHERE reporter_id = NEW.reporter_id
     AND reason = 'child_safety'::report_reason
     AND created_at > now() - interval '24 hours'
     AND id <> NEW.id;

  auto_ocultar := (reportes_recientes < 3);

  IF auto_ocultar THEN
    IF NEW.target_type = 'listing'::report_target_type THEN
      UPDATE public.products_services
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;

    ELSIF NEW.target_type = 'review'::report_target_type THEN
      UPDATE public.reviews
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;

    ELSIF NEW.target_type = 'message'::report_target_type THEN
      UPDATE public.messages
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;

    -- RAMA NUEVA. Cubre publicacion de muro y comentario, que viven en la
    -- misma tabla.
    ELSIF NEW.target_type = 'community_post'::report_target_type THEN
      UPDATE public.community_posts
         SET is_hidden = TRUE
       WHERE id = NEW.target_id;

    -- target_type 'user' ya NO se auto-oculta. Ver la cabecera: ocultar un
    -- perfil entero por una denuncia anonima es desproporcionado, y la funcion
    -- hermana auto_hide_on_threshold() ya habia excluido este caso.
    END IF;
  END IF;

  -- Esto pasa SIEMPRE, se haya ocultado o no. Es lo que garantiza que ninguna
  -- denuncia se pierda por el limite de arriba.
  INSERT INTO public.critical_reports (report_id)
  VALUES (NEW.id)
  ON CONFLICT (report_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.handle_child_safety_report() IS
  'Trigger AFTER INSERT sobre reports (trg_reports_child_safety). Oculta el contenido al PRIMER reporte de child_safety y siempre encola en critical_reports. Cubre listing, review, message y community_post; NUNCA perfiles. Tope de 3 auto-ocultados por cuenta y 24 h.';

-- El DO $comprobacion$ que ya existia en 20260827120000, AMPLIADO con la linea
-- de community_posts. Sin ampliarlo, el dia que alguien reemplace la funcion y
-- se coma la rama de comunidades la comprobacion pasaria en verde.
DO $comprobacion$
DECLARE
  cuerpo text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO cuerpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'handle_child_safety_report';

  IF cuerpo IS NULL THEN
    RAISE EXCEPTION 'handle_child_safety_report desaparecio';
  END IF;

  IF position('reportes_recientes < 3' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'el limite por cuenta no quedo en la funcion';
  END IF;

  IF position('SET is_hidden = TRUE' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'se perdio el auto-ocultado de contenido, que debe seguir existiendo';
  END IF;

  -- La rama de profiles tenia que desaparecer, y solo esa.
  IF position('public.profiles' in cuerpo) > 0 THEN
    RAISE EXCEPTION 'la funcion sigue ocultando perfiles enteros';
  END IF;

  -- Y tampoco puede colarse el ocultado de comunidades ENTERAS: apagar el muro
  -- de 500 personas por denuncias seria un arma, no moderacion. Solo se oculta
  -- la publicacion.
  IF position('public.communities' in cuerpo) > 0 THEN
    RAISE EXCEPTION 'la funcion empezo a ocultar comunidades enteras';
  END IF;

  IF position('public.products_services' in cuerpo) = 0
     OR position('public.reviews' in cuerpo) = 0
     OR position('public.messages' in cuerpo) = 0
     OR position('public.community_posts' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'se perdio alguna rama de contenido que debia conservarse';
  END IF;

  IF position('critical_reports' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'se perdio el encolado a revision humana, que es lo que hace aceptable el limite';
  END IF;

  -- El trigger tiene que seguir enganchado, o nada de lo anterior corre.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.reports'::regclass
       AND NOT tgisinternal
       AND tgfoid = 'public.handle_child_safety_report'::regproc
  ) THEN
    RAISE EXCEPTION 'el trigger de child_safety ya no esta enganchado a reports';
  END IF;
END
$comprobacion$;

-- ---------------------------------------------------------------------------
-- 3. moderate_set_content_hidden -- VERSIONADA POR PRIMERA VEZ
--
-- Esta funcion existia solo en la base. Nunca tuvo archivo: se aplico fuera de
-- banda y el repo solo la conocia por el tipo generado y por las cuatro
-- llamadas del panel. Lo de abajo es su cuerpo REAL, recuperado con
-- pg_get_functiondef, con dos unicos cambios: saltos de linea para que se pueda
-- leer, y la rama nueva. Nada mas, y en particular:
--
--   * Se conserva SET search_path TO 'public', 'pg_temp' tal como esta viva.
--     Las otras funciones de esta entrega llevan solo 'public'; esta no se
--     alinea por estetica, porque cambiar el search_path de un SECURITY DEFINER
--     vivo es cambiar como resuelve TODOS sus nombres.
--   * Se conserva la asimetria de permisos: suspender un PERFIL exige admin;
--     ocultar contenido lo puede hacer tambien un moderador. Es la misma
--     asimetria que auto_hide_on_threshold, escrita desde el otro lado.
--   * Se conserva el IF NOT FOUND final, que es lo que impide que el panel
--     pinte exito cuando el uuid no existia.
--
-- LA RAMA NUEVA VA EN EL BLOQUE DE CONTENIDO, no en el de perfil: ocultar una
-- publicacion de muro es moderacion ordinaria y un moderador tiene que poder
-- hacerla sin esperar a un admin.
--
-- Y OJO CON EL VOCABULARIO. p_target_type es TEXTO y su idioma no es el del
-- enum de reportes: aqui 'listing' se llama 'product' y 'user' se llama
-- 'profile'. El valor nuevo se llama igual en los dos idiomas, 'community_post',
-- porque es el nombre de la tabla; aun asi hay que anadir la clave al mapa
-- MODERATION_TARGET del panel o esta rama no se llama jamas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.moderate_set_content_hidden(
  p_target_type text,
  p_target_id uuid,
  p_hidden boolean
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_is_admin boolean;
  v_is_mod boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden: requiere sesion';
  END IF;

  v_is_admin := public.has_role(v_actor, 'admin'::app_role);
  v_is_mod   := public.has_role(v_actor, 'moderator'::app_role);

  IF p_target_type = 'profile' THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'forbidden: suspender usuarios requiere admin';
    END IF;
    UPDATE public.profiles SET is_hidden = p_hidden WHERE id = p_target_id;
  ELSE
    IF NOT (v_is_admin OR v_is_mod) THEN
      RAISE EXCEPTION 'forbidden: requiere admin o moderator';
    END IF;

    IF p_target_type = 'product' THEN
      UPDATE public.products_services SET is_hidden = p_hidden WHERE id = p_target_id;
    ELSIF p_target_type = 'review' THEN
      UPDATE public.reviews SET is_hidden = p_hidden WHERE id = p_target_id;
    ELSIF p_target_type = 'message' THEN
      UPDATE public.messages SET is_hidden = p_hidden WHERE id = p_target_id;

    -- RAMA NUEVA. Sirve para ocultar Y para restaurar (p_hidden = false), que
    -- es lo que necesita el boton "Restaurar" del panel, analogo a
    -- unhideListing.
    ELSIF p_target_type = 'community_post' THEN
      UPDATE public.community_posts SET is_hidden = p_hidden WHERE id = p_target_id;

    ELSE
      RAISE EXCEPTION 'target_type invalido: %', p_target_type;
    END IF;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'target no encontrado: % %', p_target_type, p_target_id;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.moderate_set_content_hidden(text, uuid, boolean) IS
  'Boton ocultar/restaurar del panel de admin. p_target_type es TEXTO y su vocabulario NO es el del enum reports: profile | product | review | message | community_post (el panel traduce con MODERATION_TARGET). Suspender un perfil exige admin; el resto admite tambien moderator. Versionada por primera vez en 20260905220000; antes solo existia en la base.';

-- Los grants se declaran, no se heredan de memoria. CREATE OR REPLACE conserva
-- el ACL previo, asi que esto es sobre todo constancia: la funcion la llama el
-- panel con la SESION del usuario (apps/web/app/admin/moderation/actions.ts),
-- no con service_role, por eso authenticated tiene que conservar el EXECUTE y
-- el control de quien es admin vive DENTRO de la funcion.
--
-- Y el REVOKE va FROM PUBLIC ademas de anon: en Postgres una funcion nace con
-- EXECUTE para PUBLIC, y revocarselo solo a los roles nominales deja el agujero
-- abierto Y la comprobacion en verde. Es la leccion de 20260827100000.
REVOKE EXECUTE ON FUNCTION public.moderate_set_content_hidden(text, uuid, boolean)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moderate_set_content_hidden(text, uuid, boolean)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. publicacion_cierra_sus_reportes -- que no queden reportes huerfanos
--
-- reports.target_id NO tiene clave foranea, y el polimorfismo es a proposito:
-- una sola tabla de denuncias para cinco tipos de contenido. El precio es que
-- al borrar el contenido, sus reportes se quedan 'pending' PARA SIEMPRE
-- apuntando a nada, y el panel los pinta como "no encontrado". Es un hueco vivo
-- del proyecto y aqui no se hereda.
--
-- VA COMO TRIGGER Y NO DENTRO DE LA RPC DE BORRADO, y esa es la decision que
-- importa: el borrado en CASCADA no pasa por la RPC. Cuando delete_user_data
-- borra las publicaciones de una cuenta, o cuando se borra una publicacion de
-- muro y la clave foranea compuesta se lleva sus comentarios, es justo el
-- momento en que mas huerfanos se generan. Colgado de la tabla, cubre las tres
-- vias.
--
-- SE RESUELVEN, NO SE BORRAN. El reporte es evidencia de cumplimiento: lo que
-- se limpia es la cola de trabajo, no el rastro.
--
-- Se traga sus propios errores con RAISE WARNING, molde de
-- notify_appointment_created: que falle el cierre de una cola administrativa no
-- puede deshacer el borrado que la persona ya vio hecho.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.publicacion_cierra_sus_reportes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.reports
     SET status           = 'resolved'::report_status,
         reviewed_at      = now(),
         resolution_notes = COALESCE(resolution_notes || ' | ', '') ||
                            '[auto] el contenido fue eliminado'
   WHERE target_type = 'community_post'::report_target_type
     AND target_id   = OLD.id
     AND status IN ('pending'::report_status, 'reviewed'::report_status);
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'no se pudieron cerrar los reportes de la publicacion %: %', OLD.id, SQLERRM;
  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION public.publicacion_cierra_sus_reportes() IS
  'Trigger AFTER DELETE sobre community_posts. Cierra como resolved los reportes que apuntaban a la fila borrada. Va como trigger y no dentro de la RPC porque el borrado en cascada (delete_user_data, comentarios de una publicacion borrada) no pasa por la RPC.';

DROP TRIGGER IF EXISTS publicacion_cierra_sus_reportes ON public.community_posts;
CREATE TRIGGER publicacion_cierra_sus_reportes
  AFTER DELETE ON public.community_posts
  FOR EACH ROW EXECUTE FUNCTION public.publicacion_cierra_sus_reportes();

-- Las funciones de trigger no se conceden a nadie: las ejecuta el motor. El
-- REVOKE va FROM PUBLIC ademas de los dos roles nominales, por lo mismo de
-- siempre.
REVOKE EXECUTE ON FUNCTION public.publicacion_cierra_sus_reportes()
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. delete_user_data -- el borrado de cuenta aprende comunidades
--
-- Las claves foraneas YA estan puestas para que nada bloquee el borrado:
-- community_posts.author_id, community_members.user_id,
-- community_post_likes.user_id y community_post_quota.user_id van ON DELETE
-- CASCADE, y las dos columnas de mando de communities --owner_id y
-- fundador_id-- van ON DELETE SET NULL a proposito, porque borrar una cuenta no
-- puede evaporar el barrio de 500 personas.
--
-- Pero la funcion ENUMERA Y CUENTA A MANO, y su deleted_summary se archiva en
-- account_deletion_log como evidencia de cumplimiento: lo que no aparece ahi,
-- no se cuenta. Dejarlo a la cascada significaria un log que dice menos de lo
-- que paso.
--
-- Y hay un paso que la cascada NO PUEDE HACER SOLA: el traspaso de mando. Sin
-- el, cada comunidad que esa persona MANDABA (no necesariamente las que fundo:
-- desde el hallazgo C-4 son dos hechos distintos) se queda viva y sin
-- moderacion local para siempre, dependiendo solo del admin global. El relevo
-- es DETERMINISTA --el miembro vivo mas antiguo por (joined_at, user_id)-- para
-- que no dependa del orden fisico de las filas. TRES salidas, una sola regla, y
-- desde la segunda vuelta de la revision tambien UNA SOLA IMPLEMENTACION: esta
-- funcion, alternar_membresia_comunidad y el trigger comunidad_releva_mando
-- llaman las tres a public.comunidad_traspasa_mando. Cuando eran tres copias
-- divergieron --una tomaba la llave de mando y las otras dos no, una comprobaba
-- left_at y las otras dos no-- y el mando acababa dependiendo de por donde se
-- fue la persona.
--
-- ES UN CREATE OR REPLACE CON LA MISMA ARIDAD, y eso no es un detalle: anadir
-- un argumento crearia una SOBRECARGA y PostgREST devolveria 300 PGRST203 a
-- todas las llamadas que no mandaran el nuevo. Ya paso una vez y la home cargo
-- con 200 y el feed vacio.
--
-- El resto del cuerpo es el VIVO de 20260827100000, sin tocar una linea. En
-- particular se conserva la guardia de dos mitades: la primera impide que un
-- usuario CON sesion borre a otro; la segunda es la que faltaba, porque
-- auth.uid() tambien es NULL para anon y la condicion de arriba, por si sola,
-- dejaba pasar derecho a los DELETE a cualquiera con la anon key.
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
  -- Bloque COMUNIDADES: el traspaso de mando se delega en
  -- public.comunidad_traspasa_mando una comunidad a la vez, asi que los dos
  -- contadores se llevan a mano en vez de salir de un GET DIAGNOSTICS.
  v_comunidad  UUID;
  v_tocadas    INTEGER := 0;
  v_archivadas INTEGER := 0;
BEGIN
  -- Only allow if caller is service_role or the user themselves.
  --
  -- La linea de abajo se conserva tal cual estaba: un usuario CON sesion no
  -- puede borrar a otro. Lo que faltaba era la otra mitad.
  IF auth.uid() IS NOT NULL AND auth.uid() != target_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot delete another user''s data'
      USING ERRCODE = '42501';
  END IF;

  -- LA MITAD QUE FALTABA. auth.uid() es NULL para service_role, si, pero
  -- tambien lo es para anon. La condicion de arriba, por si sola, es falsa
  -- cuando auth.uid() es NULL, asi que un anonimo no entraba nunca al RAISE
  -- y seguia derecho a los DELETE. Comprobado ejerciendolo: con SET LOCAL
  -- ROLE anon la funcion borro el perfil entero (dentro de un ROLLBACK).
  --
  -- Ahora el permiso sin sesion se comprueba, no se deduce de un NULL.
  -- session_user es 'authenticator' cuando la llamada entra por PostgREST y
  -- 'postgres' cuando entra por SQL directo, asi que el mantenimiento manual
  -- sigue siendo posible sin dejar abierta la puerta de la API.
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

  -- Reviews about user's products: delete (the product is being removed,
  -- so the review loses its subject). reviews.product_id is NO ACTION,
  -- so this MUST happen before deleting products_services.
  DELETE FROM public.reviews
    WHERE product_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_on_user_products', cnt);

  -- Remaining reviews where user was reviewed: anonymize (keeps community
  -- reputation context). reviewed_id becomes NULL via ON DELETE SET NULL,
  -- but we set it explicitly + stamp anonymized_at for clarity.
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
  -- COMUNIDADES (bloque nuevo, 20260905220000).
  --
  -- El orden importa: primero el MANDO, luego el CONTENIDO. Si se borraran
  -- antes las membresias, el traspaso ya no encontraria ni al saliente ni a
  -- los candidatos, y la comunidad se quedaria sin dueno en silencio.
  -- ---------------------------------------------------------------------

  -- 1. Traspaso de mando ANTES de borrar nada -- y archivado de la que se
  --    quede sin nadie, que es la otra cara del mismo acto. Los dos los hace
  --    public.comunidad_traspasa_mando (20260905200000, seccion 4.2b), que es
  --    la UNICA implementacion del traspaso que existe en el producto: la
  --    llaman tambien la rama SALIR de alternar_membresia_comunidad y el
  --    trigger comunidad_releva_mando.
  --
  --    Aqui vivia una COPIA, y la copia divergio, que es lo que le pasa a las
  --    copias: promovia sin exigir left_at IS NULL y sin tomar la llave
  --    comunidad:mando:<id>, asi que una salida concurrente podia dejar
  --    coronado a alguien que ya se habia ido y la comunidad viva, con sus
  --    miembros y con CERO filas role='owner' vivas. Dentro de la funcion
  --    canonica viven la llave, el FOR UPDATE que impide que el relevo
  --    desaparezca entre elegirlo y coronarlo, y la regla de que archivar es
  --    consecuencia de "no queda nadie" y nunca de "el UPDATE no encontro su
  --    fila".
  --
  --    El ORDER BY del cursor no es cosmetico: cada vuelta toma una llave, y
  --    tomarlas siempre en orden de community_id es lo que impide que dos
  --    bajas simultaneas que compartan dos comunidades se crucen.
  --
  --    Los contadores se llevan a mano porque deleted_summary es evidencia de
  --    cumplimiento y tiene que decir la verdad sobre ESTA baja: se cuentan
  --    las comunidades TOCADAS (todas las que esta persona mandaba, con relevo
  --    y sin el) y, de esas, las que acabaron archivadas -- que son exactamente
  --    aquellas en las que la funcion dejo owner_id en NULL, porque archiva si
  --    y solo si no queda ni un miembro vivo.
  --
  --    Ya no hace falta acotar el archivado con un EXISTS de pertenencia viva
  --    (hallazgo I-15): el cursor SOLO enumera comunidades donde esta persona
  --    es owner VIVO, asi que una membresia muerta no puede arrastrar a la
  --    comunidad de otra gente. El filtro es el driver, no un cinturon.
  --
  --    Y si communities.owner_id apunta a esta persona SIN que exista su fila
  --    de membresia viva con role='owner' -- deriva que ningun camino de hoy
  --    produce -- este bloque no la toca a proposito: la accion referencial
  --    ON DELETE SET NULL la vacia cuando cae el perfil, igual que a
  --    fundador_id.
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

  -- 2. Reacciones dadas por esta persona. El trigger de likes_count las
  --    descuenta una a una de las publicaciones ajenas.
  DELETE FROM public.community_post_likes WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_post_likes', cnt);

  -- 3. Publicaciones Y, por la clave foranea compuesta ON DELETE CASCADE, los
  --    comentarios que colgaban de ellas, incluidos los ajenos. El contador
  --    cuenta solo las filas de primer nivel, que es lo que borra esta
  --    sentencia; las hijas se van por la cascada y no aparecen aqui.
  --
  --    Cada fila borrada dispara publicacion_cierra_sus_reportes, que es
  --    exactamente el momento en que mas reportes huerfanos se generarian.
  DELETE FROM public.community_posts WHERE author_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_posts', cnt);

  -- 4. Membresias. Van al final del bloque: son las que sostienen el cursor
  --    del paso 1.
  --
  --    OJO CON EL TRIGGER: desde el hallazgo I-9 hay un comunidad_releva_mando
  --    AFTER DELETE sobre esta tabla, asi que este DELETE dispara el relevo una
  --    vez por fila. No es una segunda regla compitiendo con el paso 1: es la
  --    MISMA funcion, comunidad_traspasa_mando, con el mismo criterio, asi que
  --    vuelve a elegir a quien el paso 1 ya promovio y su archivado es un
  --    COALESCE(archived_at, now()) que respeta la fecha que ya hubiera. Dentro
  --    de esta funcion el trigger no cambia nada: es idempotente, y esa es la
  --    condicion para que pueda existir. Su valor esta FUERA -- en el borrado
  --    desde el Dashboard y en cualquier DELETE sobre auth.users que no pase
  --    por aqui, que es precisamente donde no hay ningun paso 1.
  DELETE FROM public.community_members WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_memberships', cnt);

  -- 5. Ledger de cuotas de escritura del muro (community_post_quota, hallazgo
  --    C-3).
  --
  --    DECISION, TOMADA A CONCIENCIA Y NO POR INERCIA: la FK es
  --    user_id -> profiles(id) ON DELETE CASCADE, asi que el DELETE del perfil
  --    de mas abajo se lleva estas filas SOLO. Tecnicamente este DELETE es
  --    redundante. Va igual, y por el motivo por el que esta funcion enumera a
  --    mano TODO lo que la cascada ya haria: deleted_summary se archiva en
  --    account_deletion_log como evidencia de cumplimiento, y lo que no aparece
  --    ahi no se cuenta ni se puede demostrar despues.
  --
  --    Y aqui el dato no es un detalle tecnico: el ledger es una fila con marca
  --    de tiempo por CADA vez que esa persona publico, comento o reacciono. Es
  --    un diario de actividad personal --a que horas escribe, cuantos dias
  --    seguidos-- que sobrevive al contenido, porque justamente existe para
  --    sobrevivirle. Un log de borrado que dice "publicaciones: 12" y calla que
  --    tambien habia 900 asientos de actividad dice menos de lo que paso.
  --    Contarlo cuesta una linea; no contarlo se descubre en una auditoria.
  --
  --    Va DESPUES de publicaciones y membresias y ANTES del perfil: el orden no
  --    importa para la correccion (nada depende de estas filas), solo para que
  --    el bloque se lea en el mismo orden en que se explica.
  DELETE FROM public.community_post_quota WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('community_post_quota', cnt);

  -- ---------------------------------------------------------------------
  -- LO QUE NO SE HACE AQUI, Y POR QUE. communities.fundador_id (hallazgo C-4)
  -- es ON DELETE SET NULL, asi que NO lleva sentencia propia: la accion
  -- referencial la pone a NULL cuando cae el perfil, igual que owner_id. No se
  -- traspasa a nadie a proposito --quien fundo es un hecho historico y el
  -- relevo hereda el MANDO (owner_id), no la autoria-- y no se cuenta aparte
  -- porque las comunidades tocadas ya salen en communities_traspasadas y
  -- communities_archivadas.
  --
  -- Y COMPROBARLO EN EL VERIFY, que para esto esta el C9: que fundador_id
  -- QUEDA en NULL de verdad. La accion referencial SET NULL se ejecuta como un
  -- UPDATE ordinario sobre communities, y ese UPDATE dispara los triggers
  -- BEFORE UPDATE de la tabla. Un congelador de fundador_id a secas devolveria
  -- el valor viejo, la fila se quedaria apuntando a un perfil que ya no existe
  -- y el motor NO lo rechazaria -- la comprobacion referencial se salta cuando
  -- la clave no cambia: referencia colgante silenciosa, y un borrado de cuenta
  -- que deja el identificador dentro. Por eso comunidad_normaliza congela solo
  -- el RE-APUNTADO y deja pasar el vaciado (20260905200000, seccion 4.1). Si
  -- C9 devuelve un uuid en vez de NULL, el arreglo va alli y no aqui: en esta
  -- funcion no hay ninguna sentencia que pueda esquivarlo.
  -- ---------------------------------------------------------------------

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
  'Borrado de cuenta. Enumera y cuenta a mano cada tabla porque deleted_summary se archiva en account_deletion_log como evidencia: lo que no aparece aqui, no se cuenta. Incluye el traspaso determinista del mando de las comunidades que esa cuenta manda, que la cascada no puede hacer sola y que delega en comunidad_traspasa_mando, la unica implementacion del traspaso que existe. Solo service_role (o SQL directo como postgres).';

-- El ACL no se hereda de memoria: se vuelve a declarar. Es la misma linea de
-- 20260827100000, y esta aqui porque un CREATE OR REPLACE es justo el momento
-- en el que alguien podria dar por hecho algo que no comprobo.
REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_user_data(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Comprobar que los otros dos enganches sirvieron de algo
--
-- Los dos bloques de arriba cubren las funciones de trigger de reports. Estas
-- dos no tenian comprobacion de nadie, y son precisamente las de peor sintoma:
-- si moderate_set_content_hidden se queda sin su rama, el moderador cree que
-- oculto algo que sigue publico; si delete_user_data se queda sin la suya, una
-- baja de cuenta deja comunidades sin mando y un log de cumplimiento que miente
-- por omision. Ninguna de las dos cosas da error en ningun sitio.
-- ---------------------------------------------------------------------------

DO $comprobacion_enganches$
DECLARE
  cuerpo    text;
  duplicada text;
BEGIN
  -- LO PRIMERO, Y ES LO QUE MAS PODIA SALIR MAL AQUI. moderate_set_content_hidden
  -- no tenia archivo: su firma se leyo de la base, no de un repo. Si esa lectura
  -- hubiera fallado en un solo tipo, este archivo no habria reemplazado nada --
  -- habria creado una SEGUNDA funcion con el mismo nombre, y PostgREST responde
  -- 300 PGRST203 a toda llamada ambigua. O sea: el panel de moderacion entero
  -- caido, por una migracion que "se aplico bien". Se afirma aqui, antes que
  -- nada, y con el mismo criterio para las otras dos.
  SELECT string_agg(x.proname || ' x' || x.n, ', ' ORDER BY x.proname) INTO duplicada
    FROM (
      SELECT p.proname, count(*) AS n
        FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
       WHERE n2.nspname = 'public'
         AND p.proname IN ('moderate_set_content_hidden',
                           'delete_user_data',
                           'publicacion_cierra_sus_reportes',
                           'auto_hide_on_threshold',
                           'handle_child_safety_report')
       GROUP BY p.proname
      HAVING count(*) <> 1
    ) x;

  IF duplicada IS NOT NULL THEN
    RAISE EXCEPTION
      'hay sobrecargas donde tiene que haber una sola firma (%): PostgREST devolvera 300 PGRST203',
      duplicada;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO cuerpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'moderate_set_content_hidden';

  IF cuerpo IS NULL THEN
    RAISE EXCEPTION 'moderate_set_content_hidden desaparecio';
  END IF;
  IF position('community_post' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'el panel de moderacion no sabe ocultar publicaciones de comunidad';
  END IF;
  -- Las cuatro ramas vivas siguen ahi. Esta funcion no tenia archivo: si algo
  -- se pierde aqui, no hay con que compararlo.
  IF position('public.profiles' in cuerpo) = 0
     OR position('public.products_services' in cuerpo) = 0
     OR position('public.reviews' in cuerpo) = 0
     OR position('public.messages' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'se perdio alguna rama viva de moderate_set_content_hidden';
  END IF;
  -- Suspender un perfil sigue siendo cosa de admin, no de moderador.
  IF position('requiere admin' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'moderate_set_content_hidden perdio la guardia de admin para perfiles';
  END IF;
  IF NOT has_function_privilege(
       'authenticated',
       'public.moderate_set_content_hidden(text, uuid, boolean)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdio el EXECUTE: el panel de moderacion dejaria de funcionar';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.moderate_set_content_hidden(text, uuid, boolean)'::regprocedure,
       'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede llamar al boton de ocultar' USING ERRCODE = '42501';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO cuerpo
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_user_data';

  IF cuerpo IS NULL THEN
    RAISE EXCEPTION 'delete_user_data desaparecio';
  END IF;
  IF position('public.community_posts' in cuerpo) = 0
     OR position('public.community_members' in cuerpo) = 0
     OR position('public.community_post_likes' in cuerpo) = 0
     OR position('public.community_post_quota' in cuerpo) = 0
     OR position('public.communities' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'el borrado de cuenta no conoce alguna tabla de comunidades';
  END IF;
  IF position('communities_traspasadas' in cuerpo) = 0
     OR position('comunidad_traspasa_mando' in cuerpo) = 0 THEN
    RAISE EXCEPTION 'el borrado de cuenta perdio el traspaso de mando, o volvio a escribir su propia copia en vez de llamar a comunidad_traspasa_mando';
  END IF;
  -- Su aridad no se toco (la sobrecarga ya la descarto la comprobacion de
  -- arriba), y eso es lo que mantiene viva la Edge Function delete-account.
  IF NOT has_function_privilege('service_role',
                                'public.delete_user_data(uuid)'::regprocedure,
                                'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdio el EXECUTE de delete_user_data: la Edge Function delete-account dejaria de borrar cuentas';
  END IF;
  IF has_function_privilege('anon',
                            'public.delete_user_data(uuid)'::regprocedure,
                            'EXECUTE')
     OR has_function_privilege('authenticated',
                               'public.delete_user_data(uuid)'::regprocedure,
                               'EXECUTE') THEN
    RAISE EXCEPTION 'delete_user_data volvio a quedar al alcance de la API publica'
      USING ERRCODE = '42501';
  END IF;

  -- Y el trigger que cierra los reportes huerfanos tiene que estar colgado de
  -- la tabla, no solo definido.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.community_posts'::regclass
       AND NOT tgisinternal
       AND tgfoid = 'public.publicacion_cierra_sus_reportes'::regproc
  ) THEN
    RAISE EXCEPTION 'el cierre de reportes huerfanos no esta enganchado a community_posts';
  END IF;
END
$comprobacion_enganches$;

-- Sin esto PostgREST sigue sirviendo el esquema viejo y ni la firma nueva ni
-- los grants existen para la API.
notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- VERIFY (correr DESPUES de aplicar, en el mismo editor SQL).
--
-- Con set_config a secas el editor corre como postgres, BYPASEA RLS y el test
-- MIENTE EN VERDE: en la sesion 5a un ataque que debia dar UPDATE 0 dio
-- UPDATE 3 y paso como correcto. Por eso todo lo que ejercita permisos va
-- dentro de BEGIN; SET LOCAL ROLE ...; SET LOCAL request.jwt.claims = ...;
-- ROLLBACK;
--
-- Sustituir <post> por el uuid de una publicacion de comunidad real, <miembro>
-- por un authenticated sin rol global, <admin> por uno con rol admin,
-- <reportero-1..3> por tres cuentas distintas (reports lleva un unico
-- (reporter_id, target_type, target_id): tres reportes exigen tres cuentas) y
-- <fundador> por el uuid de quien fundo una comunidad con al menos otro
-- miembro.
--
--
-- ---- A. LAS CUATRO FUNCIONES CONOCEN COMUNIDADES ------------------------
--
--   SELECT p.proname,
--          position('community_post' in pg_get_functiondef(p.oid)) > 0 AS conoce
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('auto_hide_on_threshold','handle_child_safety_report',
--                        'moderate_set_content_hidden','delete_user_data');
--   -- esperado: true en las CUATRO. delete_user_data la conoce por el nombre
--   -- de las tablas (community_posts), que contiene la misma subcadena.
--
--   -- Y que NO se haya colado el ocultado de comunidades ENTERAS por denuncia.
--   SELECT position('public.communities' in pg_get_functiondef(p.oid))
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'handle_child_safety_report';
--   -- esperado: 0
--
--   -- Ninguna sobrecarga. Una firma de mas es un 300 PGRST203 para todas las
--   -- llamadas que no manden el argumento nuevo.
--   SELECT p.proname, count(*)
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('moderate_set_content_hidden','delete_user_data',
--                        'publicacion_cierra_sus_reportes')
--    GROUP BY 1 HAVING count(*) <> 1;
--   -- esperado: 0 filas
--
--
-- ---- B. PRIVILEGIOS -----------------------------------------------------
-- Con has_function_privilege, NUNCA leyendo la ACL: la ACL puede quedar limpia
-- y el privilegio seguir llegando por PUBLIC.
--
--   SELECT f,
--          has_function_privilege('anon',          f::regprocedure, 'EXECUTE') AS anon,
--          has_function_privilege('authenticated', f::regprocedure, 'EXECUTE') AS auth
--     FROM unnest(ARRAY['public.moderate_set_content_hidden(text, uuid, boolean)',
--                       'public.delete_user_data(uuid)',
--                       'public.publicacion_cierra_sus_reportes()']) f;
--   -- esperado:
--   --   moderate_set_content_hidden   anon=false  auth=true   (lo llama el panel
--   --                                                          con la sesion)
--   --   delete_user_data              anon=false  auth=false  (solo service_role)
--   --   publicacion_cierra_sus_reportes anon=false auth=false (lo ejecuta el motor)
--
--   SELECT has_function_privilege('service_role','public.delete_user_data(uuid)','EXECUTE');
--   -- esperado: true. Si es false, la Edge Function delete-account deja de
--   -- borrar cuentas y nadie se entera hasta que alguien se da de baja.
--
--
-- ---- C. LOS ATAQUES, EJERCITADOS DE VERDAD ------------------------------
--
--   -- C1. Un authenticated raso NO puede ocultar nada, ni por RPC ni a mano.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<miembro>","role":"authenticated"}';
--     SELECT public.moderate_set_content_hidden('community_post','<post>', true);
--     -- esperado: excepcion 'forbidden: requiere admin o moderator'
--     UPDATE public.community_posts SET is_hidden = TRUE WHERE id = '<post>';
--     -- esperado: 42501 (authenticated no tiene UPDATE sobre la tabla)
--   ROLLBACK;
--
--   -- C2. Moderar la comunidad NO es moderar el producto. Ser owner o
--   --     moderator DENTRO de una comunidad da poder local (borrar por la RPC
--   --     eliminar_publicacion_comunidad), nunca la llave del panel global.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<fundador>","role":"authenticated"}';
--     SELECT public.moderate_set_content_hidden('community_post','<post>', true);
--     -- esperado: excepcion 'forbidden: requiere admin o moderator'
--   ROLLBACK;
--
--   -- C3. Un admin SI oculta, y tambien restaura.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<admin>","role":"authenticated"}';
--     SELECT public.moderate_set_content_hidden('community_post','<post>', true);
--     SELECT is_hidden FROM public.community_posts WHERE id = '<post>';  -- true
--     SELECT public.moderate_set_content_hidden('community_post','<post>', false);
--     SELECT is_hidden FROM public.community_posts WHERE id = '<post>';  -- false
--     -- Y un uuid inventado no puede pintar exito:
--     SELECT public.moderate_set_content_hidden('community_post',
--              '00000000-0000-0000-0000-000000000000', true);
--     -- esperado: excepcion 'target no encontrado'
--   ROLLBACK;
--
--   -- C4. Sin sesion no se modera.
--   BEGIN;
--     SET LOCAL ROLE anon;
--     SELECT public.moderate_set_content_hidden('community_post','<post>', true);
--     -- esperado: 42501, permission denied for function
--   ROLLBACK;
--
--   -- C5. El umbral de 3 muerde. Tres cuentas DISTINTAS, porque el unico
--   --     (reporter_id, target_type, target_id) impide repetir con la misma.
--   BEGIN;
--     INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
--     VALUES ('<reportero-1>','community_post','<post>','spam'),
--            ('<reportero-2>','community_post','<post>','spam'),
--            ('<reportero-3>','community_post','<post>','spam');
--     SELECT is_hidden FROM public.community_posts WHERE id = '<post>';
--     -- esperado: true. Con dos reportes tenia que seguir en false: si sale
--     -- true con dos, el conteo esta contando de mas.
--   ROLLBACK;
--
--   -- C6. Seguridad infantil: al PRIMER reporte, y siempre a la cola humana.
--   BEGIN;
--     INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
--     VALUES ('<reportero-1>','community_post','<post>','child_safety');
--     SELECT is_hidden FROM public.community_posts WHERE id = '<post>';  -- true
--     SELECT count(*) FROM public.critical_reports cr
--       JOIN public.reports r ON r.id = cr.report_id
--      WHERE r.target_id = '<post>';
--     -- esperado: 1. Y ninguna fila de profiles tocada: la denuncia oculta la
--     -- publicacion, nunca a la persona.
--     SELECT count(*) FROM public.profiles WHERE is_hidden = TRUE;
--     -- esperado: el mismo numero que antes de este BEGIN
--   ROLLBACK;
--
--   -- C7. Borrar el contenido cierra sus reportes en vez de dejarlos
--   --     'pending' apuntando a nada.
--   BEGIN;
--     INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
--     VALUES ('<reportero-1>','community_post','<post>','spam');
--     DELETE FROM public.community_posts WHERE id = '<post>';
--     SELECT status, resolution_notes FROM public.reports
--      WHERE target_type = 'community_post' AND target_id = '<post>';
--     -- esperado: resolved, con '[auto] el contenido fue eliminado'
--     SELECT count(*) FROM public.reports
--      WHERE target_type = 'community_post' AND target_id = '<post>'
--        AND status IN ('pending','reviewed');
--     -- esperado: 0
--   ROLLBACK;
--
--   -- C8. Y tambien por la CASCADA, que es donde mas huerfanos se generan:
--   --     borrar la publicacion madre se lleva sus comentarios, y cada
--   --     comentario cierra los suyos.
--   BEGIN;
--     INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
--     VALUES ('<reportero-1>','community_post','<comentario-de-ese-post>','spam');
--     DELETE FROM public.community_posts WHERE id = '<post>';
--     SELECT status FROM public.reports
--      WHERE target_id = '<comentario-de-ese-post>';
--     -- esperado: resolved
--   ROLLBACK;
--
--   -- C9. El borrado de cuenta traspasa el mando en vez de dejar la comunidad
--   --     sin dueno. Corre como postgres (session_user = 'postgres'), que es
--   --     la via de mantenimiento manual que la guardia permite.
--   BEGIN;
--     SELECT c.id, c.owner_id, c.miembros_count
--       FROM public.communities c WHERE c.owner_id = '<fundador>';
--     -- anotar los ids ANTES
--     SELECT public.delete_user_data('<fundador>');
--     -- esperado en el summary: las SEIS claves de comunidades con sus
--     -- numeros -- communities_traspasadas (>= 1), communities_archivadas,
--     -- community_memberships, community_posts, community_post_likes y
--     -- community_post_quota. Son SEIS claves para CINCO tablas: communities
--     -- aporta dos. Si alguna NO aparece, el log de cumplimiento esta
--     -- mintiendo por omision.
--     SELECT c.id, c.owner_id, c.fundador_id, c.archived_at,
--            (SELECT m.role FROM public.community_members m
--              WHERE m.community_id = c.id AND m.user_id = c.owner_id) AS rol_del_nuevo
--       FROM public.communities c WHERE c.id IN (<ids anotados>);
--     -- esperado: owner_id = el miembro vivo mas antiguo, rol_del_nuevo =
--     -- 'owner', archived_at NULL mientras quede alguien dentro, y
--     -- fundador_id NULL.
--     --
--     -- ESE fundador_id NULL NO ES DECORATIVO, es la prueba de que el
--     -- congelador de comunidad_normaliza no revierte la accion referencial
--     -- SET NULL: el motor la ejecuta como un UPDATE, ese UPDATE dispara los
--     -- BEFORE UPDATE de la tabla, y si el congelador devolviera el valor
--     -- viejo la fila quedaria apuntando a un perfil borrado SIN que el motor
--     -- se queje (la comprobacion referencial se salta cuando la clave no
--     -- cambia). Si aqui sale un uuid en vez de NULL, hay una referencia
--     -- colgante y el arreglo va en 20260905200000, no aqui.
--     --
--     -- Y el invariante entero, que es lo unico que detecta una carrera de
--     -- traspaso sobre datos reales: toda comunidad tocada esta archivada o
--     -- tiene EXACTAMENTE una fila role='owner' VIVA. Cero owners vivos con
--     -- archived_at NULL es el estado sin vuelta atras.
--     SELECT c.id, c.archived_at,
--            (SELECT count(*) FROM public.community_members m
--              WHERE m.community_id = c.id AND m.role = 'owner'
--                AND m.left_at IS NULL) AS owners_vivos
--       FROM public.communities c WHERE c.id IN (<ids anotados>);
--     -- esperado: archived_at NOT NULL, o bien owners_vivos = 1.
--   ROLLBACK;
--
--   -- C10. Y la que se queda sin nadie SI se archiva, sin arrastrar a
--   --      comunidades ajenas.
--   BEGIN;
--     SELECT count(*) FROM public.communities WHERE archived_at IS NOT NULL;
--     -- anotar
--     SELECT public.delete_user_data('<fundador-en-solitario>');
--     SELECT count(*) FROM public.communities WHERE archived_at IS NOT NULL;
--     -- esperado: el anterior + exactamente las suyas, ni una mas
--   ROLLBACK;
--
--   -- C11. Una membresia MUERTA no archiva la comunidad de otra gente
--   --      (hallazgo I-15). Montaje: una comunidad X que ya quedo con
--   --      owner_id NULL y archived_at NULL, con UN solo miembro vivo, y una
--   --      cuarta persona que fue miembro de X y se salio hace meses
--   --      (left_at NOT NULL). Al borrar la cuenta de esa cuarta persona, X no
--   --      se puede tocar: ni archivarse ni entrar en el contador.
--   BEGIN;
--     SELECT id, archived_at, miembros_count FROM public.communities WHERE id = '<X>';
--     -- anotar: archived_at NULL
--     SELECT public.delete_user_data('<ex-miembro-de-X>');
--     SELECT archived_at FROM public.communities WHERE id = '<X>';
--     -- esperado: sigue NULL. Antes del arreglo salia con fecha, y el ultimo
--     -- miembro vivo se quedaba ademas atrapado dentro, porque de una
--     -- comunidad archivada no se sale.
--     -- Y en el summary: communities_archivadas = 0 para esta baja.
--   ROLLBACK;
--
--
-- ---- D. Y AL FINAL, SIEMPRE ---------------------------------------------
--
--   NOTIFY pgrst, 'reload schema';
--
-- Y despues, fuera de la base: node scripts/gen-types.mjs, mas los CINCO
-- espejos de TypeScript de la cabecera. Hasta que esos esten, un reporte de
-- tipo community_post entra en la tabla y no lo cuenta nadie.
-- ---------------------------------------------------------------------------
