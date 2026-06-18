-- Migración: search_nearby_products_v4 (Hotfix Types)
-- Propósito: Corrige el error "return type mismatch" al hacer cast explícito de
-- las columnas enum a TEXT, para que coincidan con la firma de la función.
-- Mantiene SECURITY DEFINER para bypass de RLS.

CREATE OR REPLACE FUNCTION public.search_nearby_products_v4(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  radius_meters INT DEFAULT 25000,
  search_term TEXT DEFAULT NULL,
  seller_ids UUID[] DEFAULT NULL,
  cursor_time TIMESTAMPTZ DEFAULT NULL,
  cursor_id UUID DEFAULT NULL,
  result_limit INT DEFAULT 150,
  restrict_seller_mode BOOLEAN DEFAULT FALSE,
  sort_by_distance BOOLEAN DEFAULT FALSE
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
  tipo_entrega TEXT,
  distance_meters FLOAT,
  profiles JSONB,
  product_categories JSONB
) AS $$
DECLARE
  s_lat FLOAT;
  s_lng FLOAT;
  s_radius INT;
  safe_limit INT;
BEGIN
  -- 1. Validación estricta del cursor atómico
  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time and cursor_id must be provided together'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Snap y sanitización de coordenadas
  s_lat := ROUND(user_lat::numeric, 3)::FLOAT;
  s_lng := ROUND(user_lng::numeric, 3)::FLOAT;
  s_radius := LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000);
  
  IF result_limit IS NOT NULL THEN
    safe_limit := LEAST(GREATEST(result_limit, 1), 300);
  END IF;

  -- 3. Branch: "Cerca de Ti" (ordenado por distancia)
  IF sort_by_distance THEN
    RETURN QUERY
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
      ps.tipo::TEXT,
      ps.tipo_entrega::TEXT,
      -- Distance bucketed to nearest 100m
      (CEIL(ST_Distance(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography) / 100) * 100)::FLOAT AS distance_meters,
      jsonb_build_object(
        'nombre',         pr.nombre,
        'trust_level',    pr.trust_level::TEXT,
        'average_rating', pr.average_rating,
        'reviews_count',  pr.reviews_count
      ) AS profiles,
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
    JOIN profiles pr ON pr.id = ps.creador_id
    WHERE ps.estatus = 'disponible'
      AND ps.ubicacion_geo IS NOT NULL
      AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
      AND (
        search_term IS NULL 
        OR trim(search_term) = '' 
        OR ps.titulo ILIKE '%' || search_term || '%' 
        OR ps.descripcion ILIKE '%' || search_term || '%'
        OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids))
      )
      AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
      AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id))
    ORDER BY ps.ubicacion_geo <-> ST_MakePoint(s_lng, s_lat)::geography, ps.created_at DESC, ps.id DESC
    LIMIT safe_limit;
    RETURN;
  END IF;

  -- 4. Branch: /buscar (Result Limit IS NULL, sin ORDER BY interno)
  IF result_limit IS NULL THEN
    RETURN QUERY
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
      ps.tipo::TEXT,
      ps.tipo_entrega::TEXT,
      NULL::FLOAT AS distance_meters,
      jsonb_build_object(
        'nombre',         pr.nombre,
        'trust_level',    pr.trust_level::TEXT,
        'average_rating', pr.average_rating,
        'reviews_count',  pr.reviews_count
      ) AS profiles,
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
    JOIN profiles pr ON pr.id = ps.creador_id
    WHERE ps.estatus = 'disponible'
      AND ps.ubicacion_geo IS NOT NULL
      AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
      AND (
        search_term IS NULL 
        OR trim(search_term) = '' 
        OR ps.titulo ILIKE '%' || search_term || '%' 
        OR ps.descripcion ILIKE '%' || search_term || '%'
        OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids))
      )
      AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
      AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id));
    RETURN;
  END IF;

  -- 5. Branch: Feed Inicial, Load-More y Universitario
  RETURN QUERY
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
    ps.tipo::TEXT,
    ps.tipo_entrega::TEXT,
    NULL::FLOAT AS distance_meters,
    jsonb_build_object(
      'nombre',         pr.nombre,
      'trust_level',    pr.trust_level::TEXT,
      'average_rating', pr.average_rating,
      'reviews_count',  pr.reviews_count
    ) AS profiles,
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
  JOIN profiles pr ON pr.id = ps.creador_id
  WHERE ps.estatus = 'disponible'
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
    AND (
      search_term IS NULL 
      OR trim(search_term) = '' 
      OR ps.titulo ILIKE '%' || search_term || '%' 
      OR ps.descripcion ILIKE '%' || search_term || '%'
      OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids))
    )
    AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
    AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id))
  ORDER BY ps.created_at DESC, ps.id DESC
  LIMIT safe_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.search_nearby_products_v4(
  DOUBLE PRECISION,
  DOUBLE PRECISION,
  INT,
  TEXT,
  UUID[],
  TIMESTAMPTZ,
  UUID,
  INT,
  BOOLEAN,
  BOOLEAN
) TO anon, authenticated;
