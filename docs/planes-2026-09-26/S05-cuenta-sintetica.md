# Plan S05-cuenta-sintetica

**Pendiente:** S05: publicar, editar y crear una solicitud con ubicación por la UI con una cuenta sintética

**Fuentes en Notion:** E l.1170 (D01-S05-cuenta-sintetica)

**Estado conciliado (26-sep ~23:30):** pendiente. fixtures.mjs crea productos por SQL, no por la UI, y no crea purchase_requests. replicar-esquema e igualar-con-prod no copian las filas de vicino_cobertura.

**Qué falta:** Plan: (1) comprobar que vicino_cobertura de staging está en 'pais' como prod, y si no igualarlo; (2) crearUsuario + completarOnboarding y levantar dev-contra-staging; (3) por la UI, publicar con ubicación en Villahermosa, editar moviendo el pin y crear una solicitud con ubicación; (4) leer ubicacion_geo y dentro_de_cobertura() = true, y comprobar que el pin editado sustituye al anterior; (5) limpiar() de purchase_requests. Antes, comprobar que el storage de staging acepta subidas.

## Objetivo

Demostrar contra staging, con una cuenta sintética (@staging.vicino.test) y solo por la UI real (web local :3100 → staging), tres cosas: (1) publicar un producto con ubicación en Villahermosa guarda ubicacion_geo correcta y dentro de cobertura; (2) editarlo moviendo el pin sustituye el punto anterior, sin duplicar la fila; (3) crear una Solicitud con ubicación (INSERT directo del navegador a PostgREST) guarda el punto y respeta el trigger de cobertura. El código de la app no se toca y la apariencia queda igual. Límite: MapKit no funciona en local (no hay APPLE_MAPKIT_* en .env.local y /api/mapkit/token solo acepta localhost:3000). Por eso el proveedor se sustituye por uno falso dentro de Playwright. La prueba acredita la cadena UI → acción/PostgREST → base → trigger, pero no MapKit real ni gestos. Eso sigue pendiente en D01-S05 con dispositivo.

## Pasos

