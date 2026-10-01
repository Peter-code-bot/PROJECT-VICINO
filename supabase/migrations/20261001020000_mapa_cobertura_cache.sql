-- S11: additive read-only coverage contract. Projection v1 remains ~1 km.
-- Revision hashes all eligible IDs and public fields in the same SQL snapshot.
-- It is a coherence token, not permission; auth/visibility is checked every time.
CREATE FUNCTION public.search_map_publications_v2(p_request jsonb)
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
BEGIN
  IF jsonb_typeof(p_request) IS DISTINCT FROM 'object' OR octet_length(p_request::text)>8192
    OR p_request-ARRAY['action','query','coverage_center','revision','cell_cursor']<>'{}'::jsonb THEN
    RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
  END IF;
  v_action:=p_request->>'action';v_revision:=p_request->>'revision';p_query:=p_request->'query';
  IF v_action IS NULL OR v_action NOT IN ('overview','cells','listings','check')
    OR (p_request?'revision' AND jsonb_typeof(p_request->'revision') NOT IN ('string','null'))
    OR (v_revision IS NOT NULL AND v_revision!~'^[a-f0-9]{32}$') THEN
    RAISE EXCEPTION 'Invalid coverage request' USING ERRCODE='22023';
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
  v_normalized := jsonb_build_object('bounds',p_query->'bounds','q',v_term,'categories',v_categories,
    'tipo',v_tipo,'price_min',v_min,'price_max',v_max,'mode',v_mode,'radius_meters',v_radius,
    'center_lat',v_center_lat,'center_lng',v_center_lng,'coverage_center',p_request->'coverage_center');
  v_key := md5(v_normalized::text || coalesce(v_viewer::text,'guest'));

  WHILE v_overview_stride<8192 AND (ceil((v_e-v_w)*100/v_overview_stride)+2)*(ceil((v_n-v_s)*100/v_overview_stride)+2)>300 LOOP
    v_overview_stride:=v_overview_stride*2;
  END LOOP;
  IF v_cell IS NOT NULL THEN
    IF split_part(v_cell,':',2)::numeric>8192 OR split_part(v_cell,':',3)::numeric NOT BETWEEN -11850 AND -1 OR split_part(v_cell,':',4)::numeric NOT BETWEEN 0 AND 3280 THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';END IF;
    v_node_stride:=split_part(v_cell,':',2)::integer;v_node_x:=split_part(v_cell,':',3)::integer;v_node_y:=split_part(v_cell,':',4)::integer;
    IF v_node_stride>8192 OR (v_node_stride & (v_node_stride-1))<>0 THEN RAISE EXCEPTION 'Invalid group' USING ERRCODE='22023';END IF;
  END IF;
  v_cursor:=p_query->'cursor';
  IF v_cursor IS NOT NULL AND v_cursor<>'null'::jsonb THEN
    IF jsonb_typeof(v_cursor)<>'object' OR v_cursor-ARRAY['key','created_at','id']<>'{}'::jsonb
      OR jsonb_typeof(v_cursor->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(v_cursor->'created_at') NOT IN ('string','null')
      OR NOT(v_cursor?'created_at') THEN RAISE EXCEPTION 'Invalid cursor' USING ERRCODE='22023';END IF;
    v_time:=(v_cursor->>'created_at')::timestamptz;v_id:=(v_cursor->>'id')::uuid;
  END IF;
  IF p_request->'cell_cursor' IS NOT NULL AND p_request->'cell_cursor'<>'null'::jsonb THEN
    IF jsonb_typeof(p_request->'cell_cursor')<>'object' OR (p_request->'cell_cursor')-ARRAY['x','y']<>'{}'::jsonb
      OR jsonb_typeof(p_request->'cell_cursor'->'x') IS DISTINCT FROM 'number' OR jsonb_typeof(p_request->'cell_cursor'->'y') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    IF (p_request->'cell_cursor'->>'x')::numeric NOT BETWEEN -11850 AND -8650 OR (p_request->'cell_cursor'->>'y')::numeric NOT BETWEEN 1450 AND 3280 THEN RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    IF trunc((p_request->'cell_cursor'->>'x')::numeric)<>(p_request->'cell_cursor'->>'x')::numeric OR trunc((p_request->'cell_cursor'->>'y')::numeric)<>(p_request->'cell_cursor'->>'y')::numeric THEN RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
    v_after_x:=(p_request->'cell_cursor'->>'x')::integer;v_after_y:=(p_request->'cell_cursor'->>'y')::integer;
    IF (p_request->'cell_cursor'->>'x')::numeric<>v_after_x OR (p_request->'cell_cursor'->>'y')::numeric<>v_after_y THEN
      RAISE EXCEPTION 'Invalid cell cursor' USING ERRCODE='22023';END IF;
  END IF;
  v_term:=translate(lower(v_term),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc');
  WITH eligible AS MATERIALIZED (
    SELECT ps.id,ps.creador_id,ps.titulo,ps.slug,ps.precio,ps.modo_precio::text,ps.tipo::text,
      ps.imagen_principal,ps.created_at,pr.nombre AS vendedor_nombre,
      coalesce((SELECT c.slug FROM product_categories pc JOIN categories c ON c.id=pc.categoria_id
        WHERE pc.product_id=ps.id ORDER BY pc.is_primary DESC,c.slug LIMIT 1),ps.categoria) AS categoria,
      round(ST_X(ps.ubicacion_mapa)::numeric*100)::integer AS x, round(ST_Y(ps.ubicacion_mapa)::numeric*100)::integer AS y,
      ST_X(ps.ubicacion_mapa) AS public_lng, ST_Y(ps.ubicacion_mapa) AS public_lat,
      'cell:'||v_stride||':'||floor(round(ST_X(ps.ubicacion_mapa)::numeric*100)/v_stride)::text
        ||':'||floor(round(ST_Y(ps.ubicacion_mapa)::numeric*100)/v_stride)::text AS cell_id,
      count(*) OVER (PARTITION BY ps.creador_id,ST_X(ps.ubicacion_mapa),ST_Y(ps.ubicacion_mapa)) AS seller_listing_count
    FROM products_services ps JOIN profiles pr ON pr.id=ps.creador_id
    WHERE ps.estatus='disponible' AND ps.is_hidden=false AND pr.is_hidden=false
      AND ps.ubicacion_mapa IS NOT NULL
      AND ps.ubicacion_mapa && ST_MakeEnvelope(v_w,v_s,v_e,v_n,4326)
      AND dentro_de_cobertura(ST_Y(ps.ubicacion_mapa),ST_X(ps.ubicacion_mapa))
      AND (v_viewer IS NULL OR NOT EXISTS (SELECT 1 FROM user_blocks ub
        WHERE (ub.blocker_id=v_viewer AND ub.blocked_id=ps.creador_id)
           OR (ub.blocked_id=v_viewer AND ub.blocker_id=ps.creador_id)))
      AND (v_coverage_lat IS NULL OR ST_DWithin(ps.ubicacion_mapa::geography, ST_SetSRID(ST_MakePoint(v_coverage_lng,v_coverage_lat),4326)::geography,50000))
      AND (v_mode='zone' OR ST_DWithin(ps.ubicacion_mapa::geography,
        ST_SetSRID(ST_MakePoint(v_center_lng,v_center_lat),4326)::geography,v_radius))
      AND (v_tipo IS NULL OR ps.tipo::text=v_tipo)
      AND (v_min IS NULL OR ps.precio>=v_min) AND (v_max IS NULL OR ps.precio<=v_max)
      AND (cardinality(v_categories)=0 OR EXISTS (SELECT 1 FROM product_categories pc
        JOIN categories c ON c.id=pc.categoria_id WHERE pc.product_id=ps.id AND c.slug=ANY(v_categories)))
      AND (v_term='' OR strpos(translate(lower(ps.titulo),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(coalesce(ps.descripcion,'')),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0
        OR strpos(translate(lower(pr.nombre),'áàâäéèêëíìîïóòôöúùûüñç','aaaaeeeeiiiioooouuuunc'),v_term)>0)

  ), stamp AS (
    SELECT md5(v_key||coalesce(string_agg(md5(jsonb_build_array(id,creador_id,titulo,slug,precio,modo_precio,tipo,imagen_principal,created_at,vendedor_nombre,categoria,public_lat,public_lng)::text),'' ORDER BY id),'')) AS revision FROM eligible
  ), cells AS MATERIALIZED (
    SELECT x,y,count(*) AS count,count(DISTINCT creador_id) AS seller_count FROM eligible GROUP BY x,y
  ), overview AS (
    SELECT 'cell:'||v_overview_stride||':'||floor(x::numeric/v_overview_stride)::text||':'||floor(y::numeric/v_overview_stride)::text AS id,
      avg(public_lat) AS public_lat,avg(public_lng) AS public_lng,count(*) AS count,count(DISTINCT creador_id) AS seller_count,
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
  SELECT jsonb_build_object('query_key',md5(v_key||coalesce(v_cell,'all')||stamp.revision),'projection_version',1,'revision',stamp.revision,'as_of',statement_timestamp(),
    'features',CASE WHEN v_action IN('overview','check') THEN coalesce((SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM overview o),'[]'::jsonb) ELSE '[]'::jsonb END,
    'cells',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY x,y) FROM cell_page c),'[]'::jsonb),
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
REVOKE ALL ON FUNCTION public.search_map_publications_v2(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_map_publications_v2(jsonb) TO anon,authenticated;
COMMENT ON FUNCTION public.search_map_publications_v2(jsonb) IS 'S11 read-only: complete overview, paged public cells within 50 km, stable groups and fresh details. Same approximate projection v1; no private point grants. Revisions belong to eligible public results and viewer.';
