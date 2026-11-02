-- Las ventas de prueba dejan de contar como reputacion, contadores y ranking.
--
-- Requiere 20261102120000_cuentas_internas.sql.
--
-- Una venta es DE PRUEBA si alguna de sus dos puntas es una cuenta interna.
-- Estado en produccion el 1-nov-2026: todas las ventas completadas lo eran. El
-- vendedor era siempre la cuenta principal de Javier, y los compradores, sus
-- otras cuentas, la de Pedro y cuentas demo. Las de las cuentas demo son datos
-- SEMBRADOS: se insertaron ya completadas, con fecha anterior a que existiera
-- la cuenta compradora (por sus huellas, el seed de Villahermosa del 26-sep), y
-- por eso no pasaron por check_sale_completion.
--
-- Mismo caso que 20260826270000_limpiar_trust_points_sembrados: se recalcula
-- desde lo que SI tiene origen, con la tabla de puntos de las funciones vivas,
-- y se pone eso. Lo que se recalcula, para las cuentas afectadas (las
-- internas y las contrapartes de una venta de prueba):
--   trust_points    +10 por venta valida como vendedor, +3 como comprador,
--                   resena 5/4/3/2/1 -> +5/+3/+1/0/-2 al calificado y +2 a
--                   quien la escribe (solo de ventas validas), +30 si esta
--                   verificado CON una verificacion aprobada detras (casi todas
--                   las insignias de produccion son sembradas), -5/-3 por
--                   cancelar. No se resta lo que dio cada prueba: no se sabe si
--                   el disparador corrio (las 2 sembradas no lo hicieron). Se
--                   toma el MENOR entre lo que hay y lo recalculado.
--                   Neutralizar solo puede bajar.
--   total_sales     ventas validas completadas como vendedor (el menor).
--   ventas_count    unidades de ventas validas por publicacion (el menor).
--   calificaciones  average_rating, reviews_count y *_as_seller / *_as_buyer
--                   con las formulas exactas de los disparadores. Las cuentas
--                   sinteticas tienen conteos de resenas sin una sola resena
--                   detras, y esos disparadores solo corren cuando cambia una.
--   resenas         las atadas a una venta de prueba y las que escribio una
--                   cuenta interna pasan a is_hidden (los disparadores
--                   recalculan y sync_reviews_visibility baja visible).
--   seller_rankings se borran las filas no congeladas de cuentas internas y se
--                   recalculan los periodos afectados con la funcion nueva.
--
-- Y en adelante, para que la proxima prueba no lo vuelva a inflar:
--   check_sale_completion            completa la venta igual (el flujo se
--                                    tiene que poder probar en produccion),
--                                    pero sin sumar puntos ni contadores si
--                                    hay una cuenta interna en cualquier punta.
--   update_user_rating_on_review     no da puntos por resenas de esas ventas.
--   sync_reviews_visibility          la resena de una venta de prueba, o la
--                                    que escribe una cuenta interna, nace
--                                    oculta. Pasa a SECURITY DEFINER.
--   handle_sale_cancellation         cancelar una venta de prueba no resta.
--   recompute_seller_rankings_for_category
--                                    no cuenta ventas, resenas ni chats con
--                                    una cuenta interna, y borra las filas no
--                                    congeladas que ya no salen del calculo
--                                    (antes solo hacia upsert: una fila
--                                    sembrada vivia para siempre).
--
-- No borra ni modifica ninguna sale_confirmation: la historia queda, cambia lo
-- que se deriva de ella. Lo unico que se borra son filas de seller_rankings, que
-- son calculo. OJO al revertir: estas funciones leen cuentas_internas, asi que
-- se restauran ANTES de borrar esa tabla, o cada venta completada fallaria.
-- Reversion: docs/rollback/20261102120100_neutralizar_ventas_de_prueba_rollback.sql
-- Idempotente.

SET LOCAL lock_timeout = '5s';

-- 1. Resenas de ventas de prueba, o escritas por una cuenta interna, fuera.
UPDATE public.reviews r
   SET is_hidden = true
 WHERE NOT r.is_hidden
   AND (EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = r.reviewer_id)
     OR EXISTS (SELECT 1
                  FROM public.sale_confirmations s
                  JOIN public.cuentas_internas ci ON ci.user_id IN (s.seller_id, s.buyer_id)
                 WHERE s.id = r.sale_confirmation_id));

