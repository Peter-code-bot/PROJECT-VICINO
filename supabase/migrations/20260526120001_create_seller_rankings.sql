-- Hyperlocal seller rankings snapshots.
-- One row per (seller, category, YYYY-MM). Computed nightly by an Edge Function
-- ("recompute-rankings") and frozen the day after the period ends so historic
-- months become immutable evidence of past standings.
--
-- NOT applied automatically. Javier applies manually:
--   npx supabase db diff      # review
--   npx supabase db push      # apply

CREATE TABLE seller_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period TEXT NOT NULL,

  composite_score NUMERIC(7,2) NOT NULL,

  -- Auditable raw inputs
  ventas_count INTEGER NOT NULL DEFAULT 0,
  ingresos_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  rating_avg NUMERIC(3,2),
  response_time_avg_minutes INTEGER,
  trust_points_snapshot INTEGER NOT NULL DEFAULT 0,

  -- Normalized sub-scores (0..1) used in the composite formula
  score_ventas NUMERIC(5,4),
  score_ingresos NUMERIC(5,4),
  score_rating NUMERIC(5,4),
  score_response NUMERIC(5,4),
  score_trust NUMERIC(5,4),

  is_frozen BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT seller_rankings_unique UNIQUE (seller_id, category_id, period),
  CONSTRAINT seller_rankings_period_format CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT seller_rankings_score_range CHECK (composite_score >= 0 AND composite_score <= 1000),
  CONSTRAINT seller_rankings_ventas_nonneg CHECK (ventas_count >= 0),
  CONSTRAINT seller_rankings_ingresos_nonneg CHECK (ingresos_total >= 0)
);

CREATE INDEX idx_seller_rankings_category_period_score
  ON seller_rankings (category_id, period, composite_score DESC);

CREATE INDEX idx_seller_rankings_seller_period
  ON seller_rankings (seller_id, period DESC);

CREATE INDEX idx_seller_rankings_period
  ON seller_rankings (period DESC);

-- Immutability trigger: once a row is frozen it must never be mutated again.
-- The compute functions write `is_frozen = FALSE` for the in-progress month and
-- only flip it to TRUE on the first run after the period ends.
CREATE OR REPLACE FUNCTION prevent_frozen_seller_rankings_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_frozen = TRUE THEN
    RAISE EXCEPTION 'seller_rankings row is frozen and cannot be modified (seller_id=%, category_id=%, period=%)',
      OLD.seller_id, OLD.category_id, OLD.period;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seller_rankings_prevent_frozen_update
  BEFORE UPDATE ON seller_rankings
  FOR EACH ROW EXECUTE FUNCTION prevent_frozen_seller_rankings_update();

-- Block deletes of frozen rows too — they are the historical record.
CREATE OR REPLACE FUNCTION prevent_frozen_seller_rankings_delete()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_frozen = TRUE THEN
    RAISE EXCEPTION 'seller_rankings row is frozen and cannot be deleted (seller_id=%, category_id=%, period=%)',
      OLD.seller_id, OLD.category_id, OLD.period;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seller_rankings_prevent_frozen_delete
  BEFORE DELETE ON seller_rankings
  FOR EACH ROW EXECUTE FUNCTION prevent_frozen_seller_rankings_delete();

-- RLS: rankings are public reads, writes belong to service_role (the cron).
ALTER TABLE seller_rankings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rankings are publicly readable"
  ON seller_rankings FOR SELECT
  TO authenticated, anon
  USING (TRUE);

-- No INSERT/UPDATE/DELETE policies are declared, so authenticated users cannot
-- write to this table. The Edge Function uses service_role which bypasses RLS.

COMMENT ON TABLE seller_rankings IS
  'Monthly snapshot of seller composite scores per category. Frozen rows are immutable historic records.';
COMMENT ON COLUMN seller_rankings.period IS 'YYYY-MM in America/Mexico_City local time.';
COMMENT ON COLUMN seller_rankings.composite_score IS 'Weighted score scaled to 0..1000. Higher is better.';
COMMENT ON COLUMN seller_rankings.is_frozen IS 'TRUE after the period has ended and the final pass has run. Frozen rows cannot be updated or deleted.';
