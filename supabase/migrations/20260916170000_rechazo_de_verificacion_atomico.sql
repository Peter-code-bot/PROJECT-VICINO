-- Rechazar una verificacion no se podia. Literalmente.
--
-- EL FALLO. rejectVerification hacia un UPDATE directo sobre
-- seller_verification poniendo status, reviewed_at y reviewer_note con el
-- cliente del admin, o sea con el rol `authenticated`. Y 20260826301000 revoco
-- el UPDATE de tabla a `authenticated` y volvio a conceder solo siete columnas:
-- status, document_type, university_name, submitted_at y las tres URL.
-- reviewed_at y reviewer_note NO estan en ese GRANT, a proposito: son el
-- veredicto, y quien se verifica no debe poder escribirlo.
--
-- La consecuencia es que el panel tampoco podia. Un admin sigue siendo el rol
-- `authenticated` ante Postgres —lo que le da poder es la policy «Admin can
-- manage verifications», que es RLS, no un privilegio— y un GRANT ausente se
-- comprueba ANTES que cualquier policy. Resultado: 42501, y la persona veia
-- «permission denied for table seller_verification» debajo del boton de
-- confirmar rechazo.
--
-- Por eso aprobar si funcionaba y rechazar no: aprobar pasa por
-- approve_verification_atomic, que es SECURITY DEFINER y por tanto escribe con
-- los privilegios del dueno de la funcion. Rechazar no tenia equivalente.
--
-- Esta migracion es ese equivalente, espejo de la de aprobar
-- (20260528000003 + 20260826230000): mismo guard de rol leido de user_roles,
-- mismo derivar el dueno de la FILA y no de un parametro, y mismo jsonb de
-- salida.
--
-- Funcion NUEVA, asi que no hay que borrar ninguna firma vieja. Si alguna vez
-- se le anade un parametro, CREATE OR REPLACE crearia una SOBRECARGA y
-- PostgREST responderia 300 a todas las llamadas: en ese caso, DROP FUNCTION
-- de la firma anterior primero.

CREATE OR REPLACE FUNCTION public.reject_verification_atomic(
  p_verification_id uuid,
  p_note text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller          uuid := auth.uid();
  v_owner           uuid;
  v_estado_anterior verification_status;
  v_nota            text := nullif(btrim(coalesce(p_note, '')), '');
  v_retirada        boolean := false;
  v_otra_aprobada   boolean;
  v_filas           integer := 0;
BEGIN
  -- SECURITY DEFINER no evalua policies, asi que la autorizacion se comprueba
  -- aqui a mano contra el pivote user_roles. Mismo criterio que aprobar: admin
  -- o moderator. Si esto faltara, la funcion seria un rechazo abierto a
  -- cualquier cuenta con sesion.
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller
      AND role IN ('admin'::app_role, 'moderator'::app_role)
  ) THEN
    RAISE EXCEPTION 'Solo admin o moderator puede rechazar verificaciones'
      USING ERRCODE = '42501';
  END IF;

  -- El dueno y el estado previo salen de la fila. No hay parametro p_user_id
  -- que pueda apuntar a otra persona: ese fue justamente el fallo que
  -- 20260826230000 tuvo que arreglar en la funcion de aprobar.
  SELECT user_id, status
    INTO v_owner, v_estado_anterior
    FROM public.seller_verification
   WHERE id = p_verification_id
     FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Verificacion no encontrada para id %', p_verification_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.seller_verification
     SET status        = 'rejected'::verification_status,
         reviewed_at   = NOW(),
         reviewer_note = v_nota
   WHERE id = p_verification_id;

  GET DIAGNOSTICS v_filas = ROW_COUNT;
  IF v_filas = 0 THEN
    RAISE EXCEPTION 'Verificacion no encontrada para id %', p_verification_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Y ahora lo que rechazar tiene que deshacer, porque aprobar lo hizo.
  --
  -- Sin esto, rechazar una verificacion YA APROBADA dejaba la insignia de
  -- verificado puesta, los 30 puntos de confianza sumados y el nivel en
  -- 'verificado'. O sea que descubrir que un documento era falso no quitaba
  -- nada: el perfil seguia diciendo «identidad verificada». El caso normal
  -- —rechazar una pendiente— no entra aqui.
  IF v_estado_anterior = 'approved'::verification_status THEN
    -- El historial de esta tabla es multi-fila (solo PK sobre id, indice NO
    -- unico sobre user_id). Si al vendedor le queda otra verificacion
    -- aprobada, la insignia sigue estando ganada y no se toca.
    SELECT EXISTS (
      SELECT 1 FROM public.seller_verification
       WHERE user_id = v_owner
         AND id <> p_verification_id
         AND status = 'approved'::verification_status
    ) INTO v_otra_aprobada;

    IF NOT v_otra_aprobada THEN
      v_retirada := true;

      -- GREATEST y no una resta a secas: los puntos se suman por mas caminos
      -- que este, y dejar un saldo negativo ordena los rankings al reves.
      UPDATE public.profiles
         SET is_verified  = FALSE,
             verified_at  = NULL,
             trust_points = GREATEST(0, COALESCE(trust_points, 0) - 30)
       WHERE id = v_owner;

      -- Las tres banderas si se bajan siempre: describen ESTA revision.
      --
      -- current_level solo baja si esta exactamente en 'verificado', que es lo
      -- que puso aprobar. Un nivel mas alto ('confiable', 'estrella', 'elite')
      -- se gana por ventas y resenas, no por este documento, y tirarlo desde
      -- aqui borraria meses de historial ajeno a la verificacion.
      UPDATE public.trust_level_verification
         SET id_verified           = FALSE,
             selfie_verified       = FALSE,
             selfie_match_verified = FALSE,
             current_level         = CASE
                                       WHEN current_level = 'verificado'::trust_level
                                         THEN 'nuevo'::trust_level
                                       ELSE current_level
                                     END,
             level_1_completed_at  = NULL
       WHERE user_id = v_owner;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                true,
    'verification_id',   p_verification_id,
    'user_id',           v_owner,
    -- ::text explicito: un enum no tiene conversion directa a json y dejarlo
    -- al azar del motor es lo que convierte esta linea en un error de tipos
    -- el dia que alguien anada un valor al enum.
    'estado_anterior',   v_estado_anterior::text,
    'insignia_retirada', v_retirada
  );