1. 1. Precondición de cobertura, solo lectura salvo en staging. Leer vicino_cobertura (clave 'operacion') en staging con sql(cfg.ref) y en prod con prodRead. Las dos deben estar en 'pais'. Si staging difiere, hacer UPDATE solo en staging. Si la fila no existe, la prueba no vale nada, porque dentro_de_cobertura() da true si no hay fila. Comprobar también en staging que dentro_de_cobertura(17.9892,-92.9281)=true y (14.6349,-90.5069)=false, y que existen los triggers exigir_cobertura_products_services y exigir_cobertura_purchase_requests en pg_trigger.
2. 2. Precondición de storage. Confirmar que el bucket product-media existe en storage.buckets de staging. Hacer una subida y un borrado de un PNG 1x1 en <uid>/s05-probe.png por la Storage API, con el token del usuario sintético. Solo se anota el resultado: la publicación de la prueba va SIN foto (en product-form la media es opcional) para no mezclar causas de fallo. Además, limpiar() no puede borrar objetos de storage por SQL.
3. 3. scripts/staging/fixtures.mjs: en limpiar(), añadir `delete from public.purchase_requests where buyer_id in ${ids};` antes del delete de products_services. purchase_request_categories y request_responses caen en cascada. Añadir el helper hacerVendedor(cfg,id), que hace es_vendedor = true por SQL; es la misma precondición que usa e2e-campus-home.mjs.
4. 4. Nuevo scripts/staging/mapkit-falso.mjs: instalarMapkitFalso(context, lugares). Hace context.route('**/api/mapkit/token') → 200 {token:'fixture'} y context.route('https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js') → JS con cabecera Access-Control-Allow-Origin: *. Sin esa cabecera falla, porque use-mapkit.ts carga el script con crossOrigin=anonymous. El script define window.mapkit con init, Map (ColorSchemes, addEventListener, convertPointOnPageToCoordinate, setRegionAnimated, add/removeAnnotation, add/removeOverlay, destroy, colorScheme), Coordinate, CoordinateSpan, CoordinateRegion, MarkerAnnotation (draggable, drag-end), CircleOverlay, Style, FeatureVisibility, Search.autocomplete/search (tabla texto → {displayLines, coordinate, countryCode}) y Geocoder.reverseLookup (nombre fijo). Expone window.__mk.tocar(lat,lng) y window.__mk.arrastrar(lat,lng). Sigue el mismo molde que el SDK falso de scripts/test-s05-map-browser.ts.
5. 5. Nuevo scripts/staging/e2e-ubicacion-publicar.mjs, con el molde de e2e-campus-home.mjs (paso(), login() por /login, limpiar() en finally, capturas en .staging/e2e/). a) crearUsuario + completarOnboarding + hacerVendedor. b) En /vender, esperar a que se habilite el input 'Busca tu zona de entrega…'. Sirve de marca de hidratación y de MapKit listo, y evita el clic perdido antes de hidratar. Rellenar título '[FIXTURE] S05 publicar Villahermosa', descripción, precio, categoría y estado. Buscar 'Villahermosa', elegir la sugerencia y pulsar Publicar. Esperar la redirección a /<cat>/<slug> sin banner de error.
6. 6. Lectura como postgres tras publicar. Debe haber 1 fila con ese título. ST_Y/ST_X(ubicacion_geo::geometry) debe dar ≈ 17.9892/-92.9281 (±1e-5), dentro_de_cobertura(...) debe ser true y ubicacion debe ser el fullName de la sugerencia. Privacidad: el HTML de la ficha pública no debe contener '17.9892' ni '-92.9281'.
7. 7. Editar: abrir /vender/<id>/editar. El mapa debe aparecer con el pin inicial, que llega de get_product_location. Llamar __mk.tocar(18.0021,-92.9447), esperar más de 800 ms (la geocodificación inversa) y pulsar Guardar. Esperar /seller/listings. SQL: sigue habiendo 1 fila; el punto es el nuevo y distinto del anterior; ubicacion es el nombre de la inversa falsa y no el provisional 'lat, lng'; dentro_de_cobertura es true. rpc get_product_location con el token del usuario devuelve el punto nuevo.
8. 8. Solicitud: en /?feed=solicitudes, pulsar 'Crear solicitud'. Título '[FIXTURE] S05 solicitud Mérida', una categoría, buscar 'Mérida', elegir y pulsar 'Publicar solicitud'. El drawer debe cerrarse. SQL: 1 purchase_request del buyer, status 'open', punto ≈ 20.9674/-89.5926, dentro_de_cobertura true y al menos 1 fila en purchase_request_categories.
9. 9. Negativos. En la UI: abrir el drawer, elegir una zona y hacer __mk.tocar(14.6349,-90.5069) (Guatemala). Debe salir el aviso 'fuera de la cobertura' y no debe aparecer ninguna fila nueva. En la API: INSERT directo a /rest/v1/purchase_requests con el token del usuario en Guatemala debe dar 400 con code 22023. El trigger es la única capa de las Solicitudes.
10. 10. Ejecutar: node scripts/staging/dev-contra-staging.mjs en segundo plano (:3100) y luego node scripts/staging/e2e-ubicacion-publicar.mjs. Al terminar, limpiar() debe devolver 0 usuarios del dominio y no debe quedar ninguna fila '[FIXTURE] S05' en products_services ni en purchase_requests.
11. 11. Registrar el resultado N/N en docs/PENDIENTES-2026-09-26.md y en Notion (D01-S05): qué acredita y qué no (proveedor real y gestos). Commit 'test(staging): S05 publicar, editar y solicitud con ubicacion por la UI' que solo toque scripts/staging y docs. vercel.json ya no tiene ignoreCommand, así que un push a master redespliega prod con el mismo código de app: seguir la pauta de push de esta noche.
12. 12. Si aparece un bug real de la app (por ejemplo, el pin editado no sustituye al anterior o el 22023 no se traduce), corregirlo conservando la apariencia, en un commit aparte y con este e2e como regresión. Desplegarlo a prod solo con autorización explícita de Pedro.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs (limpiar() borra purchase_requests; helper hacerVendedor)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/mapkit-falso.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-ubicacion-publicar.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (registro del resultado)
- Solo lectura, como referencia: apps/web/app/(marketplace)/vender/product-form.tsx, apps/web/app/(marketplace)/vender/actions.ts (createProduct l.203, updateProductFull l.429, 22023 en l.362/l.694), apps/web/app/(marketplace)/vender/[id]/editar/page.tsx (get_product_location), apps/web/components/map/location-picker.tsx, apps/web/components/map/delivery-map.tsx, apps/web/components/map/apple-map-container.tsx, apps/web/components/solicitudes/create-request-drawer.tsx (INSERT directo l.130), apps/web/components/solicitudes/solicitudes-feed.tsx (FAB 'Crear solicitud'), apps/web/hooks/use-mapkit.ts, apps/web/app/api/mapkit/token/route.ts, apps/web/lib/geo/location-search.ts, apps/web/lib/geo/cobertura.ts, supabase/migrations/20260913160000_cobertura_de_operacion_en_la_base.sql, scripts/test-s05-map-browser.ts (molde del SDK falso)

