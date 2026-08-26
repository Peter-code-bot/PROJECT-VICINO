-- Feed: bloqueos entre usuarios, vendedores suspendidos, comodines de busqueda,
-- y la rama de /buscar sin techo.
--
-- La pagina de Notion pone una regla sobre esta funcion: "revisar TODOS antes de
-- abrir esa funcion". Se respeta — esta migracion atiende de una vez los items
-- 101, 102, 103 y 82, y deja constancia razonada del 104, que necesita una
-- decision de producto y no se toca.
--
-- El contexto que los une: search_nearby_products_v4 es SECURITY DEFINER, o sea
-- que NO pasa por RLS. Todo lo que la RLS filtraria hay que filtrarlo aqui a
-- mano, y lo que se olvide simplemente aparece en el feed.
--
-- ---------------------------------------------------------------------------
-- 101 · BLOQUEOS ENTRE USUARIOS
-- La funcion no mira user_blocks. La RLS si lo hace (la policy
-- block_aware_products_select esconde el producto cuando hay bloqueo mutuo),
-- pero el RPC la brinca. Resultado: bloqueas a alguien y sus publicaciones te
-- siguen apareciendo en el feed, que es justo lo que bloquear deberia evitar.
-- Hoy user_blocks tiene 0 filas, asi que es latente: se nota el dia que alguien
-- use la funcion de bloquear por primera vez.
-- El filtro es bidireccional a proposito: si A bloquea a B, ninguno de los dos
-- debe ver al otro.
--
-- 103 · VENDEDORES SUSPENDIDOS
-- Solo se filtraba ps.is_hidden, el del PRODUCTO. Nunca pr.is_hidden, el del
-- VENDEDOR. Consecuencia concreta: suspender a un vendedor desde el panel de
-- admin no ocultaba ni una sola de sus publicaciones. Y esto se conecta con el
-- arreglo de moderacion de hoy — ahora que suspendUser por fin funciona, tenia
-- que servir para algo. El JOIN a profiles ya existia en las tres ramas, asi que
-- el filtro no cuesta una tabla extra.
--
-- 102 · COMODINES SIN ESCAPAR
-- search_term se concatenaba crudo dentro de ILIKE. Comprobado contra
-- produccion antes de este cambio: buscar "%" devolvia los 7 productos del
-- radio, porque el patron resultante era %%%. Y "_" coincide con cualquier
-- caracter. No es inyeccion — el parametro va parametrizado y no puede cambiar
-- la consulta — pero si es una busqueda que miente.
--
-- 82 · LA RAMA DE /buscar NO TENIA TECHO
-- La rama 2 (result_limit IS NULL) no llevaba ORDER BY ni LIMIT: devolvia TODO
-- lo que cayera en el radio, hasta 50 km. Sin ORDER BY el orden ni siquiera es
-- determinista, asi que el cursor (created_at, id) que usa el resto de la
-- funcion no puede funcionar ahi. Se le pone el mismo orden que la rama 3 y un
-- techo duro de 500: cinco veces mas de lo que pide el cliente hoy, y aun asi
-- un limite.
--
-- 104 · NO SE TOCA, Y ES DELIBERADO
-- El ultimo OR del filtro de busqueda dice: con seller_ids presente y
-- restrict_seller_mode en false, TODO producto de esos vendedores entra aunque
-- no coincida con el termino buscado. La nota de Notion pide "confirmar si es
-- intencional". No lo puedo confirmar desde el codigo: puede ser el
-- comportamiento querido del feed universitario (ver los productos de tu
-- universidad aunque busques otra cosa) o un descuido. Cambiarlo seria adivinar,
-- y adivinar en el feed es caro. Queda para Pedro.

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
  sort_by_distance boolean DEFAULT false
)
RETURNS TABLE(
  id uuid, titulo text, precio numeric, imagen_principal text, categoria text,
  slug text, precio_negociable boolean, created_at timestamp with time zone,
  ventas_count integer, tipo text, tipo_entrega text, distance_meters double precision,
  profiles jsonb, product_categories jsonb, modo_precio text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  s_lat FLOAT; s_lng FLOAT; s_radius INT; safe_limit INT;
  v_viewer UUID;
  s_term TEXT;
  -- Techo de la rama /buscar. Ver nota 82 arriba.
  search_hard_cap CONSTANT INT := 500;
BEGIN
  IF (cursor_time IS NULL) <> (cursor_id IS NULL) THEN
    RAISE EXCEPTION 'cursor_time and cursor_id must be provided together' USING ERRCODE = '22023';
  END IF;

  s_lat := ROUND(user_lat::numeric, 3)::FLOAT;
  s_lng := ROUND(user_lng::numeric, 3)::FLOAT;
  s_radius := LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000);

  IF result_limit IS NOT NULL THEN safe_limit := LEAST(GREATEST(result_limit, 1), 300); END IF;

  -- Quien mira. Para anon es NULL, y entonces no hay bloqueos que aplicar.
  v_viewer := (SELECT auth.uid());

  -- Patron de busqueda con los comodines de LIKE escapados. El orden importa:
  -- primero la barra invertida, o se escaparian las barras que acabamos de
  -- introducir.
  IF search_term IS NOT NULL AND trim(search_term) <> '' THEN
    s_term := '%' || replace(replace(replace(search_term, '\', '\\'), '%', '\%'), '_', '\_') || '%';
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
      AND (s_term IS NULL OR ps.titulo ILIKE s_term OR ps.descripcion ILIKE s_term OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
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
  IF result_limit IS NULL THEN
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
      AND (s_term IS NULL OR ps.titulo ILIKE s_term OR ps.descripcion ILIKE s_term OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
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
    AND (s_term IS NULL OR ps.titulo ILIKE s_term OR ps.descripcion ILIKE s_term OR (restrict_seller_mode = FALSE AND seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
    AND (restrict_seller_mode = FALSE OR (seller_ids IS NOT NULL AND ps.creador_id = ANY(seller_ids)))
    AND (cursor_time IS NULL OR (ps.created_at, ps.id) < (cursor_time, cursor_id))
    AND (v_viewer IS NULL OR NOT EXISTS (
          SELECT 1 FROM user_blocks ub
          WHERE (ub.blocker_id = v_viewer AND ub.blocked_id = ps.creador_id)
             OR (ub.blocker_id = ps.creador_id AND ub.blocked_id = v_viewer)))
  ORDER BY ps.created_at DESC, ps.id DESC LIMIT safe_limit;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 105 · EXECUTE de PUBLIC
--
-- Postgres otorga EXECUTE a PUBLIC sobre toda funcion nueva. Aqui el efecto
-- practico es pequeño: anon y authenticated tienen su GRANT explicito
-- (verificado en proacl), que es lo que usa PostgREST, asi que revocar de PUBLIC
-- no cambia quien puede llamarla hoy. Lo que evita es que un rol futuro herede
-- EXECUTE sobre una funcion SECURITY DEFINER sin que nadie lo decida.
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.search_nearby_products_v4(
  double precision, double precision, integer, text, uuid[],
  timestamp with time zone, uuid, integer, boolean, boolean
) FROM PUBLIC;

-- VERIFY (linea base tomada ANTES de aplicar, con 19.041/-98.206 y radio 50000):
--   feed inicial           7   -> debe seguir en 7
--   cerca de ti            7   -> debe seguir en 7
--   busqueda 'hiking'      0   -> debe seguir en 0 (los dos estan 'pausado')
--   busqueda '%'           7   -> AHORA debe dar 0: el comodin ya no cuela
--
--   Y que anon sigue pudiendo llamarla:
--     SELECT has_function_privilege('anon',
--       'public.search_nearby_products_v4(double precision,double precision,integer,text,uuid[],timestamp with time zone,uuid,integer,boolean,boolean)',
--       'EXECUTE');  -- esperado: true
