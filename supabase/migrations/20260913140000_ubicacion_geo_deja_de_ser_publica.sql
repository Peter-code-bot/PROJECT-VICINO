-- La coordenada EXACTA de cada publicacion deja de ser legible por la API publica.
--
-- POR QUE IMPORTA. El proyecto invirtio en no revelar donde vive un vendedor,
-- por tres vias distintas y con el motivo escrito en cada una:
--
--   - search_nearby_products_v4 redondea la distancia HACIA ARRIBA a 100 m;
--   - lib/geo/consulta-cercanos.ts ajusta a una rejilla de 100 m las
--     coordenadas de QUIEN PREGUNTA, para que nadie pueda ir moviendose de
--     metro en metro haciendo busqueda binaria hasta triangular un anuncio;
--   - get_product_location esta REVOCADA a anon desde 20260826264000, con esta
--     frase textual: "el feed publico solo expone la distancia REDONDEADA a
--     100 m justamente para no revelar la posicion exacta de un vendedor".
--
-- Y a la vez products_services.ubicacion_geo era legible por anon. PostgREST la
-- devuelve como EWKB hexadecimal; un parser de EWKB, o dos llamadas a ST_X y
-- ST_Y, y ahi esta el domicilio. Las tres defensas de arriba eran decorativas
-- mientras la columna cruda estuviera a un GET de distancia. Comprobado contra
-- produccion:
--   GET /rest/v1/products_services?select=ubicacion_geo
--   -> "0101000020E61000005B33E83AC32A57C01A547655FBFF3140"
--
-- POR QUE UN REVOKE POR COLUMNA NO BASTO. 20260913130000 ya intento
-- "REVOKE SELECT (ubicacion_geo) ... FROM anon" y NO surtio efecto: no fallo,
-- simplemente no cambio nada, y la columna siguio saliendo. La causa es que
-- anon tiene SELECT a nivel de TABLA (relacl = anon=rtm/postgres, la r), y un
-- privilegio de tabla cubre TODAS las columnas: revocar una columna suelta no
-- le quita nada porque el permiso no venia de ahi.
--
-- O sea que, pese a lo que dice CLAUDE.md, los GRANT de products_services NO
-- eran solo por columna: habia ademas uno de tabla por encima. Esta migracion
-- lo corrige y deja el modelo como el documento ya describia.
--
-- EL CAMINO, que es el unico que funciona: quitar el SELECT de tabla y
-- reponerlo columna a columna sobre las 35 restantes. INSERT, UPDATE, DELETE y
-- REFERENCES de authenticated NO se tocan: vender/actions.ts sigue escribiendo
-- ubicacion_geo al publicar y al mover el marcador del mapa. Lo unico que
-- desaparece es la LECTURA.
--
-- POR QUE TAMBIEN A authenticated. Dejarla para usuarios con sesion no
-- protegeria nada: registrarse es gratis y tarda un minuto. Quien necesita las
-- coordenadas de SU publicacion las sigue obteniendo por get_product_location,
-- que comprueba propiedad, y que es justo lo que usa /vender/[id]/editar.
--
-- ORDEN DE DESPLIEGUE, QUE AQUI NO ES OPCIONAL. La ficha de producto pedia
-- `*`, asi que incluia esta columna y el rol anon necesitaba poder leerla. Con
-- el privilegio quitado y ese `*` todavia desplegado, TODA ficha habria
-- devuelto 42501 -- el patron exacto del incidente de modo_precio. Por eso el
-- commit que sustituye ese `*` por las 34 columnas explicitas se desplego y se
-- verifico en produccion ANTES de aplicar esto.
--
-- RIESGO RESIDUAL. Ninguna consulta del repo pide ya `*` sobre esta tabla
-- (comprobado: 45 consultas, todas con columnas explicitas, y ningun
-- `.select()` sin argumentos). Las 7 funciones que leen ubicacion_geo son
-- todas SECURITY DEFINER, asi que corren como el owner y conservan el
-- privilegio: count_nearby_vendors, feed_nearby_requests, get_product_location,
-- get_ranking_hiperlocal, nearby_products, search_nearby_products y
-- search_nearby_products_v4. Los scripts de semilla si leen la columna, pero
-- van con service_role, que tambien la conserva.
--
-- Lo que SI cambia para terceros: un GET con `select=*` contra esta tabla pasa
-- a devolver 42501 en vez de datos. Es intencionado -- es justo la consulta
-- que se lleva la coordenada -- pero conviene saberlo antes de que alguien
-- diga que "la API se rompio".

REVOKE SELECT ON public.products_services FROM anon;
REVOKE SELECT ON public.products_services FROM authenticated;

-- Las 35 columnas restantes, nombradas una a una. La que falta es la que
-- importa: ubicacion_geo.
GRANT SELECT (
  id, creador_id, titulo, titulo_en, descripcion, descripcion_en, slug,
  precio, tipo, categoria, categoria_id, imagen_principal, galeria_imagenes,
  ubicacion, tipo_entrega, estatus, ventas_count, vistas_count,
  favoritos_count, search_vector, created_at, updated_at, delivery_radius_km,
  gallery_layout, gallery_sizes, allow_appointments, appointment_start_time,
  appointment_end_time, appointment_duration_minutes, precio_negociable,
  is_hidden, estado, color, modo_precio, sort_order
) ON public.products_services TO anon;

GRANT SELECT (
  id, creador_id, titulo, titulo_en, descripcion, descripcion_en, slug,
  precio, tipo, categoria, categoria_id, imagen_principal, galeria_imagenes,
  ubicacion, tipo_entrega, estatus, ventas_count, vistas_count,
  favoritos_count, search_vector, created_at, updated_at, delivery_radius_km,
  gallery_layout, gallery_sizes, allow_appointments, appointment_start_time,
  appointment_end_time, appointment_duration_minutes, precio_negociable,
  is_hidden, estado, color, modo_precio, sort_order
) ON public.products_services TO authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (tras aplicar)
--
--   -- Nadie sin privilegio puede leer la coordenada:
--   SELECT grantee FROM information_schema.column_privileges
--    WHERE table_name='products_services' AND column_name='ubicacion_geo'
--      AND privilege_type='SELECT';
--   -- esperado: solo postgres y service_role
--
--   -- La escritura sigue intacta (publicar y mover el marcador):
--   SELECT privilege_type FROM information_schema.column_privileges
--    WHERE table_name='products_services' AND column_name='ubicacion_geo'
--      AND grantee='authenticated';
--   -- esperado: INSERT, UPDATE, REFERENCES  (sin SELECT)
--
--   -- Con la llave anon, contra la API real:
--   GET /rest/v1/products_services?select=ubicacion_geo   -> 42501
--   GET /rest/v1/products_services?select=id,titulo       -> 200
--   POST /rest/v1/rpc/search_nearby_products_v4           -> 200 (SECURITY DEFINER)
--   GET https://vicinomarket.com/<categoria>/<slug>       -> 200
-- ---------------------------------------------------------------------------
