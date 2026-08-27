-- Tres RPC ganan DEFAULT NULL en los parametros que ya aceptaban NULL.
--
-- POR QUE, Y POR QUE NO ES COSMETICO. Al cablear el generic Database en los
-- clientes de Supabase aparecieron 12 errores de tipo con una unica causa:
-- EL CODEGEN DE SUPABASE NO SABE EXPRESAR "ARGUMENTO QUE ACEPTA NULL".
-- Comprobado sobre el archivo generado entero: hay CERO `| null` en todos los
-- bloques Args, mientras que las columnas si lo llevan. Asi que un parametro
-- `p_bio text` —que en la base admite NULL y donde NULL significa
-- literalmente "borra la bio"— se genera como `p_bio: string`, y el codigo
-- que hace lo correcto deja de compilar.
--
-- Las tres salidas que se descartaron:
--
--   1. Un cast (`as string`). Es la peor: deja el generic puesto AFIRMANDO que
--      nunca mandamos NULL, justo en el flujo donde siempre lo mandamos.
--      Parece verificado y no lo esta.
--   2. `?? ''`. No es un problema de tipos, es un cambio de datos: guardaria
--      cadena vacia donde el resto de caminos guardan NULL, dejando la columna
--      con dos representaciones de lo mismo para siempre. Y como todos los
--      consumidores usan `bio &&`, '' es falsy y no se notaria nunca.
--   3. Editar a mano el archivo generado. Se pierde en la proxima regeneracion.
--
-- LO QUE SI FUNCIONA: un parametro CON default se genera como OPCIONAL
-- (`p_bio?: string`). Entonces el cliente omite la clave, PostgREST no manda
-- el parametro, y Postgres aplica el DEFAULT NULL. Mismo valor en la columna,
-- misma semantica, sin un solo cast.
--
-- CUERPOS SIN TOCAR. Los tres se regeneraron con pg_get_functiondef desde la
-- definicion VIVA y solo cambia la linea de la firma. La unica excepcion esta
-- comentada donde ocurre.

-- ── avanzar_alta_vendedor ───────────────────────────────────────────────────
-- p_paso NULL es el valor legitimo de "el alta termino": el propio cuerpo lo
-- admite (`IF p_paso IS NOT NULL AND ...`) y vender/actions.ts lo manda asi al
-- publicar. Sin default, ese caso no compilaba.
CREATE OR REPLACE FUNCTION public.avanzar_alta_vendedor(p_paso text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- ── activar_modo_vendedor ───────────────────────────────────────────────────
-- p_categoria_negocio NULL significa "no cambies la categoria", y el cuerpo ya
-- lo trata asi con COALESCE. p_seller_type ya tenia default.
CREATE OR REPLACE FUNCTION public.activar_modo_vendedor(
  p_categoria_negocio text DEFAULT NULL,
  p_seller_type       text DEFAULT 'casual'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
$function$;

-- ── update_profile_and_pause_products ───────────────────────────────────────
-- Aqui hay una consecuencia que hay que mirar de frente: Postgres exige que,
-- si un parametro tiene default, TODOS los siguientes tambien lo tengan. Y
-- p_es_vendedor va despues de p_bio, asi que se lleva un DEFAULT NULL que NO
-- queremos que nadie use: el cuerpo hace `es_vendedor = p_es_vendedor`, o sea
-- que omitirlo dejaria el perfil con la bandera en NULL.
--
-- Peor todavia: hoy, un p_es_vendedor NULL entra en `IF NOT p_es_vendedor`,
-- que con NULL evalua a NULL y NO ejecuta la rama. O sea que se pondria la
-- bandera en NULL y ADEMAS no se pausarian las publicaciones. Un fallo mudo.
--
-- Por eso este cuerpo SI cambia, en una guarda de tres lineas: omitirlo pasa a
-- ser un error ruidoso en vez de un perfil a medio escribir.
CREATE OR REPLACE FUNCTION public.update_profile_and_pause_products(
  p_user_id                uuid,
  p_nombre                 text,
  p_bio                    text    DEFAULT NULL,
  p_foto                   text    DEFAULT NULL,
  p_ubicacion              text    DEFAULT NULL,
  p_es_vendedor            boolean DEFAULT NULL,
  p_seller_type            text    DEFAULT NULL,
  p_nombre_negocio         text    DEFAULT NULL,
  p_descripcion_negocio    text    DEFAULT NULL,
  p_metodos_pago_aceptados text    DEFAULT NULL
)
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

  -- UNICO cambio de cuerpo respecto a la definicion anterior. p_es_vendedor
  -- solo tiene DEFAULT porque Postgres lo exige (va detras de p_bio), no
  -- porque sea opcional: omitirlo dejaria la bandera en NULL y ademas se
  -- saltaria el pausado, porque `IF NOT NULL` no ejecuta la rama. Que falle
  -- fuerte es exactamente lo que se quiere.
  IF p_es_vendedor IS NULL THEN
    RAISE EXCEPTION 'p_es_vendedor es obligatorio'
      USING ERRCODE = '22023',
            HINT = 'Su DEFAULT existe solo por la regla de Postgres sobre el orden de los parametros.';
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

-- COMPROBACION (tras aplicar):
--   select proname, pg_get_function_arguments(oid) from pg_proc
--    where proname in ('avanzar_alta_vendedor','activar_modo_vendedor',
--                      'update_profile_and_pause_products');
--   -- los parametros nulables deben decir DEFAULT NULL
--
--   node scripts/gen-types.mjs
--   -- y entonces Args declara p_bio?: string, p_paso?: string, etc.
