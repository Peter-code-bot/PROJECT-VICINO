-- Un reporte no puede vaciar el catalogo
--
-- EL PROBLEMA. handle_child_safety_report() oculta el objetivo con UN solo
-- reporte, de cualquier cuenta, sin umbral, sin mirar la reputacion de quien
-- reporta y sin comprobar nada mas. Como el registro es abierto, eso es un
-- boton de apagado por anuncio disponible para cualquiera. La cuenta del
-- catalogo hoy son 14 anuncios visibles: catorce peticiones y el marketplace
-- se queda vacio. El indice unico reports_reporter_target_unique no protege,
-- porque solo impide repetir el MISMO objetivo, no recorrerlos todos.
--
-- LO QUE NO SE TOCA, Y POR QUE. La respuesta inmediata a un reporte de
-- seguridad infantil es una obligacion, no una preferencia: Apple, Google y la
-- DSA piden actuar en horas, y dejar visible algo reportado por CSAM mientras
-- se junta un umbral de tres denuncias es indefendible. Asi que el contenido
-- -- anuncio, resena, mensaje -- se sigue ocultando al primer reporte. Eso no
-- cambia.
--
-- LO QUE SI CAMBIA, DOS COSAS.
--
-- 1. Se deja de ocultar el PERFIL entero.
--    Ocultar a una persona borra su negocio del mapa por una sola denuncia
--    anonima, y es desproporcionado comparado con ocultar la pieza de
--    contenido reportada. Ademas contradecia una decision que este proyecto
--    YA habia tomado: auto_hide_on_threshold(), la funcion hermana que maneja
--    todos los demas motivos, excluye a proposito target_type 'user' y
--    'message'. El trigger de child_safety la saltaba sin decirlo. Aqui se
--    igualan -- con una diferencia deliberada: 'message' SI se sigue
--    ocultando, porque ocultar un mensaje afecta a un mensaje, mientras que
--    ocultar un perfil afecta a un negocio. La asimetria es el punto.
--    El reporte sobre un perfil se sigue registrando y se sigue encolando en
--    critical_reports, que es una cola que de verdad se mira: hay panel en
--    apps/web/app/admin/moderation/critical/page.tsx.
--
-- 2. Se limita cuantas veces la MISMA cuenta puede disparar el auto-ocultado.
--    Quien reporta de verdad reporta una cosa, o dos. Quien reporta catorce en
--    una tarde no esta protegiendo a nadie. A partir del cuarto reporte de
--    child_safety de la misma cuenta en 24 horas, el reporte se registra igual
--    y se encola igual, pero deja de ocultar solo. La denuncia nunca se pierde
--    -- eso seria cambiar una vulnerabilidad por otra peor -- simplemente deja
--    de ser automatica y pasa por ojos humanos.
--
--    Tres y no uno porque una persona que encuentra un vendedor entero
--    dedicado a algo asi puede reportar legitimamente varias piezas suyas.
--    Tres y no diez porque diez ya vacia media tienda.
--
-- LO QUE ESTO NO ARREGLA, dicho en voz alta: cinco cuentas coordinadas siguen
-- sumando quince. Lo que cambia es que ahora cuesta cinco registros en vez de
-- cero, y que las quince caen juntas en la cola de criticos, donde un humano
-- ve el patron. La defensa completa es limitar por IP en la ruta de API, que
-- va aparte porque hoy ese limite es codigo muerto que nadie importa.

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

-- ---------------------------------------------------------------------------
-- Comprobar que sirvio de algo
-- ---------------------------------------------------------------------------
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
  IF position('public.products_services' in cuerpo) = 0
     OR position('public.reviews' in cuerpo) = 0
     OR position('public.messages' in cuerpo) = 0 THEN
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
