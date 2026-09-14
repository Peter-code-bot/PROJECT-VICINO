-- Dos fugas de la TABLA que la RPC ya tenia tapadas.
--
-- Todo el cuidado del feed vive en search_nearby_products_v4: radio, distancia
-- redondeada a 100 m, techos, cursor, bloqueos, suspension. Pero
-- products_services tambien esta expuesta DIRECTAMENTE por PostgREST, y esa
-- puerta no ejecuta ninguna funcion nuestra: un GET a /rest/v1/products_services
-- se resuelve solo con los GRANT por columna y la policy de SELECT. Ahi habia
-- dos cosas que la RPC si miraba y la tabla no.
--
-- ---------------------------------------------------------------------------
-- 1. ubicacion_geo: la coordenada EXACTA de cada publicacion, legible por anon
-- ---------------------------------------------------------------------------
--
-- El proyecto invirtio en NO revelar la posicion exacta de un vendedor, por
-- tres vias distintas y con el motivo escrito en cada una:
--
--   - la RPC redondea la distancia hacia arriba a 100 m
--     (20260826400000: "(CEIL(ST_Distance(...) / 100) * 100)::FLOAT");
--   - lib/geo/consulta-cercanos.ts ajusta a una rejilla de 100 m las
--     coordenadas de QUIEN PREGUNTA, para que nadie pueda hacer una busqueda
--     binaria moviendose de metro en metro hasta triangular un anuncio;
--   - get_product_location esta REVOCADA a anon desde 20260826264000, con esta
--     razon textual: "el feed publico solo expone la distancia REDONDEADA a
--     100 m justamente para no revelar la posicion exacta de un vendedor".
--
-- Y al mismo tiempo anon tenia GRANT SELECT sobre products_services.ubicacion_geo,
-- que PostgREST devuelve como EWKB hexadecimal. Comprobado contra produccion:
--   GET /rest/v1/products_services?select=ubicacion_geo
--   -> "0101000020E61000005B33E83AC32A57C01A547655FBFF3140"
-- Eso es un POINT: dos llamadas a ST_X/ST_Y, o cualquier parser de EWKB, y ahi
-- esta el domicilio. Las tres defensas de arriba quedaban decorativas mientras
-- la columna cruda estuviera a un GET de distancia.
--
-- Se revoca a anon Y a authenticated. Dejarla para authenticated no arreglaria
-- nada: registrarse es gratis. Quien de verdad necesita las coordenadas de su
-- propia publicacion ya las obtiene por get_product_location, que comprueba
-- propiedad (es lo que usa vender/[id]/editar).
--
-- INSERT y UPDATE de authenticated se CONSERVAN: vender/actions.ts escribe la
-- columna al publicar y al mover el marcador del mapa. Lo que desaparece es
-- unicamente la lectura.
--
-- Riesgo de regresion: ningun SELECT de apps/web pide esta columna sobre
-- products_services (solo escrituras, en vender/actions.ts:349 y :636). Los
-- scripts de semilla si la leen, pero corren con service_role, que mantiene el
-- privilegio. OJO con el modo de fallo: el tipo generado sigue declarando la
-- columna, asi que un SELECT futuro que la incluya NO fallara con 42703
-- ("no existe") sino con 42501 ("permiso denegado"), que es el patron exacto
-- del incidente de modo_precio documentado en CLAUDE.md.
REVOKE SELECT (ubicacion_geo) ON public.products_services FROM anon;
REVOKE SELECT (ubicacion_geo) ON public.products_services FROM authenticated;

