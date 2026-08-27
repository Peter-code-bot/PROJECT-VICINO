-- Alta de vendedor: convertir primero con lo minimo, pedir lo demas despues.
--
-- El patron sale de Instagram, verificado cita a cita en su Centro de ayuda: la
-- conversion a cuenta profesional se resuelve en dos decisiones (categoria y
-- tipo) y a partir de ahi LA CUENTA YA ES PROFESIONAL. Contacto, pagina
-- vinculada y visibilidad vienen despues, todos marcados como omitibles y cada
-- uno con su boton de escape con nombre propio, nunca un "saltar" gris.
--
-- Por que hace falta un RPC y no basta con el formulario de perfil:
--
--   1. authenticated NO tiene UPDATE sobre es_vendedor, seller_type ni
--      categoria_negocio. Comprobado en information_schema: solo INSERT y
--      SELECT. Sin RPC, el alta no puede escribir nada.
--
--   2. update_profile_and_pause_products, que si escribe es_vendedor, hace
--      SOBRESCRITURA COMPLETA del perfil: nombre_negocio = CASE WHEN ... ELSE
--      NULL, y exige nombre, bio, foto y ubicacion como parametros. Llamarlo
--      desde el alta con solo los campos de vendedor BORRARIA el resto del
--      perfil. Son dos operaciones distintas, no la misma con otro nombre.
--
-- Y por que el paso de conversion es real y no cosmetico: la policy
-- "Sellers can create products" sobre products_services exige
-- es_vendedor = true en su WITH CHECK. Comprobado en produccion contra
-- pg_policies, no leido del repo — el archivo de migracion del repo esta
-- desfasado y dice otra cosa.

-- ---------------------------------------------------------------------------
-- 1. Donde se quedo el alta.
--
-- Solo rastrea los pasos POSTERIORES a la conversion. Los dos anteriores
-- (categoria y tipo) viven en el cliente a proposito: son dos pantallas, y
-- perderlas al cerrar la app cuesta menos que mantener estado servidor para
-- ellas. Lo que si duele perder es el avance de DESPUES, porque para entonces
-- la persona ya es vendedora y espera continuar donde iba.
--
-- has_seen_onboarding NO sirve para esto: es de un solo uso y ya gobierna otra
-- cosa (la redireccion a /bienvenida en el layout).
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS alta_vendedor_paso TEXT;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_alta_vendedor_paso_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_alta_vendedor_paso_check
  CHECK (alta_vendedor_paso IS NULL OR alta_vendedor_paso IN ('ubicacion', 'publicacion'));

COMMENT ON COLUMN public.profiles.alta_vendedor_paso IS
  'Paso pendiente del alta de vendedor. NULL = sin alta en curso o ya terminada.';

-- REGLA DURA DE ESTE REPO: profiles otorga privilegios COLUMNA POR COLUMNA, asi
-- que una columna nueva nace SIN NINGUNO. Sin el GRANT SELECT, cualquier
-- consulta que la incluya muere entera con 42501 — no la columna, la consulta.
GRANT SELECT (alta_vendedor_paso) ON public.profiles TO authenticated;
-- Sin UPDATE a proposito: la escriben los dos RPC de abajo.

-- ---------------------------------------------------------------------------
-- 2. La conversion. Es el unico gesto que convierte, y es estrecho por diseno.
-- ---------------------------------------------------------------------------

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

  -- La categoria se valida contra la taxonomia real, no como texto libre. Hoy
  -- el unico valor guardado ('tecnologia') ya es un slug valido, asi que esto
  -- no rompe ningun dato existente. Se admite NULL porque elegir categoria es
  -- omitible: Instagram tampoco la exige para convertir.
  IF p_categoria_negocio IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = p_categoria_negocio AND activo) THEN
    RAISE EXCEPTION 'Esa categoria no existe.' USING ERRCODE = '22023';
  END IF;

  UPDATE profiles
     SET es_vendedor        = TRUE,
         seller_type        = p_seller_type,
         categoria_negocio  = COALESCE(p_categoria_negocio, categoria_negocio),
         -- Tras convertir, el alta continua por la ubicacion.
         alta_vendedor_paso = 'ubicacion'
   WHERE id = v_uid;

  IF NOT FOUND THEN
    -- Un UPDATE de cero filas devolveria exito sin haber escrito nada.
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('es_vendedor', TRUE, 'paso', 'ubicacion');
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Avanzar o terminar el alta.
--
-- Existe separado de la conversion porque los pasos de despues son omitibles y
-- el usuario puede salir en cualquiera: hace falta poder mover el marcador sin
-- volver a tocar es_vendedor.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.avanzar_alta_vendedor(p_paso TEXT)
RETURNS TEXT
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

  IF p_paso IS NOT NULL AND p_paso NOT IN ('ubicacion', 'publicacion') THEN
    RAISE EXCEPTION 'Paso invalido.' USING ERRCODE = '22023';
  END IF;

  -- Solo avanza el alta de quien YA es vendedor: si no, este marcador no
  -- significa nada y dejaria un estado imposible de leer.
  UPDATE profiles
     SET alta_vendedor_paso = p_paso
   WHERE id = v_uid AND es_vendedor = TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Todavia no eres vendedor.' USING ERRCODE = '42501';
  END IF;

  RETURN p_paso;
END;
$$;

REVOKE ALL ON FUNCTION public.activar_modo_vendedor(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.activar_modo_vendedor(TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.avanzar_alta_vendedor(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avanzar_alta_vendedor(TEXT) TO authenticated;

-- VERIFY:
--   SELECT count(*) FROM information_schema.column_privileges
--    WHERE table_name='profiles' AND column_name='alta_vendedor_paso'
--      AND grantee='authenticated';                       -- 1 (solo SELECT)
--   SELECT has_function_privilege('anon','public.activar_modo_vendedor(text,text)','EXECUTE');
--   -- false
