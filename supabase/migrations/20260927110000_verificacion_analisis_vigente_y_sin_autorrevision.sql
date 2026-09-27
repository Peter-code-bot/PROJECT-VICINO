-- Verificacion de identidad: el revisor sabe si la nota de la IA corresponde a
-- las fotos que esta viendo, y nadie aprueba ni rechaza su propia solicitud.
--
-- BUG-VERIF-IA (reporte de Pedro, 27-sep-2026). Una credencial se mando
-- primero con otra universidad (UMAD) y se reenvio con la correcta (Anahuac).
-- El panel mostraba "Universidad Anahuac" con la nota de la IA sobre la UMAD:
-- ai_analysis_raw / ai_confidence_score solo los escribe la accion de la IA y
-- NADA decia cuando dejaban de corresponder a los documentos. La fila se
-- reutiliza entre intentos, asi que la nota vieja se quedaba puesta como si
-- fuera de las fotos nuevas. (La IA no volvio a correr porque faltaba el
-- reverso; eso lo explica ahora la pantalla del vendedor.)
--
-- 1) La nota de la IA NO se borra: se marca como desfasada.
--    La primera version de este arreglo la ponia en NULL cuando el dueno
--    cambiaba algo, y la revision adversarial encontro que eso le daba al
--    vendedor una goma de borrar: un PATCH de submitted_at (columna que el
--    puede escribir) eliminaba un veredicto NEGATIVO de la IA sin cambiar
--    ninguna foto. Ahora la nota se conserva y el panel la presenta como
--    "sobre un envio anterior".
--
--    - ai_vigente: false en cuanto una sesion con JWT (el dueno, o un admin
--      editando a mano) cambia una foto, el tipo, la universidad o
--      submitted_at. La ruta de cada foto es fija (<user_id>/<ranura>, con
--      upsert), asi que reemplazar una foto no cambia la URL pero el
--      formulario si mueve submitted_at. Solo lo vuelve a poner en true la
--      accion de la IA, que escribe con la llave de servicio (auth.uid() nulo).
--    - ai_analizado_en: la version de las fotos que miro la IA, con el reloj de
--      Storage (el updated_at mas reciente de los tres objetos, leido ANTES de
--      descargarlos). Cubre lo que la fila no ve: reemplazar un objeto en el
--      bucket sin tocar la fila. El panel compara ese valor con el updated_at
--      actual de cada objeto.
--    Ninguna de las dos lleva GRANT de escritura para authenticated: ni el
--    vendedor ni un admin pueden marcar como vigente una nota vieja. SELECT si,
--    porque la tabla da SELECT de todas sus columnas a authenticated y un
--    `select *` con una columna sin privilegio moriria entero con 42501.
--
-- 2) Nadie aprueba ni rechaza su propia solicitud.
--    approve/reject_verification_atomic solo comprobaban el rol, asi que un
--    admin o moderador podia resolver su propia solicitud (la cuenta del caso
--    se rechazo a si misma). Y la policy "Admin can manage verifications" (ALL)
--    deja ademas a un admin INSERTAR su fila ya aprobada o cambiarle el estado
--    a mano. Se bloquea cualquier INSERT o UPDATE hecho por el propio dueno
--    que deje la fila en approved o rejected, haya o no cambio de estado: la
--    RPC de aprobar reescribe status aunque ya valga 'approved' y reparte la
--    insignia igual. Codigo propio (VC403) para que el panel de un mensaje
--    claro en vez de "vuelve a entrar". La IA (servicio, auth.uid() nulo) y un
--    revisor sobre la solicitud de otra persona no se ven afectados. El
--    vendedor normal ya no podia: su policy exige terminar en pending.
--
-- Idempotente. Limpia tambien la primera version, que solo llego a staging.

ALTER TABLE public.seller_verification
  ADD COLUMN IF NOT EXISTS ai_vigente boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ai_analizado_en timestamptz;

COMMENT ON COLUMN public.seller_verification.ai_vigente IS
  'false si una sesion con JWT cambio fotos, tipo, universidad o submitted_at despues del ultimo analisis de la IA. Solo la accion de la IA (service_role) lo pone en true.';
