-- Los roles solo cambian por el canal del servidor que exige la clave del panel.
--
-- Por que: 20261011213000 cerro la firma historica admin_set_user_role y dejo
-- admin_set_user_role_secure solo para service_role, que es lo que llama la
-- Server Action despues de comprobar ADMIN_SECURITY_PASSWORD. Pero en
-- produccion quedaron vivas otras dos funciones SECURITY DEFINER, mas viejas,
-- con EXECUTE para authenticated:
--   manage_user_role(uuid, app_role, text)  concede y quita cualquier rol
--   make_admin(text)                        concede admin por correo
-- Las dos solo comprueban que quien llama sea admin. Con una sesion de admin
-- abierta (un telefono prestado, una pestaña olvidada) se podian invocar por
-- PostgREST, /rest/v1/rpc/manage_user_role, sin pasar por la Server Action, o
-- sea sin la clave. Era exactamente el atajo que la clave existe para cerrar.
-- Ningun codigo de apps/, packages/, scripts/ ni supabase/functions las llama.
--
-- Que hace: les quita EXECUTE a PUBLIC, anon y authenticated. No las borra y
-- no cambia ningun rol ni ninguna fila de user_roles. postgres y service_role
-- conservan EXECUTE, pero ninguna de las dos sirve sin una sesion de admin
-- (las dos exigen que auth.uid() sea admin): la salida de emergencia si no
-- queda ningun admin es el INSERT directo de docs/moderation-setup.md (2.6).
--
-- manage_user_role se creo fuera de las migraciones de master y solo existe
-- en produccion; en una base armada desde el repo no esta. Por eso cada
-- funcion se cierra solo si existe, en vez de abortar con 42883.
--
-- Reversion: docs/rollback/20261118120000_roles_solo_con_clave_del_panel_rollback.sql
-- Idempotente.

SET LOCAL lock_timeout = '5s';

DO $cerrar$
DECLARE
  v_funcion text;
BEGIN
  FOREACH v_funcion IN ARRAY ARRAY[
    'public.manage_user_role(uuid, public.app_role, text)',
    'public.make_admin(text)'
  ] LOOP
    IF to_regprocedure(v_funcion) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_funcion);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_funcion);
    END IF;
  END LOOP;
END
$cerrar$;

DO $verify$
DECLARE
  v_rol text;
  v_funcion text;
BEGIN
  FOREACH v_funcion IN ARRAY ARRAY[
    'public.manage_user_role(uuid, public.app_role, text)',
    'public.make_admin(text)'
  ] LOOP
    CONTINUE WHEN to_regprocedure(v_funcion) IS NULL;
    FOREACH v_rol IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(v_rol, v_funcion, 'EXECUTE') THEN
        RAISE EXCEPTION '% conserva EXECUTE sobre %', v_rol, v_funcion;
      END IF;
    END LOOP;
  END LOOP;
END
$verify$;
