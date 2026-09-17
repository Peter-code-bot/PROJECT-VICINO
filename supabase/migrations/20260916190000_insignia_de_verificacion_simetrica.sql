-- La insignia de verificado no tenia vuelta, y los puntos se regalaban en cada
-- ciclo. Las dos cosas salen del mismo desequilibrio.
--
-- EL FALLO 1 -- PUNTOS QUE SOLO SUBEN. approve_verification_atomic hace
-- `trust_points = COALESCE(trust_points, 0) + 30` sin mirar si el perfil ya
-- estaba verificado. Aprobar dos veces al mismo vendedor suma 60. Y hay un
-- camino para conseguirlo sin ser admin: la pantalla de /seller/verificacion
-- puede devolver su propia verificacion a 'pending' (borrar una foto o cambiar
-- de tipo de documento lo hace, y la policy de la tabla lo exige), asi que el
-- ciclo aprobar -> volver a pending -> aprobar es repetible y cada vuelta
-- regala 30 puntos. Los rankings estan en produccion y ordenan por eso.
--
-- EL FALLO 2 -- LA INSIGNIA SE QUEDA PUESTA. Cuando ese mismo vendedor devuelve
-- su verificacion a 'pending', nadie deshace nada: profiles.is_verified sigue
-- en true, verified_at con su fecha y trust_level_verification en 'verificado'.
-- Resultado: un perfil que dice "identidad verificada" con CERO documentos en
-- la fila. Lo unico que si se pierde de inmediato es el feed por universidad,
-- que filtra por status. O sea que la pantalla avisaba "tu verificacion
-- aprobada volvera a revision" y eso solo pasaba a medias.
--
-- POR QUE UN TRIGGER Y NO OTRA FUNCION. Las columnas de seller_verification
-- que mueven el estado SI estan en el GRANT por columna de `authenticated`
-- (20260826301000), y con razon: el vendedor tiene que poder reemplazar sus
-- documentos. O sea que hay tres escritores distintos --el panel por RPC, la
-- pantalla del vendedor por UPDATE directo, y la revision automatica con
-- service_role-- y una invariante que los tres tienen que respetar. Escribirla
-- en cada uno es garantizar que el cuarto se olvide. Va en la base, pegada al
-- dato, donde ninguno la puede saltar.
--
-- Y por eso mismo reject_verification_atomic (20260916170000, de hoy) DEJA de
-- hacer la retirada a mano: si la hiciera y el trigger tambien, se restarian 60
-- por un solo rechazo. Su contrato de salida no cambia --sigue devolviendo
-- `insignia_retirada`--, solo que ahora lo calcula en vez de ejecutarlo.

begin;

-- ---------------------------------------------------------------------------
-- 1. La invariante: si una verificacion deja de estar aprobada y no queda otra
--    aprobada, la insignia se retira.
-- ---------------------------------------------------------------------------

create or replace function public.sincronizar_insignia_de_verificacion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_otra_aprobada boolean;
BEGIN
  -- Solo el paso de APROBADA a cualquier otra cosa. El resto de transiciones
  -- (pending -> approved, pending -> rejected) las gobierna quien escribe.
  IF OLD.status = 'approved'::verification_status
     AND NEW.status IS DISTINCT FROM 'approved'::verification_status THEN

    -- El historial es multi-fila (solo PK sobre id, indice NO unico sobre
    -- user_id). Si al vendedor le queda otra verificacion aprobada, la
    -- insignia sigue ganada y no se toca.
    SELECT EXISTS (
      SELECT 1 FROM public.seller_verification
       WHERE user_id = OLD.user_id
         AND id <> OLD.id
         AND status = 'approved'::verification_status
    ) INTO v_otra_aprobada;

    IF NOT v_otra_aprobada THEN
      -- `AND is_verified` es lo que hace la resta IDEMPOTENTE: sin esa
      -- condicion, dos transiciones seguidas restarian 60. Emparejado con el
      -- "+30 solo si no estaba verificado" del punto 2, el libro mayor cuadra
      -- en los dos sentidos y en cualquier orden.
      --
      -- GREATEST y no una resta a secas: los puntos se suman por mas caminos
      -- que este, y un saldo negativo ordena los rankings al reves.
      UPDATE public.profiles
         SET is_verified  = FALSE,
             verified_at  = NULL,
             trust_points = GREATEST(0, COALESCE(trust_points, 0) - 30)
       WHERE id = OLD.user_id
         AND is_verified;

      -- Las tres banderas describen ESTA revision, asi que bajan siempre.
      -- current_level solo baja si esta exactamente en 'verificado', que es lo
      -- que puso aprobar: un nivel mas alto se gana por ventas y resenas, y
      -- tirarlo desde aqui borraria meses de historial ajeno al documento.
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
       WHERE user_id = OLD.user_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

comment on function public.sincronizar_insignia_de_verificacion() is
  'Retira la insignia, los 30 puntos y el nivel cuando una verificacion deja de estar aprobada y no queda otra aprobada. Vive en la base porque tres escritores distintos mueven ese estado (panel por RPC, vendedor por UPDATE directo, revision automatica con service_role) y la invariante tiene que valer para los tres. La resta es idempotente: solo ocurre si el perfil estaba verificado.';

