-- Pausa la publicacion "Casa" de una cuenta del equipo, a pedido de su dueno
-- (18-nov-2026).
--
-- 20261102120000 deja visible a proposito lo que publican las cuentas `equipo`,
-- porque puede ser venta real. Con las migraciones de cuentas internas ya
-- aplicadas, esta era la unica publicacion de una cuenta interna que seguia en
-- lo publico, y su dueno pidio sacarla.
--
-- Es la misma pausa que hace el boton "Pausar" de la app (toggleProductStatus,
-- en app/(marketplace)/vender/actions.ts): solo estatus = 'pausado'. No toca
-- is_hidden, la bandera de moderacion, porque esa el dueno no la puede revertir
-- desde la app. La pausa la deshace el mismo con "Reactivar".
--
-- No avisa a nadie: products_services no tiene triggers AFTER, y al escribir
-- esto ningun favorito, chat, mensaje, venta, resena, cita ni respuesta apunta
-- a esta publicacion.
--
-- Va por id y con la condicion sobre el dueno, para no tocar algo que hubiera
-- cambiado de manos. Si ya no esta 'disponible' (el dueno la pauso, la borro o
-- se agoto), no hace nada.
--
-- No borra nada. Reversion: docs/rollback/20261118203000_pausar_publicacion_del_equipo_rollback.sql
-- o "Reactivar" desde la app. Idempotente.

SET LOCAL lock_timeout = '5s';

UPDATE public.products_services
   SET estatus = 'pausado'
 WHERE id = '2bd8950b-a143-4e47-95fe-69989cf2bf37'  -- Casa
   AND creador_id = 'f0e59346-d67b-428b-a2fa-d625deb20986'
   AND estatus = 'disponible';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products_services
              WHERE id = '2bd8950b-a143-4e47-95fe-69989cf2bf37'
                AND creador_id = 'f0e59346-d67b-428b-a2fa-d625deb20986'
                AND estatus = 'disponible') THEN
    RAISE EXCEPTION 'la publicacion del equipo sigue disponible';
  END IF;
END
$verify$;

-- VERIFY (a mano, solo lectura):
--   SELECT estatus FROM public.products_services WHERE id = '2bd8950b-a143-4e47-95fe-69989cf2bf37';
--   -- antes 'disponible'; despues 'pausado'
