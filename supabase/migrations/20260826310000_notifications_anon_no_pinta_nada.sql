-- anon puede VACIAR la tabla de notificaciones. Comprobado, no supuesto.
--
-- notifications concede a anon Y a authenticated: SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE, REFERENCES y TRIGGER. A nivel de TABLA. Y solo tiene dos
-- policies, ambas para authenticated: ver las propias y actualizar las propias.
--
-- Que significa cada privilegio sin su policy:
--   INSERT  sin policy -> se rechaza. Inofensivo.
--   DELETE  sin policy -> filtra todas las filas y afecta CERO. Es el fallo
--           silencioso de siempre, pero no abre nada.
--   TRUNCATE -> ESTE ES EL PROBLEMA. TRUNCATE NO ESTA SUJETO A ROW LEVEL
--           SECURITY. No filtra: borra la tabla entera.
--
-- Ejercitado en transaccion revertida: se inserto una notificacion, se cambio a
-- rol anon, se ejecuto TRUNCATE y la fila desaparecio. anon puede borrar TODAS
-- las notificaciones de TODOS los usuarios.
--
-- Hoy no es alcanzable por PostgREST, que no expone TRUNCATE. Pero es
-- exactamente el mismo patron que spatial_ref_sys, y ese sigue abierto
-- justamente porque se descubrio tarde: cualquier funcion SECURITY INVOKER que
-- alguien anada manana y que toque esta tabla hereda el privilegio.
--
-- Lo que el producto necesita de verdad, leido del codigo y no supuesto:
--   apps/web/app/(marketplace)/notificaciones/actions.ts hace UNICAMENTE
--   .update({ leida: true }) sobre las propias, y varios sitios hacen SELECT.
--   NADIE inserta ni borra desde el cliente: las cuatro funciones que crean
--   notificaciones (create_notification, notify_appointment_created,
--   notify_user_as_staff, update_trust_level_from_points) son SECURITY DEFINER
--   y no dependen de estos privilegios.
--
-- anon se queda sin nada: una notificacion es de alguien por definicion, y sin
-- sesion no hay alguien.

REVOKE ALL ON TABLE public.notifications FROM anon;

-- Primero el nivel de TABLA. Si se revocara solo por columna, no pasaria nada:
-- un privilegio de tabla cubre todas las columnas y convierte el REVOKE por
-- columna en un no-op silencioso. Ya se pago dos veces hoy, con profiles y con
-- seller_verification.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.notifications FROM authenticated;

-- Y se devuelve lo unico que el cliente escribe.
GRANT UPDATE (leida) ON public.notifications TO authenticated;

-- SELECT se queda a nivel de tabla: la policy "Users can view own notifications"
-- ya limita las FILAS, y no hay ninguna columna de esta tabla que el dueno de la
-- notificacion no deba ver.

-- VERIFY:
--   SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type)
--     FROM information_schema.table_privileges
--    WHERE table_name='notifications' AND grantee IN ('anon','authenticated')
--    GROUP BY grantee;
--   -- anon: ninguna fila. authenticated: REFERENCES, SELECT, TRIGGER.
--
--   SELECT string_agg(column_name, ', ') FROM information_schema.column_privileges
--    WHERE table_name='notifications' AND grantee='authenticated'
--      AND privilege_type='UPDATE';
--   -- esperado: leida
