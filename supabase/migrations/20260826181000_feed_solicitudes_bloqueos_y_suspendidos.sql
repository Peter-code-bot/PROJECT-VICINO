-- El feed de solicitudes tenia los mismos dos huecos que el de productos.
--
-- 20260826180000 cerro bloqueos y vendedores suspendidos en
-- search_nearby_products_v4. feed_nearby_requests es la otra mitad del feed —
-- la pestaña de solicitudes de compra— y tambien es SECURITY DEFINER, asi que
-- tampoco pasa por RLS y arrastraba los mismos dos olvidos:
--
--   - No miraba user_blocks: bloqueabas a alguien y sus solicitudes te seguian
--     apareciendo.
--   - No miraba bp.is_hidden: suspender a una persona desde el panel de admin no
--     ocultaba ninguna de sus solicitudes.
--
-- Los dos son latentes hoy (user_blocks tiene 0 filas, 0 perfiles suspendidos, y
-- la unica solicitud existente esta expirada), pero se activan el dia que alguien
-- use bloquear o suspender por primera vez. Que es exactamente como se comporto
-- todo lo demas que aparecio hoy.
--
-- OJO con los alias, que aqui invitan al error: en esta funcion `pr` es
-- purchase_requests y el perfil es `bp`. En search_nearby_products_v4 era al
-- reves, `pr` era profiles. Filtrar la columna equivocada aqui pasaria
-- desapercibido porque las dos tablas tienen is_hidden.
--
-- El resto de la funcion se reproduce tal cual: es LANGUAGE sql y hay que
-- reescribir el cuerpo entero para añadir dos condiciones.

CREATE OR REPLACE FUNCTION public.feed_nearby_requests(
  user_lat double precision,
  user_lng double precision,
  radius_meters integer DEFAULT 25000,
  cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone,
  result_limit integer DEFAULT 50,
  cat_slug text DEFAULT NULL::text
)
RETURNS TABLE(
  id uuid, buyer_id uuid, title character varying, description text,
  budget_estimated numeric, image_url text, status request_status,
  expires_at timestamp with time zone, created_at timestamp with time zone,
  distance_meters integer, buyer_profile jsonb, categories jsonb,
  response_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH snapped AS (
    SELECT ROUND(user_lat::numeric, 3)::FLOAT AS s_lat,
           ROUND(user_lng::numeric, 3)::FLOAT AS s_lng,
           LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000) AS s_radius,
           (SELECT auth.uid()) AS viewer
  )
  SELECT pr.id, pr.buyer_id, pr.title, pr.description, pr.budget_estimated, pr.image_url,
    pr.status, pr.expires_at, pr.created_at,
    (CEIL(ST_Distance(pr.ubicacion_geo, ST_MakePoint(s.s_lng, s.s_lat)::geography)))::INT AS distance_meters,
    jsonb_build_object('nombre', bp.nombre, 'avatar_url', bp.foto) AS buyer_profile,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('slug', c.slug, 'nombre', c.nombre))
      FROM purchase_request_categories prc JOIN categories c ON c.id = prc.categoria_id
      WHERE prc.request_id = pr.id), '[]'::jsonb) AS categories,
    (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = pr.id) AS response_count
  FROM purchase_requests pr
  CROSS JOIN snapped s
  JOIN profiles bp ON bp.id = pr.buyer_id
  WHERE pr.status = 'open' AND pr.expires_at > NOW() AND pr.ubicacion_geo IS NOT NULL
    -- Persona suspendida desde el panel: sus solicitudes salen del feed.
    AND bp.is_hidden = FALSE
    AND ST_DWithin(pr.ubicacion_geo, ST_MakePoint(s.s_lng, s.s_lat)::geography, s.s_radius)
    AND (cursor_time IS NULL OR pr.created_at < cursor_time)
    AND (cat_slug IS NULL OR EXISTS (SELECT 1 FROM purchase_request_categories prc2
      JOIN categories c2 ON c2.id = prc2.categoria_id
      WHERE prc2.request_id = pr.id AND c2.slug = cat_slug))
    -- Bloqueo en cualquiera de los dos sentidos. Para anon, viewer es NULL y no
    -- hay nada que filtrar.
    AND (s.viewer IS NULL OR NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = s.viewer AND ub.blocked_id = pr.buyer_id)
             OR (ub.blocker_id = pr.buyer_id AND ub.blocked_id = s.viewer)))
  ORDER BY pr.created_at DESC
  LIMIT LEAST(GREATEST(result_limit, 1), 100);
$function$;

REVOKE EXECUTE ON FUNCTION public.feed_nearby_requests(
  double precision, double precision, integer, timestamp with time zone, integer, text
) FROM PUBLIC;

-- VERIFY (linea base antes de aplicar: 1 solicitud total, 0 abiertas, 0 en el feed):
--   SELECT count(*) FROM feed_nearby_requests(19.041,-98.206,50000,null,50,null);
--   -- esperado: 0, igual que antes
--
--   SELECT has_function_privilege('anon',
--     'public.feed_nearby_requests(double precision,double precision,integer,timestamp with time zone,integer,text)',
--     'EXECUTE');  -- esperado: true
