-- Migración: search_nearby_products (V2.2)
-- Propósito: RPC unificado para búsqueda hiperlocal. 
-- Retorna un TABLE estructurado con JSONB embeds para profiles y product_categories.

DROP FUNCTION IF EXISTS search_nearby_products(FLOAT, FLOAT, INT, TEXT, UUID[]);

CREATE OR REPLACE FUNCTION search_nearby_products(
  user_lat FLOAT,
  user_lng FLOAT,
  radius_meters INT DEFAULT 25000,
  search_term TEXT DEFAULT NULL,
  seller_ids UUID[] DEFAULT NULL
) RETURNS TABLE (
  id UUID,
  titulo TEXT,
  precio NUMERIC,
  imagen_principal TEXT,
  categoria TEXT,
  slug TEXT,
  precio_negociable BOOLEAN,
  created_at TIMESTAMPTZ,
  ventas_count INT,
  tipo TEXT,
  profiles JSONB,
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
    ps.precio_negociable,
    ps.created_at,
    ps.ventas_count,
    ps.tipo,
    -- profiles embed
    jsonb_build_object(
      'nombre',         pr.nombre,
      'trust_level',    pr.trust_level::TEXT,
      'average_rating', pr.average_rating,
      'reviews_count',  pr.reviews_count
    ) AS profiles,
    -- product_categories embed
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
  WHERE ps.estatus = 'disponible'
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(
          ps.ubicacion_geo,
          ST_MakePoint(s.s_lng, s.s_lat)::geography,
          s.s_radius
        )
    AND (
      search_term IS NULL 
      OR trim(search_term) = '' 
      OR ps.titulo ILIKE '%' || search_term || '%' 
      OR ps.descripcion ILIKE '%' || search_term || '%'
      OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids))
    );
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION search_nearby_products(FLOAT, FLOAT, INT, TEXT, UUID[]) TO anon, authenticated;
