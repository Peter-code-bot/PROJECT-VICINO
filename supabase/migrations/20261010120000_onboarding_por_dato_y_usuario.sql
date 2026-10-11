-- Onboarding por dato. Aplicar antes de la aplicación compatible.
-- El RPC anterior conserva su firma para clientes anteriores de Capacitor.
-- La herramienta de migración envuelve este cuerpo y el ledger juntos.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_onboarding_paso_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_onboarding_paso_check
  CHECK (onboarding_paso IS NULL OR onboarding_paso IN (
    'perfil', 'categoria', 'tipo', 'usuario', 'nombre', 'foto', 'descripcion',
    'pagos', 'intereses', 'ubicacion', 'activar', 'notificaciones', 'listo'
  ));

-- Un @ elegido puede parecer un código Uxxxxxxx. Un alta futura no debe
-- sortearlo como username automático y fallar por el índice único.
CREATE OR REPLACE FUNCTION public.generate_user_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $generated$
DECLARE
  v_new_id text;
BEGIN
  IF NEW.user_id IS NULL THEN
    LOOP
      v_new_id := 'U' || lpad(floor(random() * 10000000)::text, 7, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.profiles
          WHERE user_id = v_new_id OR lower(username) = lower(v_new_id)
      );
    END LOOP;
    NEW.user_id := v_new_id;
  END IF;
  IF NEW.username IS NULL THEN NEW.username := NEW.user_id; END IF;
  RETURN NEW;
END;
$generated$;

-- Una sola política para escritura y consulta. Mantiene los reservados previos.
CREATE OR REPLACE FUNCTION public.username_validation_status(p_username text)
RETURNS text LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $policy$
  SELECT CASE
    WHEN btrim(coalesce(p_username, '')) !~ '^[A-Za-z0-9_]{3,30}$' THEN 'invalid'
    WHEN lower(btrim(p_username)) = ANY (ARRAY[
      'admin', 'administrador', 'administrator', 'moderador', 'moderator',
      'vicino', 'vicinomarket', 'soporte', 'support', 'ayuda', 'help',
      'root', 'sistema', 'system', 'api', 'www', 'oficial', 'official',
      'null', 'undefined', 'anonimo', 'anonymous'
    ]) THEN 'reserved'
    ELSE NULL
  END;