-- ---------------------------------------------------------------------------
-- 2. Suspender a un vendedor ocultaba sus productos en el feed, pero no en la
--    lectura directa de la tabla
-- ---------------------------------------------------------------------------
--
-- La RPC filtra el perfil del creador en sus tres ramas ("AND pr.is_hidden =
-- FALSE"). Fue el item 103 de 20260826180000, con el motivo escrito:
-- "suspender a un vendedor desde el panel de admin no ocultaba ni una sola de
-- sus publicaciones".
--
-- block_aware_products_select nunca recibio ese filtro: mira el is_hidden del
-- PRODUCTO, jamas el del perfil de quien lo publico. O sea que moderacion
-- suspende una cuenta, la app deja de mostrarla, y
--   GET /rest/v1/products_services?select=id,titulo
-- la sigue devolviendo entera. El embed profiles!inner si la tapa, pero basta
-- con no pedir el embed.
--
-- El arreglo anade el EXISTS sobre profiles a las DOS ramas publicas. NO se
-- toca ninguna de las otras tres:
--   - el creador sigue viendo lo suyo aunque este suspendido (si no, no podria
--     ni ver por que le pasa nada);
--   - admin y moderator siguen viendolo todo, que es como se revisa una cuenta
--     suspendida.
--
-- Por que un EXISTS y no vicino_guard.cuenta_suspendida(): ese helper pregunta
-- por QUIEN LLAMA, no por el vendedor de la fila. Sirve para el WITH CHECK de
-- las escrituras (20260912120000), no aqui.
--
-- Coste: un EXISTS por fila contra profiles(id), que es la clave primaria, asi
-- que es una busqueda por indice. Se mide abajo en el VERIFY porque esta
-- policy corre en CADA SELECT de la tabla.
ALTER POLICY "block_aware_products_select"
  ON public.products_services
  USING (
    ((SELECT auth.uid()) = creador_id)
    OR has_role((SELECT auth.uid()), 'admin'::app_role)
    OR has_role((SELECT auth.uid()), 'moderator'::app_role)
    OR (
      ((SELECT auth.uid()) IS NULL)
      AND (estatus = 'disponible'::listing_status)
      AND (is_hidden = false)
      AND EXISTS (
        SELECT 1 FROM public.profiles pr
        WHERE pr.id = products_services.creador_id AND pr.is_hidden = false
      )
    )
    OR (
      ((SELECT auth.uid()) IS NOT NULL)
      AND (estatus = 'disponible'::listing_status)
      AND (is_hidden = false)
      AND (NOT (creador_id = ANY ((SELECT vicino_guard.bloqueados_conmigo())::uuid[])))
      AND EXISTS (
        SELECT 1 FROM public.profiles pr
        WHERE pr.id = products_services.creador_id AND pr.is_hidden = false
      )
    )
  );

-- ---------------------------------------------------------------------------
-- VERIFY (a mano, tras aplicar)
--
--   -- 1. La coordenada ya no sale por la API publica:
--   SELECT grantee FROM information_schema.column_privileges
--    WHERE table_name='products_services' AND column_name='ubicacion_geo'
--      AND privilege_type='SELECT';
--   -- esperado: solo postgres y service_role
--
--   GET /rest/v1/products_services?select=ubicacion_geo   -- con la llave anon
--   -- esperado: 42501, no un EWKB
--
--   GET /rest/v1/products_services?select=id,titulo,precio -- con la llave anon
--   -- esperado: 200 (el catalogo publico sigue sirviendose)
--
--   -- 2. El vendedor suspendido desaparece tambien de la tabla. Bajo ROLLBACK,
--   --    porque suspende de verdad a una cuenta real mientras dura:
--   BEGIN;
--     UPDATE public.profiles SET is_hidden = true WHERE id = '<vendedor>';
--     SET LOCAL ROLE anon;
--     SELECT count(*) FROM public.products_services WHERE creador_id = '<vendedor>';
--     -- esperado: 0   (antes de esta migracion: todas sus publicaciones)
--   ROLLBACK;
--
--   -- SET LOCAL ROLE es obligatorio: el rol postgres BYPASEA la RLS, asi que
--   -- sin el la comprobacion pasa siempre y no prueba nada (leccion 2 de
--   -- CLAUDE.md).
--
--   -- 3. Coste del EXISTS en el camino caliente:
--   EXPLAIN (ANALYZE, BUFFERS)
--     SELECT id FROM public.products_services WHERE estatus = 'disponible';
--   -- esperado: Index Scan sobre profiles_pkey en el subplan, no Seq Scan
-- ---------------------------------------------------------------------------
