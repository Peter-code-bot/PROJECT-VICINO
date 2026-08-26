-- El usuario no puede registrar su propio consentimiento. Hoy, literalmente.
--
-- verification_consent existe, tiene sus GRANT por columna para authenticated,
-- y DOS policies: "Admin gestiona consentimientos" (ALL) y "Usuario ve su
-- propio consentimiento" (SELECT). No hay ninguna de INSERT.
--
-- En Postgres, un INSERT sin policy que lo autorice se rechaza. Asi que el
-- camino que el producto necesita —que la persona marque una casilla y quede
-- constancia— muere con 42501 antes de escribir nada. La tabla lleva 0 filas
-- desde que se creo, y hay TRES verificaciones aprobadas sin consentimiento
-- registrado.
--
-- Por que un RPC y no una policy de INSERT: esto es prueba legal. Con una
-- policy, el cliente elige que escribe, incluida la fecha y la version del
-- Aviso que dice haber aceptado. Un consentimiento cuya fecha la pone quien
-- consiente no acredita gran cosa. Aqui la fecha la pone el servidor con
-- NOW(), la version llega del servidor y el user_id sale de auth.uid(), nunca
-- de un parametro.
--
-- Contexto legal, para que no se pierda: la selfie de verificacion es dato
-- BIOMETRICO y por tanto sensible bajo la LFPDPPP. El articulo 8 exige
-- consentimiento EXPRESO y por escrito para datos sensibles, no el tacito que
-- basta para el resto. Una casilla marcada por defecto no es consentimiento
-- expreso; por eso la de la interfaz nace desmarcada.

CREATE OR REPLACE FUNCTION public.registrar_consentimiento_biometrico(
  p_aviso_version TEXT,
  p_user_agent    TEXT DEFAULT NULL,
  p_ip            TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_id  UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  IF p_aviso_version IS NULL OR btrim(p_aviso_version) = '' THEN
    RAISE EXCEPTION 'Falta la version del Aviso.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO verification_consent (user_id, tipo, aviso_version, aceptado_at, user_agent, ip)
  VALUES (
    v_uid,
    'biometrico',
    btrim(p_aviso_version),
    NOW(),                                  -- la pone el servidor, no el cliente
    left(coalesce(p_user_agent, ''), 500),
    -- Una IP mal formada no puede tumbar el consentimiento: se guarda NULL.
    -- Es un dato de apoyo, no la prueba; la prueba es la fila y su fecha.
    CASE WHEN p_ip ~ '^[0-9a-fA-F:.]+$' THEN p_ip::inet ELSE NULL END
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_consentimiento_biometrico(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_consentimiento_biometrico(TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.registrar_consentimiento_biometrico(TEXT, TEXT, TEXT) TO authenticated;

-- Consulta que usa el servidor para exigir consentimiento antes de procesar un
-- documento. Va como funcion y no como SELECT directo porque el usuario solo
-- puede leer SU fila, y esta comprobacion la hace el veredicto con cliente
-- admin: asi el mismo predicado sirve para los dos.
CREATE OR REPLACE FUNCTION public.tiene_consentimiento_biometrico(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM verification_consent
     WHERE user_id = p_user_id AND tipo = 'biometrico'
  );
$$;

REVOKE ALL ON FUNCTION public.tiene_consentimiento_biometrico(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tiene_consentimiento_biometrico(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.tiene_consentimiento_biometrico(UUID) TO authenticated, service_role;

-- VERIFY:
--   SELECT has_function_privilege('anon','public.registrar_consentimiento_biometrico(text,text,text)','EXECUTE');
--   -- esperado: false
--   SELECT has_function_privilege('authenticated','public.registrar_consentimiento_biometrico(text,text,text)','EXECUTE');
--   -- esperado: true
