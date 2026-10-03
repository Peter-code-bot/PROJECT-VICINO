-- H39 / PLAN-20261003-NOMBRE-TIENDA: one visible identity in UI, RPCs and notices.
-- Read the installed definitions: do not overwrite their filters/permissions
-- with an old migration snapshot. All changes participate in the caller's transaction.
CREATE OR REPLACE FUNCTION public.profile_public_name(
  p_nombre text, p_es_vendedor boolean, p_seller_type text, p_nombre_negocio text
) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $name$
  SELECT CASE WHEN p_es_vendedor IS TRUE AND p_seller_type = 'business'
    THEN COALESCE(NULLIF(regexp_replace(p_nombre_negocio, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), 'Tienda')
    ELSE COALESCE(NULLIF(regexp_replace(p_nombre, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), 'Usuario') END;
$name$;
REVOKE ALL ON FUNCTION public.profile_public_name(text, boolean, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_public_name(text, boolean, text, text) TO anon, authenticated, service_role;

DO $migration$
DECLARE
  fn record;
  definition text;
  updated text;
  profile_alias text;
  target_name text;
  targets text[] := ARRAY[
    'notify_new_message', 'notify_sale_confirmation_created', 'notify_new_review',
    'nearby_products', 'search_nearby_products', 'search_nearby_products_v4',
    'feed_nearby_requests', 'get_ranking_hiperlocal',
    'feed_comunidades_explorar', 'feed_muro_comunidad',
    'notificar_comentario_de_comunidad', 'solicitar_union_comunidad',
    'iniciar_conversacion', 'iniciar_confirmacion_venta',
    'search_map_publications_v1', 'search_map_publications_v2'
  ];
BEGIN
  FOREACH target_name IN ARRAY targets LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = target_name) THEN
      RAISE EXCEPTION 'Missing function %. Review the installed definition before applying identity mapping.', target_name;
    END IF;
  END LOOP;
  FOR fn IN
    SELECT p.oid, p.proname, p.prosrc FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY (targets)
  LOOP
    definition := pg_get_functiondef(fn.oid);
    IF strpos(fn.prosrc, 'profile_public_name(') > 0 THEN
      RAISE EXCEPTION 'Identity mapping already present in %. Review the installed definition.', fn.proname;
    END IF;
    updated := definition;
    FOR profile_alias IN
      SELECT DISTINCT m[1] FROM regexp_matches(fn.prosrc,
        '(?:from|join)[[:space:]]+(?:public\.)?profiles[[:space:]]+(?:as[[:space:]]+)?([a-z_][a-z_0-9]*)', 'gi') m
      WHERE lower(m[1]) NOT IN ('where', 'join', 'on', 'order', 'group', 'limit', 'left', 'inner', 'right')
    LOOP
      -- The legacy display_name must not override an active store's identity.
      updated := regexp_replace(updated,
        'COALESCE\(NULLIF\(btrim\(' || profile_alias || '\.display_name\), ''''\), ' || profile_alias || '\.nombre\)',
        profile_alias || '.nombre', 'gi');
      updated := regexp_replace(updated, '\m' || profile_alias || '\.nombre\M',
        'public.profile_public_name(' || profile_alias || '.nombre, ' || profile_alias || '.es_vendedor, ' || profile_alias || '.seller_type, ' || profile_alias || '.nombre_negocio)', 'g');
    END LOOP;
    -- Three notice triggers and the atomic sale RPC read an unaliased profile.
    updated := regexp_replace(updated,
      '(\mselect[[:space:]]+)nombre([[:space:]]+into[[:space:]]+[a-z_0-9]+[[:space:]]+from[[:space:]]+(?:public\.)?profiles\M)',
      '\1public.profile_public_name(nombre, es_vendedor, seller_type, nombre_negocio)\2', 'gi');
    IF updated = definition THEN
      RAISE EXCEPTION 'No profile identity mapping found in %. Review the installed definition.', fn.proname;
    END IF;
    EXECUTE updated;
  END LOOP;
END;
$migration$;

-- Existing invalid rows retain the safe display fallback; future store changes
-- must provide a name. Do not backfill or overwrite the personal identity.
CREATE OR REPLACE FUNCTION public.require_store_name() RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $guard$
BEGIN
  IF NEW.es_vendedor IS TRUE AND NEW.seller_type = 'business'
    AND NULLIF(regexp_replace(NEW.nombre_negocio, '^[[:space:]]+|[[:space:]]+$', '', 'g'), '') IS NULL THEN
    RAISE EXCEPTION 'Escribe el nombre de la tienda' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION public.require_store_name() FROM PUBLIC;
CREATE TRIGGER profiles_require_store_name
BEFORE INSERT OR UPDATE OF nombre_negocio, es_vendedor, seller_type ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.require_store_name();
NOTIFY pgrst, 'reload schema';
