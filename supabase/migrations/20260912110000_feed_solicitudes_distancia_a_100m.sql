-- R-04: la distancia al metro delataba el domicilio del comprador.
--
-- feed_nearby_requests redondea la posicion de quien mira a 3 decimales
-- (~111 m) pero devolvia la distancia EXACTA al metro contra la ubicacion
-- cruda de la solicitud. Redondear al observador no protege nada: quien
-- ataca sabe a que punto quedo redondeado el suyo (aplica el mismo ROUND),
-- asi que tiene un punto conocido y una distancia exacta. Tres consultas
-- desde tres coordenadas y la interseccion de las circunferencias da la
-- ubicacion cruda con precision de metros. No hace falta cuenta: anon puede
-- ejecutar la funcion y la anon key viaja en el bundle.
--
-- El repo ya conoce el ataque: apps/web/lib/geo/fuzz.ts lo nombra en su
-- docstring y search_nearby_products_v4 / nearby_products ya agrupan a 100 m.
-- La que se quedo fuera es justo la que lleva ubicaciones de COMPRADORES, que
-- no eligieron un punto en un mapa: es donde quieren recibir la cosa.
--
-- ARREGLO: una linea. Misma firma, mismo tipo de retorno (no hay que regenerar
-- tipos ni tocar TypeScript), y el resto del cuerpo identico al vivo
-- (20260826181000). Sin efecto visible por encima de 1 km: formatDistance ya
-- hace toFixed(1). Por debajo dira "300 m" donde antes decia "347 m".
--
-- Hoy hay 0 solicitudes abiertas: el agujero esta vivo pero no expone a nadie
-- todavia. Es la ventana barata para cerrarlo.
--
-- CREATE OR REPLACE conserva el ACL (anon, authenticated, service_role) y los
-- comentarios. Se re-declaran igualmente SECURITY DEFINER y search_path porque
-- forman parte de la definicion y CREATE OR REPLACE los sustituye.
-- ---------------------------------------------------------------------------

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
    -- R-04: agrupada a 100 m, igual que search_nearby_products_v4. La
    -- distancia exacta al metro contra la ubicacion cruda permitia triangular
    -- la casa del comprador con tres consultas anonimas.
    (CEIL(ST_Distance(pr.ubicacion_geo, ST_MakePoint(s.s_lng, s.s_lat)::geography) / 100) * 100)::INT AS distance_meters,
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
    -- Bloqueo en cualquiera de los dos sentidos. Esta funcion es SECURITY
    -- DEFINER, asi que aqui el NOT EXISTS SI ve las dos direcciones (a
    -- diferencia de las policies, ver 20260912100000). Para anon, viewer es
    -- NULL y no hay nada que filtrar.
    AND (s.viewer IS NULL OR NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = s.viewer AND ub.blocked_id = pr.buyer_id)
             OR (ub.blocker_id = pr.buyer_id AND ub.blocked_id = s.viewer)))
  ORDER BY pr.created_at DESC
  LIMIT LEAST(GREATEST(result_limit, 1), 100);
$function$;

-- ---------------------------------------------------------------------------
-- VERIFY (dentro de BEGIN ... ROLLBACK, con una solicitud sembrada a 347 m):
--
--   INSERT INTO public.purchase_requests (buyer_id, title, status, expires_at, ubicacion_geo)
--   VALUES ('<perfil>', 'prueba R-04', 'open', now() + interval '1 day',
--           ST_SetSRID(ST_MakePoint(-98.20600 + 0.00330, 19.04100), 4326)::geography);
--   SELECT distance_meters FROM public.feed_nearby_requests(19.041, -98.206, 5000, NULL, 50, NULL);
--   -- esperado: multiplo de 100 (400), nunca 347
--
--   SELECT count(*) FROM pg_proc WHERE proname = 'feed_nearby_requests';      -- 1 (sin sobrecarga)
--   SELECT has_function_privilege('anon',
--     'public.feed_nearby_requests(double precision,double precision,integer,timestamp with time zone,integer,text)',
--     'EXECUTE');                                                              -- true (sin cambio)
--   SELECT prosrc !~ 'CEIL\(ST_Distance\([^)]*\)\)\)::INT' FROM pg_proc WHERE proname='feed_nearby_requests'; -- true
-- ---------------------------------------------------------------------------
