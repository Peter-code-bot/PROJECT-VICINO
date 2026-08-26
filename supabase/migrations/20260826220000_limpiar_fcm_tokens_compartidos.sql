-- Dos cuentas comparten el mismo token de push. Las notificaciones de una
-- pueden aterrizar en el telefono de la otra.
--
-- Items 41 y 69 de Notion. El token de FCM identifica un DISPOSITIVO, no a una
-- persona: si dos perfiles apuntan al mismo, send-push manda a ese telefono lo
-- que sea de cualquiera de los dos. Con mensajes de chat y avisos de venta de por
-- medio, es una fuga de privacidad, no una molestia.
--
-- La causa esta arreglada en el mismo commit: hasta hoy NADA soltaba
-- profiles.fcm_token al cerrar sesion, asi que el perfil de quien se iba seguia
-- apuntando a ese telefono. Ahora lo sueltan useLogout y la server action
-- signOut, antes del signOut, que es cuando todavia hay permiso para escribir.
--
-- Esto limpia lo que ya quedo mal. Poner el token en NULL no rompe nada y se
-- cura solo: la proxima vez que cada persona abra la app, usePushNotifications
-- vuelve a registrarlo con la cuenta que este realmente en sesion. El precio es
-- no recibir push hasta ese momento, que es mucho menos malo que recibir las de
-- otra persona.
--
-- Se limpian TODAS las cuentas implicadas, no una: desde aqui no hay forma de
-- saber cual de las dos es la que de verdad esta usando ese telefono ahora.

UPDATE public.profiles
   SET fcm_token = NULL
 WHERE fcm_token IS NOT NULL
   AND fcm_token IN (
     SELECT fcm_token
       FROM public.profiles
      WHERE fcm_token IS NOT NULL
      GROUP BY fcm_token
     HAVING COUNT(*) > 1
   );

-- VERIFY:
--   SELECT count(*) FROM (
--     SELECT fcm_token FROM public.profiles
--     WHERE fcm_token IS NOT NULL
--     GROUP BY fcm_token HAVING count(*) > 1
--   ) x;
--   -- esperado: 0
