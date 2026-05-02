-- =============================================================================
-- VICINO Moderation: CSAM (child_safety) — auto-hide inmediato + audit trail legal
-- Fase 4 / 4 — Cumplimiento de obligaciones legales mexicanas
-- =============================================================================
--
-- Cualquier reporte con reason='child_safety' dispara:
--   1. Auto-hide inmediato del target (los 4 tipos: listing, user, message, review)
--   2. Inserción en critical_reports para audit trail
--   3. Email URGENTE al admin (manejado por el webhook handler en /api/admin/report-webhook)
--
-- La prioridad legal (denuncia ante Policía Cibernética / FGR) supera el
-- riesgo de abuso de auto-hide en 'user' y 'message'.
-- Ver T&C sección 14 + Aviso de Privacidad sección 8.
-- =============================================================================

-- 1. Tabla critical_reports ---------------------------------------------------

CREATE TABLE public.critical_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id UUID NOT NULL REFERENCES public.reports(id) ON DELETE CASCADE,
  authority_notified_at TIMESTAMPTZ,
  authority_notification_reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Un report no puede tener más de un critical_report
  CONSTRAINT critical_reports_report_unique UNIQUE (report_id)
);

CREATE INDEX idx_critical_reports_pending
  ON public.critical_reports(authority_notified_at)
  WHERE authority_notified_at IS NULL;

CREATE INDEX idx_critical_reports_created
  ON public.critical_reports(created_at DESC);

CREATE TRIGGER critical_reports_updated_at
  BEFORE UPDATE ON public.critical_reports
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 2. RLS: solo admins pueden ver/manejar critical_reports --------------------

ALTER TABLE public.critical_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_only_critical_reports"
  ON public.critical_reports FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. Trigger CSAM: auto-hide inmediato + insert critical_report ---------------

CREATE OR REPLACE FUNCTION handle_child_safety_report()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reason <> 'child_safety'::report_reason THEN
    RETURN NEW;
  END IF;

  -- Auto-hide INMEDIATO del target (los 4 tipos)
  IF NEW.target_type = 'listing'::report_target_type THEN
    UPDATE public.products_services
       SET is_hidden = TRUE
     WHERE id = NEW.target_id;

  ELSIF NEW.target_type = 'review'::report_target_type THEN
    UPDATE public.reviews
       SET is_hidden = TRUE
     WHERE id = NEW.target_id;
    -- el trigger sync_reviews_visibility actualiza visible automáticamente

  ELSIF NEW.target_type = 'user'::report_target_type THEN
    UPDATE public.profiles
       SET is_hidden = TRUE
     WHERE id = NEW.target_id;

  ELSIF NEW.target_type = 'message'::report_target_type THEN
    UPDATE public.messages
       SET is_hidden = TRUE
     WHERE id = NEW.target_id;
  END IF;

  -- Audit trail legal: una entrada por reporte
  INSERT INTO public.critical_reports (report_id)
  VALUES (NEW.id)
  ON CONFLICT (report_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_reports_child_safety
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION handle_child_safety_report();

-- =============================================================================
COMMENT ON TABLE public.critical_reports IS 'Audit trail legal para reportes child_safety. Admin debe denunciar a Policía Cibernética/FGR y registrar authority_notified_at.';
COMMENT ON COLUMN public.critical_reports.authority_notified_at IS 'Timestamp de cuando se presentó la denuncia ante autoridad mexicana competente.';
COMMENT ON COLUMN public.critical_reports.authority_notification_reference IS 'Folio/expediente entregado por la autoridad.';