-- 2. Puntos y ventas de las cuentas afectadas. Va a una tabla temporal para
--    escribir puntos y ventas en dos UPDATE: auto_update_trust_level corre con
--    cualquier UPDATE OF trust_points, y solo debe correr donde los puntos de
--    verdad bajan (un nivel sembrado incoherente podria "subir" y mandar la
--    notificacion de subida).
DROP TABLE IF EXISTS pg_temp._reputacion_recalculada;
CREATE TEMP TABLE _reputacion_recalculada AS
WITH de_prueba AS (
  SELECT s.id, s.seller_id, s.buyer_id
    FROM public.sale_confirmations s
   WHERE EXISTS (SELECT 1 FROM public.cuentas_internas ci
                  WHERE ci.user_id IN (s.seller_id, s.buyer_id))
),
validas AS (
  SELECT s.*
    FROM public.sale_confirmations s
   WHERE NOT EXISTS (SELECT 1 FROM de_prueba d WHERE d.id = s.id)
),
afectadas AS (
  SELECT user_id AS id FROM public.cuentas_internas
  UNION SELECT seller_id FROM de_prueba
  UNION SELECT buyer_id  FROM de_prueba
),
-- Exactamente las condiciones con las que update_user_rating_on_review da puntos.
resenas_validas AS (
  SELECT r.reviewer_id, r.reviewed_id, r.rating
    FROM public.reviews r
    JOIN validas v ON v.id = r.sale_confirmation_id
   WHERE r.origen = 'venta'
     AND v.status = 'completed'
     AND v.product_id = r.product_id
     AND ((r.review_type = 'buyer_to_seller' AND v.buyer_id = r.reviewer_id AND v.seller_id = r.reviewed_id)
       OR (r.review_type = 'seller_to_buyer' AND v.seller_id = r.reviewer_id AND v.buyer_id = r.reviewed_id))
),
recalculo AS (
  SELECT a.id,
         (SELECT count(*) FROM validas v WHERE v.seller_id = a.id AND v.status = 'completed')::integer AS ventas,
         GREATEST(0,
             10 * (SELECT count(*) FROM validas v WHERE v.seller_id = a.id AND v.status = 'completed')
           +  3 * (SELECT count(*) FROM validas v WHERE v.buyer_id  = a.id AND v.status = 'completed')
           + COALESCE((SELECT sum(CASE rv.rating WHEN 5 THEN 5 WHEN 4 THEN 3 WHEN 3 THEN 1 WHEN 1 THEN -2 ELSE 0 END)
                         FROM resenas_validas rv WHERE rv.reviewed_id = a.id), 0)
           +  2 * (SELECT count(*) FROM resenas_validas rv WHERE rv.reviewer_id = a.id)
           -- La insignia sola no es origen: casi todos los is_verified de
           -- produccion vienen sembrados. Mismo criterio que 20260826270000.
           + CASE WHEN p.is_verified AND EXISTS (SELECT 1 FROM public.seller_verification sv
                                                  WHERE sv.user_id = a.id AND sv.status = 'approved')
                  THEN 30 ELSE 0 END
           -  5 * (SELECT count(*) FROM validas v
                    WHERE v.status = 'cancelled' AND v.cancelled_by = a.id AND v.seller_id = a.id)
           -  3 * (SELECT count(*) FROM validas v
                    WHERE v.status = 'cancelled' AND v.cancelled_by = a.id AND v.buyer_id = a.id)
         )::integer AS puntos
    FROM afectadas a
    JOIN public.profiles p ON p.id = a.id
)
SELECT id, ventas, puntos FROM recalculo;

UPDATE public.profiles p
   SET trust_points = r.puntos
  FROM _reputacion_recalculada r
 WHERE p.id = r.id
   AND p.trust_points > r.puntos;

UPDATE public.profiles p
   SET total_sales = r.ventas
  FROM _reputacion_recalculada r
 WHERE p.id = r.id
   AND p.total_sales > r.ventas;

DROP TABLE _reputacion_recalculada;

-- 3. Unidades vendidas de sus publicaciones y de las vendidas en una prueba.
WITH de_prueba AS (
  SELECT s.id, s.product_id
    FROM public.sale_confirmations s
   WHERE EXISTS (SELECT 1 FROM public.cuentas_internas ci
                  WHERE ci.user_id IN (s.seller_id, s.buyer_id))
),
recalculo AS (
  SELECT ps.id,
         COALESCE((SELECT sum(s.cantidad) FROM public.sale_confirmations s
                    WHERE s.product_id = ps.id AND s.status = 'completed'
                      AND NOT EXISTS (SELECT 1 FROM de_prueba d WHERE d.id = s.id)), 0)::integer AS vendidas
    FROM public.products_services ps
   WHERE EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = ps.creador_id)
      OR EXISTS (SELECT 1 FROM de_prueba d WHERE d.product_id = ps.id)
)
UPDATE public.products_services ps
   SET ventas_count = LEAST(ps.ventas_count, r.vendidas)
  FROM recalculo r
 WHERE ps.id = r.id
   AND ps.ventas_count > r.vendidas;