## Pruebas

- Precondición SQL en staging: vicino_cobertura 'operacion' = 'pais', igual que prod (prodRead de solo lectura); dentro_de_cobertura en Villahermosa = true y en Guatemala = false; los 2 triggers exigir_cobertura_* existen.
- Storage en staging: bucket product-media presente; subida y borrado de un PNG 1x1 con el token sintético → 200/200.
- e2e staging scripts/staging/e2e-ubicacion-publicar.mjs contra http://localhost:3100 (dev-contra-staging). Pasos esperados: publicar con ubicación (redirección + 1 fila + punto correcto + dentro_de_cobertura true + ubicacion = nombre de la sugerencia); ficha pública sin coordenadas crudas; editar con el pin movido (1 fila, punto nuevo distinto del anterior, ubicacion = nombre de la inversa, get_product_location con el token del usuario = punto nuevo); solicitud en Mérida (1 purchase_request open, punto correcto, categorías ≥1, dentro_de_cobertura true); negativo UI en Guatemala (aviso y 0 filas nuevas); negativo API en Guatemala (400, code 22023).
- Limpieza: limpiar() devuelve 0 usuarios @staging.vicino.test y quedan 0 filas '[FIXTURE] S05' en products_services y purchase_requests.
- Regresión de los fixtures compartidos: repetir e2e-campus-home.mjs (11/11) y e2e-chips-home.mjs (6/6) contra staging tras el cambio de limpiar().
- node --check de los dos scripts nuevos. No hacen falta pruebas unitarias con jiti porque no cambia código de la app.

## Riesgos

- El proveedor falso acredita la cadena UI → base → trigger, no MapKit real, pinch ni tap en iPhone o iPad. Eso sigue en D01-S05 con dispositivo y hay que dejarlo escrito para que nadie dé S05 por cerrado del todo.
- Si el script falso servido por page.route no lleva Access-Control-Allow-Origin, use-mapkit.ts (crossOrigin=anonymous) lo rechaza, el buscador queda deshabilitado y el fallo parece de la app.
- Un clic antes de hidratar se pierde en silencio. Hay que esperar a que se habilite el input del buscador, que depende de mapkit.isAvailable, y rellenar con fill o insertText, nunca con el setter nativo.
- Deriva de esquema en staging (S04 aplicado y deshecho, ledger distinto de prod): publicar podría fallar por GRANTs o columnas ajenas a S05. En ese caso se anota como hallazgo y NO se corre igualar-con-prod --aplicar con los ledgers distintos.
- El cambio de limpiar() afecta a todos los e2e de staging. Por eso se repiten campus y chips como regresión.
- Si se añadiera foto, limpiar() no puede borrar storage.objects por SQL: habría que retirarla por la Storage API. Por eso la prueba principal va sin foto.
- Un push a master redespliega prod aunque solo cambien scripts y docs, porque vercel.json no tiene ignoreCommand.

## Requiere antes

- Staging vivo con claves: .staging/staging.json con ref, url, anon y service (verificado que existe).
- Token de la Management API en .env (SUPABASE_ACCESS_TOKEN), para sql() en staging y prodRead de solo lectura.
- Puerto 3100 libre y sin otra sesión usando dev-contra-staging; Chromium de Playwright en apps/web (ya lo usa e2e-campus-home esta noche).
- Ninguna decisión de Javier: no hay rediseño y la apariencia no cambia.
- Pedro: no hace falta nada para la prueba (solo staging). Solo autoriza si hay que desplegar a prod un arreglo de la app que salga de aquí.

**Responsable:** Claude

**Estimación:** 3–4 h: MapKit falso ~45 min, script e2e ~1–1.5 h, ejecución y depuración contra staging ~45 min (el primer compilado de next dev es lento), registro en docs y Notion ~20 min. Si aparece un bug real de la app, añadir 1–2 h aparte.

**Ejecutable por Claude ahora:** sí
