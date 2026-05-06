-- =============================================================================
-- VICINO Moderation: reports + user_blocks + is_hidden columns + auto-hide
-- Fase 1 / 4 de implementación de moderación para Google Play Store
-- =============================================================================

-- 1. Enums --------------------------------------------------------------------

CREATE TYPE report_target_type AS ENUM ('listing', 'user', 'message', 'review');

CREATE TYPE report_status AS ENUM ('pending', 'reviewed', 'resolved', 'dismissed');

CREATE TYPE report_reason AS ENUM (
  'spam',
  'inappropriate_content',
  'fraud_or_scam',
  'harassment',
  'fake_profile',
  'illegal_product',
  'copyright_violation',
  'child_safety',
  'other'
);

-- 2. Tabla reports ------------------------------------------------------------

CREATE TABLE public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  target_type report_target_type NOT NULL,
  target_id UUID NOT NULL,
  reason report_reason NOT NULL,
  description TEXT,
  status report_status NOT NULL DEFAULT 'pending',
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  resolution_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Bloquea que el mismo usuario reporte 2x el mismo target
  CONSTRAINT reports_reporter_target_unique UNIQUE (reporter_id, target_type, target_id),

  -- Bloquea self-report
  CONSTRAINT reports_no_self_user_target CHECK (
    target_type <> 'user' OR target_id <> reporter_id
  )
);

CREATE INDEX idx_reports_target ON public.reports(target_type, target_id);
CREATE INDEX idx_reports_status_pending ON public.reports(status) WHERE status = 'pending';
CREATE INDEX idx_reports_reporter ON public.reports(reporter_id);
CREATE INDEX idx_reports_created ON public.reports(created_at DESC);

CREATE TRIGGER reports_updated_at
  BEFORE UPDATE ON public.reports
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

-- 3. Tabla user_blocks --------------------------------------------------------

CREATE TABLE public.user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT user_blocks_unique_pair UNIQUE (blocker_id, blocked_id),
  CONSTRAINT user_blocks_no_self CHECK (blocker_id <> blocked_id)
);

-- Índices necesarios para que la RLS bidireccional sea performante
CREATE INDEX idx_user_blocks_pair_lookup ON public.user_blocks (blocker_id, blocked_id);
CREATE INDEX idx_user_blocks_reverse_lookup ON public.user_blocks (blocked_id, blocker_id);

-- 4. Agregar is_hidden a las tablas de UGC ------------------------------------

ALTER TABLE public.products_services
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT FALSE;

-- Sync inicial de reviews: is_hidden = NOT visible
UPDATE public.reviews
   SET is_hidden = NOT visible
 WHERE is_hidden IS DISTINCT FROM (NOT visible);

-- Trigger que mantiene reviews.visible y reviews.is_hidden sincronizados.
-- Razón: existe código legacy que lee `visible` (admin actual + recálculo de
-- ratings) y código nuevo que leerá `is_hidden`. Eliminamos `visible` en una
-- migración futura tras 2 releases (ver docs/moderation-setup.md).
CREATE OR REPLACE FUNCTION sync_reviews_visibility()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_hidden := NOT NEW.visible;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
      NEW.visible := NOT NEW.is_hidden;
    ELSIF NEW.visible IS DISTINCT FROM OLD.visible THEN
      NEW.is_hidden := NOT NEW.visible;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reviews_sync_visibility
  BEFORE INSERT OR UPDATE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION sync_reviews_visibility();

-- Índices parciales para listados rápidos de no-ocultos
CREATE INDEX IF NOT EXISTS idx_products_services_hidden
  ON public.products_services(is_hidden) WHERE is_hidden = FALSE;

CREATE INDEX IF NOT EXISTS idx_reviews_hidden
  ON public.reviews(is_hidden) WHERE is_hidden = FALSE;

CREATE INDEX IF NOT EXISTS idx_messages_hidden
  ON public.messages(is_hidden) WHERE is_hidden = FALSE;

CREATE INDEX IF NOT EXISTS idx_profiles_hidden
  ON public.profiles(is_hidden) WHERE is_hidden = FALSE;

-- 5. View de conteo de reportes activos --------------------------------------

CREATE OR REPLACE VIEW public.v_active_reports_count AS
SELECT
  target_type,
  target_id,
  COUNT(*)::INT AS report_count
FROM public.reports
WHERE status IN ('pending', 'reviewed')
GROUP BY target_type, target_id;

-- 6. Auto-hide cuando un target acumula 3+ reportes activos -------------------
-- Solo aplica a 'listing' y 'review'. 'user' y 'message' requieren acción
-- manual del admin (excepto child_safety, que se maneja en migración 4).

CREATE OR REPLACE FUNCTION auto_hide_on_threshold()
RETURNS TRIGGER AS $$
DECLARE
  cnt INT;
BEGIN
  -- CSAM tiene su propio trigger (migración 4), aquí no lo manejamos
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
      -- el trigger sync_reviews_visibility actualiza visible automáticamente
    END IF;
    -- 'user' y 'message': admin manual (riesgo de abuso > beneficio)
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_reports_auto_hide
  AFTER INSERT ON public.reports
  FOR EACH ROW EXECUTE FUNCTION auto_hide_on_threshold();

-- =============================================================================
-- Comentarios para grep futuro
-- =============================================================================
COMMENT ON TABLE public.reports IS 'Reportes de contenido user-generated. Cumplimiento Google Play Store. Ver docs/moderation-setup.md';
COMMENT ON TABLE public.user_blocks IS 'Bloqueos bidireccionales entre usuarios. Filtrado vía RLS, no en queries de cliente.';
COMMENT ON COLUMN public.reviews.visible IS 'DEPRECATED: usar is_hidden. Sincronizado vía trigger trg_reviews_sync_visibility. Eliminar en 2 releases.';
COMMENT ON COLUMN public.reviews.reportada IS 'DEPRECATED: ahora se usa public.reports con target_type=review. Eliminar en 2 releases.';
COMMENT ON COLUMN public.reviews.motivo_reporte IS 'DEPRECATED: ahora se usa public.reports.description. Eliminar en 2 releases.';