-- 4. Calificaciones de las cuentas afectadas, con las formulas de
--    update_user_rating_on_review y update_separated_ratings.
WITH afectadas AS (
  SELECT user_id AS id FROM public.cuentas_internas
  UNION
  SELECT unnest(ARRAY[s.seller_id, s.buyer_id])
    FROM public.sale_confirmations s
   WHERE EXISTS (SELECT 1 FROM public.cuentas_internas ci
                  WHERE ci.user_id IN (s.seller_id, s.buyer_id))
),
calc AS (
  SELECT a.id,
         COALESCE((SELECT avg(r.rating)::numeric(3,2) FROM public.reviews r
                    WHERE r.reviewed_id = a.id AND r.visible AND NOT r.is_hidden), 0) AS avg_all,
         (SELECT count(*) FROM public.reviews r
           WHERE r.reviewed_id = a.id AND r.visible AND NOT r.is_hidden)::integer AS n_all,
         COALESCE((SELECT avg(r.rating)::numeric(3,2) FROM public.reviews r
                    WHERE r.reviewed_id = a.id AND r.review_type = 'buyer_to_seller' AND r.visible AND NOT r.is_hidden), 0) AS avg_s,
         (SELECT count(*) FROM public.reviews r
           WHERE r.reviewed_id = a.id AND r.review_type = 'buyer_to_seller' AND r.visible AND NOT r.is_hidden)::integer AS n_s,
         COALESCE((SELECT avg(r.rating)::numeric(3,2) FROM public.reviews r
                    WHERE r.reviewed_id = a.id AND r.review_type = 'seller_to_buyer' AND r.visible AND NOT r.is_hidden), 0) AS avg_b,
         (SELECT count(*) FROM public.reviews r
           WHERE r.reviewed_id = a.id AND r.review_type = 'seller_to_buyer' AND r.visible AND NOT r.is_hidden)::integer AS n_b
    FROM afectadas a
)
UPDATE public.profiles p
   SET average_rating           = c.avg_all,
       reviews_count            = c.n_all,
       average_rating_as_seller = c.avg_s,
       reviews_count_as_seller  = c.n_s,
       average_rating_as_buyer  = c.avg_b,
       reviews_count_as_buyer   = c.n_b
  FROM calc c
 WHERE p.id = c.id
   AND (p.average_rating IS DISTINCT FROM c.avg_all
     OR p.reviews_count IS DISTINCT FROM c.n_all
     OR p.average_rating_as_seller IS DISTINCT FROM c.avg_s
     OR p.reviews_count_as_seller IS DISTINCT FROM c.n_s
     OR p.average_rating_as_buyer IS DISTINCT FROM c.avg_b
     OR p.reviews_count_as_buyer IS DISTINCT FROM c.n_b);

-- 5. En adelante: una venta con una cuenta interna se completa sin sumar.
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
    -- Una cuenta interna en cualquier punta = venta de prueba
    -- (20261102120100): se completa, pero no es reputacion ni prueba social.
    IF NOT EXISTS (SELECT 1 FROM public.cuentas_internas ci
                    WHERE ci.user_id IN (NEW.seller_id, NEW.buyer_id)) THEN
      UPDATE profiles SET total_sales = total_sales + 1, trust_points = trust_points + 10
        WHERE id = NEW.seller_id;
      UPDATE profiles SET trust_points = trust_points + 3 WHERE id = NEW.buyer_id;
      UPDATE products_services SET ventas_count = ventas_count + NEW.cantidad
        WHERE id = NEW.product_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Cancelar una venta de prueba tampoco cuesta: una persona real que cancela la
