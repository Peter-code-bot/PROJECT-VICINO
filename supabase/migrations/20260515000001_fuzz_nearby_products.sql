-- Geo-privacy defense in depth for Bloque 4 of the Phase B security plan.
-- Replaces nearby_products so it buckets distance_meters to the nearest 100m
-- before returning. The TS layer (apps/web/lib/geo/fuzz.ts:fuzzDistance) also
-- buckets — if either path drifts in the future, the database still rounds.
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
  SELECT
    ps.id,
    ps.titulo,
    ps.slug,
    ps.precio,
    ps.imagen_principal,
    ps.categoria,
    ps.tipo_entrega::TEXT,
    -- Bucket to nearest 100m so a series of probe requests cannot
    -- triangulate the listing's exact position.
    (ROUND(
      ST_Distance(
        ps.ubicacion_geo,
        ST_MakePoint(user_lng, user_lat)::geography
      ) / 100
    ) * 100)::FLOAT AS distance_meters,
    pr.nombre                     AS vendedor_nombre,
    pr.trust_level::TEXT          AS vendedor_trust,
    pr.average_rating_as_seller   AS vendedor_rating,
    pr.reviews_count_as_seller    AS vendedor_reviews
  FROM products_services ps
  JOIN profiles pr ON pr.id = ps.creador_id
  WHERE
    ps.estatus = 'disponible'
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(
          ps.ubicacion_geo,
          ST_MakePoint(user_lng, user_lat)::geography,
          radius_meters
        )
    AND (category_filter IS NULL OR ps.categoria = category_filter)
  ORDER BY
    ps.ubicacion_geo <-> ST_MakePoint(user_lng, user_lat)::geography
  LIMIT result_limit;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION nearby_products(FLOAT, FLOAT, INT, TEXT, INT) TO anon, authenticated;
