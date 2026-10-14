-- Categories and group photos. Community-only catalog; existing wall media is untouched.
-- Photo ACL is independent of REST metadata access. No raw centers leave these RPCs.
CREATE TABLE public.community_categories (
  id text PRIMARY KEY, nombre text NOT NULL,
  source_category_id uuid UNIQUE REFERENCES public.categories(id),
  activo boolean NOT NULL DEFAULT true,
  CHECK ((id = 'comunidad-vecinal' AND source_category_id IS NULL) OR source_category_id IS NOT NULL)
);
ALTER TABLE public.community_categories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_categories FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.community_categories TO anon, authenticated;
CREATE POLICY community_categories_read ON public.community_categories FOR SELECT TO anon, authenticated USING (activo);
INSERT INTO public.community_categories(id,nombre,source_category_id)
SELECT c.slug, c.nombre, c.id FROM public.categories c WHERE c.activo AND c.slug IN (
'comida', 'postres', 'ropa', 'joyeria', 'tecnologia', 'hogar', 'electrodomesticos', 'belleza', 'salud', 'deportes', 'mascotas', 'bebes', 'vehiculos', 'libros', 'juguetes', 'arte', 'regalos', 'muebles', 'herramientas', 'servicios-hogar', 'educacion', 'deportes-aventura', 'eventos', 'entretenimiento', 'transporte', 'diseno-tech', 'salud-terapias', 'fotografia', 'inmuebles', 'proveedores-mayoreo', 'empleos', 'otros');
INSERT INTO public.community_categories(id,nombre) VALUES ('comunidad-vecinal','Comunidad vecinal');
DO $preflight$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.community_categories WHERE id='otros') THEN
  RAISE EXCEPTION 'Falta la categoria activa otros';
 END IF;
END $preflight$;
ALTER TABLE public.communities ADD COLUMN categoria_id text NOT NULL DEFAULT 'otros' REFERENCES public.community_categories(id);
ALTER TABLE public.communities ADD COLUMN foto_path text;
-- Community writes already go through authorized RPCs; protect the new identity
-- against accidental table-level grants and REST writes during deployment.
REVOKE INSERT, UPDATE ON public.communities FROM anon, authenticated;
ALTER TABLE public.communities ADD CONSTRAINT communities_foto_path_valid CHECK (
 foto_path IS NULL OR (length(foto_path)<=512 AND foto_path ~ ('^'||id::text||'/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$'))
);
-- Existing six fixture groups only; wrong identities abort instead of editing strangers.
DO $backfill$ BEGIN IF EXISTS(SELECT 1 FROM public.communities WHERE id='93f9bc9c-b899-4f47-b0f6-c80e2aa940da' AND nombre IS DISTINCT FROM 'Tecnología Villahermosa') THEN RAISE EXCEPTION 'Identidad inesperada en backfill 93f9bc9c-b899-4f47-b0f6-c80e2aa940da'; END IF; END $backfill$;
UPDATE public.communities SET categoria_id='tecnologia' WHERE id='93f9bc9c-b899-4f47-b0f6-c80e2aa940da' AND nombre='Tecnología Villahermosa';
DO $backfill$ BEGIN IF EXISTS(SELECT 1 FROM public.communities WHERE id='6b777773-f6c8-471e-bbc1-0488837b3cbd' AND nombre IS DISTINCT FROM 'Sabores de Villahermosa') THEN RAISE EXCEPTION 'Identidad inesperada en backfill 6b777773-f6c8-471e-bbc1-0488837b3cbd'; END IF; END $backfill$;
UPDATE public.communities SET categoria_id='comida' WHERE id='6b777773-f6c8-471e-bbc1-0488837b3cbd' AND nombre='Sabores de Villahermosa';
DO $backfill$ BEGIN IF EXISTS(SELECT 1 FROM public.communities WHERE id='1c0eeddd-eadf-4cdd-8b88-f12656910be3' AND nombre IS DISTINCT FROM 'Hogar y Servicios Tabasco') THEN RAISE EXCEPTION 'Identidad inesperada en backfill 1c0eeddd-eadf-4cdd-8b88-f12656910be3'; END IF; END $backfill$;
UPDATE public.communities SET categoria_id='servicios-hogar' WHERE id='1c0eeddd-eadf-4cdd-8b88-f12656910be3' AND nombre='Hogar y Servicios Tabasco';
DO $backfill$ BEGIN IF EXISTS(SELECT 1 FROM public.communities WHERE id='99e60f68-1b50-4713-b7b6-2f1ab7b69fda' AND nombre IS DISTINCT FROM 'Intercambios Tabasco 2000') THEN RAISE EXCEPTION 'Identidad inesperada en backfill 99e60f68-1b50-4713-b7b6-2f1ab7b69fda'; END IF; END $backfill$;
UPDATE public.communities SET categoria_id='comunidad-vecinal' WHERE id='99e60f68-1b50-4713-b7b6-2f1ab7b69fda' AND nombre='Intercambios Tabasco 2000';
DO $backfill$ BEGIN IF EXISTS(SELECT 1 FROM public.communities WHERE id='24278f23-1e68-447a-b0e9-0df9dae01960' AND nombre IS DISTINCT FROM 'Vecinos Tabasco 2000') THEN RAISE EXCEPTION 'Identidad inesperada en backfill 24278f23-1e68-447a-b0e9-0df9dae01960'; END IF; END $backfill$;
UPDATE public.communities SET categoria_id='comunidad-vecinal' WHERE id='24278f23-1e68-447a-b0e9-0df9dae01960' AND nombre='Vecinos Tabasco 2000';
DO $backfill$ BEGIN IF EXISTS(SELECT 1 FROM public.communities WHERE id='7090ab5d-bb07-4f03-82b8-a85d909e1684' AND nombre IS DISTINCT FROM 'Club Emprendedores Vhsa') THEN RAISE EXCEPTION 'Identidad inesperada en backfill 7090ab5d-bb07-4f03-82b8-a85d909e1684'; END IF; END $backfill$;
UPDATE public.communities SET categoria_id='otros' WHERE id='7090ab5d-bb07-4f03-82b8-a85d909e1684' AND nombre='Club Emprendedores Vhsa';

