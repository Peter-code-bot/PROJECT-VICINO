-- Las cuentas de demostracion @demo.vicino.mx ya no pueden iniciar sesion.
--
-- Por que: supabase/seed-v2.sql y supabase/seed-dev.sql crean compradores
-- inventados con correo @demo.vicino.mx y una contraseña escrita en el propio
-- archivo. El seed corrio en produccion el 26-sep-2026, asi que esas cuentas
-- existen ahi con una contraseña que cualquiera puede leer en este repositorio
-- publico. Nadie ha entrado con ellas (nunca han iniciado sesion), pero
-- cualquiera podria hacerlo y escribir mensajes o publicar a nombre de una
-- cuenta que el panel ya trata como de prueba.
--
-- Que hace: les pone banned_until a cien años. GoTrue rechaza el inicio de
-- sesion y la renovacion del token de una cuenta bloqueada. Se usa una fecha y
-- no 'infinity' porque GoTrue no sabe leer 'infinity' y fallaria al listar los
-- usuarios (el panel de admin los lista para buscar). No borra ni cambia nada
-- mas: las cuentas y sus registros se conservan, y siguen fuera de las
-- metricas del panel (lib/admin/cuentas-fuera-de-metricas.ts).
--
-- Reversion: docs/rollback/20261118140000_bloquear_cuentas_demo_rollback.sql
-- Idempotente.

SET LOCAL lock_timeout = '5s';

UPDATE auth.users
   SET banned_until = now() + interval '100 years'
 WHERE lower(email) LIKE '%@demo.vicino.mx'
   AND (banned_until IS NULL OR banned_until < now() + interval '99 years');

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
     WHERE lower(email) LIKE '%@demo.vicino.mx'
       AND (banned_until IS NULL OR banned_until <= now())
  ) THEN
    RAISE EXCEPTION 'queda una cuenta @demo.vicino.mx sin bloquear';
  END IF;
END
$verify$;
