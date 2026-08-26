-- Asignar y quitar roles de admin esta ROTO. Es la quinta vez con este patron.
--
-- Encontrado por scripts/audit-policies-vs-grants.mjs, que se escribio hoy
-- justamente para dejar de descubrir esto en runtime:
--
--   user_roles tiene la policy "Admin can manage roles" (FOR ALL, con
--   has_role(auth.uid(),'admin')), pero `authenticated` NO tiene privilegio de
--   INSERT, UPDATE ni DELETE sobre la tabla.
--
-- Y apps/web/app/admin/users/actions.ts escribe ahi con la sesion del usuario.
-- Resultado: assignRole y removeRole mueren con 42501. Policy escrita, GRANT
-- olvidado — igual que modo_precio, sort_order, sale_confirmations y el INSERT de
-- profiles.
--
-- POR QUE UN RPC Y NO UN GRANT
-- Lo rapido seria GRANT INSERT, DELETE ON user_roles TO authenticated y dejar que
-- la policy autorice. Es el patron normal de Supabase y funcionaria.
--
-- No se hace, y la razon es esta tabla en concreto: user_roles reparte admin. Si
-- algun dia esa policy se cae, se renombra o se sustituye por una mas
-- permisiva — cosa que este proyecto ya demostro hoy que le pasa — un GRANT
-- suelto sobre user_roles significa que cualquiera se hace admin. Con un RPC
-- SECURITY DEFINER la comprobacion de rol vive DENTRO de la funcion y no depende
-- de que la policy siga ahi. Mismo criterio que moderate_set_content_hidden y
-- notify_user_as_staff.
--
-- El seguro contra el auto-bloqueo es deliberado: hoy hay 3 admins y ninguna otra
-- forma de recuperar el acceso si el ultimo se quita el rol por error.

CREATE OR REPLACE FUNCTION public.admin_set_user_role(
  p_user_id uuid,
  p_role    app_role,
  p_grant   boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden: requiere sesion';
  END IF;

  IF NOT public.has_role(v_actor, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede repartir roles';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_user_id;
  END IF;

  IF p_grant THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT DO NOTHING;   -- ya lo tenia: exito idempotente, no error
  ELSE
    -- Sin esto, el ultimo admin puede quitarse el rol y dejar el panel sin
    -- ninguna via de recuperacion. No hay backdoor: se arreglaria a mano en la
    -- base.
    IF p_role = 'admin'::app_role AND p_user_id = v_actor THEN
      RAISE EXCEPTION 'no puedes quitarte a ti mismo el rol de admin';
    END IF;

    DELETE FROM public.user_roles
     WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_user_role(uuid, app_role, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_set_user_role(uuid, app_role, boolean) IS
  'Reparte o quita un rol. Valida admin dentro de la funcion, no via policy, porque user_roles es la tabla que concede admin. Impide que un admin se quite su propio rol.';

-- VERIFY (todo en transacciones revertidas):
--   1. Un usuario sin rol no puede repartir:
--      BEGIN; SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid-no-admin>","role":"authenticated"}';
--        SELECT admin_set_user_role('<uuid>','moderator'::app_role,true);
--      ROLLBACK;   -- esperado: forbidden: solo un admin puede repartir roles
--
--   2. Un admin si:
--      ... con un uuid admin -> la fila aparece en user_roles
--
--   3. Un admin no puede quitarse su propio admin:
--      SELECT admin_set_user_role('<su propio uuid>','admin'::app_role,false);
--      -- esperado: no puedes quitarte a ti mismo el rol de admin
