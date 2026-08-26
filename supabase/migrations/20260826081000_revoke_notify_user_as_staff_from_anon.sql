-- Cierra un grant que se colo solo.
--
-- 20260826080000 hizo REVOKE ... FROM PUBLIC y GRANT ... TO authenticated sobre
-- notify_user_as_staff, y aun asi anon quedo con EXECUTE. La causa es que este
-- proyecto tiene ALTER DEFAULT PRIVILEGES otorgando EXECUTE sobre funciones
-- nuevas a anon, authenticated y service_role: ese grant es EXPLICITO para anon,
-- asi que revocarlo de PUBLIC no lo toca.
--
-- No era explotable — la funcion valida sesion y rol, y un anon recibe
-- "forbidden: requiere sesion" — pero un permiso que nadie necesita no deberia
-- existir. Y conviene dejarlo escrito: cualquier funcion nueva de este proyecto
-- nace con EXECUTE para anon salvo que se revoque a mano.

REVOKE EXECUTE ON FUNCTION public.notify_user_as_staff(uuid, text, text, text, jsonb)
  FROM anon;

-- VERIFY:
--   SELECT has_function_privilege('anon',
--     'public.notify_user_as_staff(uuid,text,text,text,jsonb)', 'EXECUTE');
--   -- esperado: false
