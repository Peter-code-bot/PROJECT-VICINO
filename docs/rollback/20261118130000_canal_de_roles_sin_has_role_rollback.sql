-- Reversion de 20261118130000_canal_de_roles_sin_has_role.sql
--
-- Devuelve admin_set_user_role_secure a la version de 20261011213000, que
-- comprueba al actor con has_role. OJO: esa version esta ROTA en produccion:
-- en el canal de servicio has_role responde false para cualquier actor y
-- el panel no puede conceder ni quitar ningun rol. Solo tiene sentido si la
-- version nueva causara algo peor.
--
-- Correr en el SQL Editor como postgres. No toca filas. Despues, si se quiere
-- volver a aplicar la migracion con scripts/apply-migration.mjs, hay que borrar
-- su fila del ledger (la herramienta se niega a reaplicar una version):
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261118130000';

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
