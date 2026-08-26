-- La busqueda por titulo y descripcion llevaba rota desde esta misma manana.
--
-- Causa: la propia correccion del item 102. /buscar convertia TODA vocal en
-- guion bajo (apps/web/app/(marketplace)/buscar/page.tsx:95) como truco casero
-- para ignorar acentos, apoyandose en que el guion bajo es comodin de LIKE. La
-- migracion 20260826180000 lo escapo para cerrar el agujero del porcentaje, y
-- de paso volvio literal ese comodin.
--
-- Comprobado contra produccion ANTES de escribir esto:
--   search_nearby_products_v4(..., 'w_n_s', ...) -> 0 filas
--   search_nearby_products_v4(..., 'winis', ...) -> 1 fila
--
-- MATIZ, porque el enunciado facil es falso: no falla "siempre". Un termino sin
-- vocales llega intacto y sigue encontrando ('nd' devuelve 2). Falla todo
-- termino con al menos una vocal, que en castellano es practicamente todo.
--
-- El arreglo NO es revertir el escape: eso reabriria el agujero del porcentaje.
-- Es hacer de verdad lo que el truco emulaba mal, comparar sin acentos por los
-- DOS lados. Se usa translate() y no unaccent() porque unaccent no esta
-- instalada (pg_trgm tampoco), y translate es IMMUTABLE y no pide extension.
--
-- Decision de producto tomada aqui, y conviene saberla: la enye se aplana a n.
-- Asi quien teclea "pinatas" encuentra las que llevan enye, que es lo que
-- escribe la mayoria. El precio es que dos palabras que solo se distinguen por
-- la enye pasan a ser el mismo TERMINO DE BUSQUEDA. No afecta a ningun dato
-- guardado, solo a que coincide con que.
--
-- El cuerpo se GENERO desde pg_get_functiondef de la funcion viva y se cambiaron
-- tres cosas: las declaraciones del mapa, el armado del patron (conservando
-- intacto el escapado de comodines que ya tenia) y las tres copias del
-- predicado. La firma no se toca: CREATE OR REPLACE no puede cambiar el tipo de
-- retorno, y hoy ya se perdio tiempo por reescribir una funcion a mano leyendo
-- solo su clausula RETURNS.

CREATE OR REPLACE FUNCTION public.search_nearby_products_v4(user_lat double precision, user_lng double precision, radius_meters integer DEFAULT 25000, search_term text DEFAULT NULL::text, seller_ids uuid[] DEFAULT NULL::uuid[], cursor_time timestamp with time zone DEFAULT NULL::timestamp with time zone, cursor_id uuid DEFAULT NULL::uuid, result_limit integer DEFAULT 150, restrict_seller_mode boolean DEFAULT false, sort_by_distance boolean DEFAULT false)
 RETURNS TABLE(id uuid, titulo text, precio numeric, imagen_principal text, categoria text, slug text, precio_negociable boolean, created_at timestamp with time zone, ventas_count integer, tipo text, tipo_entrega text, distance_meters double precision, profiles jsonb, product_categories jsonb, modo_precio text)
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

  IF result_limit IS NOT NULL THEN safe_limit := LEAST(GREATEST(result_limit, 1), 300); END IF;

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

-- VERIFY (contra produccion, tras aplicar):
--   'winis'  -> 1     (seguia funcionando, no debe cambiar)
--   'sandia' -> >=1   (el titulo real lleva tilde: antes daba 0)
--   'w_n_s'  -> 0     (el truco muere, y debe morir)
--   '%'      -> 0     (el agujero del item 102 sigue cerrado)
