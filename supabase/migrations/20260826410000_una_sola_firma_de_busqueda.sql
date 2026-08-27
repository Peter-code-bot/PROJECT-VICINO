-- ARREGLO DE P0. La migracion 20260826400000 dejo el feed caido en produccion.
--
-- QUE PASO, EXACTAMENTE. Esa migracion anadio el parametro `sin_limite` con un
-- CREATE OR REPLACE. Pero en Postgres la IDENTIDAD de una funcion es (nombre,
-- tipos de los argumentos): anadir un argumento NO reemplaza nada, CREA UNA
-- SOBRECARGA. Quedaron dos search_nearby_products_v4 vivas, la de 10 y la de 11
-- argumentos.
--
-- Y PostgREST resuelve la sobrecarga ANTES de ejecutar nada, asi que no hay
-- policy ni permiso que lo salve: las cuatro llamadas que NO mandan sin_limite
-- reciben
--
--   HTTP 300  PGRST203  "Could not choose the best candidate function"
--
-- O sea el feed "Para ti", el feed universitario, "Cerca de ti" y el cargar-mas.
-- Solo /buscar sobrevivio, porque es el unico sitio que manda el parametro nuevo
-- y eso desambigua. El sintoma visible era el peor posible: la home devolvia 200
-- y pintaba "No hay vendedores cerca de ti" con la base llena.
--
-- POR QUE NO LO ATRAPO EL SMOKE. Se comprobo que / devolvia 200. Un 200 no dice
-- nada sobre lo que hay dentro: la pagina cargaba perfecto y el feed venia
-- vacio. Desde ahora el smoke de la home mira CONTENIDO, no codigo de estado.
--
-- SE BORRA LA DE 10 Y SE QUEDA LA DE 11. Es la que espera el codigo ya
-- desplegado (/buscar manda sin_limite), y para las otras cuatro llamadas el
-- DEFAULT false reproduce exactamente el comportamiento anterior.

DROP FUNCTION IF EXISTS public.search_nearby_products_v4(
  double precision, double precision, integer, text, uuid[],
  timestamp with time zone, uuid, integer, boolean, boolean
);

-- SEGUNDO DESTROZO DE LA MISMA MIGRACION, mas silencioso. La firma de 10
-- argumentos tenia REVOKE ... FROM PUBLIC desde
-- 20260826180000_feed_v4_bloqueos_suspendidos_y_comodines.sql. La sobrecarga
-- nueva nacio SIN ese REVOKE, o sea con EXECUTE para PUBLIC (se ve como
-- "=X/postgres" en proacl). Al regenerar una funcion no se heredan los
-- privilegios de la anterior: se aplican los del esquema. Aqui se repone.
REVOKE EXECUTE ON FUNCTION public.search_nearby_products_v4(
  double precision, double precision, integer, text, uuid[],
  timestamp with time zone, uuid, integer, boolean, boolean, boolean
) FROM PUBLIC;

-- COMPROBACION (tras aplicar):
--   select p.oid::regprocedure::text, p.proacl::text from pg_proc p
--     join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='search_nearby_products_v4';
--   -- esperado: UNA sola fila, y su acl SIN "=X/postgres"
--
--   curl -H "Cookie: vicino_location=19.0414,-98.2063; vicino_radius=25000" \
--        https://vicinomarket.com/ | grep -c "No hay vendedores cerca de ti"
--   -- esperado: 0