-- prueba que le abrio alguien del equipo no pierde 3 puntos.
CREATE OR REPLACE FUNCTION public.handle_sale_cancellation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status = 'pending_confirmation' AND NEW.cancelled_by IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.cuentas_internas ci
                      WHERE ci.user_id IN (NEW.seller_id, NEW.buyer_id)) THEN
    IF NEW.cancelled_by = NEW.seller_id THEN
      UPDATE profiles SET trust_points = GREATEST(0, trust_points - 5) WHERE id = NEW.seller_id;
    ELSIF NEW.cancelled_by = NEW.buyer_id THEN
      UPDATE profiles SET trust_points = GREATEST(0, trust_points - 3) WHERE id = NEW.buyer_id;
    END IF;
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
 -- Sin puntos por resenas de una venta de prueba (20261102120100).
 IF TG_OP='INSERT' AND NEW.origen='venta' AND EXISTS(SELECT 1 FROM public.sale_confirmations sc
   WHERE sc.id=NEW.sale_confirmation_id AND sc.status='completed' AND sc.product_id=NEW.product_id
    AND ((NEW.review_type='buyer_to_seller' AND sc.buyer_id=NEW.reviewer_id AND sc.seller_id=NEW.reviewed_id)
      OR (NEW.review_type='seller_to_buyer' AND sc.seller_id=NEW.reviewer_id AND sc.buyer_id=NEW.reviewed_id))
    AND NOT EXISTS(SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id IN (sc.seller_id, sc.buyer_id))) THEN
   points:=CASE NEW.rating WHEN 5 THEN 5 WHEN 4 THEN 3 WHEN 3 THEN 1 WHEN 1 THEN -2 ELSE 0 END;
   UPDATE public.profiles SET trust_points=greatest(0,trust_points+points) WHERE id=NEW.reviewed_id;
   UPDATE public.profiles SET trust_points=trust_points+2 WHERE id=NEW.reviewer_id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $function$;

-- La resena de una venta de prueba, o la que escribe una cuenta interna (venga
-- o no de una venta), nace oculta: si no, la proxima prueba de Javier volveria
-- a pintar "1 resena, 5 estrellas" en su tienda, y una resena del equipo o de
-- QA moveria la calificacion de un vendedor real. SECURITY DEFINER porque quien
-- resena (authenticated, o service_role en scripts) no puede leer
-- cuentas_internas, y service_role ni siquiera tiene USAGE sobre vicino_guard.
-- search_path vacio: todo va calificado.
CREATE OR REPLACE FUNCTION public.sync_reviews_visibility()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.is_hidden := NOT COALESCE(NEW.visible, TRUE);
    IF NOT NEW.is_hidden AND (
         EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = NEW.reviewer_id)
      OR (NEW.sale_confirmation_id IS NOT NULL AND EXISTS (
            SELECT 1
              FROM public.sale_confirmations s
              JOIN public.cuentas_internas ci ON ci.user_id IN (s.seller_id, s.buyer_id)
             WHERE s.id = NEW.sale_confirmation_id))) THEN
      NEW.is_hidden := TRUE;
      NEW.visible := FALSE;
    END IF;
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

  -- Lo que ya no sale del calculo se va (20261102120100). Antes solo habia
  -- upsert, y una fila sembrada o de una venta de prueba vivia para siempre.
  -- Las congeladas no se tocan.
  DELETE FROM seller_rankings sr
   WHERE sr.category_id = p_category_id
     AND sr.period      = p_period
     AND NOT sr.is_frozen
     AND NOT EXISTS (
       SELECT 1
         FROM sale_confirmations sc
         JOIN products_services ps ON ps.id = sc.product_id
        WHERE sc.seller_id = sr.seller_id
          AND sc.status = 'completed'
          AND sc.completed_at >= v_start_ts
          AND sc.completed_at <  v_end_ts
          AND ps.categoria_id = p_category_id
          AND NOT EXISTS (SELECT 1 FROM cuentas_internas ci
                           WHERE ci.user_id IN (sc.seller_id, sc.buyer_id))
     );

  WITH
  -- Ventas entre independientes: ninguna punta es una cuenta interna.
  ventas_validas AS (
    SELECT sc.seller_id, sc.precio_acordado
    FROM sale_confirmations sc
    JOIN products_services ps ON ps.id = sc.product_id
    WHERE sc.status = 'completed'
      AND sc.completed_at >= v_start_ts
      AND sc.completed_at <  v_end_ts
      AND ps.categoria_id = p_category_id
      AND NOT EXISTS (SELECT 1 FROM cuentas_internas ci
                       WHERE ci.user_id IN (sc.seller_id, sc.buyer_id))
  ),
  sellers_in_category AS (
    SELECT DISTINCT seller_id FROM ventas_validas
  ),
  ventas_stats AS (
    SELECT
      seller_id,
      COUNT(*)::INT                                   AS ventas_count,
      COALESCE(SUM(precio_acordado), 0)::NUMERIC(12,2) AS ingresos
    FROM ventas_validas
    GROUP BY seller_id
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
      AND NOT EXISTS (SELECT 1 FROM cuentas_internas ci WHERE ci.user_id = r.reviewer_id)
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
      AND NOT EXISTS (SELECT 1 FROM cuentas_internas ci WHERE ci.user_id = c.comprador_id)
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

-- 6. Rankings: fuera las cuentas internas (aunque esten en una categoria
--    inactiva, que recompute_seller_rankings no recorre) y se recalculan los
--    periodos que tienen filas o ventas completadas.
DELETE FROM public.seller_rankings sr
 WHERE NOT sr.is_frozen
   AND EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = sr.seller_id);

