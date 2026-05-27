-- Ranking compute + read functions.
--
-- recompute_seller_rankings_for_category(category, period):
--   Aggregates sale_confirmations / reviews / chat-response stats for the period,
--   normalizes via PERCENT_RANK inside the category, computes the composite
--   score, and upserts into seller_rankings. Skips frozen rows via ON CONFLICT
--   WHERE is_frozen = FALSE.
--
-- recompute_seller_rankings(period):
--   Orchestrator. Loops every active category and calls the per-category fn.
--   Returns the number of categories processed.
--
-- get_ranking_hiperlocal(...):
--   Read RPC for the /rankings page. Validates inputs, geo-filters via
--   ST_DWithin on the seller's latest available product in that category, and
--   buckets the returned distance to 100 m. NEVER returns lat / lng / geo.
--
-- get_available_ranking_periods():
--   Read RPC for the month-picker. Returns last 12 distinct periods.
--
-- Freezing: out of scope for this PR. The trigger prevent_frozen_update already
-- blocks accidental writes once is_frozen = TRUE, but no job flips that flag
-- automatically yet.
-- TODO: freeze del mes pasado via segundo cron (5 0 1 * *), follow-up PR.
--
-- NOT applied automatically. Apply manually:
--   npx supabase db push

-- ===========================================================================
-- 1) Per-category compute (SECURITY DEFINER, never exposed to clients)
-- ===========================================================================

