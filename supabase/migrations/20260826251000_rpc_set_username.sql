-- Unico camino de escritura para profiles.username.
--
-- authenticated no tiene UPDATE sobre la columna a proposito (ver
-- 20260826250000), asi que este RPC es la puerta. Mismo patron que
-- update_profile_and_pause_products: SECURITY DEFINER, comprueba auth.uid() y
-- devuelve codigos que el cliente puede distinguir.
--
-- Los mensajes van en castellano y son legibles: van directos al usuario.
-- Sin esto, una colision de @ llegaria al front como un 23505 crudo con el
-- nombre del indice dentro.

CREATE OR REPLACE FUNCTION public.set_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_limpio TEXT;
  -- Palabras que no puede tomar nadie. Viven aqui y no en un CHECK porque
  -- son POLITICA: la lista va a crecer, y una lista dentro de un CHECK
  -- obligaria a una migracion cada vez que se anada una palabra.
  v_reservados TEXT[] := ARRAY[
    'admin', 'administrador', 'administrator', 'moderador', 'moderator',
    'vicino', 'vicinomarket', 'soporte', 'support', 'ayuda', 'help',
    'root', 'sistema', 'system', 'api', 'www', 'oficial', 'official',
    'null', 'undefined', 'anonimo', 'anonymous'
  ];
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  v_limpio := btrim(coalesce(p_username, ''));

  IF v_limpio !~ '^[A-Za-z0-9_]{3,30}$' THEN
    RAISE EXCEPTION
      'El nombre de usuario debe tener entre 3 y 30 caracteres y usar solo letras, numeros y guion bajo.'
      USING ERRCODE = '22023';
  END IF;

  IF lower(v_limpio) = ANY (v_reservados) THEN
    RAISE EXCEPTION 'Ese nombre de usuario esta reservado.'
      USING ERRCODE = '22023';
  END IF;

  -- Se comprueba antes para dar un mensaje claro, pero el indice unico sobre
  -- lower(username) sigue siendo la garantia real: entre este SELECT y el
  -- UPDATE cabe otra transaccion, y es el indice el que la detiene.
  IF EXISTS (
    SELECT 1 FROM profiles
     WHERE lower(username) = lower(v_limpio) AND id <> v_uid
  ) THEN
    RAISE EXCEPTION 'Ese nombre de usuario ya esta en uso.'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles SET username = v_limpio WHERE id = v_uid;

  IF NOT FOUND THEN
    -- Un UPDATE de cero filas devolveria exito sin haber escrito nada. Es el
    -- fallo silencioso que este proyecto ya pago caro en otras cinco tablas.
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  RETURN v_limpio;

EXCEPTION
  WHEN unique_violation THEN
    -- La carrera que el SELECT de arriba no puede cerrar.
    RAISE EXCEPTION 'Ese nombre de usuario ya esta en uso.'
      USING ERRCODE = '23505';
END;
$$;

-- REVOKE explicito a anon ademas de a PUBLIC: Supabase concede EXECUTE a anon
-- por ALTER DEFAULT PRIVILEGES, y un REVOKE ... FROM PUBLIC no se lo quita.
-- Se comprobo hoy con notify_user_as_staff.
REVOKE ALL ON FUNCTION public.set_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_username(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_username(TEXT) TO authenticated;

-- VERIFY:
--   SELECT has_function_privilege('anon','public.set_username(text)','EXECUTE');
--   -- esperado: false
--   SELECT has_function_privilege('authenticated','public.set_username(text)','EXECUTE');
--   -- esperado: true
