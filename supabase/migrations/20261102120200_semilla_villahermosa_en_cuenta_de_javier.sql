-- La semilla de Villahermosa que quedo en la cuenta REAL de Javier, fuera de la
-- vista publica.
--
-- docs/planes-2026-09-26/README.md pedia "confirmar que ese seed nunca se
-- ejecuto contra prod" (seed-villahermosa-estradajr.sql, sin versionar, en la
-- maquina de Javier). Todo indica que si (el archivo no esta en el repo; esto
-- sale de sus huellas): el 26-sep-2026 a las 04:19:07 UTC, el mismo
-- minuto en que nacieron las cuentas demo, aparecieron en la cuenta principal
-- de Javier 8 publicaciones de Villahermosa (7 siguen 'disponible': tamales de
-- chipilin, queso de poro de Balancan, guayabera tabasquena...), dos ventas
-- COMPLETADAS con fecha anterior a que existieran sus compradores y filas de
-- ranking de agosto y septiembre que ninguna venta respalda. El 12-oct se
-- sembraron ademas las 6 comunidades de Tabasco; una quedo a nombre de Javier
-- (Vecinos Tabasco 2000), con 4 miembros y 4 publicaciones, todos sinteticos.
--
-- Va aparte de 20261102120000 porque toca contenido de la cuenta de un
-- fundador, y eso lo decide Javier. Las ventas, los puntos y los rankings ya
-- los neutraliza 20261102120100; aqui solo se oculta lo que se ve:
--   * las 8 publicaciones -> products_services.is_hidden. Es la bandera de
--     moderacion: authenticated no tiene UPDATE sobre esa columna, asi que el
--     dueno no la revierte desde la app.
--   * Vecinos Tabasco 2000 -> communities.is_hidden.
-- Va por id y no por regla: nada en esas filas las distingue de una
-- publicacion real salvo su origen. La condicion sobre el dueno evita tocar
-- algo que hubiera cambiado de manos.
--
-- No borra nada. Reversion: docs/rollback/20261102120200_semilla_villahermosa_en_cuenta_de_javier_rollback.sql
-- Idempotente.

UPDATE public.products_services
   SET is_hidden = true
 WHERE creador_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95'
   AND id IN (
     '0cde809a-292d-4fbf-9eff-f16c9a71321d',  -- Mantenimiento de minisplit
     '1f3d8c62-4728-4ae4-9dd6-6883583d99f5',  -- Monstera (ya 'eliminado')
     '36e7ddfa-94e4-4f22-9e85-cba2ac95cb58',  -- Guayabera tabasquena
     '3e4d3bb7-84f2-430a-b3ac-675bdbb4e5f0',  -- Servicio tecnico de computo
     '6560186f-40a8-4c14-b45a-13301b83b903',  -- Kit de camaras
     '85949c48-44c5-4e70-8543-d90b7d0833c3',  -- Tamales de chipilin
     '91675669-bd70-4fc0-b1a5-022d339d64ef',  -- Laptop ThinkPad
     'eb9a4a40-0ac2-4737-81f6-81fc5fb7bf0e'   -- Queso de poro y butifarras
   )
   AND NOT is_hidden;

UPDATE public.communities
   SET is_hidden = true
 WHERE id = '24278f23-1e68-447a-b0e9-0df9dae01960'  -- Vecinos Tabasco 2000
   AND owner_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95'
   AND NOT is_hidden;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products_services
              WHERE creador_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95'
                AND created_at >= '2026-09-26 04:19:00+00' AND created_at < '2026-09-26 04:20:00+00'
                AND NOT is_hidden) THEN
    RAISE EXCEPTION 'queda visible una publicacion de la semilla del 26-sep';
  END IF;
  IF EXISTS (SELECT 1 FROM public.communities
              WHERE id = '24278f23-1e68-447a-b0e9-0df9dae01960'
                AND owner_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95'
                AND NOT is_hidden) THEN
    RAISE EXCEPTION 'Vecinos Tabasco 2000 sigue visible';
  END IF;
END
$verify$;

-- VERIFY (a mano, solo lectura):
--   SELECT count(*) FROM public.products_services
--    WHERE creador_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95' AND estatus = 'disponible' AND NOT is_hidden;
--   -- antes 7; despues 0 (lo que Javier publique despues sigue visible)
