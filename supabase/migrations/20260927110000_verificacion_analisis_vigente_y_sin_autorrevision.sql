-- Verificacion de identidad: el analisis de la IA siempre corresponde a los
-- documentos que se ven, y nadie aprueba ni rechaza su propia solicitud.
--
-- BUG-VERIF-IA (reporte de Pedro, 27-sep-2026). Una credencial se mando
-- primero con otra universidad (UMAD) y se reenvio con la correcta (Anahuac).
-- El panel mostraba "Universidad Anahuac" con la nota de la IA sobre la UMAD:
-- ai_analysis_raw / ai_confidence_score solo los escribe la accion de la IA y
-- NADA los invalida cuando el vendedor cambia fotos, tipo o universidad. La
-- fila se reutiliza entre intentos, asi que la nota vieja se queda puesta.
-- (La IA no volvio a correr porque faltaba el reverso; eso lo explica ahora la
-- pantalla del vendedor. Aqui se arregla la nota vieja.)
--
-- 1) invalidar_analisis_ia_trg: si el DUENO de una solicitud pendiente cambia
--    una foto, el tipo, la universidad o submitted_at (la ruta de cada foto es
--    fija, asi que reemplazar una foto en su ranura no cambia la URL pero si
--    submitted_at), el analisis anterior se pone en NULL. Solo cuando escribe
--    el dueno (auth.uid() = user_id): la accion de la IA escribe con la llave
--    de servicio (auth.uid() nulo) y su veredicto se conserva; los revisores
--    solo cambian el estado; la purga toca filas aprobadas o rechazadas.
--    Un trigger puede escribir columnas que el rol no tiene en su GRANT.
--
-- 2) impedir_revisar_verificacion_propia_trg: approve/reject_verification_atomic
--    solo comprobaban el rol, asi que un admin o moderador podia aprobarse a
--    si mismo (la cuenta del caso se rechazo a si misma). Se bloquea cualquier
--    paso a approved/rejected hecho por el propio dueno. La IA (servicio) y un
--    revisor sobre la solicitud de otra persona no se ven afectados.
--
-- Idempotente.

CREATE OR REPLACE FUNCTION public.invalidar_analisis_ia_al_cambiar_documentos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() = NEW.user_id
     AND (NEW.status IS NULL OR NEW.status = 'pending'::verification_status)
     AND (NEW.selfie_url      IS DISTINCT FROM OLD.selfie_url
       OR NEW.ine_front_url   IS DISTINCT FROM OLD.ine_front_url
       OR NEW.ine_back_url    IS DISTINCT FROM OLD.ine_back_url
       OR NEW.document_type   IS DISTINCT FROM OLD.document_type
       OR NEW.university_name IS DISTINCT FROM OLD.university_name
       OR NEW.submitted_at    IS DISTINCT FROM OLD.submitted_at)
  THEN
    NEW.ai_analysis_raw := NULL;
    NEW.ai_confidence_score := NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS invalidar_analisis_ia_trg ON public.seller_verification;
CREATE TRIGGER invalidar_analisis_ia_trg
  BEFORE UPDATE ON public.seller_verification
  FOR EACH ROW EXECUTE FUNCTION public.invalidar_analisis_ia_al_cambiar_documentos();

CREATE OR REPLACE FUNCTION public.impedir_revisar_verificacion_propia()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND auth.uid() = NEW.user_id
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('approved'::verification_status, 'rejected'::verification_status)
  THEN
    RAISE EXCEPTION 'No puedes aprobar ni rechazar tu propia verificacion'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS impedir_revisar_verificacion_propia_trg ON public.seller_verification;
CREATE TRIGGER impedir_revisar_verificacion_propia_trg
  BEFORE UPDATE ON public.seller_verification
  FOR EACH ROW EXECUTE FUNCTION public.impedir_revisar_verificacion_propia();

-- Nadie las llama directamente: son funciones de trigger.
REVOKE ALL ON FUNCTION public.invalidar_analisis_ia_al_cambiar_documentos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.impedir_revisar_verificacion_propia() FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.seller_verification'::regclass
                 AND tgname = 'invalidar_analisis_ia_trg' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta invalidar_analisis_ia_trg';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.seller_verification'::regclass
                 AND tgname = 'impedir_revisar_verificacion_propia_trg' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta impedir_revisar_verificacion_propia_trg';
  END IF;
END
$verify$;
