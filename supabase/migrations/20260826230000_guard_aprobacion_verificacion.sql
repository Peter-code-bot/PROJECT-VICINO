-- No se puede aprobar una identidad con un solo documento.
--
-- Item 47 de Notion. Ni approve_verification_atomic ni el camino de la IA
-- comprobaban que los TRES documentos existieran antes de poner
-- status = 'approved'. La IA es el caso concreto: se dispara justo despues de
-- subir la foto frontal, asi que podia aprobar con el reverso y la selfie sin
-- subir.
--
-- POR QUE UN TRIGGER Y NO UN CHECK, que seria lo obvio:
--   Un CHECK del tipo "si status = approved entonces los tres URLs no son NULL"
--   bloquearia la purga. purge-verification-documents pone precisamente esos
--   tres URLs en NULL cuando la verificacion ya esta resuelta —incluidas las
--   aprobadas— para cumplir el borrado a 90 dias del Aviso §15. Con un CHECK, la
--   purga fallaria y el compromiso legal se romperia por intentar reforzar otra
--   regla.
--
--   Un trigger BEFORE si distingue el MOMENTO: exige los documentos solo en la
--   TRANSICION a aprobada. Despues, la purga puede vaciarlos sin estorbo.
--
-- Se cubre INSERT ademas de UPDATE. Hoy las policies impiden que un usuario cree
-- su fila ya aprobada (20260826151000), pero service_role no pasa por RLS, y una
-- Edge Function o un script podrian hacerlo sin querer.

CREATE OR REPLACE FUNCTION public.guard_verification_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_pasa_a_aprobada boolean;
BEGIN
  -- OLD no existe en un trigger de INSERT, y leerlo alli lanza "record old is
  -- not assigned yet". De ahi el TG_OP en vez de un IS DISTINCT FROM a secas.
  IF TG_OP = 'INSERT' THEN
    v_pasa_a_aprobada := (NEW.status = 'approved'::verification_status);
  ELSE
    v_pasa_a_aprobada := (NEW.status = 'approved'::verification_status
                          AND OLD.status IS DISTINCT FROM 'approved'::verification_status);
  END IF;

  IF v_pasa_a_aprobada
     AND (NEW.ine_front_url IS NULL
          OR NEW.ine_back_url IS NULL
          OR NEW.selfie_url  IS NULL) THEN
    RAISE EXCEPTION
      'no se puede aprobar una verificacion sin los tres documentos (frente, reverso y selfie)'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.guard_verification_approval() IS
  'Exige los tres documentos SOLO en la transicion a aprobada. Un CHECK no serviria: bloquearia a purge-verification-documents, que vacia esos URLs a los 90 dias por el Aviso §15.';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.seller_verification'::regclass
      AND tgname  = 'guard_verification_approval_trg'
  ) THEN
    CREATE TRIGGER guard_verification_approval_trg
      BEFORE INSERT OR UPDATE ON public.seller_verification
      FOR EACH ROW
      EXECUTE FUNCTION public.guard_verification_approval();
  END IF;
END
$do$;

-- ---------------------------------------------------------------------------
-- Y de paso, un fallo distinto del mismo RPC que aparecio al leerlo:
-- approve_verification_atomic recibe p_verification_id y p_user_id como
-- parametros INDEPENDIENTES y nunca comprueba que correspondan. Un descuido en
-- el panel —o una llamada manipulada— podia marcar aprobada la verificacion de
-- una persona y sumarle los 30 puntos de confianza, el is_verified y el
-- trust_level a OTRA.
--
-- El arreglo no es validar que coincidan, es dejar de confiar en el parametro:
-- el user_id se deriva de la propia fila. p_user_id se conserva en la firma para
-- no romper a quien ya la llama, pero si no coincide, se rechaza en vez de
-- escribir en el perfil equivocado.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.approve_verification_atomic(
  p_verification_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

  -- El dueño sale de la fila, no del parametro.
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

  UPDATE public.profiles
     SET is_verified  = TRUE,
         verified_at  = NOW(),
         trust_points = COALESCE(trust_points, 0) + 30
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

-- VERIFY (transacciones revertidas):
--   1. Aprobar sin los tres documentos -> 23514
--      BEGIN;
--        UPDATE public.seller_verification SET status='approved'
--         WHERE ine_back_url IS NULL LIMIT 1;
--      ROLLBACK;
--
--   2. La purga sigue pudiendo vaciar los URLs de una aprobada:
--      BEGIN;
--        UPDATE public.seller_verification
--           SET ine_front_url=NULL, ine_back_url=NULL, selfie_url=NULL
--         WHERE status='approved';
--      ROLLBACK;   -- debe funcionar
--
--   3. p_user_id que no corresponde -> 22023