SELECT public.recompute_seller_rankings(x.period)
  FROM (
    SELECT period FROM public.seller_rankings
    UNION
    SELECT to_char(s.completed_at AT TIME ZONE 'America/Mexico_City', 'YYYY-MM')
      FROM public.sale_confirmations s
     WHERE s.status = 'completed' AND s.completed_at IS NOT NULL
  ) x
 ORDER BY x.period;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles p JOIN public.cuentas_internas ci ON ci.user_id = p.id
              WHERE p.total_sales > 0) THEN
    RAISE EXCEPTION 'quedan cuentas internas con ventas a su nombre';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p JOIN public.cuentas_internas ci ON ci.user_id = p.id
              WHERE p.trust_points > CASE WHEN p.is_verified AND EXISTS (
                                            SELECT 1 FROM public.seller_verification sv
                                             WHERE sv.user_id = p.id AND sv.status = 'approved')
                                          THEN 30 ELSE 0 END) THEN
    RAISE EXCEPTION 'quedan cuentas internas con puntos sin origen';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products_services ps
               JOIN public.cuentas_internas ci ON ci.user_id = ps.creador_id
              WHERE ps.ventas_count > 0) THEN
    RAISE EXCEPTION 'quedan publicaciones de cuentas internas con ventas';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reviews r
               JOIN public.sale_confirmations s ON s.id = r.sale_confirmation_id
              WHERE NOT r.is_hidden
                AND EXISTS (SELECT 1 FROM public.cuentas_internas ci
                             WHERE ci.user_id IN (s.seller_id, s.buyer_id))) THEN
    RAISE EXCEPTION 'quedan resenas visibles de ventas de prueba';
  END IF;
  IF EXISTS (SELECT 1 FROM public.seller_rankings sr
               JOIN public.cuentas_internas ci ON ci.user_id = sr.seller_id
              WHERE NOT sr.is_frozen) THEN
    RAISE EXCEPTION 'quedan cuentas internas en los rankings';
  END IF;
  IF position('cuentas_internas' IN pg_get_functiondef('public.check_sale_completion()'::regprocedure)) = 0
     OR position('cuentas_internas' IN pg_get_functiondef('public.update_user_rating_on_review()'::regprocedure)) = 0
     OR position('cuentas_internas' IN pg_get_functiondef('public.recompute_seller_rankings_for_category(uuid,text)'::regprocedure)) = 0
     OR position('cuentas_internas' IN pg_get_functiondef('public.sync_reviews_visibility()'::regprocedure)) = 0
     OR position('cuentas_internas' IN pg_get_functiondef('public.handle_sale_cancellation()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'alguna funcion sigue contando ventas de prueba';
  END IF;
  -- sync_reviews_visibility corre en cada resena: si no es DEFINER, authenticated
  -- y service_role no pueden leer cuentas_internas y TODA resena fallaria.
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = 'public.sync_reviews_visibility()'::regprocedure) THEN
    RAISE EXCEPTION 'sync_reviews_visibility tiene que ser SECURITY DEFINER';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reviews r
              WHERE NOT r.is_hidden
                AND EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = r.reviewer_id)) THEN
    RAISE EXCEPTION 'quedan resenas visibles escritas por cuentas internas';
  END IF;
END
$verify$;

-- VERIFY (a mano, solo lectura):
--   SELECT p.username, p.trust_points, p.total_sales, p.trust_level, p.reviews_count
--     FROM public.profiles p WHERE p.id = '7db68a49-2aa9-443a-a99c-3b654a43ec95';
--   -- antes 582 / 41 / estrella / 3; despues 30 / 0 / nuevo / 0. Los 30 son su
--   -- verificacion aprobada, que tiene reviewed_at NULL: approve_verification_atomic
--   -- nunca lo deja asi, asi que tambien podria ser sembrada.
--   SELECT count(*) FROM public.seller_rankings sr JOIN public.cuentas_internas ci ON ci.user_id = sr.seller_id;
--   -- despues 0
