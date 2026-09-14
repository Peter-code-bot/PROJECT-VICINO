-- result_limit NULL dejaba dos ramas del feed SIN TECHO.
--
-- EL FALLO. safe_limit solo se asignaba cuando result_limit NO era nulo:
--
--   IF result_limit IS NOT NULL THEN safe_limit := LEAST(GREATEST(result_limit, 1), 300); END IF;
--
-- No habia ELSE, asi que con result_limit NULL la variable se quedaba en NULL.
-- Y en Postgres LIMIT NULL no es "limite cero" ni un error: es SIN LIMITE. Las
-- dos ramas que cierran con "LIMIT safe_limit" -- la 1 (sort_by_distance,
-- "Cerca de ti") y la 3 (feed inicial, load-more y universitario) -- devolvian
-- entonces todo lo que cupiera en el radio. La rama 2 (/buscar) NO estaba
-- afectada: cierra con "LIMIT search_hard_cap", que es la constante 500.
--
-- POR QUE IMPORTA SI LA APP NUNCA MANDA NULL. Porque la app no es el unico
-- llamador. El codegen de Supabase no declara nulables los argumentos de RPC,
-- asi que desde apps/web es imposible mandar NULL; pero la funcion tiene
-- GRANT EXECUTE a anon y la llave anon viaja en el bundle del cliente:
-- cualquiera puede hacer POST a /rest/v1/rpc/search_nearby_products_v4 con
-- {"result_limit": null} y llevarse el catalogo entero de un viaje, saltandose
-- los techos de 150/300 que el resto del sistema da por hechos. Comprobado
-- contra produccion ANTES de esta migracion: con result_limit null devolvia
-- todas las filas del radio; con result_limit 2, dos.
--
-- EL ARREGLO es una linea: COALESCE al mismo 150 que ya declara el DEFAULT de
-- la firma, de modo que "NULL" y "omitido" acaban exactamente en el mismo
-- sitio. El techo duro de 300 se conserva.
--
-- POR QUE ES UN CREATE OR REPLACE QUE REPITE LA FIRMA ENTERA. En Postgres no
-- se puede parchear el cuerpo de una funcion: hay que reemitirla. Y la firma
-- tiene que ser IDENTICA -- mismos nombres de parametro, mismos tipos, mismos
-- DEFAULT -- por dos razones: con un nombre distinto Postgres rechaza con
-- "cannot change name of input parameter", y con un parametro de mas o de
-- menos no se reemplaza nada sino que nace una SOBRECARGA, y entonces
-- PostgREST deja de saber cual llamar y devuelve 300 PGRST203. Ese P0 ya paso
-- en este proyecto (ver 20260826410000). Por eso el cuerpo de abajo no se
-- copio del archivo 20260826400000 sino que se volco de pg_proc.prosrc de
-- PRODUCCION y se le sustituyo UNICAMENTE esa linea: asi, si produccion tenia
-- algun ajuste fuera de banda, esta migracion lo conserva en vez de pisarlo.
--
-- LO QUE ESTO NO ARREGLA. El techo interno no es una cuota: quien llame 1.000
-- veces se sigue llevando 150.000 filas. La cuota por IP de las paginas vive
-- en apps/web/proxy.ts, y la puerta mas barata de todas -- el GET directo a
-- /rest/v1/products_services -- se trata aparte.
--
-- VERIFY (con la llave anon, contra la base ya migrada):
--   POST /rest/v1/rpc/search_nearby_products_v4
--     {"user_lat":19.0414,"user_lng":-98.2063,"radius_meters":50000,
--      "result_limit":null,"sort_by_distance":true}
--   -> como maximo 150 filas (antes: todas las del radio)
--   El mismo cuerpo con "result_limit":2 -> 2 filas (sin cambio)
--   SELECT count(*) FROM pg_proc WHERE proname='search_nearby_products_v4'; -- 1
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.search_nearby_products_v4(
  user_lat double precision,
  user_lng double precision,
  radius_meters integer DEFAULT 25000,
  search_term text DEFAULT NULL::text,
  seller_ids uuid[] DEFAULT NULL::uuid[],
  cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone,
  cursor_id uuid DEFAULT NULL::uuid,
  result_limit integer DEFAULT 150,
  restrict_seller_mode boolean DEFAULT false,
  sort_by_distance boolean DEFAULT false,
  sin_limite boolean DEFAULT false
)
RETURNS TABLE(
  id uuid,
  titulo text,
  precio numeric,
  imagen_principal text,
  categoria text,
  slug text,
  precio_negociable boolean,
  created_at timestamp with time zone,
  ventas_count integer,
  tipo text,
  tipo_entrega text,
  distance_meters double precision,
  profiles jsonb,
  product_categories jsonb,
  modo_precio text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s_lat FLOAT; s_lng FLOAT; s_radius INT; safe_limit INT;
  v_viewer UUID;
  s_term TEXT;
  -- Techo de la rama /buscar. Ver nota 82 arriba.
  search_hard_cap CONSTANT INT := 500;
  -- Mapa de acentos construido con chr(), no con un literal.
  --
  -- Es deliberado y cuesta unas lineas de mas: el archivo queda en ASCII puro,
  -- asi que ninguna conversion de codificacion ni ningun escape mal
  -- interpretado puede corromperlo. Un literal con acentos de verdad se veria
  -- identico en el editor y podria llegar mutilado a produccion sin que nada lo
  -- delate. El primer intento de esta misma migracion uso escapes Unicode y
  -- acabo con bytes NUL dentro; por eso no hay ni una barra invertida aqui.
  --
  -- Se aplica lower() antes de traducir, asi que solo hacen falta minusculas.
  -- Comprobado contra produccion: 'Aros de Sandia' con tilde -> 'aros de sandia'.
  v_acentos CONSTANT TEXT :=
      chr(225) ||
      chr(224) ||
      chr(226) ||
      chr(228) ||
      chr(233) ||
      chr(232) ||
      chr(234) ||
      chr(235) ||
      chr(237) ||
      chr(236) ||
      chr(238) ||
      chr(239) ||
      chr(243) ||
      chr(242) ||
      chr(244) ||
      chr(246) ||
      chr(250) ||
      chr(249) ||
      chr(251) ||
      chr(252) ||
      chr(241) ||
      chr(231);
  v_llanos  CONSTANT TEXT := 'aaaaeeeeiiiioooouuuunc';
BEGIN
  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time and cursor_id must be provided together' USING ERRCODE = '22023';
  END IF;

  s_lat := ROUND(user_lat::numeric, 3)::FLOAT;
  s_lng := ROUND(user_lng::numeric, 3)::FLOAT;
  s_radius := LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000);

  safe_limit := LEAST(GREATEST(COALESCE(result_limit, 150), 1), 300);

  -- Quien mira. Para anon es NULL, y entonces no hay bloqueos que aplicar.
  v_viewer := (SELECT auth.uid());

  -- Patron de busqueda con los comodines de LIKE escapados. El orden importa:
  -- primero la barra invertida, o se escaparian las barras que acabamos de
  -- introducir.
  IF search_term IS NOT NULL AND trim(search_term) <> '' THEN
    s_term := '%'
      || translate(lower(replace(replace(replace(search_term, '\', '\\'), '%', '\%'), '_', '\_')), v_acentos, v_llanos)
      || '%';
  END IF;

  -- Rama 1: "Cerca de Ti"
  IF sort_by_distance THEN
    RETURN QUERY
    SELECT ps.id, ps.titulo, ps.precio, ps.imagen_principal, ps.categoria, ps.slug, ps.precio_negociable,
           ps.created_at, ps.ventas_count,
           ps.tipo::TEXT,
           ps.tipo_entrega::TEXT,
           (CEIL(ST_Distance(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography) / 100) * 100)::FLOAT AS distance_meters,
           jsonb_build_object('nombre', pr.nombre, 'trust_level', pr.trust_level::TEXT, 'average_rating', pr.average_rating, 'reviews_count', pr.reviews_count) AS profiles,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('is_primary', pc.is_primary, 'categories', jsonb_build_object('slug', c.slug, 'nombre', c.nombre))) FROM product_categories pc JOIN categories c ON c.id = pc.categoria_id WHERE pc.product_id = ps.id), '[]'::jsonb) AS product_categories,
           ps.modo_precio::TEXT
    FROM products_services ps JOIN profiles pr ON pr.id = ps.creador_id
    WHERE ps.estatus = 'disponible' AND ps.is_hidden = FALSE
      AND pr.is_hidden = FALSE
      AND ps.ubicacion_geo IS NOT NULL AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
      AND (s_term IS NULL OR translate(lower(ps.titulo), v_acentos, v_llanos) LIKE s_term OR translate(lower(ps.descripcion), v_acentos, v_llanos) LIKE s_term OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
      AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
      AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id))
      AND (v_viewer IS NULL OR NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = v_viewer AND ub.blocked_id = ps.creador_id)
               OR (ub.blocker_id = ps.creador_id AND ub.blocked_id = v_viewer)))
    ORDER BY ps.ubicacion_geo <-> ST_MakePoint(s_lng, s_lat)::geography, ps.created_at DESC, ps.id DESC LIMIT safe_limit;
    RETURN;
  END IF;

  -- Rama 2: /buscar
  -- Antes esto decia `IF result_limit IS NULL`. El nulo hacia de INTERRUPTOR
  -- DE RAMA sobre un parametro que se llama "limite", que es demasiado listo:
  -- el tipo generado de Supabase no sabe declarar un argumento nulable, asi
  -- que /buscar no podia expresar su propia rama sin un cast. Ahora la rama
  -- tiene su propio nombre y result_limit vuelve a significar solo "limite".
  IF sin_limite THEN
    RETURN QUERY
    SELECT ps.id, ps.titulo, ps.precio, ps.imagen_principal, ps.categoria, ps.slug, ps.precio_negociable,
           ps.created_at, ps.ventas_count,
           ps.tipo::TEXT,
           ps.tipo_entrega::TEXT,
           NULL::FLOAT AS distance_meters,
           jsonb_build_object('nombre', pr.nombre, 'trust_level', pr.trust_level::TEXT, 'average_rating', pr.average_rating, 'reviews_count', pr.reviews_count) AS profiles,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('is_primary', pc.is_primary, 'categories', jsonb_build_object('slug', c.slug, 'nombre', c.nombre))) FROM product_categories pc JOIN categories c ON c.id = pc.categoria_id WHERE pc.product_id = ps.id), '[]'::jsonb) AS product_categories,
           ps.modo_precio::TEXT
    FROM products_services ps JOIN profiles pr ON pr.id = ps.creador_id
    WHERE ps.estatus = 'disponible' AND ps.is_hidden = FALSE
      AND pr.is_hidden = FALSE
      AND ps.ubicacion_geo IS NOT NULL AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
      AND (s_term IS NULL OR translate(lower(ps.titulo), v_acentos, v_llanos) LIKE s_term OR translate(lower(ps.descripcion), v_acentos, v_llanos) LIKE s_term OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
      AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
      AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id))
      AND (v_viewer IS NULL OR NOT EXISTS (
            SELECT 1 FROM user_blocks ub
            WHERE (ub.blocker_id = v_viewer AND ub.blocked_id = ps.creador_id)
               OR (ub.blocker_id = ps.creador_id AND ub.blocked_id = v_viewer)))
    ORDER BY ps.created_at DESC, ps.id DESC LIMIT search_hard_cap;
    RETURN;
  END IF;

  -- Rama 3: feed inicial / load-more / universitario
  RETURN QUERY
  SELECT ps.id, ps.titulo, ps.precio, ps.imagen_principal, ps.categoria, ps.slug, ps.precio_negociable,
         ps.created_at, ps.ventas_count,
         ps.tipo::TEXT,
         ps.tipo_entrega::TEXT,
         NULL::FLOAT AS distance_meters,
         jsonb_build_object('nombre', pr.nombre, 'trust_level', pr.trust_level::TEXT, 'average_rating', pr.average_rating, 'reviews_count', pr.reviews_count) AS profiles,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('is_primary', pc.is_primary, 'categories', jsonb_build_object('slug', c.slug, 'nombre', c.nombre))) FROM product_categories pc JOIN categories c ON c.id = pc.categoria_id WHERE pc.product_id = ps.id), '[]'::jsonb) AS product_categories,
         ps.modo_precio::TEXT
  FROM products_services ps JOIN profiles pr ON pr.id = ps.creador_id
  WHERE ps.estatus = 'disponible' AND ps.is_hidden = FALSE
    AND pr.is_hidden = FALSE
    AND ps.ubicacion_geo IS NOT NULL AND ST_DWithin(ps.ubicacion_geo, ST_MakePoint(s_lng, s_lat)::geography, s_radius)
    AND (s_term IS NULL OR translate(lower(ps.titulo), v_acentos, v_llanos) LIKE s_term OR translate(lower(ps.descripcion), v_acentos, v_llanos) LIKE s_term OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
    AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
    AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id))
    AND (v_viewer IS NULL OR NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = v_viewer AND ub.blocked_id = ps.creador_id)
             OR (ub.blocker_id = ps.creador_id AND ub.blocked_id = v_viewer)))
  ORDER BY ps.created_at DESC, ps.id DESC LIMIT safe_limit;
END;
$function$;

-- CREATE OR REPLACE conserva la ACL, pero se repone para que el archivo sea
-- autosuficiente: quien lo lea ve con que privilegios queda la funcion.
REVOKE EXECUTE ON FUNCTION public.search_nearby_products_v4(
  double precision, double precision, integer, text, uuid[],
  timestamp with time zone, uuid, integer, boolean, boolean, boolean
) FROM PUBLIC;
