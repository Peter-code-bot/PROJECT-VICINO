-- El canal de roles del servidor vuelve a funcionar: comprueba al actor sin has_role.
--
-- Por que: la Server Action del panel (app/admin/users/actions.ts) llama a
-- admin_set_user_role_secure con el cliente de servicio, despues de comprobar
-- la sesion de admin y la clave del panel. Esa funcion comprobaba al actor con
-- public.has_role(p_actor_id, 'admin'). Pero el has_role de produccion lleva
-- un guard contra la enumeracion de roles: si el id preguntado no es el de
-- auth.uid() y quien pregunta no es admin, devuelve false. En el canal de
-- servicio no hay sesion (auth.uid() es NULL), asi que has_role decia "no es
-- admin" del admin real y TODA concesion o retiro de rol desde el panel
-- terminaba en "forbidden: solo un admin puede repartir roles", con la clave
-- correcta o sin ella. Comprobado en produccion el 18-nov-2026 con una prueba
-- dentro de una transaccion revertida.
--
-- Que hace: reemplaza admin_set_user_role_secure con el MISMO cuerpo de
-- 20261011213000 salvo la comprobacion del actor, que ahora mira user_roles
-- directamente. La firma no cambia (ni el codigo ni los tipos). Reafirma que
-- solo service_role la ejecuta y lo verifica en la misma transaccion. No toca
-- has_role, que sigue protegiendo a las sesiones de clientes.
--
-- Reversion: docs/rollback/20261118130000_canal_de_roles_sin_has_role_rollback.sql
-- (devuelve la version rota). Idempotente.

SET LOCAL lock_timeout = '5s';

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

  -- Directo contra user_roles y no con has_role: en este canal no hay sesion
  -- y el guard de has_role respondia false para cualquier actor.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = p_actor_id AND role = 'admin'::public.app_role
  ) THEN
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

DO $verify$
DECLARE
  v_funcion constant text := 'public.admin_set_user_role_secure(uuid, uuid, public.app_role, boolean)';
BEGIN
  IF has_function_privilege('anon', v_funcion, 'EXECUTE')
     OR has_function_privilege('authenticated', v_funcion, 'EXECUTE') THEN
    RAISE EXCEPTION 'un cliente conserva EXECUTE sobre %', v_funcion;
  END IF;
  IF NOT has_function_privilege('service_role', v_funcion, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdio EXECUTE sobre %', v_funcion;
  END IF;
  IF pg_get_functiondef(to_regprocedure(v_funcion)) ~ 'has_role\(' THEN
    RAISE EXCEPTION '% todavia comprueba al actor con has_role', v_funcion;
  END IF;
END
$verify$;