drop trigger if exists sincronizar_insignia_de_verificacion_trg on public.seller_verification;

create trigger sincronizar_insignia_de_verificacion_trg
  after update of status on public.seller_verification
  for each row
  execute function public.sincronizar_insignia_de_verificacion();

-- ---------------------------------------------------------------------------
-- 2. Aprobar deja de regalar puntos.
--
-- Misma firma EXACTA que 20260528000003 + 20260826230000: un parametro de mas
-- crearia una SOBRECARGA y PostgREST responderia 300 a todas las llamadas.
-- Solo cambia el UPDATE de profiles; el resto va igual, a proposito, para que
-- el diff sea legible.
-- ---------------------------------------------------------------------------

create or replace function public.approve_verification_atomic(
  p_verification_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_caller     UUID := auth.uid();
  v_owner      UUID;
  v_ver_found  INTEGER := 0;
  v_has_trust  BOOLEAN := FALSE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = v_caller
      AND role IN ('admin'::app_role, 'moderator'::app_role)
  ) THEN
    RAISE EXCEPTION 'Solo admin o moderator puede aprobar verificaciones'
      USING ERRCODE = '42501';
  END IF;

  -- El dueno sale de la fila, no del parametro.
  SELECT user_id INTO v_owner
    FROM public.seller_verification
   WHERE id = p_verification_id;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Verificacion no encontrada para id %', p_verification_id
      USING ERRCODE = 'P0002';
  END IF;

  IF p_user_id IS DISTINCT FROM v_owner THEN
    RAISE EXCEPTION 'La verificacion % no pertenece al usuario %', p_verification_id, p_user_id
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.seller_verification
     SET status      = 'approved'::verification_status,
         reviewed_at = NOW()
   WHERE id = p_verification_id;

  GET DIAGNOSTICS v_ver_found = ROW_COUNT;
  IF v_ver_found = 0 THEN
    RAISE EXCEPTION 'Verificacion no encontrada para id %', p_verification_id
      USING ERRCODE = 'P0002';
  END IF;

  -- LOS 30 PUNTOS, UNA SOLA VEZ. El CASE sobre is_verified es todo el arreglo
  -- del fallo 1: sin el, el ciclo aprobar -> volver a pending -> aprobar
  -- sumaba 30 en cada vuelta. La insignia y la fecha si se reescriben siempre,
  -- que es idempotente y deja verified_at diciendo cuando se gano la vigente.
  UPDATE public.profiles
     SET is_verified  = TRUE,
         verified_at  = NOW(),
         trust_points = COALESCE(trust_points, 0)
                        + CASE WHEN COALESCE(is_verified, FALSE) THEN 0 ELSE 30 END
   WHERE id = v_owner;

  SELECT EXISTS(
    SELECT 1 FROM public.trust_level_verification WHERE user_id = v_owner
  ) INTO v_has_trust;

  IF v_has_trust THEN
    UPDATE public.trust_level_verification
       SET id_verified           = TRUE,
           selfie_verified       = TRUE,
           selfie_match_verified = TRUE,
           current_level         = 'verificado'::trust_level,
           level_1_completed_at  = NOW()
     WHERE user_id = v_owner;
  ELSE
    INSERT INTO public.trust_level_verification (
      user_id, id_verified, selfie_verified, selfie_match_verified,
      current_level, level_1_completed_at
    ) VALUES (
      v_owner, TRUE, TRUE, TRUE, 'verificado'::trust_level, NOW()
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'verification_id', p_verification_id, 'user_id', v_owner);
END;
$function$;

comment on function public.approve_verification_atomic(uuid, uuid) is
  'Aprobacion atomica de una verificacion. Valida admin o moderator contra user_roles, deriva el dueno de la FILA y reparte insignia, nivel y 30 puntos. Los 30 puntos se suman SOLO si el perfil no estaba ya verificado: sin eso, el ciclo aprobar -> volver a pending -> aprobar (que el vendedor puede provocar desde su pantalla) regalaba 30 en cada vuelta.';

-- ---------------------------------------------------------------------------
-- 3. Rechazar deja de retirar la insignia a mano: ahora lo hace el trigger.
--
-- Si las dos cosas ocurrieran, un solo rechazo restaria 60. El contrato de
-- salida no cambia: `insignia_retirada` se sigue devolviendo, calculado con la
-- misma condicion que evalua el trigger.
-- ---------------------------------------------------------------------------

