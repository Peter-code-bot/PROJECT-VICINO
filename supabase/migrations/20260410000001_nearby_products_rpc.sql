-- RPC: nearby_products
-- Retorna productos disponibles dentro de radius_meters del punto (user_lat, user_lng).
-- Usa ST_DWithin para filtrar con el GIST index (idx_products_location),
-- y el operador <-> en ORDER BY para nearest-neighbor sobre el resultado filtrado.
-- NUNCA usar <-> en WHERE — no utiliza el índice.

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
    ST_Distance(
      ps.ubicacion_geo,
      ST_MakePoint(user_lng, user_lat)::geography
    ) AS distance_meters,
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

-- Permitir llamadas desde el browser (anon key) y usuarios autenticados
GRANT EXECUTE ON FUNCTION nearby_products(FLOAT, FLOAT, INT, TEXT, INT) TO anon, authenticated;
