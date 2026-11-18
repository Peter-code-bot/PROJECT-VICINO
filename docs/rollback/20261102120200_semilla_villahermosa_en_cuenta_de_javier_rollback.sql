-- Reversion de 20261102120200_semilla_villahermosa_en_cuenta_de_javier. Se corre
-- a mano. Vuelve a publicar las 8 publicaciones de la semilla y Vecinos
-- Tabasco 2000. La migracion solo toco filas que estaban visibles, asi que
-- desocultarlas devuelve el estado anterior.

begin;

UPDATE public.products_services
   SET is_hidden = false
 WHERE creador_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95'
   AND id IN (
     '0cde809a-292d-4fbf-9eff-f16c9a71321d',
     '1f3d8c62-4728-4ae4-9dd6-6883583d99f5',
     '36e7ddfa-94e4-4f22-9e85-cba2ac95cb58',
     '3e4d3bb7-84f2-430a-b3ac-675bdbb4e5f0',
     '6560186f-40a8-4c14-b45a-13301b83b903',
     '85949c48-44c5-4e70-8543-d90b7d0833c3',
     '91675669-bd70-4fc0-b1a5-022d339d64ef',
     'eb9a4a40-0ac2-4737-81f6-81fc5fb7bf0e'
   );

UPDATE public.communities
   SET is_hidden = false
 WHERE id = '24278f23-1e68-447a-b0e9-0df9dae01960'
   AND owner_id = '7db68a49-2aa9-443a-a99c-3b654a43ec95';

commit;
