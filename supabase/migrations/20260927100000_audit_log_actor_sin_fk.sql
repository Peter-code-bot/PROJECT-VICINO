-- Eliminar la cuenta de un admin o moderador fallaba a la mitad.
--
-- Reporte de Pedro (27-sep-2026): "Datos eliminados, pero fallo la baja en
-- autenticacion. Contacta a soporte." Log de Auth de esa ejecucion:
--   DELETE /admin/users/<id> 500 "ERROR: audit_log is immutable
--   (compliance MX 5 anios). row id: ... (SQLSTATE P0001)"
--
-- Causa: audit_log.actor_id tenia FK a auth.users con ON DELETE SET NULL, y
-- audit_log es inmutable (trg_audit_log_no_update, 20260429120004). Al borrar
-- el usuario de Auth, Postgres intenta el SET NULL, que es un UPDATE; el
-- trigger lo aborta y el borrado de Auth se revierte. delete_user_data ya
-- habia borrado los datos antes, asi que la cuenta queda a medias: sin perfil
-- pero con sesiones vivas. Le pasa a cualquier cuenta que haya dejado una fila
-- en audit_log (moderacion, verificaciones), no por ser admin en si.
--
-- Arreglo: quitar la FK. actor_id queda como el UUID historico de quien hizo
-- la accion, inmutable, que es justo lo que pide conservar el registro de
-- cumplimiento: con SET NULL se habria perdido quien hizo cada accion. Se
-- conserva el indice idx_audit_log_actor_id. La app solo INSERTa en audit_log
-- y no hace embedding por esta relacion (verificado con grep en apps/web).
--
-- No se toca el trigger de inmutabilidad. Idempotente.

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_actor_id_fkey;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audit_log'::regclass
      AND contype = 'f'
      AND confrelid = 'auth.users'::regclass
  ) THEN
    RAISE EXCEPTION 'audit_log sigue con FK hacia auth.users';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.audit_log'::regclass
      AND tgname = 'trg_audit_log_no_update'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'falta el trigger de inmutabilidad de audit_log';
  END IF;
END
$verify$;