END;
$function$;

COMMENT ON FUNCTION public.reject_verification_atomic(uuid, text) IS
  'Rechazo atomico de una verificacion. Existe porque authenticated NO tiene GRANT de UPDATE sobre reviewed_at ni reviewer_note (20260826301000), asi que el UPDATE directo del panel moria con 42501. Espejo de approve_verification_atomic: valida admin o moderator contra user_roles, deriva el dueno de la fila y, si la fila venia aprobada y no queda otra aprobada, retira la insignia y los 30 puntos.';

REVOKE ALL ON FUNCTION public.reject_verification_atomic(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reject_verification_atomic(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_verification_atomic(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reject_verification_atomic(uuid, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- VERIFICACION
--
-- 1. La firma es UNICA. Si hay dos, PostgREST responde 300 a todo:
--      SELECT oid::regprocedure
--        FROM pg_proc
--       WHERE proname = 'reject_verification_atomic';
--      -- esperado: exactamente una fila,
--      --   reject_verification_atomic(uuid,text)
--
-- 2. El privilegio quedo solo en authenticated:
--      SELECT grantee, privilege_type
--        FROM information_schema.routine_privileges
--       WHERE routine_name = 'reject_verification_atomic';
--      -- esperado: authenticated / EXECUTE. NI anon NI PUBLIC.
--
-- 3. Una cuenta SIN rol no puede rechazar. SET LOCAL ROLE es obligatorio:
--    postgres BYPASEA la RLS y auth.uid() saldria null (leccion 2 de CLAUDE.md).
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid_sin_rol>","role":"authenticated"}';
--        SELECT public.reject_verification_atomic('<id>', 'prueba');
--        -- esperado: 42501 'Solo admin o moderator puede rechazar verificaciones'
--      ROLLBACK;
--
-- 4. Un admin SI puede, y la nota queda escrita. Esta es la prueba que refuta
--    el «permission denied for table seller_verification» del panel:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid_admin>","role":"authenticated"}';
--        SELECT public.reject_verification_atomic('<id_pendiente>', '  la foto no se lee  ');
--        SELECT status, reviewed_at, reviewer_note
--          FROM public.seller_verification WHERE id = '<id_pendiente>';
--        -- esperado: rejected / fecha de ahora / 'la foto no se lee' (sin espacios)
--      ROLLBACK;
--
-- 5. Una nota vacia se guarda como NULL, no como cadena vacia:
--      SELECT public.reject_verification_atomic('<id>', '   ');
--      -- esperado: reviewer_note IS NULL
--
-- 6. Rechazar una YA APROBADA retira la insignia:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid_admin>","role":"authenticated"}';
--        SELECT public.reject_verification_atomic('<id_aprobada>', 'documento falso');
--        -- esperado en el jsonb: "insignia_retirada": true
--        SELECT is_verified, verified_at, trust_points
--          FROM public.profiles WHERE id = '<uuid_dueno>';
--        -- esperado: false / NULL / 30 menos que antes, nunca negativo
--        SELECT id_verified, selfie_verified, selfie_match_verified, current_level
--          FROM public.trust_level_verification WHERE user_id = '<uuid_dueno>';
--        -- esperado: false, false, false y current_level 'nuevo' SOLO si estaba
--        -- en 'verificado'
--      ROLLBACK;
--
-- 7. Un id que no existe:
--      SELECT public.reject_verification_atomic('00000000-0000-0000-0000-000000000000', 'x');
--      -- esperado: P0002 'Verificacion no encontrada'
--
-- ROLLBACK (manual)
--   DROP FUNCTION IF EXISTS public.reject_verification_atomic(uuid, text);
--   Y devolver rejectVerification en apps/web/app/admin/verifications/actions.ts
--   al UPDATE directo, sabiendo que volvera a fallar con 42501.
-- ---------------------------------------------------------------------------
