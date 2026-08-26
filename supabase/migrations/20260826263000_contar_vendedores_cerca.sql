-- Contar vendedores cercanos sin traerse cien productos para contarlos.
--
-- La tarjeta de zona del home llamaba a search_nearby_products_v4 con
-- result_limit 100, se traia hasta cien filas COMPLETAS —con su objeto de
-- perfil y su agregado de categorias— y luego contaba en JavaScript:
--
--   const names = new Set((data ?? []).map(p => p.profiles?.nombre)...)
--   return { count: names.size }
--
-- Dos problemas, no uno:
--
--   1. Cuenta por NOMBRE. Dos vendedores que se llamen igual cuentan como uno.
--      No es hipotetico en un marketplace de barrio: "Tortas Lupita" y
--      "Tortas Lupita" son dos negocios distintos. El RPC no devuelve el
--      identificador del vendedor, asi que desde el cliente NO habia forma de
--      contarlo bien: el fallo estaba en la eleccion de herramienta.
--
--   2. Tope de 100. Con mas de cien productos en el radio, la cuenta se queda
--      corta y ademas de forma silenciosa.
--
-- Los filtros son los MISMOS que la rama con geolocalizacion de
-- search_nearby_products_v4, copiados de su definicion viva y no de memoria:
-- estatus disponible, producto no oculto, vendedor no oculto, con ubicacion,
-- dentro del radio, y sin bloqueos en ninguno de los dos sentidos.
--
-- Es SECURITY DEFINER por el mismo motivo que la v4: necesita leer user_blocks
-- de terceros para excluirlos. Devuelve un unico entero, asi que no puede
-- filtrar datos de nadie.

CREATE OR REPLACE FUNCTION public.count_nearby_vendors(
  user_lat DOUBLE PRECISION,
  user_lng DOUBLE PRECISION,
  radius_meters INTEGER DEFAULT 5000
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  s_lat FLOAT;
  s_lng FLOAT;
  s_radius INT;
  v_viewer UUID;
  v_total INT;
BEGIN
  -- Mismo redondeo que la v4: mantiene la cuadricula de privacidad y hace que
  -- las dos llamadas del home hablen de la misma zona.
  s_lat := ROUND(user_lat::numeric, 3)::FLOAT;
  s_lng := ROUND(user_lng::numeric, 3)::FLOAT;
  s_radius := LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000);

  v_viewer := (SELECT auth.uid());

  SELECT count(DISTINCT ps.creador_id)::INT INTO v_total
  FROM products_services ps
  JOIN profiles pr ON pr.id = ps.creador_id
  WHERE ps.estatus = 'disponible'
    AND ps.is_hidden = FALSE
    AND pr.is_hidden = FALSE
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
    AND (v_viewer IS NULL OR NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = v_viewer AND ub.blocked_id = ps.creador_id)
             OR (ub.blocker_id = ps.creador_id AND ub.blocked_id = v_viewer)));

  RETURN COALESCE(v_total, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.count_nearby_vendors(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_nearby_vendors(DOUBLE PRECISION, DOUBLE PRECISION, INTEGER) TO anon, authenticated;

-- VERIFY:
--   SELECT count_nearby_vendors(19.0186585, -98.2639874, 25000);
--   -- debe coincidir con: SELECT count(DISTINCT creador_id) FROM products_services
--   --   WHERE estatus='disponible' AND is_hidden=false AND ubicacion_geo IS NOT NULL
--   --   AND ST_DWithin(...) ... (mismo radio redondeado)
