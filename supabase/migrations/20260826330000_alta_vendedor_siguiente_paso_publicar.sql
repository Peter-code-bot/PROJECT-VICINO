-- Tras convertir, el paso que sigue es PUBLICAR, no registrar la colonia.
--
-- La version anterior de activar_modo_vendedor dejaba alta_vendedor_paso en
-- 'ubicacion' porque el borrador del flujo decia que sin colonia no apareces en
-- el feed. Al comprobar la premisa resulto FALSA:
--
--   - search_nearby_products_v4 exige ps.ubicacion_geo, o sea la ubicacion de
--     CADA PUBLICACION, y no mira pr.ubicacion en ningun punto. Comprobado
--     sobre su prosrc, no leido del repo.
--   - profiles.ubicacion solo se muestra en el perfil
--     (profile-header.tsx:171). No gatea nada.
--   - Y la ubicacion que SI cuenta ya es obligatoria al crear una publicacion:
--     product-form.tsx:508 la exige antes de dejar guardar.
--
-- Poner un candado sobre la colonia habria sido una barrera sobre un campo que
-- no afecta a la visibilidad, mientras el requisito de verdad ya estaba puesto
-- en otro sitio. Se corrige el marcador para que apunte a lo que de verdad
-- falta.
--
-- El CHECK de la columna ya admite los dos valores, asi que esto no necesita
-- tocar la restriccion ni migrar datos: hoy no hay ninguna fila con el alta a
-- medias (la funcion se creo hace minutos).

CREATE OR REPLACE FUNCTION public.activar_modo_vendedor(
  p_categoria_negocio TEXT,
  p_seller_type       TEXT DEFAULT 'casual'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  IF p_seller_type IS NULL OR p_seller_type NOT IN ('casual', 'business') THEN
    RAISE EXCEPTION 'Tipo de vendedor invalido.' USING ERRCODE = '22023';
  END IF;

  IF p_categoria_negocio IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = p_categoria_negocio AND activo) THEN
    RAISE EXCEPTION 'Esa categoria no existe.' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
     SET es_vendedor        = TRUE,
         seller_type        = p_seller_type,
         categoria_negocio  = COALESCE(p_categoria_negocio, categoria_negocio),
         -- Publicar, que es lo unico que hace aparecer a alguien en el feed.
         alta_vendedor_paso = 'publicacion'
   WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('es_vendedor', TRUE, 'paso', 'publicacion');
END;
$$;

-- VERIFY:
--   SELECT prosrc LIKE '%alta_vendedor_paso = ''publicacion''%'
--     FROM pg_proc WHERE proname = 'activar_modo_vendedor';   -- true
