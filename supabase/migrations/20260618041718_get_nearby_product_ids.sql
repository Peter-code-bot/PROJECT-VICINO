-- Migración: get_nearby_product_ids
-- Propósito: RPC que devuelve únicamente los UUIDs de los productos cercanos al usuario.

CREATE OR REPLACE FUNCTION get_nearby_product_ids(
  user_lat FLOAT,
  user_lng FLOAT,
  radius_meters INT DEFAULT 25000
) RETURNS TABLE(id UUID) AS $$
  WITH snapped AS (
    SELECT
      ROUND(user_lat::numeric, 3)::FLOAT AS s_lat,
      ROUND(user_lng::numeric, 3)::FLOAT AS s_lng,
      LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000) AS s_radius
  )
  SELECT ps.id
  FROM products_services ps
  CROSS JOIN snapped s
  WHERE ps.estatus = 'disponible'
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(
          ps.ubicacion_geo,
          ST_MakePoint(s.s_lng, s.s_lat)::geography,
          s.s_radius
        );
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION get_nearby_product_ids(FLOAT, FLOAT, INT) TO anon, authenticated;
