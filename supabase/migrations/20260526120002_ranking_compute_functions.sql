-- Functions that power /rankings.
--
-- recompute_seller_rankings_for_category : compute a single category's snapshot for a YYYY-MM
-- recompute_seller_rankings              : iterate the snapshot over all active categories
-- get_ranking_hiperlocal                 : hyperlocal read RPC consumed by the UI
-- get_available_ranking_periods          : list periods available in the snapshot table
--
-- Privacy: the read RPC mirrors the input snap + output bucket pattern from
-- nearby_products (20260515000001). Coordinates and ubicacion_geo never leave
-- the database in this function's RETURNS TABLE.

-- ============================================================================
-- recompute_seller_rankings_for_category
-- ============================================================================
CREATE OR REPLACE FUNCTION recompute_seller_rankings_for_category(
  p_category_id UUID,
  p_period TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_start_ts TIMESTAMPTZ;
  v_end_ts TIMESTAMPTZ;
  v_period_end_date DATE;
  v_should_freeze BOOLEAN;
  v_rows_affected INTEGER;
BEGIN
  IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid period format: % (expected YYYY-MM)', p_period;
  END IF;

  -- Period boundaries in America/Mexico_City local time. The cron tick runs in
  -- CDMX, so "month" follows local-month semantics, not UTC.
  v_start_ts := (p_period || '-01 00:00:00')::timestamp AT TIME ZONE 'America/Mexico_City';
  v_end_ts := v_start_ts + INTERVAL '1 month';
  v_period_end_date := (v_end_ts AT TIME ZONE 'America/Mexico_City')::date;

  -- Freeze flag flips to TRUE on the first pass after the period has ended.
  v_should_freeze := (NOW() AT TIME ZONE 'America/Mexico_City')::date >= v_period_end_date;

  WITH period_range AS (
    SELECT v_start_ts AS start_ts, v_end_ts AS end_ts
  ),
  ventas AS (
    SELECT
      sc.seller_id,
      COUNT(*)::INTEGER AS ventas_count,
      SUM(sc.precio_acordado * sc.cantidad)::NUMERIC(12,2) AS ingresos_total
    FROM sale_confirmations sc
    JOIN products_services ps ON ps.id = sc.product_id
    JOIN period_range pr ON TRUE
    WHERE sc.status = 'completed'
      AND sc.completed_at >= pr.start_ts
      AND sc.completed_at < pr.end_ts
      AND ps.categoria_id = p_category_id
    GROUP BY sc.seller_id
  ),
  ratings AS (
    SELECT
      r.reviewed_id AS seller_id,
      AVG(r.rating)::NUMERIC(3,2) AS rating_avg
    FROM reviews r
    JOIN period_range pr ON TRUE
    WHERE r.review_type = 'buyer_to_seller'
      AND r.visible = TRUE
      AND r.created_at >= pr.start_ts
      AND r.created_at < pr.end_ts
      AND r.reviewed_id IN (SELECT seller_id FROM ventas)
    GROUP BY r.reviewed_id
  ),
  first_response_per_chat AS (
    -- For each chat opened in the period where the seller participated, find
    -- the minutes between chat creation and the seller's first reply.
    SELECT
      c.vendedor_id AS seller_id,
      c.id AS chat_id,
      EXTRACT(EPOCH FROM (MIN(m.created_at) - c.created_at)) / 60.0 AS minutes_to_first
    FROM chats c
    JOIN messages m ON m.chat_id = c.id AND m.autor_id = c.vendedor_id
    JOIN period_range pr ON TRUE
    WHERE c.created_at >= pr.start_ts
      AND c.created_at < pr.end_ts
      AND c.vendedor_id IN (SELECT seller_id FROM ventas)
    GROUP BY c.vendedor_id, c.id, c.created_at
    HAVING MIN(m.created_at) >= c.created_at
  ),
  response AS (
    SELECT
      seller_id,
      AVG(minutes_to_first)::INTEGER AS response_time_avg_minutes
    FROM first_response_per_chat
    GROUP BY seller_id
  ),
  base AS (
    SELECT
      v.seller_id,
      v.ventas_count,
      v.ingresos_total,
      ra.rating_avg,
      rs.response_time_avg_minutes,
      p.trust_points AS trust_points_snapshot
    FROM ventas v
    JOIN profiles p ON p.id = v.seller_id
    LEFT JOIN ratings ra ON ra.seller_id = v.seller_id
    LEFT JOIN response rs ON rs.seller_id = v.seller_id
  ),
  normalized AS (
    SELECT
      seller_id,
      ventas_count,
      ingresos_total,
      rating_avg,
      response_time_avg_minutes,
      trust_points_snapshot,
      -- CUME_DIST (rank / N) instead of PERCENT_RANK ((rank-1)/(N-1)) so the
      -- highest seller always normalizes to 1.0 and a lone seller in a category
      -- is not punished with score 0.
      CUME_DIST() OVER (ORDER BY ventas_count) AS score_ventas,
      CUME_DIST() OVER (ORDER BY ingresos_total) AS score_ingresos,
      -- Rating: scaled 0..1. NULL (no reviews yet) maps to midpoint.
      COALESCE(rating_avg / 5.0, 0.6) AS score_rating,
      -- Response time: piecewise inverse. <=10min => 1.0, >=120min => 0.2.
      -- NULL (no qualifying chats) => 0.5.
      CASE
        WHEN response_time_avg_minutes IS NULL THEN 0.5
        WHEN response_time_avg_minutes <= 10 THEN 1.0
        WHEN response_time_avg_minutes >= 120 THEN 0.2
        ELSE 1.0 - ((response_time_avg_minutes - 10)::NUMERIC / 110.0) * 0.8
      END AS score_response,
      LEAST(trust_points_snapshot::NUMERIC / 1000.0, 1.0) AS score_trust
    FROM base
  )
  INSERT INTO seller_rankings (
    seller_id, category_id, period,
    composite_score,
    ventas_count, ingresos_total, rating_avg, response_time_avg_minutes, trust_points_snapshot,
    score_ventas, score_ingresos, score_rating, score_response, score_trust,
    is_frozen, computed_at
  )
  SELECT
    seller_id,
    p_category_id,
    p_period,
    ROUND(
      (score_ventas * 0.40
       + score_ingresos * 0.25
       + score_rating * 0.20
       + score_response * 0.10
       + score_trust * 0.05) * 1000,
      2
    ),
    ventas_count,
    ingresos_total,
    rating_avg,
    response_time_avg_minutes,
    trust_points_snapshot,
    ROUND(score_ventas, 4),
    ROUND(score_ingresos, 4),
    ROUND(score_rating, 4),
    ROUND(score_response, 4),
    ROUND(score_trust, 4),
    v_should_freeze,
    NOW()
  FROM normalized
  ON CONFLICT (seller_id, category_id, period) DO UPDATE
    SET composite_score = EXCLUDED.composite_score,
        ventas_count = EXCLUDED.ventas_count,
        ingresos_total = EXCLUDED.ingresos_total,
        rating_avg = EXCLUDED.rating_avg,
        response_time_avg_minutes = EXCLUDED.response_time_avg_minutes,
        trust_points_snapshot = EXCLUDED.trust_points_snapshot,
        score_ventas = EXCLUDED.score_ventas,
        score_ingresos = EXCLUDED.score_ingresos,
        score_rating = EXCLUDED.score_rating,
        score_response = EXCLUDED.score_response,
        score_trust = EXCLUDED.score_trust,
        is_frozen = EXCLUDED.is_frozen,
        computed_at = EXCLUDED.computed_at
    WHERE seller_rankings.is_frozen = FALSE;

  GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
  RETURN v_rows_affected;
END;
$$;

-- ============================================================================
-- recompute_seller_rankings — orchestrator over all active categories
-- ============================================================================
CREATE OR REPLACE FUNCTION recompute_seller_rankings(
  p_period TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_categories_processed INTEGER := 0;
  v_cat RECORD;
BEGIN
  IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid period format: % (expected YYYY-MM)', p_period;
  END IF;

  FOR v_cat IN
    SELECT id FROM categories WHERE activo = TRUE
  LOOP
    PERFORM recompute_seller_rankings_for_category(v_cat.id, p_period);
    v_categories_processed := v_categories_processed + 1;
  END LOOP;

  RETURN v_categories_processed;
END;
$$;

-- ============================================================================
-- get_ranking_hiperlocal — hyperlocal read RPC, SECURITY DEFINER so callers
-- never get direct read access to products_services.ubicacion_geo
-- ============================================================================
CREATE OR REPLACE FUNCTION get_ranking_hiperlocal(
  p_category_id UUID,
  p_period TEXT,
  p_user_lat DOUBLE PRECISION,
  p_user_lng DOUBLE PRECISION,
  p_radius_meters INTEGER DEFAULT 5000,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE (
  rank INTEGER,
  seller_id UUID,
  display_name TEXT,
  foto TEXT,
  composite_score NUMERIC,
  trust_points INTEGER,
  is_confiable BOOLEAN,
  distancia_aprox INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
BEGIN
  IF p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'Invalid period format: % (expected YYYY-MM)', p_period;
  END IF;
  IF p_radius_meters < 100 OR p_radius_meters > 50000 THEN
    RAISE EXCEPTION 'Invalid radius: % (must be 100..50000)', p_radius_meters;
  END IF;
  IF p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'Invalid limit: % (must be 1..100)', p_limit;
  END IF;
  IF p_user_lat IS NULL OR p_user_lng IS NULL THEN
    RAISE EXCEPTION 'user_lat and user_lng are required';
  END IF;

  RETURN QUERY
  WITH snapped AS (
    -- Same input snap as nearby_products (20260515000001): coords to 3 decimals
    -- (~100m grid at this latitude) and radius rounded up + 100m buffer to
    -- avoid false negatives at the boundary.
    SELECT
      ROUND(p_user_lat::numeric, 3)::DOUBLE PRECISION AS s_lat,
      ROUND(p_user_lng::numeric, 3)::DOUBLE PRECISION AS s_lng,
      (CEIL(p_radius_meters::FLOAT / 100) * 100 + 100)::INTEGER AS s_radius
  ),
  candidates AS (
    SELECT
      sr.seller_id,
      sr.composite_score,
      sr.ventas_count,
      sr.trust_points_snapshot,
      sr.computed_at,
      p.display_name,
      p.nombre,
      p.foto,
      p.trust_points,
      p.trust_level,
      latest.ubicacion_geo
    FROM seller_rankings sr
    JOIN profiles p ON p.id = sr.seller_id
    JOIN LATERAL (
      SELECT ps.ubicacion_geo
      FROM products_services ps
      WHERE ps.creador_id = sr.seller_id
        AND ps.categoria_id = sr.category_id
        AND ps.estatus = 'disponible'
        AND ps.ubicacion_geo IS NOT NULL
      ORDER BY ps.created_at DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE sr.category_id = p_category_id
      AND sr.period = p_period
  ),
  filtered AS (
    SELECT
      c.*,
      ST_Distance(
        c.ubicacion_geo,
        ST_MakePoint(s.s_lng, s.s_lat)::geography
      ) AS dist_m
    FROM candidates c
    CROSS JOIN snapped s
    WHERE ST_DWithin(
      c.ubicacion_geo,
      ST_MakePoint(s.s_lng, s.s_lat)::geography,
      s.s_radius
    )
  ),
  ranked AS (
    SELECT
      ROW_NUMBER() OVER (
        ORDER BY composite_score DESC,
                 ventas_count DESC,
                 trust_points_snapshot DESC,
                 computed_at ASC
      )::INTEGER AS rank,
      seller_id,
      COALESCE(NULLIF(display_name, ''), NULLIF(nombre, ''), 'Vendedor') AS display_name,
      foto,
      composite_score,
      trust_points,
      (trust_level IN ('confiable', 'estrella', 'elite')) AS is_confiable,
      -- Bucket the distance to 100m so probe sequences cannot triangulate
      (ROUND(dist_m / 100) * 100)::INTEGER AS distancia_aprox
    FROM filtered
  )
  SELECT
    r.rank,
    r.seller_id,
    r.display_name,
    r.foto,
    r.composite_score,
    r.trust_points,
    r.is_confiable,
    r.distancia_aprox
  FROM ranked r
  ORDER BY r.rank
  LIMIT p_limit;
END;
$$;

-- ============================================================================
-- get_available_ranking_periods — list periods present in the snapshot table
-- ============================================================================
CREATE OR REPLACE FUNCTION get_available_ranking_periods()
RETURNS TABLE (
  period TEXT,
  is_frozen BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
  SELECT
    sr.period,
    BOOL_AND(sr.is_frozen) AS is_frozen
  FROM seller_rankings sr
  GROUP BY sr.period
  ORDER BY sr.period DESC
  LIMIT 12;
$$;

-- ============================================================================
-- Grants
-- ============================================================================
GRANT EXECUTE ON FUNCTION recompute_seller_rankings_for_category(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION recompute_seller_rankings(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION get_ranking_hiperlocal(UUID, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_available_ranking_periods() TO anon, authenticated;
