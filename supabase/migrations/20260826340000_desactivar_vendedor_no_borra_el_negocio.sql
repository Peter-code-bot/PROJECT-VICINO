-- Desactivar el Modo Vendedor BORRABA el nombre del negocio. Ya no.
--
-- Comprobado ejercitandolo bajo rol real, en transaccion revertida: un vendedor
-- con nombre_negocio "Tortas Lupita", su descripcion y sus metodos de pago, al
-- desactivar se quedaba con los TRES en NULL. Y seller_type volvia a 'casual'.
--
-- Dos cosas lo hacian grave:
--
--   1. La confirmacion solo avisaba de que las publicaciones se pausan, y decia
--      "podras reactivarlos si vuelves a activar el modo vendedor". Eso da a
--      entender que se recupera todo. El nombre del negocio no volvia.
--
--   2. Esa confirmacion solo aparecia si el vendedor tenia publicaciones
--      ACTIVAS (profile-form.tsx: turningSellerOff && activeProductCount > 0).
--      Con cero publicaciones no salia ningun aviso: desmarcabas la casilla,
--      guardabas, y el nombre de tu negocio desaparecia en silencio.
--
-- El borrado tampoco era necesario para nada. Lo que evita que un no-vendedor
-- muestre su nombre de negocio no es que la columna este vacia: es el render,
-- que ya exige es_vendedor (profile-header.tsx pinta nombre_negocio solo si
-- profile.es_vendedor && seller_type === 'business'). Se estaba destruyendo un
-- dato para conseguir algo que la pantalla ya conseguia sola.
--
-- Ahora, al desactivar, esos tres campos se CONSERVAN. Reactivar devuelve el
-- negocio tal como estaba, y la frase "podras reactivarlos" pasa a ser cierta.
--
-- El camino de ACTIVAR no cambia: ahi los valores siguen viniendo del
-- formulario, incluido pasar de negocio a casual, que sigue limpiandolos.
--
-- Cuerpo generado desde pg_get_functiondef de la funcion viva. Solo cambian
-- tres ELSE NULL por su propia columna.

CREATE OR REPLACE FUNCTION public.update_profile_and_pause_products(p_user_id uuid, p_nombre text, p_bio text, p_foto text, p_ubicacion text, p_es_vendedor boolean, p_seller_type text, p_nombre_negocio text, p_descripcion_negocio text, p_metodos_pago_aceptados text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller          UUID := auth.uid();
  v_products_paused INTEGER := 0;
  v_profile_found   INTEGER := 0;
BEGIN
  -- Authorization: caller must be the profile owner. SECURITY DEFINER bypasses
  -- RLS, so we MUST enforce this explicitly. Anonymous calls (v_caller IS
  -- NULL) are rejected.
  IF v_caller IS NULL OR v_caller <> p_user_id THEN
    RAISE EXCEPTION 'No autorizado'
      USING ERRCODE = '42501', HINT = 'auth.uid() must match p_user_id';
  END IF;

  -- Validate seller_type early so we don't half-write on bad input. Mirrors
  -- the zod enum on the client (casual | business).
  IF p_seller_type IS NOT NULL AND p_seller_type NOT IN ('casual', 'business') THEN
    RAISE EXCEPTION 'seller_type inválido: %', p_seller_type
      USING ERRCODE = '22023';
  END IF;

  -- Write #1: profile. Server is the source of truth for the "seller-only
  -- fields are nulled when es_vendedor = false" rule — even if the caller
  -- sends populated values, we coerce them to NULL/casual.
  UPDATE public.profiles
  SET
    nombre                   = p_nombre,
    bio                      = p_bio,
    foto                     = p_foto,
    ubicacion                = p_ubicacion,
    es_vendedor              = p_es_vendedor,
    seller_type              = CASE WHEN p_es_vendedor THEN COALESCE(p_seller_type, 'casual') ELSE 'casual' END,
    nombre_negocio           = CASE WHEN p_es_vendedor THEN p_nombre_negocio        ELSE nombre_negocio END,
    descripcion_negocio      = CASE WHEN p_es_vendedor THEN p_descripcion_negocio   ELSE descripcion_negocio END,
    metodos_pago_aceptados   = CASE WHEN p_es_vendedor THEN p_metodos_pago_aceptados ELSE metodos_pago_aceptados END
  WHERE id = p_user_id;

  GET DIAGNOSTICS v_profile_found = ROW_COUNT;
  IF v_profile_found = 0 THEN
    RAISE EXCEPTION 'Perfil no encontrado para id %', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Write #2: pause any `disponible` products if the user is no longer a
  -- seller. Wrapped in the same transaction as Write #1 by virtue of being
  -- inside the same function — if this fails, the profile UPDATE rolls back.
  IF NOT p_es_vendedor THEN
    UPDATE public.products_services
    SET estatus = 'pausado'
    WHERE creador_id = p_user_id
      AND estatus = 'disponible';

    GET DIAGNOSTICS v_products_paused = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'profile_updated', TRUE,
    'products_paused', v_products_paused
  );
END;
$function$;
