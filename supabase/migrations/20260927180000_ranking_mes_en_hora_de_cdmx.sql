-- El mes del ranking se corta en hora de CDMX, no en UTC.
--
-- S08 H3 (confirmada el 27-sep-2026 en solo lectura en prod):
-- recompute_seller_rankings_for_category hacia `(p_period || '-01')::TIMESTAMPTZ`,
-- que usa la zona de la sesion; en prod es UTC. La UI y el cron usan CDMX, asi
-- que lo de las 18:00 a las 24:00 CDMX del ultimo dia del mes (ventas, resenas,
-- chats) contaba en el mes siguiente, y lo de las 00:00 a las 06:00 UTC del dia 1
-- en el anterior. Con AT TIME ZONE 'America/Mexico_City' el periodo 2026-09 va
-- de 2026-09-01 06:00+00 a 2026-10-01 06:00+00 (comprobado en prod).
--
-- Misma firma (uuid, text): CREATE OR REPLACE no crea sobrecarga y conserva el
-- ACL (solo service_role/postgres). El cuerpo es el de produccion del 27-sep con
-- SOLO esas dos lineas cambiadas.
--
-- Requisito: va con el arreglo H4 (la ruta del cron recalcula el mes anterior
-- los dias 1 y 2 de CDMX), que ya esta en master. Despues de aplicarla, correr
-- recompute_seller_rankings para el mes actual y el anterior.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.recompute_seller_rankings_for_category(p_category_id uuid, p_period text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_start_ts TIMESTAMPTZ;
  v_end_ts   TIMESTAMPTZ;
BEGIN
  IF p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format (expected YYYY-MM): %', p_period;
  END IF;

  -- Mes en hora de CDMX, no en la zona de la sesion (UTC en prod): H3, 27-sep.
  v_start_ts := (p_period || '-01')::timestamp AT TIME ZONE 'America/Mexico_City';
  v_end_ts   := ((p_period || '-01')::timestamp + INTERVAL '1 month') AT TIME ZONE 'America/Mexico_City';

  WITH
  sellers_in_category AS (
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
      AND r.is_hidden = FALSE
    GROUP BY r.reviewed_id
  ),
  per_chat_response AS (
    SELECT
      c.vendedor_id AS seller_id,
      EXTRACT(EPOCH FROM (MIN(m.created_at) - c.created_at)) / 60.0 AS minutes_to_first_reply
    FROM chats c
    JOIN messages m
      ON  m.chat_id      = c.id
      AND m.autor_id     = c.vendedor_id
      AND m.message_type = 'user_text'
      AND m.is_hidden    = FALSE
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
    seller_id, category_id, period, composite_score,
    ventas_count, ingresos, rating_avg, response_avg_minutes, trust_points_snapshot,
    computed_at
  )
  SELECT
    s.seller_id,
    p_category_id,
    p_period,
    ROUND(
      ((s.s_ventas    * 0.40
      + s.s_ingresos  * 0.25
      + s.s_rating    * 0.20
      + s.s_response  * 0.10
      + s.s_trust     * 0.05
       ) * 1000.0)::numeric
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
$function$;

REVOKE ALL ON FUNCTION public.recompute_seller_rankings_for_category(uuid, text) FROM PUBLIC, anon, authenticated;

DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
   WHERE p.proname = 'recompute_seller_rankings_for_category'
     AND pg_get_function_identity_arguments(p.oid) = 'p_category_id uuid, p_period text';
  IF v_def IS NULL OR position('America/Mexico_City' in v_def) = 0 THEN
    RAISE EXCEPTION 'recompute_seller_rankings_for_category no corta el mes en CDMX';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'recompute_seller_rankings_for_category') <> 1 THEN
    RAISE EXCEPTION 'hay sobrecargas de recompute_seller_rankings_for_category';
  END IF;
  IF has_function_privilege('anon', 'public.recompute_seller_rankings_for_category(uuid, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.recompute_seller_rankings_for_category(uuid, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'la funcion de recalculo quedo ejecutable por anon/authenticated';
  END IF;
END
$verify$;
