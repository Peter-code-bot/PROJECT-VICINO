-- =============================================================================
-- VICINO Moderation: inmutabilidad de critical_reports + audit_log
-- Fase 5 / 5 — Hardening de compliance MX (5+ anios de retencion legal)
-- =============================================================================
--
-- Reemplaza la policy FOR ALL de critical_reports por 3 policies selectivas
-- (SELECT, INSERT, UPDATE) y agrega triggers BEFORE DELETE/UPDATE que
-- RAISE EXCEPTION. Tambien agrega defense-in-depth append-only en audit_log.
--
-- Justificacion: las policies RLS no protegen contra service_role / superuser
-- (BYPASSRLS). Los triggers SI protegen — incluso un admin con conexion
-- directa a la DB no puede borrar evidencia legal.
--
-- Efecto colateral intencional: reports con critical_report asociado tampoco
-- se pueden DELETE (el ON DELETE CASCADE intenta borrar critical_reports →
-- trigger RAISE EXCEPTION → toda la transaccion rollback). El report mismo
-- es evidencia legal.
-- =============================================================================

-- ────────────────────────────────────────────────────────────────────
-- PARTE 1 — critical_reports: replace FOR ALL policy + add triggers
-- ────────────────────────────────────────────────────────────────────

-- 1.1 Reemplazar policy FOR ALL por 3 policies selectivas
DROP POLICY IF EXISTS "admins_only_critical_reports" ON public.critical_reports;

CREATE POLICY "admins_select_critical_reports"
  ON public.critical_reports FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins_insert_critical_reports"
  ON public.critical_reports FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- UPDATE permitido para registrar la denuncia (folio + notes), pero los
-- campos inmutables se protegen con trigger mas abajo.
CREATE POLICY "admins_update_critical_reports"
  ON public.critical_reports FOR UPDATE
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- NO existe policy DELETE: RLS deny-by-default protege contra DELETE de
-- usuarios authenticated. El trigger BEFORE DELETE de abajo es defense-in-
-- depth contra service_role / superuser que tienen BYPASSRLS.

-- 1.2 Trigger BEFORE UPDATE: campos inmutables del audit trail
CREATE OR REPLACE FUNCTION protect_critical_reports_audit_trail()
RETURNS TRIGGER AS $$
BEGIN
  -- id, report_id, created_at: jamas se pueden modificar
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'critical_reports.id is immutable (compliance MX 5 anios)';
  END IF;

  IF NEW.report_id <> OLD.report_id THEN
    RAISE EXCEPTION 'critical_reports.report_id is immutable (compliance MX 5 anios)';
  END IF;

  IF NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'critical_reports.created_at is immutable (compliance MX 5 anios)';
  END IF;

  -- authority_notified_at + reference: una vez seteados, no se pueden cambiar
  IF OLD.authority_notified_at IS NOT NULL
     AND NEW.authority_notified_at IS DISTINCT FROM OLD.authority_notified_at
  THEN
    RAISE EXCEPTION 'authority_notified_at is immutable once recorded (compliance MX 5 anios)';
  END IF;

  IF OLD.authority_notification_reference IS NOT NULL
     AND NEW.authority_notification_reference IS DISTINCT FROM OLD.authority_notification_reference
  THEN
    RAISE EXCEPTION 'authority_notification_reference is immutable once recorded (compliance MX 5 anios)';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_critical_reports_immutable
  BEFORE UPDATE ON public.critical_reports
  FOR EACH ROW EXECUTE FUNCTION protect_critical_reports_audit_trail();

-- 1.3 Trigger BEFORE DELETE: bloqueo total
-- Se dispara tambien ante CASCADE desde reports (deseado — el report con
-- critical tambien es evidencia legal).
CREATE OR REPLACE FUNCTION block_critical_reports_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'critical_reports cannot be deleted (compliance MX 5 anios). report_id: %, created_at: %', OLD.report_id, OLD.created_at;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_critical_reports_no_delete
  BEFORE DELETE ON public.critical_reports
  FOR EACH ROW EXECUTE FUNCTION block_critical_reports_delete();

-- ────────────────────────────────────────────────────────────────────
-- PARTE 2 — audit_log: defense-in-depth append-only
-- ────────────────────────────────────────────────────────────────────
-- audit_log ya tiene RLS habilitada con solo SELECT + INSERT policies
-- (deny-by-default para DELETE/UPDATE de authenticated). Estos triggers
-- protegen tambien contra service_role / superuser con BYPASSRLS.

CREATE OR REPLACE FUNCTION block_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log is append-only (compliance MX 5 anios). actor_id: %, action: %, created_at: %', OLD.actor_id, OLD.action, OLD.created_at;
  ELSIF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log is immutable (compliance MX 5 anios). row id: %', OLD.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_log_no_delete
  BEFORE DELETE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION block_audit_log_mutation();

CREATE TRIGGER trg_audit_log_no_update
  BEFORE UPDATE ON public.audit_log
  FOR EACH ROW EXECUTE FUNCTION block_audit_log_mutation();

-- =============================================================================
-- Comentarios
-- =============================================================================
COMMENT ON FUNCTION protect_critical_reports_audit_trail() IS 'BEFORE UPDATE trigger fn: bloquea cambio de id/report_id/created_at, y bloquea cambio retroactivo de authority_notified_at + reference una vez seteados. Compliance MX 5+ anios.';
COMMENT ON FUNCTION block_critical_reports_delete() IS 'BEFORE DELETE trigger fn: bloquea TODO DELETE en critical_reports (incluye CASCADE desde reports). Compliance MX 5+ anios.';
COMMENT ON FUNCTION block_audit_log_mutation() IS 'BEFORE DELETE/UPDATE trigger fn: hace audit_log estrictamente append-only, defense-in-depth contra service_role BYPASSRLS. Compliance MX 5+ anios.';
