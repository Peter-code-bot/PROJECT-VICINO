-- Monthly snapshot of seller rankings, computed per (seller, category, period).
-- Period format is 'YYYY-MM'. One row per seller per category per month.
--
-- Privacy: this table never stores user coordinates. Geo filtering happens at
-- read time via get_ranking_hiperlocal() which snaps inputs and buckets outputs.
--
-- Inmutability: once is_frozen = TRUE, the row cannot be UPDATEd (see trigger).
-- The recompute function uses ON CONFLICT ... WHERE is_frozen = FALSE so the
-- nightly job naturally skips frozen rows.
--
-- NOT applied automatically. Apply manually:
--   npx supabase db push

CREATE TABLE IF NOT EXISTS seller_rankings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id               UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id             UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  period                  TEXT NOT NULL,
  composite_score         NUMERIC(7,2) NOT NULL DEFAULT 0,
  ventas_count            INTEGER NOT NULL DEFAULT 0,
  ingresos                NUMERIC(12,2) NOT NULL DEFAULT 0,
  rating_avg              NUMERIC(3,2),
  response_avg_minutes    INTEGER,
  trust_points_snapshot   INTEGER NOT NULL DEFAULT 0,
  is_frozen               BOOLEAN NOT NULL DEFAULT FALSE,
  computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seller_rankings_period_format CHECK (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT seller_rankings_unique UNIQUE (seller_id, category_id, period)
);

CREATE INDEX IF NOT EXISTS idx_seller_rankings_category_period
  ON seller_rankings (category_id, period);
CREATE INDEX IF NOT EXISTS idx_seller_rankings_period
  ON seller_rankings (period);
CREATE INDEX IF NOT EXISTS idx_seller_rankings_seller
  ON seller_rankings (seller_id);

ALTER TABLE seller_rankings ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can SELECT. Rankings are public-facing.
DROP POLICY IF EXISTS "Rankings are publicly readable" ON seller_rankings;
CREATE POLICY "Rankings are publicly readable"
  ON seller_rankings
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- INSERT / UPDATE / DELETE: no policies for public roles, so only the service_role
-- bypass (used by the nightly Edge Function) can write. This is the same pattern
-- used in 20260320000002_profiles.sql for trust-managed fields.

-- Inmutability trigger: once is_frozen flips to TRUE, the row is read-only.
CREATE OR REPLACE FUNCTION prevent_frozen_update()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.is_frozen = TRUE THEN
    RAISE EXCEPTION 'seller_rankings row is frozen and cannot be modified (id=%)', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_frozen_update ON seller_rankings;
CREATE TRIGGER trg_prevent_frozen_update
  BEFORE UPDATE ON seller_rankings
  FOR EACH ROW
  EXECUTE FUNCTION prevent_frozen_update();

COMMENT ON TABLE seller_rankings IS
  'Monthly snapshot of seller ranking per category. Period is YYYY-MM. Rows with is_frozen=TRUE are immutable (trg_prevent_frozen_update).';
COMMENT ON COLUMN seller_rankings.composite_score IS
  '0..1000 weighted: ventas 40%, ingresos 25%, rating 20%, response_time 10%, trust 5%.';
COMMENT ON COLUMN seller_rankings.is_frozen IS
  'TRUE = row is the immutable historical record for that period. See follow-up freeze job.';
