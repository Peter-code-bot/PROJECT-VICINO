-- Reversion de 20261118120000_roles_solo_con_clave_del_panel.sql
--
-- Devuelve EXECUTE a authenticated sobre las dos funciones viejas de roles.
-- OJO: con esto, una sesion de admin vuelve a poder conceder y quitar roles
-- por PostgREST SIN la clave del panel. Solo tiene sentido si algo que nadie
-- vio dependia de ellas; lo correcto es llevar ese algo al canal del servidor
-- (Server Action con clave -> admin_set_user_role_secure), no reabrir esto.
--
-- Correr en el SQL Editor como postgres. No toca filas.

GRANT EXECUTE ON FUNCTION public.manage_user_role(uuid, public.app_role, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.make_admin(text) TO authenticated;
