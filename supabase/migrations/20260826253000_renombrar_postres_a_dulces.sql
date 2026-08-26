-- "Postres y Reposteria" pasa a llamarse "Dulces y Postres".
--
-- Decision de Pedro (26-ago-2026). Caso que la origino: alguien que vende
-- gomitas no encontro donde publicar y acabo en "Comida y Bebidas", mientras
-- esta categoria estaba vacia al lado. El problema no era que faltara un
-- cajon —hay 42 categorias para 14 publicaciones, y 33 de ellas nunca han
-- recibido nada— sino que el cajon correcto no decia su palabra.
--
-- El slug NO se toca. Es lo que casa con product_categories, con el resolutor
-- de slug->id de vender/actions.ts y con las URLs /[categoria]/[slug] que ya
-- se compartieron. Renombrar el slug romperia enlaces existentes; renombrar
-- solo el nombre visible no rompe nada.
--
-- El array de TypeScript se cambia en el mismo commit. Los dos tienen que
-- decir lo mismo: el formulario lee el de TS y el feed lee el de la base.

UPDATE public.categories
   SET nombre = 'Dulces y Postres'
 WHERE slug = 'postres';

-- VERIFY:
--   SELECT nombre, slug FROM categories WHERE slug = 'postres';
--   -- esperado: Dulces y Postres | postres
--   SELECT count(*) FROM product_categories pc
--     JOIN categories c ON c.id = pc.categoria_id WHERE c.slug = 'postres';
--   -- el mismo numero que antes: renombrar no mueve ninguna asignacion
