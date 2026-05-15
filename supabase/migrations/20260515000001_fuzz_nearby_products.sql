-- Geo-privacy defense in depth for Bloque 4 of the Phase B security plan.
-- Replaces nearby_products so it (a) snaps the caller's user_lat / user_lng /
-- radius_meters inputs to a 100m grid before evaluating ST_DWithin — without
-- this, a caller can binary-search a known listing's distance by varying the
-- radius across calls and observing inclusion/exclusion — and (b) buckets the
-- returned distance_meters to the same 100m grid before returning.
--
-- The TS layer (apps/web/lib/geo/actions.ts) already snaps the inputs and
-- buckets the output. This migration mirrors both steps at the database so
-- the privacy boundary holds even if any future caller bypasses the TS path.
--
-- NOT applied automatically. Javier applies manually:
--   npx supabase db diff      # review
--   npx supabase db push      # apply

CREATE OR REPLACE FUNCTION nearby_products(
  user_lat        FLOAT,
  user_lng        FLOAT,
  radius_meters   INT     DEFAULT 5000,
  category_filter TEXT    DEFAULT NULL,
  result_limit    INT     DEFAULT 20
)
RETURNS TABLE (
  id               UUID,
  titulo           TEXT,
  slug             TEXT,
  precio           NUMERIC,
  imagen_principal TEXT,
  categoria        TEXT,
  tipo_entrega     TEXT,
  distance_meters  FLOAT,
  vendedor_nombre  TEXT,
  vendedor_trust   TEXT,
  vendedor_rating  NUMERIC,
  vendedor_reviews INT
) AS $$
  WITH snapped AS (
    SELECT
      ROUND(user_lat::numeric, 3)::FLOAT AS s_lat,
      ROUND(user_lng::numeric, 3)::FLOAT AS s_lng,
      (ROUND(radius_meters::FLOAT / 100) * 100)::INT AS s_radius
  )
  SELECT
    ps.id,
    ps.titulo,
    ps.slug,
    ps.precio,
    ps.imagen_principal,
    ps.categoria,
    ps.tipo_entrega::TEXT,
    -- Bucket to nearest 100m so a probe sequence cannot triangulate
    -- the listing's exact position.
    (ROUND(
      ST_Distance(
        ps.ubicacion_geo,
        ST_MakePoint(s.s_lng, s.s_lat)::geography
      ) / 100
    ) * 100)::FLOAT AS distance_meters,
    pr.nombre                     AS vendedor_nombre,
    pr.trust_level::TEXT          AS vendedor_trust,
    pr.average_rating_as_seller   AS vendedor_rating,
    pr.reviews_count_as_seller    AS vendedor_reviews
  FROM products_services ps
  CROSS JOIN snapped s
  JOIN profiles pr ON pr.id = ps.creador_id
  WHERE
    ps.estatus = 'disponible'
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(
          ps.ubicacion_geo,
          ST_MakePoint(s.s_lng, s.s_lat)::geography,
          s.s_radius
        )
    AND (category_filter IS NULL OR ps.categoria = category_filter)
  ORDER BY
    ps.ubicacion_geo <-> ST_MakePoint(s.s_lng, s.s_lat)::geography
  LIMIT result_limit;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION nearby_products(FLOAT, FLOAT, INT, TEXT, INT) TO anon, authenticated;
