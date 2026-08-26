-- El ranking mostraria "Vendedor" para TODOS en cuanto tuviera datos.
--
-- get_ranking_hiperlocal devuelve profiles.display_name, y esa columna esta
-- NULL en las 11 filas de produccion: nunca existio camino que la escribiera.
-- Los tres componentes que la pintan hacen `display_name ?? "Vendedor"`
-- (components/rankings/podio-ranking.tsx, ranking-list.tsx y
-- rankings-home-strip.tsx), asi que un podio de tres puestos ensenaria
-- "Vendedor", "Vendedor" y "Vendedor".
--
-- Hoy no se ve porque seller_rankings esta vacia (0 filas). Es la peor clase
-- de fallo: espera a que la funcionalidad empiece a funcionar para aparecer,
-- o sea el dia del estreno.
--
-- Se arregla en la funcion y no en los tres componentes por lo de siempre: si
-- se parchea abajo, el cuarto componente que se escriba manana vuelve a
-- traerlo. nombre es NOT NULL y no tiene ninguna fila vacia (verificado), asi
-- que el COALESCE no puede quedarse corto.
--
-- El cuerpo se GENERO desde pg_get_functiondef de la funcion viva y se cambio
-- UNA linea. Es deliberado: el primer borrador se escribio a mano leyendo
-- solo la clausula RETURNS, y salio con otra firma, con parametros inventados
-- y con 'destacado' donde el enum real dice 'estrella'. Habria creado una
-- SOBRECARGA en vez de reemplazar nada. Lo detuvo Postgres, no la revision.

CREATE OR REPLACE FUNCTION public.get_ranking_hiperlocal(p_category_id uuid, p_period text, p_user_lat double precision, p_user_lng double precision, p_radius_meters integer DEFAULT 5000, p_limit integer DEFAULT 10)
 RETURNS TABLE(rank integer, seller_id uuid, display_name text, foto text, composite_score numeric, trust_points integer, is_confiable boolean, distancia_aprox integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' THEN
    RAISE EXCEPTION 'invalid period format (expected YYYY-MM): %', p_period;
  END IF;
  IF p_radius_meters IS NULL OR p_radius_meters NOT BETWEEN 100 AND 50000 THEN
    RAISE EXCEPTION 'p_radius_meters must be between 100 and 50000';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'p_limit must be between 1 and 100';
  END IF;
  IF p_user_lat IS NULL OR ABS(p_user_lat) > 90 THEN
    RAISE EXCEPTION 'p_user_lat out of range';
  END IF;
  IF p_user_lng IS NULL OR ABS(p_user_lng) > 180 THEN
    RAISE EXCEPTION 'p_user_lng out of range';
  END IF;

  RETURN QUERY
  WITH
  user_point AS (
    SELECT
      ST_MakePoint(
        ROUND(p_user_lng::numeric, 3)::DOUBLE PRECISION,
        ROUND(p_user_lat::numeric, 3)::DOUBLE PRECISION
      )::geography AS geog,
      (CEIL(p_radius_meters::FLOAT / 100) * 100 + 100)::INT AS radius
  ),
  -- profiles.is_hidden = FALSE is filtered HERE (upstream of ROW_NUMBER) on
  -- purpose: if we filtered hidden sellers in the final JOIN instead, they
  -- would still get a rank number assigned by ROW_NUMBER() and then disappear
  -- from the result, leaving gaps like {1, 2, 4, 5}.
  seller_latest_product AS (
    SELECT
      sr.seller_id,
      sr.composite_score,
      sr.ventas_count,
      sr.trust_points_snapshot,
      sr.computed_at,
      (
        SELECT ps.ubicacion_geo
        FROM products_services ps
        WHERE ps.creador_id    = sr.seller_id
          AND ps.categoria_id  = p_category_id
          AND ps.estatus       = 'disponible'
          AND ps.is_hidden     = FALSE
          AND ps.ubicacion_geo IS NOT NULL
        ORDER BY ps.created_at DESC
        LIMIT 1
      ) AS geog
    FROM seller_rankings sr
    JOIN profiles pf
      ON  pf.id        = sr.seller_id
      AND pf.is_hidden = FALSE
    WHERE sr.category_id = p_category_id
      AND sr.period      = p_period
  ),
  filtered AS (
    SELECT
      slp.seller_id,
      slp.composite_score,
      slp.ventas_count,
      slp.trust_points_snapshot,
      slp.computed_at,
      (FLOOR(ST_Distance(slp.geog, up.geog) / 100) * 100)::INT AS distancia_aprox
    FROM seller_latest_product slp
    CROSS JOIN user_point up
    WHERE slp.geog IS NOT NULL
      AND ST_DWithin(slp.geog, up.geog, up.radius)
  ),
  ordered AS (
    SELECT
      f.*,
      ROW_NUMBER() OVER (
        ORDER BY f.composite_score        DESC,
                 f.ventas_count           DESC,
                 f.trust_points_snapshot  DESC,
                 f.computed_at            ASC
      )::INT AS rank
    FROM filtered f
  )
  SELECT
    o.rank,
    o.seller_id,
    COALESCE(NULLIF(btrim(p.display_name), ''), p.nombre) AS display_name,
    p.foto,
    o.composite_score,
    p.trust_points,
    (p.trust_level IN ('confiable', 'estrella', 'elite')) AS is_confiable,
    o.distancia_aprox
  FROM ordered o
  JOIN profiles p ON p.id = o.seller_id
  ORDER BY o.rank
  LIMIT p_limit;
END;
$function$
;


-- VERIFY:
--   SELECT count(*) FROM pg_proc WHERE proname='get_ranking_hiperlocal';
--   -- esperado: 1 (no 2: una sobrecarga significaria que la firma cambio)
--   SELECT prosrc LIKE '%COALESCE(NULLIF(btrim(p.display_name)%'
--     FROM pg_proc WHERE proname='get_ranking_hiperlocal';  -- true