create or replace function public.reject_verification_atomic(
  p_verification_id uuid,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_caller          uuid := auth.uid();
  v_owner           uuid;
  v_estado_anterior verification_status;
  v_nota            text := nullif(btrim(coalesce(p_note, '')), '');
  v_retirada        boolean := false;
  v_otra_aprobada   boolean;
  v_filas           integer := 0;
BEGIN
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

  SELECT user_id, status
    INTO v_owner, v_estado_anterior
    FROM public.seller_verification
   WHERE id = p_verification_id
     FOR UPDATE;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Verificacion no encontrada para id %', p_verification_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Se calcula ANTES del UPDATE, porque despues el trigger ya habra cambiado
  -- el mundo que esta condicion describe.
  IF v_estado_anterior = 'approved'::verification_status THEN
    SELECT EXISTS (
      SELECT 1 FROM public.seller_verification
       WHERE user_id = v_owner
         AND id <> p_verification_id
         AND status = 'approved'::verification_status
    ) INTO v_otra_aprobada;
    v_retirada := NOT v_otra_aprobada;
  END IF;

  -- Este UPDATE dispara sincronizar_insignia_de_verificacion_trg, que es quien
  -- retira insignia, puntos y nivel si toca.
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

comment on function public.reject_verification_atomic(uuid, text) is
  'Rechazo atomico de una verificacion. Existe porque authenticated NO tiene GRANT de UPDATE sobre reviewed_at ni reviewer_note (20260826301000), asi que el UPDATE directo del panel moria con 42501. Valida admin o moderator contra user_roles y deriva el dueno de la fila. La retirada de insignia, puntos y nivel la hace el trigger sincronizar_insignia_de_verificacion_trg (20260916190000), no esta funcion: hacerlo en los dos sitios restaria 60 por un solo rechazo.';

notify pgrst, 'reload schema';

commit;

-- ---------------------------------------------------------------------------
-- VERIFICACION (correr despues de aplicar)
--
--   -- 1. El trigger existe y es AFTER UPDATE OF status.
--   SELECT tgname, pg_get_triggerdef(t.oid)
--     FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
--    WHERE c.relname = 'seller_verification' AND NOT t.tgisinternal;
--   -- esperado: sincronizar_insignia_de_verificacion_trg, AFTER UPDATE OF status
--
--   -- 2. Ninguna firma duplicada (una sobrecarga da 300 en PostgREST).
--   SELECT oid::regprocedure::text FROM pg_proc
--    WHERE proname IN ('approve_verification_atomic','reject_verification_atomic',
--                      'sincronizar_insignia_de_verificacion');
--   -- esperado: tres filas, una por nombre
--
--   -- 3. Aprobar dos veces NO suma 60. Es el fallo 1, y este es su test.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid_admin>","role":"authenticated"}';
--     SELECT trust_points FROM public.profiles WHERE id = '<uuid_dueno>';  -- antes
--     SELECT public.approve_verification_atomic('<id>', '<uuid_dueno>');
--     SELECT trust_points, is_verified FROM public.profiles WHERE id = '<uuid_dueno>';
--     -- esperado: +30, is_verified true
--     SELECT public.approve_verification_atomic('<id>', '<uuid_dueno>');
--     SELECT trust_points FROM public.profiles WHERE id = '<uuid_dueno>';
--     -- esperado: EL MISMO valor. Antes sumaba otros 30.
--   ROLLBACK;
--
--   -- 4. El trigger retira la insignia cuando el VENDEDOR devuelve su fila a
--   --    pending con un UPDATE directo. Es el fallo 2, y este es su test: no
--   --    pasa por ninguna RPC.
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid_dueno>","role":"authenticated"}';
--     UPDATE public.seller_verification SET status = 'pending' WHERE id = '<id_aprobada>';
--     SELECT is_verified, verified_at, trust_points FROM public.profiles WHERE id = '<uuid_dueno>';
--     -- esperado: false / NULL / 30 menos, nunca negativo
--     SELECT current_level FROM public.trust_level_verification WHERE user_id = '<uuid_dueno>';
--     -- esperado: 'nuevo' SOLO si estaba en 'verificado'
--   ROLLBACK;
--
--   -- 5. Idempotencia de la resta: dos transiciones seguidas restan 30, no 60.
--   BEGIN;
--     UPDATE public.seller_verification SET status = 'pending' WHERE id = '<id_aprobada>';
--     UPDATE public.seller_verification SET status = 'rejected' WHERE id = '<id_aprobada>';
--     SELECT trust_points FROM public.profiles WHERE id = '<uuid_dueno>';
--     -- esperado: 30 menos que al empezar
--   ROLLBACK;
--
--   -- 6. Con OTRA verificacion aprobada, la insignia NO se toca.
--
-- LO QUE ESTA MIGRACION NO CUBRE, a proposito
--   Un DELETE de una fila aprobada no dispara nada, asi que dejaria la insignia
--   puesta. Hoy nada en la app borra filas de seller_verification (se vacian las
--   columnas, no se borra la fila), y un trigger de DELETE tendria que decidir
--   que hacer con un borrado en cascada de la cuenta, donde el perfil se va
--   igual. Si algun dia se borran filas, hace falta el espejo.
--
-- ROLLBACK (manual)
--   DROP TRIGGER IF EXISTS sincronizar_insignia_de_verificacion_trg ON public.seller_verification;
--   DROP FUNCTION IF EXISTS public.sincronizar_insignia_de_verificacion();
--   Y devolver approve_verification_atomic y reject_verification_atomic a sus
--   cuerpos de 20260826230000 y 20260916170000, en ese orden.
-- ---------------------------------------------------------------------------