$policy$;
REVOKE ALL ON FUNCTION public.username_validation_status(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.set_username(p_username text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $username$
DECLARE
  v_uid uuid := auth.uid();
  v_limpio text := btrim(coalesce(p_username, ''));
  v_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  v_status := public.username_validation_status(v_limpio);
  IF v_status = 'invalid' THEN
    RAISE EXCEPTION 'El nombre de usuario debe tener entre 3 y 30 caracteres y usar solo letras, numeros y guion bajo.' USING ERRCODE = '22023';
  ELSIF v_status = 'reserved' THEN
    RAISE EXCEPTION 'Ese nombre de usuario esta reservado.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_limpio) AND id <> v_uid) THEN
    RAISE EXCEPTION 'Ese nombre de usuario ya esta en uso.' USING ERRCODE = '23505';
  END IF;
  UPDATE public.profiles SET username = v_limpio WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_limpio;
EXCEPTION WHEN unique_violation THEN
  -- El índice único lower(username) resuelve la carrera posterior al SELECT.
  RAISE EXCEPTION 'Ese nombre de usuario ya esta en uso.' USING ERRCODE = '23505';
END;
$username$;
REVOKE ALL ON FUNCTION public.set_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_username(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.consultar_usuarios_onboarding(
  p_username text DEFAULT NULL,
  p_sugerencias text[] DEFAULT ARRAY[]::text[]
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $lookup$
DECLARE
  v_uid uuid := auth.uid();
  v_username text := btrim(coalesce(p_username, ''));
  v_status text;
  v_message text;
  v_suggestions jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_uid) THEN
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(v_username) > 100 OR coalesce(cardinality(p_sugerencias), 0) > 30 THEN
    RAISE EXCEPTION 'Consulta de usuario invalida.' USING ERRCODE = '22023';
  END IF;

  IF v_username = '' THEN
    v_status := 'empty';
  ELSE
    v_status := public.username_validation_status(v_username);
    IF v_status IS NULL THEN
      v_status := CASE WHEN EXISTS (
        SELECT 1 FROM public.profiles WHERE lower(username) = lower(v_username) AND id <> v_uid
      ) THEN 'taken' ELSE 'available' END;
    END IF;
  END IF;
  v_message := CASE v_status
    WHEN 'invalid' THEN 'Usa entre 3 y 30 caracteres: letras, numeros y guion bajo.'
    WHEN 'reserved' THEN 'Ese nombre de usuario esta reservado.'
    WHEN 'taken' THEN 'Ese nombre de usuario ya esta en uso.'
    WHEN 'available' THEN 'Disponible'
    ELSE NULL END;

  SELECT coalesce(jsonb_agg(candidate ORDER BY position), '[]'::jsonb)
    INTO v_suggestions
    FROM (
      SELECT candidate, position FROM (
        SELECT DISTINCT ON (lower(candidate)) candidate, position
          FROM unnest(coalesce(p_sugerencias, ARRAY[]::text[])) WITH ORDINALITY AS s(candidate, position)
         WHERE public.username_validation_status(candidate) IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM public.profiles p WHERE lower(p.username) = lower(candidate) AND p.id <> v_uid
           )
         ORDER BY lower(candidate), position
      ) unique_candidates ORDER BY position LIMIT 3
    ) available_candidates;

  -- Solo disponibilidad y cadenas sugeridas: nunca datos de otros perfiles.
  RETURN jsonb_build_object('username', v_username, 'status', v_status,
    'message', v_message, 'suggestions', v_suggestions);
END;
$lookup$;
REVOKE ALL ON FUNCTION public.consultar_usuarios_onboarding(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.consultar_usuarios_onboarding(text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.guardar_paso_onboarding_v2(
  p_camino text DEFAULT NULL,
  p_paso text DEFAULT NULL,
  p_nombre text DEFAULT NULL,
  p_bio text DEFAULT NULL,
  p_foto text DEFAULT NULL,
  p_intereses text[] DEFAULT NULL,
  p_username text DEFAULT NULL,
  p_categoria_negocio text DEFAULT NULL,
  p_seller_type text DEFAULT NULL,
  p_nombre_negocio text DEFAULT NULL,
  p_descripcion_negocio text DEFAULT NULL,
  p_metodos_pago_aceptados text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $progress$
DECLARE
  v_uid uuid := auth.uid();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;
  IF p_camino IS NOT NULL AND p_camino NOT IN ('explorar', 'vender') THEN
    RAISE EXCEPTION 'Camino de onboarding invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_paso IS NOT NULL AND p_paso NOT IN (
    'perfil', 'categoria', 'tipo', 'usuario', 'nombre', 'foto', 'descripcion',
    'pagos', 'intereses', 'ubicacion', 'activar', 'notificaciones', 'listo'
  ) THEN
    RAISE EXCEPTION 'Paso de onboarding invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_seller_type IS NOT NULL AND p_seller_type NOT IN ('casual', 'business') THEN
    RAISE EXCEPTION 'Tipo de vendedor invalido.' USING ERRCODE = '22023';
  END IF;
  IF p_nombre IS NOT NULL AND char_length(btrim(p_nombre)) NOT BETWEEN 2 AND 60 THEN
    RAISE EXCEPTION 'El nombre debe tener entre 2 y 60 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_bio IS NOT NULL AND char_length(btrim(p_bio)) NOT BETWEEN 1 AND 160 THEN
    RAISE EXCEPTION 'La descripcion debe tener entre 1 y 160 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_foto IS NOT NULL AND (char_length(p_foto) > 500 OR p_foto !~ '^https?://[^[:space:]]+$') THEN
    RAISE EXCEPTION 'Esa foto no es valida.' USING ERRCODE = '22023';
  END IF;
  IF p_nombre_negocio IS NOT NULL AND char_length(btrim(p_nombre_negocio)) NOT BETWEEN 2 AND 100 THEN
    RAISE EXCEPTION 'El nombre del negocio debe tener entre 2 y 100 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_descripcion_negocio IS NOT NULL AND char_length(btrim(p_descripcion_negocio)) NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'La descripcion del negocio debe tener entre 1 y 1000 caracteres.' USING ERRCODE = '22023';
  END IF;
  IF p_metodos_pago_aceptados IS NOT NULL AND char_length(btrim(p_metodos_pago_aceptados)) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Los metodos de pago no son validos.' USING ERRCODE = '22023';
  END IF;
  IF p_categoria_negocio IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.categories WHERE slug = p_categoria_negocio AND activo
  ) THEN
    RAISE EXCEPTION 'Esa categoria no existe.' USING ERRCODE = '22023';
  END IF;
  IF p_intereses IS NOT NULL THEN
    IF cardinality(p_intereses) NOT BETWEEN 1 AND 5
       OR array_position(p_intereses, NULL) IS NOT NULL
       OR EXISTS (SELECT 1 FROM unnest(p_intereses) AS s(slug)
         WHERE NOT EXISTS (SELECT 1 FROM public.categories c WHERE c.slug = s.slug AND c.activo)) THEN
      RAISE EXCEPTION 'Elige entre 1 y 5 intereses validos.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Ordena escrituras de una misma cuenta; el índice sigue protegiendo dos cuentas.
  SELECT * INTO v_profile FROM public.profiles WHERE id = v_uid FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;
  IF p_username IS NOT NULL THEN
    PERFORM public.set_username(p_username);
  END IF;

  UPDATE public.profiles SET
    onboarding_camino = coalesce(p_camino, onboarding_camino),
    onboarding_paso = coalesce(p_paso, onboarding_paso),
    nombre = coalesce(btrim(p_nombre), nombre),
    bio = coalesce(btrim(p_bio), bio),
    foto = coalesce(p_foto, foto),
    intereses = coalesce(p_intereses, intereses),
    categoria_negocio = coalesce(p_categoria_negocio, categoria_negocio),
    descripcion_negocio = coalesce(btrim(p_descripcion_negocio), descripcion_negocio),
    metodos_pago_aceptados = coalesce(btrim(p_metodos_pago_aceptados), metodos_pago_aceptados)
  WHERE id = v_uid
  RETURNING * INTO v_profile;
  -- UPDATE OF dispara el guard de nombre de tienda aun cuando COALESCE no
  -- cambia nada. No mencionarlo al guardar otro paso deja reanudar los perfiles
  -- legacy sin nombre de tienda; los cambios explícitos conservan ese guard.
  IF (p_seller_type IS NOT NULL AND p_seller_type IS DISTINCT FROM v_profile.seller_type)
     OR (p_nombre_negocio IS NOT NULL AND btrim(p_nombre_negocio) IS DISTINCT FROM v_profile.nombre_negocio) THEN
    UPDATE public.profiles SET
      seller_type = coalesce(p_seller_type, seller_type),
      nombre_negocio = coalesce(btrim(p_nombre_negocio), nombre_negocio)
    WHERE id = v_uid RETURNING * INTO v_profile;
  END IF;
  -- Omitir = NULL, sin borrar lo anterior. Ninguna escritura de es_vendedor.
  RETURN jsonb_build_object('camino', v_profile.onboarding_camino,
    'paso', v_profile.onboarding_paso, 'username', v_profile.username);
END;
$progress$;
REVOKE ALL ON FUNCTION public.guardar_paso_onboarding_v2(text, text, text, text, text, text[], text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_paso_onboarding_v2(text, text, text, text, text, text[], text, text, text, text, text, text) TO authenticated;

-- La bandera y el paso terminal se confirman juntos. Sin requisitos nuevos de
-- foto/bio/zona: esos pasos permiten Omitir por decisión explícita de producto.
CREATE OR REPLACE FUNCTION public.complete_user_onboarding()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $complete$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no authenticated user';
  END IF;
  UPDATE public.profiles SET has_seen_onboarding = true, onboarding_paso = NULL
    WHERE id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'onboarding: no profile row for user %', auth.uid() USING ERRCODE = 'P0002';
  END IF;
END;
$complete$;
REVOKE ALL ON FUNCTION public.complete_user_onboarding() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_user_onboarding() TO authenticated;

NOTIFY pgrst, 'reload schema';
