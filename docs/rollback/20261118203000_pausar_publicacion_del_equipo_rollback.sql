-- Reversion de 20261118203000_pausar_publicacion_del_equipo. Se corre a mano.
-- Vuelve a publicar la "Casa", pero solo si sigue en pausa: si el dueno ya la
-- reactivo, la borro o se agoto, no hace nada. El boton "Reactivar" de la app
-- hace lo mismo.

begin;

UPDATE public.products_services
   SET estatus = 'disponible'
 WHERE id = '2bd8950b-a143-4e47-95fe-69989cf2bf37'
   AND creador_id = 'f0e59346-d67b-428b-a2fa-d625deb20986'
   AND estatus = 'pausado';

commit;
