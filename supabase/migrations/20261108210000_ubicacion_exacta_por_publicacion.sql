-- Ubicacion exacta por publicacion (encargo GEO-PUB-EXACT-20261104 / GEO-PRECISION-01).
--
-- Que cambia:
--   * Cada publicacion guarda su PRECISION: 'exacta' (el vendedor eligio y
--     confirmo el punto) o 'aproximada'. Las que ya existen nacen 'aproximada'
--     por el DEFAULT constante: no se reescribe la tabla, no cambia updated_at
--     y se siguen viendo exactamente como hoy.
--   * El punto publico exacto vive en su propia columna, ubicacion_exacta,
--     separada de ubicacion_geo (privada). No la escribe nadie a mano: la deriva
--     un trigger de ubicacion_geo SOLO cuando la precision es 'exacta', y la
--     vacia en cuanto deja de serlo o se quita la ubicacion. Asi el modo, el
--     punto y su revision quedan en la MISMA fila y en la MISMA escritura.
--   * ubicacion_revision sube cuando cambian la precision o el punto (comparando
--     los bytes del punto, no "la columna venia en el UPDATE"): editar precio o
--     fotos no la mueve. Es la clave de cache del minimapa y entra en la
--     revision del mapa.
--   * Un solo dato autorizado P = ubicacion_publica_punto(precision, exacta,
--     geo, decimales): el punto exacto si es 'exacta'; si no, la rejilla
--     aproximada de 2 decimales (~1 km, lo que se ve hoy) o 3 (~110 m, PR #75).
--     Lo usan el mapa (search_map_publications_v4) y la ficha y el minimapa
--     (ubicacion_publica_de_publicacion). Los decimales los decide el servidor
--     con VICINO_MAPA_RPC, la misma variable de Vercel de siempre.
--
-- Quien lee que:
--   * ubicacion_exacta, ubicacion_revision y ubicacion_precision: sin SELECT
--     para anon ni authenticated (igual que ubicacion_geo y ubicacion_publica).
--   * authenticated recibe UPDATE solo de ubicacion_precision (lo escribe la
--     Server Action del formulario junto con ubicacion_geo). El INSERT de
--     products_services es de tabla, asi que un cliente podria mandar
--     ubicacion_exacta o ubicacion_revision: el trigger las pisa siempre.
--   * search_map_publications_v4: authenticated y service_role, como v3.
--   * ubicacion_publica_de_publicacion: solo service_role. La ficha y la ruta
--     del minimapa autorizan ANTES con el cliente del usuario (RLS) y despues
--     la llaman con el cliente admin, igual que hoy leen ubicacion_geo.
--   * ubicacion_de_mi_publicacion: authenticated, solo devuelve filas propias
--     (la pantalla de editar carga el punto, la precision y la revision).
--
-- Compatible con el codigo de master: un INSERT sin la columna nace
-- 'aproximada'; un UPDATE de ubicacion_geo sube la revision; v1, v2, v3, la
-- ficha y el minimapa actuales no leen nada de esto. Por eso esta migracion va
-- ANTES del merge.
--
-- No usa CONCURRENTLY (apply-migration envuelve en BEGIN/COMMIT).
-- Aplicar: node scripts/apply-migration.mjs supabase/migrations/20261108210000_ubicacion_exacta_por_publicacion.sql
-- Despues: node scripts/gen-types.mjs
-- Reversion: docs/rollback/20261108210000_ubicacion_exacta_por_publicacion_rollback.sql

-- Las ALTER toman un candado sobre products_services hasta el commit: si no lo
-- consiguen en 5 s, la migracion entera aborta en vez de hacer fila.
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.products_services
  ADD COLUMN IF NOT EXISTS ubicacion_precision text NOT NULL DEFAULT 'aproximada',
  ADD COLUMN IF NOT EXISTS ubicacion_exacta public.geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS ubicacion_revision bigint NOT NULL DEFAULT 0;

ALTER TABLE public.products_services DROP CONSTRAINT IF EXISTS products_services_ubicacion_precision_valida;
ALTER TABLE public.products_services ADD CONSTRAINT products_services_ubicacion_precision_valida
  CHECK (ubicacion_precision IN ('exacta', 'aproximada'));
ALTER TABLE public.products_services DROP CONSTRAINT IF EXISTS products_services_ubicacion_exacta_coherente;
ALTER TABLE public.products_services ADD CONSTRAINT products_services_ubicacion_exacta_coherente
  CHECK ((ubicacion_precision = 'exacta') = (ubicacion_exacta IS NOT NULL));

COMMENT ON COLUMN public.products_services.ubicacion_precision IS
  'exacta = el vendedor eligio y confirmo el punto; aproximada = se publica la rejilla. Las anteriores a 20261108210000 son aproximadas.';
COMMENT ON COLUMN public.products_services.ubicacion_exacta IS
  'Punto publico exacto. Lo deriva zz_ubicacion_publica_derivada de ubicacion_geo solo con precision exacta. Sin SELECT para clientes.';
COMMENT ON COLUMN public.products_services.ubicacion_revision IS
  'Sube cuando cambian la precision o el punto. Clave de cache del minimapa y parte de la revision del mapa.';

-- Una columna nueva de products_services nace sin privilegios de columna; el
-- REVOKE deja constancia y el DO del final lo comprueba de verdad.
REVOKE ALL (ubicacion_precision, ubicacion_exacta, ubicacion_revision) ON public.products_services FROM PUBLIC, anon, authenticated;
GRANT UPDATE (ubicacion_precision) ON public.products_services TO authenticated;

-- El dato autorizado. IMMUTABLE: depende solo de sus argumentos. La rama
-- aproximada repite la expresion de ubicacion_mapa (2 decimales,
-- 20260930220000) y de ubicacion_publica (3 decimales, 20261020150000).
CREATE OR REPLACE FUNCTION public.ubicacion_publica_punto(
  p_precision text, p_exacta public.geometry, p_geo public.geography, p_decimales integer
) RETURNS public.geometry
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN p_geo IS NULL THEN NULL
    WHEN p_precision = 'exacta' AND p_exacta IS NOT NULL THEN p_exacta
    ELSE public.ST_SetSRID(public.ST_MakePoint(
      round(public.ST_X(p_geo::public.geometry)::numeric, CASE WHEN p_decimales = 3 THEN 3 ELSE 2 END)::double precision,
      round(public.ST_Y(p_geo::public.geometry)::numeric, CASE WHEN p_decimales = 3 THEN 3 ELSE 2 END)::double precision
    ), 4326)
  END
$fn$;
REVOKE ALL ON FUNCTION public.ubicacion_publica_punto(text, public.geometry, public.geography, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ubicacion_publica_punto(text, public.geometry, public.geography, integer) TO service_role;

-- El trigger. Sin acceso a tablas: solo calcula NEW. 'zz_' para correr DESPUES
-- de los demas BEFORE (van en orden alfabetico) y ver el ubicacion_geo final.
CREATE OR REPLACE FUNCTION public.derivar_ubicacion_publica()
RETURNS trigger LANGUAGE plpgsql SET search_path = ''
AS $fn$
BEGIN
  IF NEW.ubicacion_precision IS NULL THEN
    NEW.ubicacion_precision := 'aproximada';
  END IF;
  -- Sin punto no hay nada exacto que mostrar.
  IF NEW.ubicacion_geo IS NULL THEN
    NEW.ubicacion_precision := 'aproximada';
  END IF;
  -- Derivado SIEMPRE: lo que mande el cliente en ubicacion_exacta se ignora.
  NEW.ubicacion_exacta := CASE WHEN NEW.ubicacion_precision = 'exacta'
    THEN public.ST_SetSRID(NEW.ubicacion_geo::public.geometry, 4326) END;
  IF TG_OP = 'INSERT' THEN
    NEW.ubicacion_revision := 0;
  ELSIF NEW.ubicacion_precision IS DISTINCT FROM OLD.ubicacion_precision
     OR public.ST_AsEWKB(NEW.ubicacion_geo::public.geometry) IS DISTINCT FROM public.ST_AsEWKB(OLD.ubicacion_geo::public.geometry) THEN
    NEW.ubicacion_revision := OLD.ubicacion_revision + 1;
  ELSE
    NEW.ubicacion_revision := OLD.ubicacion_revision;
  END IF;
  RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public.derivar_ubicacion_publica() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS zz_ubicacion_publica_derivada ON public.products_services;
CREATE TRIGGER zz_ubicacion_publica_derivada
  BEFORE INSERT OR UPDATE ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.derivar_ubicacion_publica();

-- Ficha y minimapa. SECURITY INVOKER a proposito: solo service_role puede leer
-- estas columnas, asi que concederla por error a un cliente no abre nada. NO
-- revisa visibilidad: quien la llama ya autorizo con RLS (ver la cabecera).
CREATE OR REPLACE FUNCTION public.ubicacion_publica_de_publicacion(p_product_id uuid, p_decimales integer DEFAULT 2)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = ''
AS $fn$
DECLARE
  v_decimales integer := CASE WHEN p_decimales = 3 THEN 3 ELSE 2 END;
  v_precision text;
  v_revision bigint;
  v_punto public.geometry;
BEGIN
  SELECT ps.ubicacion_precision, ps.ubicacion_revision,
         public.ubicacion_publica_punto(ps.ubicacion_precision, ps.ubicacion_exacta, ps.ubicacion_geo, v_decimales)
    INTO v_precision, v_revision, v_punto
    FROM public.products_services ps
   WHERE ps.id = p_product_id;
  IF NOT FOUND OR v_punto IS NULL THEN
    RETURN jsonb_build_object('disponible', false, 'precision', coalesce(v_precision, 'aproximada'),
      'revision', coalesce(v_revision, 0), 'decimales', v_decimales);
  END IF;
  RETURN jsonb_build_object('disponible', true, 'precision', v_precision, 'revision', v_revision,
    'decimales', v_decimales, 'lat', public.ST_Y(v_punto), 'lng', public.ST_X(v_punto));
END;
$fn$;
REVOKE ALL ON FUNCTION public.ubicacion_publica_de_publicacion(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ubicacion_publica_de_publicacion(uuid, integer) TO service_role;

-- Editar: el dueno recupera su punto, la precision guardada y la revision.
-- get_product_location (20260826264000) no se toca: CREATE OR REPLACE no puede
-- cambiar su tipo de retorno y el codigo de master la sigue usando.
CREATE OR REPLACE FUNCTION public.ubicacion_de_mi_publicacion(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_geo public.geography;
  v_precision text;
  v_revision bigint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT ps.ubicacion_geo, ps.ubicacion_precision, ps.ubicacion_revision
    INTO v_geo, v_precision, v_revision
    FROM public.products_services ps
   WHERE ps.id = p_product_id AND ps.creador_id = v_uid AND ps.estatus <> 'eliminado';
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'lat', CASE WHEN v_geo IS NOT NULL THEN public.ST_Y(v_geo::public.geometry) END,
    'lng', CASE WHEN v_geo IS NOT NULL THEN public.ST_X(v_geo::public.geometry) END,
    'precision', v_precision,
    'revision', v_revision);
END;
$fn$;
REVOKE ALL ON FUNCTION public.ubicacion_de_mi_publicacion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ubicacion_de_mi_publicacion(uuid) TO authenticated, service_role;

-- El mapa. Mismo contrato que v3 (projection_version 2, rejilla en milesimas)
-- sobre P, mas dos campos opcionales: cells[].punto {lat,lng} cuando la celda
-- es de una sola ubicacion exacta, y features[].precision = 'exacta'.
CREATE OR REPLACE FUNCTION public.search_map_publications_v4(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '4s'
AS $map$
DECLARE
  p_query jsonb; v_viewer uuid := auth.uid();
  v_w float8;v_s float8;v_e float8;v_n float8;
  v_center_lat float8;v_center_lng float8;v_coverage_lat float8;v_coverage_lng float8;
  v_radius integer;v_stride integer:=1;v_overview_stride integer:=1;v_mode text;v_tipo text;
  v_min numeric;v_max numeric;v_term text;v_categories text[];
  v_cell text;v_cursor jsonb;v_key text;v_time timestamptz;v_id uuid;
  v_normalized jsonb;v_result jsonb;v_action text;v_revision text;
  v_after_x integer;v_after_y integer;v_node_stride integer;v_node_x integer;v_node_y integer;
  -- Decimales de la rejilla APROXIMADA: 2 (~1 km, lo de hoy) o 3 (~110 m, PR #75).
  -- La pone la ruta segun VICINO_MAPA_RPC; quien llama directo y no la manda
  -- recibe 2, lo mas conservador. Las exactas no dependen de ella.
  v_decimales integer:=2;
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>8192
    OR p_request-ARRAY['action','query','coverage_center','revision','cell_cursor','rejilla']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
  END IF;
  v_action:=p_request->>'action';v_revision:=p_request->>'revision';p_query:=p_request->'query';
  IF v_action IS NULL OR v_action NOT IN ('overview','cells','listings','check')
    OR (p_request?'revision' AND jsonb_typeof(p_request->'revision') NOT IN ('string','null'))
    OR (v_revision IS NOT NULL AND v_revision!~'^[a-f0-9]{32}$') THEN
    RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
  END IF;
  IF p_request ? 'rejilla' THEN
    IF jsonb_typeof(p_request->'rejilla') IS DISTINCT FROM 'number' OR (p_request->>'rejilla') NOT IN ('2','3') THEN
      RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
    END IF;
    v_decimales:=(p_request->>'rejilla')::integer;
  END IF;
  IF p_request->'coverage_center' IS NOT NULL AND p_request->'coverage_center'<>'null'::jsonb THEN
    IF jsonb_typeof(p_request->'coverage_center')<>'object'
      OR (p_request->'coverage_center')-ARRAY['lat','lng']<>'{}'::jsonb
      OR jsonb_typeof(p_request->'coverage_center'->'lat') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_request->'coverage_center'->'lng') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid coverage center' USING ERRCODE='22023';
    END IF;
    v_coverage_lat:=(p_request->'coverage_center'->>'lat')::float8;v_coverage_lng:=(p_request->'coverage_center'->>'lng')::float8;
    IF NOT(v_coverage_lat BETWEEN 14.5 AND 32.8 AND v_coverage_lng BETWEEN -118.5 AND -86.5) THEN
      RAISE EXCEPTION 'Invalid coverage center' USING ERRCODE='22023';
    END IF;
  END IF;
  IF v_action='cells' AND v_coverage_lat IS NULL THEN RAISE EXCEPTION 'Choose a local area' USING ERRCODE='22023';END IF;
  IF p_query IS NULL OR jsonb_typeof(p_query) <> 'object' OR octet_length(p_query::text) > 8192
     OR p_query - ARRAY['bounds','q','categories','tipo','price_min','price_max','mode','center','radius_meters','cell_id','cursor'] <> '{}'::jsonb
     OR jsonb_typeof(p_query->'bounds') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid map query' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_query->'bounds') e
    WHERE e.key NOT IN ('west','south','east','north') OR jsonb_typeof(e.value) <> 'number')
    OR (SELECT count(*) FROM jsonb_object_keys(p_query->'bounds')) <> 4 THEN
    RAISE EXCEPTION 'Invalid map bounds' USING ERRCODE='22023';
  END IF;
  v_w := (p_query->'bounds'->>'west')::double precision;
  v_s := (p_query->'bounds'->>'south')::double precision;
  v_e := (p_query->'bounds'->>'east')::double precision;
  v_n := (p_query->'bounds'->>'north')::double precision;
  IF NOT (v_w >= -118.5 AND v_e <= -86.5 AND v_s >= 14.5 AND v_n <= 32.8 AND v_w < v_e AND v_s < v_n) THEN
    RAISE EXCEPTION 'Invalid map bounds' USING ERRCODE='22023';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_each(p_query) e WHERE
    (e.key IN ('q','mode') AND jsonb_typeof(e.value) <> 'string') OR
    (e.key IN ('tipo','cell_id') AND jsonb_typeof(e.value) NOT IN ('string','null')) OR
    (e.key IN ('price_min','price_max') AND jsonb_typeof(e.value) NOT IN ('number','null')) OR
    (e.key = 'radius_meters' AND jsonb_typeof(e.value) <> 'number') OR
    (e.key = 'categories' AND jsonb_typeof(e.value) <> 'array') OR
    (e.key IN ('center','cursor') AND jsonb_typeof(e.value) NOT IN ('object','null'))) THEN
    RAISE EXCEPTION 'Invalid map filters' USING ERRCODE='22023';
  END IF;
  v_mode := coalesce(p_query->>'mode','zone');
  v_tipo := p_query->>'tipo'; v_cell := p_query->>'cell_id';
  v_min := (p_query->>'price_min')::numeric; v_max := (p_query->>'price_max')::numeric;
  v_radius := coalesce((p_query->>'radius_meters')::numeric,10000)::integer;
  v_term := trim(coalesce(p_query->>'q',''));
  IF v_mode NOT IN ('zone','nearby') OR (v_tipo IS NOT NULL AND v_tipo NOT IN ('producto','servicio'))
    OR length(v_term)>120 OR v_radius<1000 OR v_radius>50000
    OR (p_query ? 'radius_meters' AND (p_query->>'radius_meters')::numeric <> v_radius)
    OR (v_min IS NOT NULL AND (v_min<0 OR v_min>99999999))
    OR (v_max IS NOT NULL AND (v_max<0 OR v_max>99999999)) OR v_min>v_max
    OR (v_cell IS NOT NULL AND (length(v_cell)>70 OR v_cell !~ '^cell:[1-9][0-9]*:-?[0-9]+:-?[0-9]+$')) THEN
    RAISE EXCEPTION 'Invalid map filters' USING ERRCODE='22023';
  END IF;
  IF p_query->'center' IS NOT NULL AND p_query->'center' <> 'null'::jsonb THEN
    IF (p_query->'center') - ARRAY['lat','lng'] <> '{}'::jsonb
      OR jsonb_typeof(p_query->'center'->'lat') IS DISTINCT FROM 'number'
      OR jsonb_typeof(p_query->'center'->'lng') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid map center' USING ERRCODE='22023';
    END IF;
    v_center_lat := (p_query->'center'->>'lat')::double precision;
    v_center_lng := (p_query->'center'->>'lng')::double precision;
    IF NOT (v_center_lat BETWEEN -90 AND 90 AND v_center_lng BETWEEN -180 AND 180) THEN
      RAISE EXCEPTION 'Invalid map center' USING ERRCODE='22023';
    END IF;
  END IF;
  IF v_mode='nearby' AND (v_center_lat IS NULL OR v_center_lng IS NULL) THEN
    RAISE EXCEPTION 'Missing map center' USING ERRCODE='22023';
  END IF;
  IF v_mode='zone' THEN v_center_lat:=NULL; v_center_lng:=NULL; END IF;
  IF jsonb_array_length(coalesce(p_query->'categories','[]'::jsonb))>10
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(p_query->'categories','[]'::jsonb)) a WHERE jsonb_typeof(a)<>'string') THEN
    RAISE EXCEPTION 'Invalid map categories' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(array_agg(DISTINCT value ORDER BY value),'{}'::text[]) INTO v_categories
    FROM jsonb_array_elements_text(coalesce(p_query->'categories','[]'::jsonb));
  IF EXISTS (SELECT 1 FROM unnest(v_categories) s WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.slug=s)) THEN
    RAISE EXCEPTION 'Invalid map categories' USING ERRCODE='22023';
  END IF;
  -- 'projection' entra en la clave: un cursor emitido por v2 (otras unidades)
  -- no se puede reproducir aqui y cae como cursor caduco (22023 -> 409).
  -- 'contrato' y 'rejilla' hacen lo mismo con los de v3 y con los de la otra rejilla.
  v_normalized := jsonb_build_object('bounds',p_query->'bounds','q',v_term,'categories',v_categories,
    'tipo',v_tipo,'price_min',v_min,'price_max',v_max,'mode',v_mode,'radius_meters',v_radius,
    'center_lat',v_center_lat,'center_lng',v_center_lng,'coverage_center',p_request->'coverage_center','projection',2,'contrato','v4','rejilla',v_decimales);
  v_key := md5(v_normalized::text || coalesce(v_viewer::text,'guest'));

  -- Rejilla en MILESIMAS de grado (x1000): una unidad = celda de ~110 m.
  WHILE v_overview_stride<8192 AND (ceil((v_e-v_w)*1000/v_overview_stride)+2)*(ceil((v_n-v_s)*1000/v_overview_stride)+2)>300 LOOP
    v_overview_stride:=v_overview_stride*2;
  END LOOP;
  IF v_cell IS NOT NULL THEN
    IF split_part(v_cell,':',2)::numeric>8192 OR split_part(v_cell,':',3)::numeric NOT BETWEEN -118500 AND -1 OR split_part(v_cell,':',4)::numeric NOT BETWEEN 0 AND 32800 THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';END IF;
    v_node_stride:=split_part(v_cell,':',2)::integer;v_node_x:=split_part(v_cell,':',3)::integer;v_node_y:=split_part(v_cell,':',4)::integer;
    IF v_node_stride>8192 OR (v_node_stride & (v_node_stride-1))<>0 THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';END IF;
    -- El nodo tiene que caer dentro de Mexico EN LAS UNIDADES DE ESTA
    -- proyeccion y de su stride: un grupo emitido por v2 (centesimas, p. ej.
    -- cell:1:-9821:1904) es invalido aqui, no una lista vacia.
    IF v_node_x NOT BETWEEN floor(-118500.0/v_node_stride) AND floor(-86500.0/v_node_stride)
      OR v_node_y NOT BETWEEN floor(14500.0/v_node_stride) AND floor(32800.0/v_node_stride) THEN
      RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';
    END IF;
  END IF;
  v_cursor:=p_query->'cursor';
  IF v_cursor IS NOT NULL AND v_cursor<>'null'::jsonb THEN
    IF jsonb_typeof(v_cursor)<>'object' OR v_cursor-ARRAY['key','created_at','id']<>'{}'::jsonb
      OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(v_cursor->'created_at') NOT IN ('string','null')
      OR NOT(v_cursor?'created_at') THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023';END IF;
    -- Un id o una fecha mal formados son un cursor invalido (22023 -> 409 en la
    -- ruta), no un error interno (22P02/22007 -> 503) como en v2.
    BEGIN
      v_time:=(v_cursor->>'created_at')::timestamptz;v_id:=(v_cursor->>'id')::uuid;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023';
    END;
  END IF;
  IF p_request->'cell_cursor' IS NOT NULL AND p_request->'cell_cursor'<>'null'::jsonb THEN
    IF jsonb_typeof(p_request->'cell_cursor')<>'object' OR (p_request->'cell_cursor')-ARRAY['x','y']<>'{}'::jsonb
      OR jsonb_typeof(p_request->'cell_cursor'->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p_request->'cell_cursor'->'y') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    -- Limites de Mexico en milesimas: -118.5..-86.5 y 14.5..32.8.
    IF (p_request->'cell_cursor'->>'x')::numeric NOT BETWEEN -118500 AND -86500 OR (p_request->'cell_cursor'->>'y')::numeric NOT BETWEEN 14500 AND 32800 THEN RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    IF trunc((p_request->'cell_cursor'->>'x')::numeric)<>(p_request->'cell_cursor'->>'x')::numeric OR trunc((p_request->'cell_cursor'->>'y')::numeric)<>(p_request->'cell_cursor'->>'y')::numeric THEN RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    v_after_x:=(p_request->'cell_cursor'->>'x')::integer;v_after_y:=(p_request->'cell_cursor'->>'y')::integer;
    IF (p_request->'cell_cursor'->>'x')::numeric<>v_after_x OR (p_request->'cell_cursor'->>'y')::numeric<>v_after_y THEN
      RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
  END IF;
  v_term:=translate(lower(v_term),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc');
  WITH eligible AS MATERIALIZED (
    SELECT ps.id,ps.creador_id,ps.titulo,ps.slug,ps.precio,ps.modo_precio::text,ps.tipo::text,
      ps.imagen_principal,ps.created_at,ps.ubicacion_precision AS precision,ps.ubicacion_revision AS revision_ubicacion,
      public.profile_public_name(pr.nombre, pr.es_vendedor, pr.seller_type, pr.nombre_negocio) AS vendedor_nombre,
      coalesce((SELECT c.slug FROM product_categories pc JOIN categories c ON c.id=pc.categoria_id
        WHERE pc.product_id=ps.id ORDER BY pc.is_primary DESC,c.slug LIMIT 1),ps.categoria) AS categoria,
      round(ST_X(pp.punto)::numeric*1000)::integer AS x, round(ST_Y(pp.punto)::numeric*1000)::integer AS y,
      ST_X(pp.punto) AS public_lng, ST_Y(pp.punto) AS public_lat,
      'cell:'||v_stride||':'||floor(round(ST_X(pp.punto)::numeric*1000)/v_stride)::text
        ||':'||floor(round(ST_Y(pp.punto)::numeric*1000)/v_stride)::text AS cell_id,
      count(*) OVER (PARTITION BY ps.creador_id,ST_X(pp.punto),ST_Y(pp.punto)) AS seller_listing_count
    FROM products_services ps JOIN profiles pr ON pr.id=ps.creador_id
    -- P: el punto exacto si el vendedor lo eligio y confirmo, si no la rejilla
    -- aproximada. TODO lo publico (celda, promedio, bounds, filtros) sale de P.
    CROSS JOIN LATERAL (SELECT public.ubicacion_publica_punto(ps.ubicacion_precision,ps.ubicacion_exacta,ps.ubicacion_geo,v_decimales) AS punto) pp
    WHERE ps.estatus='disponible' AND ps.is_hidden=false AND pr.is_hidden=false
      AND ps.ubicacion_geo IS NOT NULL AND pp.punto IS NOT NULL
      -- Prefiltro con el indice GIST de ubicacion_geo, holgado 0.006 grados (P
      -- nunca se aleja mas de 0.005 del punto guardado); el filtro que manda es
      -- el de P de la linea siguiente, asi que el resultado solo depende de P.
      AND ps.ubicacion_geo && ST_MakeEnvelope(v_w-0.006,v_s-0.006,v_e+0.006,v_n+0.006,4326)::geography
      AND pp.punto && ST_MakeEnvelope(v_w,v_s,v_e,v_n,4326)
      AND dentro_de_cobertura(ST_Y(pp.punto),ST_X(pp.punto))
      AND (v_viewer IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id=v_viewer AND ub.blocked_id=ps.creador_id)
           OR (ub.blocked_id=v_viewer AND ub.blocker_id=ps.creador_id)))
      AND (v_coverage_lat IS NULL OR ST_DWithin(pp.punto::geography, ST_SetSRID(ST_MakePoint(v_coverage_lng,v_coverage_lat),4326)::geography,50000))
      AND (v_mode='zone' OR ST_DWithin(pp.punto::geography,
        ST_SetSRID(ST_MakePoint(v_center_lng,v_center_lat),4326)::geography,v_radius))
      AND (v_tipo IS NULL OR ps.tipo::text=v_tipo)
      AND (v_min IS NULL OR ps.precio>=v_min) AND (v_max IS NULL OR ps.precio<=v_max)
      AND (cardinality(v_categories)=0 OR EXISTS (SELECT 1 FROM product_categories pc
        JOIN categories c ON c.id=pc.categoria_id WHERE pc.product_id=ps.id AND c.slug=ANY(v_categories)))
      AND (v_term='' OR strpos(translate(lower(ps.titulo),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(coalesce(ps.descripcion,'')),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(public.profile_public_name(pr.nombre, pr.es_vendedor, pr.seller_type, pr.nombre_negocio)),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0)

  ), stamp AS (
    SELECT md5(v_key||coalesce(string_agg(md5(jsonb_build_array(id,creador_id,titulo,slug,precio,modo_precio,tipo,imagen_principal,created_at,vendedor_nombre,categoria,public_lat,public_lng,precision,revision_ubicacion)::text),'' ORDER BY id),'')) AS revision FROM eligible
  ), cells AS MATERIALIZED (
    -- punto: solo cuando TODAS las publicaciones de la celda son exactas y
    -- comparten el mismo punto; si no, la celda se pinta en su nodo como hoy.
    SELECT x,y,count(*) AS count,count(DISTINCT creador_id) AS seller_count,
      CASE WHEN bool_and(precision='exacta') AND min(public_lng)=max(public_lng) AND min(public_lat)=max(public_lat)
        THEN jsonb_build_object('lat',min(public_lat),'lng',min(public_lng)) END AS punto
    FROM eligible GROUP BY x,y
  ), overview AS (
    SELECT 'cell:'||v_overview_stride||':'||floor(x::numeric/v_overview_stride)::text||':'||floor(y::numeric/v_overview_stride)::text AS id,
      avg(public_lat) AS public_lat,avg(public_lng) AS public_lng,count(*) AS count,count(DISTINCT creador_id) AS seller_count,
      CASE WHEN bool_and(precision='exacta') AND min(public_lng)=max(public_lng) AND min(public_lat)=max(public_lat) THEN 'exacta' END AS precision,
      jsonb_build_object('west',min(public_lng),'south',min(public_lat),'east',max(public_lng),'north',max(public_lat)) AS bounds
    FROM eligible GROUP BY floor(x::numeric/v_overview_stride),floor(y::numeric/v_overview_stride)
  ), cell_batch AS MATERIALIZED (
    SELECT * FROM cells WHERE v_action='cells' AND (v_after_x IS NULL OR (x,y)>(v_after_x,v_after_y)) ORDER BY x,y LIMIT 301
  ), cell_page AS MATERIALIZED (SELECT * FROM cell_batch ORDER BY x,y LIMIT 300),
  focused AS MATERIALIZED (
    SELECT * FROM eligible WHERE v_action='listings' AND (v_cell IS NULL OR (floor(x::numeric/v_node_stride)=v_node_x AND floor(y::numeric/v_node_stride)=v_node_y))
  ), batch AS MATERIALIZED (
    SELECT * FROM focused WHERE v_id IS NULL OR (v_time IS NULL AND created_at IS NULL AND id<v_id)
      OR (v_time IS NOT NULL AND (created_at<v_time OR(created_at=v_time AND id<v_id) OR created_at IS NULL))
    ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 31
  ), page AS MATERIALIZED (SELECT * FROM batch ORDER BY created_at DESC NULLS LAST,id DESC LIMIT 30)
  SELECT jsonb_build_object('query_key',md5(v_key||coalesce(v_cell,'all')||stamp.revision),'projection_version',2,'revision',stamp.revision,'as_of',statement_timestamp(),
    'features',CASE WHEN v_action IN('overview','check') THEN coalesce((SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(o)) ORDER BY id) FROM overview o),'[]'::jsonb) ELSE '[]'::jsonb END,
    'cells',coalesce((SELECT jsonb_agg(jsonb_strip_nulls(to_jsonb(c)) ORDER BY x,y) FROM cell_page c),'[]'::jsonb),
    'next_cell_cursor',CASE WHEN(SELECT count(*) FROM cell_batch)>300 THEN (SELECT jsonb_build_object('x',x,'y',y) FROM cell_page ORDER BY x DESC,y DESC LIMIT 1) ELSE NULL END,
    'complete',v_action='cells' AND (SELECT count(*) FROM cell_batch)<=300,
    'total',(SELECT count(*) FROM eligible),'seller_total',(SELECT count(DISTINCT creador_id) FROM eligible),'list_total',(SELECT count(*) FROM focused),'list_seller_total',(SELECT count(DISTINCT creador_id) FROM focused),
    'listings',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'creador_id',p.creador_id,'titulo',p.titulo,'slug',p.slug,'precio',p.precio,
      'modo_precio',p.modo_precio,'tipo',p.tipo,'imagen_principal',p.imagen_principal,'created_at',p.created_at,'vendedor_nombre',p.vendedor_nombre,
      'categoria',p.categoria,'cell_id',coalesce(v_cell,p.cell_id),'seller_listing_count',p.seller_listing_count) ORDER BY p.created_at DESC NULLS LAST,p.id DESC) FROM page p),'[]'::jsonb),
    'next_cursor',CASE WHEN(SELECT count(*) FROM batch)>30 THEN(SELECT jsonb_build_object('key',md5(v_key||coalesce(v_cell,'all')||stamp.revision),'created_at',created_at,'id',id)
      FROM page ORDER BY created_at ASC NULLS FIRST,id ASC LIMIT 1) ELSE NULL END) INTO v_result FROM stamp;
  IF v_action<>'check' AND v_revision IS NOT NULL AND v_revision<>v_result->>'revision' THEN RAISE EXCEPTION 'Stale coverage revision' USING ERRCODE='22023';END IF;
  IF v_id IS NOT NULL AND v_cursor->>'key' IS DISTINCT FROM v_result->>'query_key' THEN RAISE EXCEPTION 'Stale listing cursor' USING ERRCODE='22023';END IF;
  RETURN v_result;
