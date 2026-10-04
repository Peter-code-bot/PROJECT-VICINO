-- MP03-D: bounded national Home previews. Only the server can call these RPCs.
-- Eligibility uses the existing operation coverage; geographic values never leave
-- the predicates. No changes to existing functions, table grants or RLS policies.
CREATE OR REPLACE FUNCTION public.home_guest_requests_preview(result_limit integer DEFAULT 12)
RETURNS TABLE (
  id uuid, titulo text, descripcion text, presupuesto_max numeric,
  categoria text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT r.id, r.title::text, left(r.description, 240), r.budget_estimated,
         (SELECT c.slug FROM public.purchase_request_categories rc
            JOIN public.categories c ON c.id = rc.categoria_id
           WHERE rc.request_id = r.id ORDER BY c.slug, c.id LIMIT 1),
         r.created_at
    FROM public.purchase_requests r
    JOIN public.profiles buyer ON buyer.id = r.buyer_id AND buyer.is_hidden = false
   WHERE r.status = 'open' AND r.expires_at > now()
     AND (r.created_at IS NULL OR r.created_at <= now())
     AND r.ubicacion_geo IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.vicino_cobertura WHERE clave = 'operacion')
     AND public.dentro_de_cobertura(public.ST_Y(r.ubicacion_geo::public.geometry), public.ST_X(r.ubicacion_geo::public.geometry))
   ORDER BY r.created_at DESC NULLS LAST, r.id DESC
   LIMIT greatest(1, least(coalesce(result_limit, 12), 12));
$function$;

CREATE OR REPLACE FUNCTION public.home_guest_communities_preview(result_limit integer DEFAULT 12)
RETURNS TABLE (
  id uuid, nombre text, descripcion text, miembros_count integer,
  publicaciones_count integer, ultima_publicacion_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH eligible AS MATERIALIZED (
    SELECT c.id, c.nombre, c.descripcion, c.miembros_count, c.created_at
      FROM public.communities c
     WHERE c.es_privada = false AND c.is_hidden = false AND c.archived_at IS NULL
       AND c.created_at <= now()
       AND NOT EXISTS (SELECT 1 FROM public.profiles owner WHERE owner.id = c.owner_id AND owner.is_hidden = true)
       AND EXISTS (SELECT 1 FROM public.vicino_cobertura WHERE clave = 'operacion')
       AND public.dentro_de_cobertura(public.ST_Y(c.centro::public.geometry), public.ST_X(c.centro::public.geometry))
     ORDER BY c.created_at DESC, c.id DESC
     LIMIT greatest(1, least(coalesce(result_limit, 12), 12))
  )
  SELECT c.id, c.nombre, left(c.descripcion, 240), c.miembros_count,
         activity.total::integer, activity.latest
    FROM eligible c
    CROSS JOIN LATERAL (
      SELECT count(*) AS total, max(p.created_at) AS latest
        FROM public.community_posts p
        JOIN public.profiles author ON author.id = p.author_id AND author.is_hidden = false
       WHERE p.community_id = c.id AND p.parent_post_id IS NULL AND p.is_hidden = false
         AND p.created_at <= now()
    ) activity
   ORDER BY c.created_at DESC, c.id DESC;
$function$;

CREATE OR REPLACE FUNCTION public.home_guest_posts_preview(result_limit integer DEFAULT 12)
RETURNS TABLE (
  id uuid, community_id uuid, community_nombre text, contenido text,
  created_at timestamptz, likes_count integer, comentarios_count integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT p.id, c.id, c.nombre, left(p.cuerpo, 240), p.created_at,
         p.likes_count, p.comentarios_count
    FROM public.community_posts p
    JOIN public.communities c ON c.id = p.community_id
    JOIN public.profiles author ON author.id = p.author_id AND author.is_hidden = false
   WHERE p.parent_post_id IS NULL AND p.is_hidden = false AND p.created_at <= now()
     AND length(btrim(p.cuerpo)) > 0
     AND c.es_privada = false AND c.is_hidden = false AND c.archived_at IS NULL
     AND c.created_at <= now()
     AND NOT EXISTS (SELECT 1 FROM public.profiles owner WHERE owner.id = c.owner_id AND owner.is_hidden = true)
     AND EXISTS (SELECT 1 FROM public.vicino_cobertura WHERE clave = 'operacion')
     AND public.dentro_de_cobertura(public.ST_Y(c.centro::public.geometry), public.ST_X(c.centro::public.geometry))
   ORDER BY p.created_at DESC, p.id DESC
   LIMIT greatest(1, least(coalesce(result_limit, 12), 12));
$function$;

REVOKE ALL ON FUNCTION public.home_guest_requests_preview(integer), public.home_guest_communities_preview(integer), public.home_guest_posts_preview(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.home_guest_requests_preview(integer), public.home_guest_communities_preview(integer), public.home_guest_posts_preview(integer) TO service_role;

-- After restoring the previous application, rollback only these new functions:
-- DROP FUNCTION public.home_guest_requests_preview(integer), public.home_guest_communities_preview(integer), public.home_guest_posts_preview(integer);
