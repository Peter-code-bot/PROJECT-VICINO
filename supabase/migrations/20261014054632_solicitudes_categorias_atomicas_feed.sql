-- SC02 / SC-DATA-01. Additive rollout: legacy feed remains available.
CREATE INDEX IF NOT EXISTS idx_requests_open_cursor
  ON public.purchase_requests(created_at DESC, id DESC) WHERE status = 'open';

CREATE OR REPLACE FUNCTION public.feed_nearby_requests_v2(
  user_lat double precision, user_lng double precision,
  radius_meters integer DEFAULT 25000, cursor_time timestamptz DEFAULT NULL,
  cursor_id uuid DEFAULT NULL, result_limit integer DEFAULT 12, cat_slug text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, buyer_id uuid, title varchar, description text,
  budget_estimated numeric, image_url text, status public.request_status,
  expires_at timestamptz, created_at timestamptz, distance_meters integer,
  buyer_profile jsonb, categories jsonb, response_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH snapped AS (
    SELECT round(user_lat::numeric,3)::float8 AS lat,
           round(user_lng::numeric,3)::float8 AS lng,
           least(greatest((ceil(coalesce(radius_meters,25000)::float8/100)*100+100)::integer,1000),50000) AS radius,
           (SELECT auth.uid()) AS viewer
    WHERE user_lat BETWEEN -90 AND 90 AND user_lng BETWEEN -180 AND 180 AND (SELECT auth.uid()) IS NOT NULL
  )
  SELECT r.id,r.buyer_id,r.title,r.description,r.budget_estimated,r.image_url,
    r.status,r.expires_at,r.created_at,
    (ceil(public.ST_Distance(r.ubicacion_geo,public.ST_MakePoint(s.lng,s.lat)::public.geography)/100)*100)::integer,
    jsonb_build_object('nombre',p.nombre,'avatar_url',p.foto),
    coalesce((SELECT jsonb_agg(jsonb_build_object('slug',c.slug,'nombre',c.nombre) ORDER BY c.slug,c.id)
      FROM public.purchase_request_categories rc JOIN public.categories c ON c.id=rc.categoria_id
      WHERE rc.request_id=r.id),'[]'::jsonb),
    (SELECT count(*) FROM public.request_responses rr WHERE rr.request_id=r.id)
  FROM public.purchase_requests r JOIN public.profiles p ON p.id=r.buyer_id
  CROSS JOIN snapped s
  WHERE r.status='open' AND r.expires_at>now() AND r.created_at IS NOT NULL AND r.created_at<=now()
    AND r.ubicacion_geo IS NOT NULL AND p.is_hidden=false
    AND public.ST_DWithin(r.ubicacion_geo,public.ST_MakePoint(s.lng,s.lat)::public.geography,s.radius)
    AND (cursor_time IS NULL OR (cursor_id IS NOT NULL AND (r.created_at,r.id)<(cursor_time,cursor_id)))
    AND (cat_slug IS NULL OR EXISTS(SELECT 1 FROM public.purchase_request_categories rc
      JOIN public.categories c ON c.id=rc.categoria_id WHERE rc.request_id=r.id AND c.slug=cat_slug))
    AND (s.viewer IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_blocks b
      WHERE (b.blocker_id=s.viewer AND b.blocked_id=r.buyer_id)
         OR (b.blocker_id=r.buyer_id AND b.blocked_id=s.viewer)))
  ORDER BY r.created_at DESC,r.id DESC
  LIMIT greatest(1,least(coalesce(result_limit,12),50));