END;
$map$;
REVOKE ALL ON FUNCTION public.search_map_publications_v4(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_map_publications_v4(jsonb) TO authenticated, service_role;
COMMENT ON FUNCTION public.search_map_publications_v4(jsonb) IS
  'GEO-PUB-EXACT: contrato de v3 sobre el punto publico autorizado (ubicacion_publica_punto): exacto si el vendedor lo eligio, si no la rejilla de 2 o 3 decimales (clave rejilla de la peticion, 2 por defecto). cells[].punto y features[].precision solo para ubicaciones exactas. No devuelve ubicacion_geo.';

DO $verify$
DECLARE
  v_columna text;
BEGIN
  FOREACH v_columna IN ARRAY ARRAY['ubicacion_precision', 'ubicacion_exacta', 'ubicacion_revision'] LOOP
    IF has_column_privilege('anon', 'public.products_services', v_columna, 'SELECT')
       OR has_column_privilege('authenticated', 'public.products_services', v_columna, 'SELECT') THEN
      RAISE EXCEPTION '% quedo legible por clientes: revisa los privilegios de products_services', v_columna;
    END IF;
  END LOOP;
  IF has_column_privilege('authenticated', 'public.products_services', 'ubicacion_exacta', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.products_services', 'ubicacion_revision', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated puede actualizar ubicacion_exacta o ubicacion_revision';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.products_services', 'ubicacion_precision', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated no puede actualizar ubicacion_precision: el formulario fallaria con 42501';
  END IF;
  IF has_function_privilege('anon', 'public.search_map_publications_v4(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede ejecutar search_map_publications_v4';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.search_map_publications_v4(jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated no puede ejecutar search_map_publications_v4';
  END IF;
  IF has_function_privilege('authenticated', 'public.ubicacion_publica_de_publicacion(uuid, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ubicacion_publica_de_publicacion(uuid, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ubicacion_publica_de_publicacion quedo ejecutable por clientes';
  END IF;
  IF has_function_privilege('anon', 'public.ubicacion_de_mi_publicacion(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede ejecutar ubicacion_de_mi_publicacion';
  END IF;
  IF has_function_privilege('authenticated', 'public.ubicacion_publica_punto(text, public.geometry, public.geography, integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.ubicacion_publica_punto(text, public.geometry, public.geography, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ubicacion_publica_punto quedo ejecutable por clientes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.products_services'::regclass
                  AND tgname = 'zz_ubicacion_publica_derivada' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta el trigger zz_ubicacion_publica_derivada';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('search_map_publications_v1', 'search_map_publications_v2',
        'search_map_publications_v3', 'search_map_publications_v4')) <> 4 THEN
    RAISE EXCEPTION 'search_map_publications_v1..v4 duplicada o ausente';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';

-- VERIFY (despues de aplicar, en solo lectura):
--
--   SELECT ubicacion_precision, count(*), count(ubicacion_exacta), max(ubicacion_revision)
--     FROM public.products_services GROUP BY 1;
--   -- esperado justo despues de aplicar: una sola fila, 'aproximada', 0 exactas, revision 0
--
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.products_services'::regclass
--      AND NOT tgisinternal ORDER BY tgname;
--   -- esperado: zz_ubicacion_publica_derivada el ultimo
--
--   Con el sub de una cuenta real (BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';):
--     SELECT (public.search_map_publications_v4('{"action":"overview","rejilla":2,"query":{"bounds":{"west":-98.4,"south":18.9,"east":-98.0,"north":19.2}}}'::jsonb))->'total';
--     SELECT (public.search_map_publications_v2('{"action":"overview","query":{"bounds":{"west":-98.4,"south":18.9,"east":-98.0,"north":19.2}}}'::jsonb))->'total';
--     -- esperado: el mismo total (con rejilla 2 y sin exactas, v4 ve lo mismo que v2)
--   ROLLBACK;