DROP FUNCTION public.mis_comunidades();
create function public.mis_comunidades()
returns table (
  id uuid, nombre text, descripcion text, mi_rol text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  soy_fundador boolean, es_privada boolean, soy_miembro boolean,
  solicitud_pendiente boolean, puedo_entrar boolean,
  disponible boolean, archivada boolean,
  categoria_id text, foto_path text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE v_viewer UUID;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion, m.role,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         COALESCE(c.fundador_id = v_viewer, FALSE),
         c.es_privada, TRUE, FALSE, TRUE,
         (c.is_hidden = FALSE AND c.archived_at IS NULL),
         (c.archived_at IS NOT NULL), c.categoria_id, c.foto_path
    FROM community_members m
    JOIN communities c ON c.id = m.community_id
   WHERE m.user_id = v_viewer
     AND m.left_at IS NULL
   ORDER BY (c.is_hidden = FALSE AND c.archived_at IS NULL) DESC,
            c.ultima_publicacion_at DESC NULLS LAST, c.nombre ASC
   LIMIT public.comunidades_limite('membresias_vivas') + 10;
END;
$function$;
REVOKE ALL ON FUNCTION public.mis_comunidades() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mis_comunidades() TO authenticated;

DROP FUNCTION public.descubrir_comunidades(double precision, double precision, integer);
create function public.descubrir_comunidades(
  p_lat        double precision,
  p_lng        double precision,
  result_limit integer default 30
)
returns table (
  id uuid, nombre text, descripcion text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  distancia_m integer,
  es_privada boolean, soy_miembro boolean, mi_rol text, solicitud_pendiente boolean,
  puedo_entrar boolean,
  categoria_id text, foto_path text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_lat    FLOAT;
  v_lng    FLOAT;
  v_punto  geography;
  v_limite INT;
  c_radio  CONSTANT INT := public.comunidades_limite('radio_descubrir_metros');
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN RETURN; END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  v_limite := LEAST(GREATEST(COALESCE(result_limit, 30), 1),
                    public.comunidades_limite('pagina_descubrir'));

  v_lat := round(p_lat::numeric, 3)::FLOAT;
  v_lng := round(p_lng::numeric, 3)::FLOAT;
  v_punto := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         (CEIL(ST_Distance(c.centro, v_punto) / 500) * 500)::INT,
         c.es_privada,
         FALSE,
         NULL::text,
         EXISTS (SELECT 1 FROM community_join_requests r
                  WHERE r.community_id = c.id AND r.user_id = v_viewer
                    AND r.status = 'pendiente'),
         -- Solo sobre las <= 30 filas que salen: una sonda por fila.
         (NOT c.es_privada
          OR c.owner_id = v_viewer
          OR public.solicitud_aceptada_vigente(c.id, v_viewer)),
         c.categoria_id, CASE WHEN NOT c.es_privada THEN c.foto_path ELSE NULL::text END
    FROM communities c
   WHERE c.is_hidden   = FALSE
     AND c.archived_at IS NULL
     AND c.miembros_count > 0
     AND ST_DWithin(c.centro, v_punto, c_radio)
     AND NOT EXISTS (SELECT 1 FROM community_members m
                      WHERE m.community_id = c.id
                        AND m.user_id      = v_viewer
                        AND m.left_at IS NULL)
     AND (c.owner_id IS NULL OR NOT public.hay_bloqueo_con(c.owner_id))
   ORDER BY c.centro <-> v_punto, c.miembros_count DESC, c.id
   LIMIT v_limite;
END;
$function$;
REVOKE ALL ON FUNCTION public.descubrir_comunidades(double precision, double precision, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.descubrir_comunidades(double precision, double precision, integer) TO authenticated;

DROP FUNCTION public.detalle_comunidad(uuid);
create function public.detalle_comunidad(p_community_id uuid)
returns table (
  id uuid, nombre text, descripcion text,
  miembros_count integer, publicaciones_count integer,
  ultima_publicacion_at timestamp with time zone,
  created_at timestamp with time zone,
  es_privada boolean, disponible boolean,
  soy_miembro boolean, mi_rol text, soy_fundador boolean, solicitud_pendiente boolean,
  puedo_entrar boolean, archivada boolean,
  categoria_id text, foto_path text
)
language plpgsql
stable security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer UUID;
  v_rol    TEXT;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL OR p_community_id IS NULL THEN RETURN; END IF;

  SELECT m.role INTO v_rol
    FROM community_members m
   WHERE m.community_id = p_community_id AND m.user_id = v_viewer AND m.left_at IS NULL;

  RETURN QUERY
  SELECT c.id, c.nombre, c.descripcion,
         c.miembros_count, c.publicaciones_count, c.ultima_publicacion_at,
         c.created_at,
         c.es_privada,
         (c.is_hidden = FALSE AND c.archived_at IS NULL),
         (v_rol IS NOT NULL),
         v_rol,
         COALESCE(c.fundador_id = v_viewer, FALSE),
         EXISTS (SELECT 1 FROM community_join_requests r
                  WHERE r.community_id = c.id AND r.user_id = v_viewer
                    AND r.status = 'pendiente'),
         (v_rol IS NOT NULL
          OR NOT c.es_privada
          OR c.owner_id = v_viewer
          OR public.solicitud_aceptada_vigente(c.id, v_viewer)),
         (c.archived_at IS NOT NULL), c.categoria_id,
         CASE WHEN NOT c.es_privada OR v_rol IS NOT NULL OR c.owner_id = v_viewer THEN c.foto_path ELSE NULL::text END
    FROM communities c
   WHERE c.id = p_community_id
     AND (
       v_rol IS NOT NULL
       OR c.owner_id = v_viewer
       OR (c.is_hidden = FALSE AND c.archived_at IS NULL
           AND (c.owner_id IS NULL OR NOT public.hay_bloqueo_con(c.owner_id)))
     );
END;
$function$;
REVOKE ALL ON FUNCTION public.detalle_comunidad(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detalle_comunidad(uuid) TO authenticated;

-- Keep the deployed four-argument creator compatible during frontend rollout.
-- The new entrypoint requires an explicit community category and commits privacy atomically.
create function public.fundar_comunidad_v2(
  p_nombre      text,
  p_lat         double precision,
  p_lng         double precision,
  p_descripcion text default null::text,
  p_categoria_id text default null,
  p_privada boolean default false,
  p_creation_id uuid default null
)
returns jsonb
language plpgsql
volatile security definer
set search_path to 'public'
as $function$
DECLARE
  v_viewer  UUID;
  v_nombre  TEXT;
  v_desc    TEXT;
  v_lat     FLOAT;
  v_lng     FLOAT;
  v_punto   geography;
  v_id      UUID;
  v_estado  JSONB;
  v_existing public.communities%ROWTYPE;
BEGIN
  v_viewer := (SELECT auth.uid());
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (SELECT 1 FROM profiles pf WHERE pf.id = v_viewer AND pf.is_hidden) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;

  v_nombre := btrim(COALESCE(p_nombre, ''));
  IF char_length(v_nombre) < 3 OR char_length(v_nombre) > 40 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 3 y 40 caracteres.' USING ERRCODE = '22023';
  END IF;

  v_desc := NULLIF(btrim(COALESCE(p_descripcion, '')), '');
  IF v_desc IS NOT NULL AND char_length(v_desc) > 300 THEN
    RAISE EXCEPTION 'La descripcion no puede pasar de 300 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat = 'NaN'::double precision OR p_lng = 'NaN'::double precision
     OR p_lat NOT BETWEEN -90 AND 90
     OR p_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'Ubicacion invalida.' USING ERRCODE = '22023';
  END IF;

  v_lat   := round(p_lat::numeric, 2)::FLOAT;
  v_lng   := round(p_lng::numeric, 2)::FLOAT;
  v_punto := ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326)::geography;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:fundar:' || v_viewer::text, 0));
  PERFORM pg_advisory_xact_lock(
    hashtextextended('comunidad:membresia:' || v_viewer::text, 0));

  IF p_categoria_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.community_categories cc WHERE cc.id = p_categoria_id AND cc.activo) THEN
    RAISE EXCEPTION 'Elige una categoria valida.' USING ERRCODE = '22023';
  END IF;
  IF p_privada IS NULL THEN RAISE EXCEPTION 'Privacidad invalida.' USING ERRCODE = '22023'; END IF;
  IF p_creation_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.communities c WHERE c.id = p_creation_id;
    IF FOUND THEN
      IF v_existing.fundador_id IS DISTINCT FROM v_viewer OR v_existing.owner_id IS DISTINCT FROM v_viewer
         OR v_existing.nombre <> v_nombre OR v_existing.categoria_id <> p_categoria_id OR v_existing.es_privada <> p_privada
         OR v_existing.descripcion IS DISTINCT FROM v_desc OR ST_Distance(v_existing.centro, v_punto) <> 0 THEN
        RAISE EXCEPTION 'Esta creacion ya no se puede repetir.' USING ERRCODE = '42501';
      END IF;
      RETURN jsonb_build_object('id',v_existing.id,'nombre',v_existing.nombre,'es_privada',v_existing.es_privada);
    END IF;
  END IF;

  -- CUOTAS A, B y D: el mismo helper que consulta estado_cuota_fundacion().
  v_estado := public.comunidad_fundacion_estado(v_viewer);
  IF NOT (v_estado->>'puede_fundar')::boolean THEN
    RAISE EXCEPTION '%', v_estado->>'motivo' USING ERRCODE = '23514';
  END IF;

  -- CUOTA C: separacion de 1 km entre las propias. Depende del punto, asi que
  -- vive aqui y no en el helper.
  IF EXISTS (SELECT 1 FROM communities c
              WHERE c.fundador_id = v_viewer
                AND c.archived_at IS NULL
                AND ST_DWithin(c.centro, v_punto,
                               public.comunidades_limite('separacion_propias_metros'))) THEN
    RAISE EXCEPTION 'Ya tienes una comunidad a menos de 1 km de aqui.'
      USING ERRCODE = '23514';
  END IF;

  BEGIN
    INSERT INTO communities (id, nombre, descripcion, owner_id, fundador_id, centro, categoria_id, es_privada)
    VALUES (COALESCE(p_creation_id, gen_random_uuid()), v_nombre, v_desc, v_viewer, v_viewer, v_punto, p_categoria_id, p_privada)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'Ya existe una comunidad con ese nombre por aqui.'
      USING ERRCODE = '23505';
  END;

  INSERT INTO community_members (community_id, user_id, role)
  VALUES (v_id, v_viewer, 'owner');

  RETURN jsonb_build_object('id', v_id, 'nombre', v_nombre, 'es_privada', p_privada);
END;
$function$;
REVOKE ALL ON FUNCTION public.fundar_comunidad_v2(text, double precision, double precision, text, text, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fundar_comunidad_v2(text, double precision, double precision, text, text, boolean, uuid) TO authenticated;

DROP FUNCTION public.home_guest_communities_preview(integer);
CREATE FUNCTION public.home_guest_communities_preview(result_limit integer DEFAULT 12)
RETURNS TABLE (
  id uuid, nombre text, descripcion text, miembros_count integer,
  publicaciones_count integer, ultima_publicacion_at timestamptz, categoria_id text, foto_path text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH eligible AS MATERIALIZED (
    SELECT c.id, c.nombre, c.descripcion, c.miembros_count, c.created_at, c.categoria_id, c.foto_path
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
         activity.total::integer, activity.latest, c.categoria_id, c.foto_path
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
REVOKE ALL ON FUNCTION public.home_guest_communities_preview(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.home_guest_communities_preview(integer) TO service_role;

CREATE SCHEMA IF NOT EXISTS vicino_private;
REVOKE ALL ON SCHEMA vicino_private FROM PUBLIC;
GRANT USAGE ON SCHEMA vicino_private TO anon, authenticated;

-- Policy helpers are non-exposed. UUIDs are compared as text before any cast.
CREATE FUNCTION vicino_private.community_photo_owner(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.communities c
  JOIN public.community_members m ON m.community_id=c.id AND m.user_id=(SELECT auth.uid()) AND m.role='owner' AND m.left_at IS NULL
  JOIN public.profiles pf ON pf.id=m.user_id AND NOT pf.is_hidden
  WHERE c.id::text=split_part(p_path,'/',1) AND c.owner_id=m.user_id AND NOT c.is_hidden AND c.archived_at IS NULL
    AND p_path ~ ('^'||c.id::text||'/'||m.user_id::text||'/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
 );
$function$;
CREATE FUNCTION vicino_private.community_photo_readable(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
 SELECT EXISTS (
  SELECT 1 FROM public.communities c
  WHERE c.foto_path=p_path AND NOT c.is_hidden AND c.archived_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM public.profiles pf WHERE pf.id=c.owner_id AND pf.is_hidden)
    AND ((SELECT auth.uid()) IS NULL OR c.owner_id IS NULL OR NOT public.hay_bloqueo_con(c.owner_id))
    AND (NOT c.es_privada OR EXISTS (
      SELECT 1 FROM public.community_members m WHERE m.community_id=c.id AND m.user_id=(SELECT auth.uid()) AND m.left_at IS NULL
    ))
 );
$function$;
CREATE FUNCTION vicino_private.community_photo_deletable(p_path text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $function$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.communities c
  JOIN public.community_members m ON m.community_id=c.id AND m.user_id=(SELECT auth.uid()) AND m.role='owner' AND m.left_at IS NULL
  JOIN public.profiles pf ON pf.id=m.user_id AND NOT pf.is_hidden
  WHERE c.id::text=split_part(p_path,'/',1) AND c.owner_id=m.user_id AND NOT c.is_hidden AND c.archived_at IS NULL
    AND p_path ~ ('^'||c.id::text||'/[0-9a-f-]{36}/[0-9a-f-]{36}\.webp$')
 ) AND NOT EXISTS (
  SELECT 1 FROM public.communities c WHERE c.foto_path=p_path
 );
$function$;
REVOKE ALL ON FUNCTION vicino_private.community_photo_owner(text), vicino_private.community_photo_readable(text), vicino_private.community_photo_deletable(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION vicino_private.community_photo_owner(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION vicino_private.community_photo_deletable(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION vicino_private.community_photo_readable(text) TO anon, authenticated;

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('community-photos','community-photos',false,5242880,ARRAY['image/webp'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=EXCLUDED.file_size_limit,allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE POLICY community_photo_read ON storage.objects FOR SELECT TO anon, authenticated
 USING(bucket_id='community-photos' AND (vicino_private.community_photo_readable(name) OR ((SELECT auth.uid()) IS NOT NULL AND (vicino_private.community_photo_owner(name) OR vicino_private.community_photo_deletable(name)))));
CREATE POLICY community_photo_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='community-photos' AND vicino_private.community_photo_owner(name));
CREATE POLICY community_photo_cleanup ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='community-photos' AND vicino_private.community_photo_deletable(name));
-- Restrictive guards keep unrelated broad permissive policies from admitting
-- access to this new bucket. Other buckets retain their existing behavior.
CREATE POLICY community_photo_read_guard ON storage.objects AS RESTRICTIVE FOR SELECT TO anon, authenticated
 USING(bucket_id<>'community-photos' OR vicino_private.community_photo_readable(name) OR vicino_private.community_photo_owner(name) OR vicino_private.community_photo_deletable(name));
CREATE POLICY community_photo_upload_guard ON storage.objects AS RESTRICTIVE FOR INSERT TO authenticated
 WITH CHECK(bucket_id<>'community-photos' OR vicino_private.community_photo_owner(name));
CREATE POLICY community_photo_cleanup_guard ON storage.objects AS RESTRICTIVE FOR DELETE TO authenticated
 USING(bucket_id<>'community-photos' OR vicino_private.community_photo_deletable(name));
CREATE POLICY community_photo_immutable_guard ON storage.objects AS RESTRICTIVE FOR UPDATE TO anon, authenticated
 USING(bucket_id<>'community-photos') WITH CHECK(bucket_id<>'community-photos');
-- Immutable objects: there is no UPDATE policy and uploads never use upsert.

CREATE FUNCTION public.editar_identidad_comunidad(p_community_id uuid,p_categoria_id text,p_foto_path text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_viewer uuid := (SELECT auth.uid()); v_actual public.communities%ROWTYPE;
BEGIN
 IF v_viewer IS NULL THEN RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE='42501'; END IF;
 SELECT c.* INTO v_actual FROM public.communities c
 WHERE c.id=p_community_id AND c.owner_id=v_viewer AND NOT c.is_hidden AND c.archived_at IS NULL
 AND EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=c.id AND m.user_id=v_viewer AND m.role='owner' AND m.left_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.profiles pf WHERE pf.id=v_viewer AND pf.is_hidden)
 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solo quien administra puede editar.' USING ERRCODE='42501'; END IF;
 IF p_categoria_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.community_categories cc WHERE cc.id=p_categoria_id AND cc.activo) THEN
  RAISE EXCEPTION 'Elige una categoria valida.' USING ERRCODE='22023';
 END IF;
 IF p_foto_path IS NOT NULL AND p_foto_path IS DISTINCT FROM v_actual.foto_path THEN
  IF NOT vicino_private.community_photo_owner(p_foto_path) OR NOT EXISTS(
    SELECT 1 FROM storage.objects o WHERE o.bucket_id='community-photos' AND o.name=p_foto_path
  ) THEN RAISE EXCEPTION 'Foto invalida.' USING ERRCODE='22023'; END IF;
 END IF;
 UPDATE public.communities SET categoria_id=p_categoria_id,foto_path=p_foto_path WHERE id=p_community_id;
 RETURN jsonb_build_object('categoria_id',p_categoria_id,'foto_path',p_foto_path);
END;
$function$;
REVOKE ALL ON FUNCTION public.editar_identidad_comunidad(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.editar_identidad_comunidad(uuid,text,text) TO authenticated;