$function$;
REVOKE ALL ON FUNCTION public.feed_nearby_requests_v2(float8,float8,integer,timestamptz,uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.feed_nearby_requests_v2(float8,float8,integer,timestamptz,uuid,integer,text) TO authenticated;

-- Discover ALL categories in the eligible zone, not only those in the first page.
CREATE OR REPLACE FUNCTION public.nearby_request_categories(
  user_lat double precision,user_lng double precision,radius_meters integer DEFAULT 25000
)
RETURNS TABLE(slug text,nombre text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH snapped AS (
    SELECT round(user_lat::numeric,3)::float8 AS lat,round(user_lng::numeric,3)::float8 AS lng,
      least(greatest((ceil(coalesce(radius_meters,25000)::float8/100)*100+100)::integer,1000),50000) AS radius,
      (SELECT auth.uid()) AS viewer
    WHERE user_lat BETWEEN -90 AND 90 AND user_lng BETWEEN -180 AND 180 AND (SELECT auth.uid()) IS NOT NULL
  )
  SELECT c.slug::text,c.nombre::text FROM public.categories c
  WHERE EXISTS (
    SELECT 1 FROM public.purchase_request_categories rc
    JOIN public.purchase_requests r ON r.id=rc.request_id
    JOIN public.profiles p ON p.id=r.buyer_id CROSS JOIN snapped s
    WHERE rc.categoria_id=c.id AND r.status='open' AND r.expires_at>now()
      AND r.created_at IS NOT NULL AND r.created_at<=now() AND r.ubicacion_geo IS NOT NULL AND p.is_hidden=false
      AND public.ST_DWithin(r.ubicacion_geo,public.ST_MakePoint(s.lng,s.lat)::public.geography,s.radius)
      AND (s.viewer IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_blocks b
        WHERE (b.blocker_id=s.viewer AND b.blocked_id=r.buyer_id)
           OR (b.blocker_id=r.buyer_id AND b.blocked_id=s.viewer)))
  ) ORDER BY c.nombre,c.slug;
$function$;
REVOKE ALL ON FUNCTION public.nearby_request_categories(float8,float8,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.nearby_request_categories(float8,float8,integer) TO authenticated;

-- Private receipt: no coordinates or payload leave the database. RLS denies
-- direct access; the private function is exposed only via an authenticated wrapper.
CREATE SCHEMA IF NOT EXISTS vicino_guard;
CREATE TABLE IF NOT EXISTS vicino_guard.request_creation_operations(
  operation_id uuid PRIMARY KEY, buyer_id uuid NOT NULL,
  payload_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vicino_guard.request_creation_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vicino_guard.request_creation_operations FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION vicino_guard.create_purchase_request_v2(
  operation_id uuid,request_title text,request_lat float8,request_lng float8,
  category_slugs text[],request_description text DEFAULT NULL,
  request_budget numeric DEFAULT NULL,request_image_url text DEFAULT NULL,expiry_hours integer DEFAULT 72
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  viewer uuid := auth.uid();
  normalized_slugs text[];
  category_ids uuid[];
  fingerprint text;
  receipt vicino_guard.request_creation_operations%ROWTYPE;
BEGIN
  IF viewer IS NULL THEN
    RAISE EXCEPTION 'Inicia sesion para publicar' USING ERRCODE='42501';
  END IF;
  IF operation_id IS NULL OR request_title IS NULL OR char_length(btrim(request_title)) NOT BETWEEN 3 AND 100
    OR coalesce(char_length(request_description),0)>2000
    OR request_lat IS NULL OR request_lng IS NULL OR NOT(request_lat BETWEEN -90 AND 90 AND request_lng BETWEEN -180 AND 180)
    OR expiry_hours IS NULL OR expiry_hours NOT IN(24,72,168)
    OR (request_budget IS NOT NULL AND NOT(request_budget BETWEEN 0 AND 99999999.99))
    OR (request_image_url IS NOT NULL AND (char_length(request_image_url)>2048 OR request_image_url !~ '^https://'))
    OR category_slugs IS NULL OR cardinality(category_slugs) NOT BETWEEN 1 AND 3
    OR EXISTS(SELECT 1 FROM unnest(category_slugs) AS c(slug) WHERE c.slug IS NULL OR c.slug='') THEN
    RAISE EXCEPTION 'Solicitud invalida' USING ERRCODE='22023';
  END IF;
  SELECT array_agg(DISTINCT c.slug ORDER BY c.slug) INTO normalized_slugs FROM unnest(category_slugs) AS c(slug);
  IF cardinality(normalized_slugs)<>cardinality(category_slugs) THEN
    RAISE EXCEPTION 'Categorias invalidas' USING ERRCODE='22023';
  END IF;
  fingerprint := md5(jsonb_build_array(btrim(request_title),nullif(btrim(request_description),''),request_budget,
    request_image_url,request_lat,request_lng,expiry_hours,normalized_slugs)::text);
  -- Serialize two deliveries of the same operation before checking its receipt.
  PERFORM pg_advisory_xact_lock(hashtextextended(operation_id::text,0));
  SELECT * INTO receipt FROM vicino_guard.request_creation_operations o WHERE o.operation_id=create_purchase_request_v2.operation_id;
  IF FOUND THEN
    IF receipt.buyer_id<>viewer OR receipt.payload_hash<>fingerprint
      OR NOT EXISTS(SELECT 1 FROM public.purchase_requests r WHERE r.id=operation_id AND r.buyer_id=viewer) THEN
      RAISE EXCEPTION 'No se puede repetir esta operacion' USING ERRCODE='22023';
    END IF;
    RETURN operation_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=viewer AND p.is_hidden=false) THEN
    RAISE EXCEPTION 'Tu cuenta no puede publicar' USING ERRCODE='42501';
  END IF;
  SELECT array_agg(c.id ORDER BY c.slug) INTO category_ids FROM public.categories c WHERE c.slug=ANY(normalized_slugs) AND c.activo=true;
  IF coalesce(cardinality(category_ids),0)<>cardinality(normalized_slugs) THEN
    RAISE EXCEPTION 'Categorias invalidas' USING ERRCODE='22023';
  END IF;
  -- Existing coverage trigger remains authoritative and can reject this INSERT.
  INSERT INTO public.purchase_requests(id,buyer_id,title,description,budget_estimated,image_url,ubicacion_geo,expires_at)
    VALUES(operation_id,viewer,btrim(request_title),nullif(btrim(request_description),''),request_budget,request_image_url,
      public.ST_SetSRID(public.ST_MakePoint(request_lng,request_lat),4326)::public.geography,
      now()+make_interval(hours=>expiry_hours));
  INSERT INTO public.purchase_request_categories(request_id,categoria_id)
    SELECT operation_id,c.id FROM unnest(category_ids) AS c(id);
  INSERT INTO vicino_guard.request_creation_operations(operation_id,buyer_id,payload_hash)
    VALUES(operation_id,viewer,fingerprint);
  RETURN operation_id;
END;
$function$;
REVOKE ALL ON FUNCTION vicino_guard.create_purchase_request_v2(uuid,text,float8,float8,text[],text,numeric,text,integer) FROM PUBLIC,anon;
GRANT USAGE ON SCHEMA vicino_guard TO authenticated;
GRANT EXECUTE ON FUNCTION vicino_guard.create_purchase_request_v2(uuid,text,float8,float8,text[],text,numeric,text,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_purchase_request_v2(
  operation_id uuid,request_title text,request_lat float8,request_lng float8,
  category_slugs text[],request_description text DEFAULT NULL,
  request_budget numeric DEFAULT NULL,request_image_url text DEFAULT NULL,expiry_hours integer DEFAULT 72
) RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = ''
AS $function$
  SELECT vicino_guard.create_purchase_request_v2(operation_id,request_title,request_lat,request_lng,
    category_slugs,request_description,request_budget,request_image_url,expiry_hours);
$function$;
REVOKE ALL ON FUNCTION public.create_purchase_request_v2(uuid,text,float8,float8,text[],text,numeric,text,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_purchase_request_v2(uuid,text,float8,float8,text[],text,numeric,text,integer) TO authenticated;