CREATE OR REPLACE FUNCTION recompute_seller_rankings_for_category(
  p_category_id UUID,
  p_period      TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_start_ts TIMESTAMPTZ;
  v_end_ts   TIMESTAMPTZ;
BEGIN
  IF p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format (expected YYYY-MM): %', p_period;
  END IF;

  v_start_ts := (p_period || '-01')::TIMESTAMPTZ;
  v_end_ts   := v_start_ts + INTERVAL '1 month';

  WITH
  sellers_in_category AS (
    -- All sellers who had at least one completed sale of a product in this
    -- category during the period. JOIN to products_services filters by
    -- categoria_id (the UUID FK), so products without categoria_id are
    -- naturally excluded.
    SELECT DISTINCT sc.seller_id
    FROM sale_confirmations sc
    JOIN products_services ps ON ps.id = sc.product_id
    WHERE sc.status = 'completed'
      AND sc.completed_at >= v_start_ts
      AND sc.completed_at <  v_end_ts
      AND ps.categoria_id = p_category_id
  ),
  ventas_stats AS (
    SELECT
      sc.seller_id,
      COUNT(*)::INT                     AS ventas_count,
      COALESCE(SUM(sc.precio_acordado), 0)::NUMERIC(12,2) AS ingresos
    FROM sale_confirmations sc
    JOIN products_services ps ON ps.id = sc.product_id
    WHERE sc.status = 'completed'
      AND sc.completed_at >= v_start_ts
      AND sc.completed_at <  v_end_ts
      AND ps.categoria_id = p_category_id
    GROUP BY sc.seller_id
  ),
  rating_stats AS (
    SELECT
      r.reviewed_id AS seller_id,
      AVG(r.rating)::NUMERIC(3,2) AS rating_avg
    FROM reviews r
    WHERE r.review_type = 'buyer_to_seller'
      AND r.created_at >= v_start_ts
      AND r.created_at <  v_end_ts
      AND r.reviewed_id IN (SELECT seller_id FROM sellers_in_category)
    GROUP BY r.reviewed_id
  ),
  -- For each chat the seller is in, compute minutes between chat creation and
  -- the seller's first message in that chat. Then average per seller.
  per_chat_response AS (
    SELECT
      c.vendedor_id AS seller_id,
      EXTRACT(EPOCH FROM (MIN(m.created_at) - c.created_at)) / 60.0 AS minutes_to_first_reply
    FROM chats c
    JOIN messages m
      ON m.chat_id  = c.id
     AND m.autor_id = c.vendedor_id
    WHERE c.vendedor_id IN (SELECT seller_id FROM sellers_in_category)
      AND c.created_at >= v_start_ts
      AND c.created_at <  v_end_ts
    GROUP BY c.id, c.vendedor_id, c.created_at
  ),
  response_stats AS (
    SELECT
      seller_id,
      AVG(minutes_to_first_reply)::NUMERIC AS response_avg_minutes_raw
    FROM per_chat_response
    WHERE minutes_to_first_reply IS NOT NULL
      AND minutes_to_first_reply >= 0
    GROUP BY seller_id
  ),
  trust_stats AS (
    SELECT
      p.id           AS seller_id,
      p.trust_points AS trust_points_snapshot
    FROM profiles p
    WHERE p.id IN (SELECT seller_id FROM sellers_in_category)
  ),
  combined AS (
    SELECT
      sic.seller_id,
      COALESCE(vs.ventas_count, 0)               AS ventas_count,
      COALESCE(vs.ingresos, 0)::NUMERIC(12,2)    AS ingresos,
      rs.rating_avg,
      CASE
        WHEN resp.response_avg_minutes_raw IS NULL THEN NULL
        ELSE ROUND(resp.response_avg_minutes_raw)::INT
      END                                         AS response_avg_minutes,
      COALESCE(ts.trust_points_snapshot, 0)      AS trust_points_snapshot
    FROM sellers_in_category sic
    LEFT JOIN ventas_stats   vs   ON vs.seller_id   = sic.seller_id
    LEFT JOIN rating_stats   rs   ON rs.seller_id   = sic.seller_id
    LEFT JOIN response_stats resp ON resp.seller_id = sic.seller_id
    LEFT JOIN trust_stats    ts   ON ts.seller_id   = sic.seller_id
  ),
  ranked AS (
    SELECT
      c.*,
      PERCENT_RANK() OVER (ORDER BY c.ventas_count) AS s_ventas_raw,
      PERCENT_RANK() OVER (ORDER BY c.ingresos)    AS s_ingresos_raw
    FROM combined c
  ),
  scored AS (
    SELECT
      seller_id,
      ventas_count,
      ingresos,
      rating_avg,
      response_avg_minutes,
      trust_points_snapshot,
      -- Normalization sub-scores in [0, 1]
      s_ventas_raw                                                   AS s_ventas,
      s_ingresos_raw                                                 AS s_ingresos,
      (COALESCE(rating_avg, 3.0) / 5.0)                              AS s_rating,
      CASE
        WHEN response_avg_minutes IS NULL          THEN 0.5
        WHEN response_avg_minutes <= 10            THEN 1.0
        WHEN response_avg_minutes <= 30            THEN 0.85
        WHEN response_avg_minutes <= 60            THEN 0.7
        WHEN response_avg_minutes <= 180           THEN 0.55
        ELSE 0.4
      END                                                            AS s_response,
      LEAST(trust_points_snapshot / 1000.0, 1.0)                     AS s_trust
    FROM ranked
  )
  INSERT INTO seller_rankings (
    seller_id,
    category_id,
    period,
    composite_score,
    ventas_count,
    ingresos,
    rating_avg,
    response_avg_minutes,
    trust_points_snapshot,
    computed_at
  )
  SELECT
    s.seller_id,
    p_category_id,
    p_period,
    ROUND(
      (s.s_ventas    * 0.40
     + s.s_ingresos  * 0.25
     + s.s_rating    * 0.20
     + s.s_response  * 0.10
     + s.s_trust     * 0.05
      ) * 1000.0
    , 2)::NUMERIC(7,2)                       AS composite_score,
    s.ventas_count,
    s.ingresos,
    s.rating_avg,
    s.response_avg_minutes,
    s.trust_points_snapshot,
    NOW()
  FROM scored s
  ON CONFLICT (seller_id, category_id, period) DO UPDATE
  SET composite_score       = EXCLUDED.composite_score,
      ventas_count          = EXCLUDED.ventas_count,
      ingresos              = EXCLUDED.ingresos,
      rating_avg            = EXCLUDED.rating_avg,
      response_avg_minutes  = EXCLUDED.response_avg_minutes,
      trust_points_snapshot = EXCLUDED.trust_points_snapshot,
      computed_at           = EXCLUDED.computed_at
  WHERE seller_rankings.is_frozen = FALSE;
END;
$$;

REVOKE EXECUTE ON FUNCTION recompute_seller_rankings_for_category(UUID, TEXT) FROM PUBLIC;

-- ===========================================================================
-- 2) Orchestrator (called by the nightly Edge Function)
-- ===========================================================================

CREATE OR REPLACE FUNCTION recompute_seller_rankings(p_period TEXT)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat       RECORD;
  processed INT := 0;
BEGIN
  IF p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format (expected YYYY-MM): %', p_period;
  END IF;

  FOR cat IN
    SELECT id FROM categories WHERE activo = TRUE
  LOOP
    PERFORM recompute_seller_rankings_for_category(cat.id, p_period);
    processed := processed + 1;
  END LOOP;

  RETURN processed;
END;
$$;

REVOKE EXECUTE ON FUNCTION recompute_seller_rankings(TEXT) FROM PUBLIC;