COMMENT ON COLUMN public.seller_verification.ai_analizado_en IS
  'updated_at mas reciente (reloj de Storage) de las tres fotos que analizo la IA, leido antes de descargarlas. Un objeto con updated_at posterior no lo vio la IA.';

-- SELECT si (ver punto 1); INSERT/UPDATE no, a proposito.
GRANT SELECT (ai_vigente, ai_analizado_en) ON public.seller_verification TO authenticated;

-- Primera version (solo staging): ponia el analisis en NULL.
DROP TRIGGER IF EXISTS invalidar_analisis_ia_trg ON public.seller_verification;
DROP FUNCTION IF EXISTS public.invalidar_analisis_ia_al_cambiar_documentos();

CREATE OR REPLACE FUNCTION public.marcar_analisis_ia_desfasado()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND (NEW.selfie_url      IS DISTINCT FROM OLD.selfie_url
       OR NEW.ine_front_url   IS DISTINCT FROM OLD.ine_front_url
       OR NEW.ine_back_url    IS DISTINCT FROM OLD.ine_back_url
       OR NEW.document_type   IS DISTINCT FROM OLD.document_type
       OR NEW.university_name IS DISTINCT FROM OLD.university_name
       OR NEW.submitted_at    IS DISTINCT FROM OLD.submitted_at)
  THEN
    NEW.ai_vigente := false;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS marcar_analisis_ia_desfasado_trg ON public.seller_verification;
CREATE TRIGGER marcar_analisis_ia_desfasado_trg
  BEFORE UPDATE ON public.seller_verification
  FOR EACH ROW EXECUTE FUNCTION public.marcar_analisis_ia_desfasado();

CREATE OR REPLACE FUNCTION public.impedir_revisar_verificacion_propia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() = NEW.user_id
     AND NEW.status IN ('approved'::verification_status, 'rejected'::verification_status)
  THEN
    RAISE EXCEPTION 'No puedes aprobar ni rechazar tu propia verificacion'
      USING ERRCODE = 'VC403';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS impedir_revisar_verificacion_propia_trg ON public.seller_verification;
CREATE TRIGGER impedir_revisar_verificacion_propia_trg
  BEFORE INSERT OR UPDATE ON public.seller_verification
  FOR EACH ROW EXECUTE FUNCTION public.impedir_revisar_verificacion_propia();

-- Nadie las llama directamente: son funciones de trigger.
REVOKE ALL ON FUNCTION public.marcar_analisis_ia_desfasado() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.impedir_revisar_verificacion_propia() FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.seller_verification'::regclass
                 AND tgname = 'marcar_analisis_ia_desfasado_trg' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta marcar_analisis_ia_desfasado_trg';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.seller_verification'::regclass
                 AND tgname = 'impedir_revisar_verificacion_propia_trg' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta impedir_revisar_verificacion_propia_trg';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.seller_verification'::regclass
             AND tgname = 'invalidar_analisis_ia_trg') THEN
    RAISE EXCEPTION 'sigue la primera version (invalidar_analisis_ia_trg)';
  END IF;
  -- Ni el vendedor ni un admin pueden escribir las dos columnas nuevas.
  IF EXISTS (SELECT 1 FROM information_schema.column_privileges
             WHERE table_schema = 'public' AND table_name = 'seller_verification'
               AND column_name IN ('ai_vigente', 'ai_analizado_en')
               AND grantee IN ('authenticated', 'anon')
               AND privilege_type IN ('INSERT', 'UPDATE')) THEN
    RAISE EXCEPTION 'authenticated o anon pueden escribir ai_vigente / ai_analizado_en';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.seller_verification', 'ai_vigente', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.seller_verification', 'ai_analizado_en', 'SELECT') THEN
    RAISE EXCEPTION 'falta el SELECT de authenticated sobre las columnas nuevas';
  END IF;
  -- La accion de la IA escribe las dos con la llave de servicio.
  IF NOT has_column_privilege('service_role', 'public.seller_verification', 'ai_vigente', 'UPDATE')
     OR NOT has_column_privilege('service_role', 'public.seller_verification', 'ai_analizado_en', 'UPDATE') THEN
    RAISE EXCEPTION 'service_role no puede escribir ai_vigente / ai_analizado_en';
  END IF;
END
$verify$;
