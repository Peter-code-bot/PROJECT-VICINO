-- Reversion de 20261102120100_neutralizar_ventas_de_prueba. Se corre a mano,
-- ANTES de revertir 20261102120000 (estas funciones leen cuentas_internas).
--
-- Devuelve las cinco funciones a su definicion de produccion del 2-nov-2026
-- (sync_reviews_visibility vuelve a SECURITY INVOKER y sin search_path, como
-- estaba).
-- Los datos (puntos, ventas, calificaciones, resenas ocultas y filas de
-- seller_rankings borradas) vuelven con el restaurar-*.sql que genero
-- scripts/respaldo-cuentas-internas.mjs justo antes de aplicar.

begin;

CREATE OR REPLACE FUNCTION public.check_sale_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.buyer_confirmed = TRUE AND NEW.seller_confirmed = TRUE
     AND NEW.status = 'pending_confirmation'
     AND (OLD.buyer_confirmed = FALSE OR OLD.seller_confirmed = FALSE) THEN
    NEW.status := 'completed';
    NEW.completed_at := NOW();
    UPDATE profiles SET total_sales = total_sales + 1, trust_points = trust_points + 10
      WHERE id = NEW.seller_id;
    UPDATE profiles SET trust_points = trust_points + 3 WHERE id = NEW.buyer_id;
    UPDATE products_services SET ventas_count = ventas_count + NEW.cantidad
      WHERE id = NEW.product_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_user_rating_on_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE target uuid; points integer;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.reviewed_id ELSE NEW.reviewed_id END;
 UPDATE public.profiles SET average_rating=coalesce((SELECT avg(rating)::numeric(3,2) FROM public.reviews WHERE reviewed_id=target AND visible AND NOT is_hidden),0),
 reviews_count=(SELECT count(*) FROM public.reviews WHERE reviewed_id=target AND visible AND NOT is_hidden), updated_at=now() WHERE id=target;
 IF TG_OP='INSERT' AND NEW.origen='venta' AND EXISTS(SELECT 1 FROM public.sale_confirmations sc
   WHERE sc.id=NEW.sale_confirmation_id AND sc.status='completed' AND sc.product_id=NEW.product_id
    AND ((NEW.review_type='buyer_to_seller' AND sc.buyer_id=NEW.reviewer_id AND sc.seller_id=NEW.reviewed_id)
      OR (NEW.review_type='seller_to_buyer' AND sc.seller_id=NEW.reviewer_id AND sc.buyer_id=NEW.reviewed_id))) THEN
   points:=CASE NEW.rating WHEN 5 THEN 5 WHEN 4 THEN 3 WHEN 3 THEN 1 WHEN 1 THEN -2 ELSE 0 END;
   UPDATE public.profiles SET trust_points=greatest(0,trust_points+points) WHERE id=NEW.reviewed_id;
   UPDATE public.profiles SET trust_points=trust_points+2 WHERE id=NEW.reviewer_id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.sync_reviews_visibility()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_hidden := NOT COALESCE(NEW.visible, TRUE);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.is_hidden IS DISTINCT FROM OLD.is_hidden THEN
      NEW.visible := NOT NEW.is_hidden;
    ELSIF NEW.visible IS DISTINCT FROM OLD.visible THEN
      NEW.is_hidden := NOT COALESCE(NEW.visible, TRUE);
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_sale_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'pending_confirmation' AND NEW.cancelled_by IS NOT NULL THEN
    IF NEW.cancelled_by = NEW.seller_id THEN
      UPDATE profiles SET trust_points = GREATEST(0, trust_points - 5) WHERE id = NEW.seller_id;
    ELSIF NEW.cancelled_by = NEW.buyer_id THEN
      UPDATE profiles SET trust_points = GREATEST(0, trust_points - 3) WHERE id = NEW.buyer_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

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

commit;
