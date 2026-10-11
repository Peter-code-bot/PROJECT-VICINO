-- La segunda clave se valida en la Server Action. Un JWT de admin no debe
-- poder saltarla llamando al RPC histórico o escribiendo user_roles directamente.
-- No contiene contraseñas ni cambia los roles de ninguna cuenta.
CREATE OR REPLACE FUNCTION public.admin_set_user_role_secure(
  p_actor_id uuid,
  p_user_id uuid,
  p_role public.app_role,
  p_grant boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: requiere canal de servidor' USING ERRCODE = '42501';
  END IF;
  IF p_actor_id IS NULL OR p_user_id IS NULL OR p_grant IS NULL
     OR p_role IS NULL OR p_role::text NOT IN ('admin', 'moderator') THEN
    RAISE EXCEPTION 'datos de cambio de rol inválidos' USING ERRCODE = '22023';
  END IF;

  -- Orden estable para evitar carreras entre acciones de dos administradores.
  -- Una revocación concurrente usa estos mismos bloqueos antes de comprobar actor.
  PERFORM id FROM public.profiles
    WHERE id IN (p_actor_id, p_user_id) ORDER BY id FOR UPDATE;

  IF NOT public.has_role(p_actor_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede repartir roles' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'usuario no encontrado' USING ERRCODE = '22023';
  END IF;

  IF p_grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role) ON CONFLICT DO NOTHING;
  ELSE
    IF p_role = 'admin'::public.app_role AND p_user_id = p_actor_id THEN
      RAISE EXCEPTION 'no puedes quitarte a ti mismo el rol de admin' USING ERRCODE = '22023';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_user_role_secure(uuid, uuid, public.app_role, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_role_secure(uuid, uuid, public.app_role, boolean)
  TO service_role;

-- Conservar la firma histórica, pero cerrar su entrada desde sesiones de clientes.
REVOKE ALL ON FUNCTION public.admin_set_user_role(uuid, public.app_role, boolean)
  FROM PUBLIC, anon, authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM PUBLIC, anon, authenticated;
-- Un REVOKE de tabla no elimina posibles GRANT anteriores por columna.
DO $permissions$
DECLARE v_column text;
BEGIN
  FOR v_column IN
    SELECT attname FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.user_roles'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%1$I), UPDATE (%1$I) ON public.user_roles FROM PUBLIC, anon, authenticated',
      v_column
    );
  END LOOP;
END;
$permissions$;

COMMENT ON FUNCTION public.admin_set_user_role_secure(uuid, uuid, public.app_role, boolean) IS
  'Canal service_role después de verificar sesión admin y clave adicional en servidor; actor de getUser, autorización vigente y cambio atómico. No accesible con JWT de usuario.';
