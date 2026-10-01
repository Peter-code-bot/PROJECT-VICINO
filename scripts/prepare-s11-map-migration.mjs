import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const old = readFileSync(path.join(root, 'supabase/migrations/20260930220000_mapa_publicaciones_aproximadas.sql'), 'utf8');
const validation = old.slice(old.indexOf('  IF p_query IS NULL'), old.indexOf('  v_cursor :=')).replace("'cell_id',v_cell", "'coverage_center',p_request->'coverage_center'");
let eligible = old.slice(old.indexOf('  WITH eligible AS MATERIALIZED ('), old.indexOf('  ), cells AS ('));
eligible = eligible.replace('      ST_X(ps.ubicacion_mapa)', '      round(ST_X(ps.ubicacion_mapa)::numeric*100)::integer AS x, round(ST_Y(ps.ubicacion_mapa)::numeric*100)::integer AS y,\n      ST_X(ps.ubicacion_mapa)');
eligible = eligible.replace("      AND (v_mode='zone'", "      AND (v_coverage_lat IS NULL OR ST_DWithin(ps.ubicacion_mapa::geography, ST_SetSRID(ST_MakePoint(v_coverage_lng,v_coverage_lat),4326)::geography,50000))\n      AND (v_mode='zone'");
const sql = `-- S11: additive read-only coverage contract. Projection v1 remains ~1 km.
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
${validation}
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
${eligible}
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
`;
writeFileSync(path.join(root,'supabase/migrations/20261001020000_mapa_cobertura_cache.sql'),sql);
console.log('S11 additive migration prepared; no database mutation executed.');
