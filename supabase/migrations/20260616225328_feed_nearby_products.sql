-- Migración: feed_nearby_products
-- Propósito: RPC para el feed principal filtrado por geo, retornando la misma shape que el embed actual.
-- Notas de seguridad: SECURITY DEFINER con search_path = public.

CREATE OR REPLACE FUNCTION feed_nearby_products(
  user_lat      FLOAT,
  user_lng      FLOAT,
  radius_meters INT      DEFAULT 25000,
  cursor_time   TIMESTAMPTZ DEFAULT NULL,
  result_limit  INT      DEFAULT 150,
  seller_ids    UUID[]   DEFAULT NULL
)
RETURNS TABLE (
  id                UUID,
  titulo            TEXT,
  precio            NUMERIC,
  imagen_principal  TEXT,
  categoria         TEXT,
  slug              TEXT,
  created_at        TIMESTAMPTZ,
  precio_negociable BOOLEAN,
  profiles          JSONB,
  product_categories JSONB
) AS $$
  WITH snapped AS (
    SELECT
      ROUND(user_lat::numeric, 3)::FLOAT AS s_lat,
      ROUND(user_lng::numeric, 3)::FLOAT AS s_lng,
      LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000) AS s_radius
  )
  SELECT
    ps.id,
    ps.titulo,
    ps.precio,
    ps.imagen_principal,
    ps.categoria,
    ps.slug,
    ps.created_at,
    ps.precio_negociable,
    -- profiles embed: misma shape que supabase-js profiles!inner(...)
    jsonb_build_object(
      'nombre',         pr.nombre,
      'trust_level',    pr.trust_level::TEXT,
      'average_rating', pr.average_rating,
      'reviews_count',  pr.reviews_count
    ) AS profiles,
    -- product_categories embed: misma shape que supabase-js
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'is_primary', pc.is_primary,
          'categories', jsonb_build_object(
            'slug',   c.slug,
            'nombre', c.nombre
          )
        )
      )
      FROM product_categories pc
      JOIN categories c ON c.id = pc.categoria_id
      WHERE pc.product_id = ps.id),
      '[]'::jsonb
    ) AS product_categories
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
    AND (cursor_time IS NULL OR ps.created_at < cursor_time)
    AND (seller_ids IS NULL OR ps.creador_id = ANY(seller_ids))
  ORDER BY ps.created_at DESC
  LIMIT LEAST(GREATEST(result_limit, 1), 300);
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION feed_nearby_products(FLOAT, FLOAT, INT, TIMESTAMPTZ, INT, UUID[]) TO anon, authenticated;