-- ===========================================================================
-- 3) Read RPC for /rankings (authenticated callers, hyperlocal filter)
--    NEVER returns lat / lng / ubicacion_geo.
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_ranking_hiperlocal(
  p_category_id   UUID,
  p_period        TEXT,
  p_user_lat      DOUBLE PRECISION,
  p_user_lng      DOUBLE PRECISION,
  p_radius_meters INT DEFAULT 5000,
  p_limit         INT DEFAULT 10
)
RETURNS TABLE (
  rank             INT,
  seller_id        UUID,
  display_name     TEXT,
  foto             TEXT,
  composite_score  NUMERIC,
  trust_points     INT,
  is_confiable     BOOLEAN,
  distancia_aprox  INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format (expected YYYY-MM): %', p_period;
  END IF;
  IF p_radius_meters IS NULL OR p_radius_meters NOT BETWEEN 100 AND 50000 THEN
    RAISE EXCEPTION 'p_radius_meters must be between 100 and 50000';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;
  IF p_user_lat IS NULL OR ABS(p_user_lat) > 90 THEN
    RAISE EXCEPTION 'p_user_lat out of range';
  END IF;
  IF p_user_lng IS NULL OR ABS(p_user_lng) > 180 THEN
    RAISE EXCEPTION 'p_user_lng out of range';
  END IF;

  RETURN QUERY
  WITH
  user_point AS (
    -- Snap input to a 100m grid before evaluating ST_DWithin so a caller cannot
    -- binary-search exact seller positions by probing radii.
    SELECT
      ST_MakePoint(
        ROUND(p_user_lng::numeric, 3)::DOUBLE PRECISION,
        ROUND(p_user_lat::numeric, 3)::DOUBLE PRECISION
      )::geography AS geog,
      (CEIL(p_radius_meters::FLOAT / 100) * 100 + 100)::INT AS radius
  ),
  -- For each seller in the ranking, find their most recently published product
  -- in this category that has a known location. We never expose this product's
  -- coordinates outside the function.
  seller_latest_product AS (
    SELECT
      sr.seller_id,
      sr.composite_score,
      sr.ventas_count,
      sr.trust_points_snapshot,
      sr.computed_at,
      (
        SELECT ps.ubicacion_geo
        FROM products_services ps
        WHERE ps.creador_id    = sr.seller_id
          AND ps.categoria_id  = p_category_id
          AND ps.estatus       = 'disponible'
          AND ps.ubicacion_geo IS NOT NULL
        ORDER BY ps.created_at DESC
        LIMIT 1
      ) AS geog
    FROM seller_rankings sr
    WHERE sr.category_id = p_category_id
      AND sr.period      = p_period
  ),
  filtered AS (
    SELECT
      slp.seller_id,
      slp.composite_score,
      slp.ventas_count,
      slp.trust_points_snapshot,
      slp.computed_at,
      -- Output bucket to nearest 100m so probe sequences cannot triangulate.
      (FLOOR(ST_Distance(slp.geog, up.geog) / 100) * 100)::INT AS distancia_aprox
    FROM seller_latest_product slp
    CROSS JOIN user_point up
    WHERE slp.geog IS NOT NULL
      AND ST_DWithin(slp.geog, up.geog, up.radius)
  ),
  ordered AS (
    SELECT
      f.*,
      ROW_NUMBER() OVER (
        ORDER BY f.composite_score        DESC,
                 f.ventas_count           DESC,
                 f.trust_points_snapshot  DESC,
                 f.computed_at            ASC
      )::INT AS rank
    FROM filtered f
  )
  SELECT
    o.rank,
    o.seller_id,
    p.display_name,
    p.foto,
    o.composite_score,
    p.trust_points,
    (p.trust_level IN ('confiable', 'estrella', 'elite')) AS is_confiable,
    o.distancia_aprox
  FROM ordered o
  JOIN profiles p ON p.id = o.seller_id
  ORDER BY o.rank
  LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION get_ranking_hiperlocal(
  UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT, INT
) TO authenticated;

-- ===========================================================================
-- 4) Periods available for the month-picker
-- ===========================================================================

CREATE OR REPLACE FUNCTION get_available_ranking_periods()
RETURNS TABLE (
  period    TEXT,
  is_frozen BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT period, BOOL_AND(is_frozen) AS is_frozen
  FROM seller_rankings
  GROUP BY period
  ORDER BY period DESC
  LIMIT 12;
$$;

GRANT EXECUTE ON FUNCTION get_available_ranking_periods() TO authenticated;

COMMENT ON FUNCTION recompute_seller_rankings(TEXT) IS
  'Orchestrator: recomputes rankings for every active category for the given period (YYYY-MM). Called by the nightly Edge Function.';
COMMENT ON FUNCTION get_ranking_hiperlocal(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INT, INT) IS
  'Read RPC. Hyperlocal filter via ST_DWithin on the seller''s latest product geo. NEVER returns lat/lng/ubicacion_geo.';
