# Plan PREVIEW-mapa

**Pendiente:** 'Mapa no disponible' en la ficha: diagnóstico del caso reportado, smoke del proveedor real y privacidad

**Fuentes en Notion:** C l.413 (PT05-preview-privacidad); D l.649 (R05-preview-mapa-no-disponible); E l.1170 (D01-S05-smoke-proveedor); F l.1483-1489 (S05-preview-mapa-no-disponible); G l.1708-1711 (G-mapa-preview); H l.27 (H27-preview-mapa-no-disponible)

**Estado conciliado (26-sep ~23:30):** parcial. route.ts:46-76 separa 404, 409, 429 y 503; location-banner.tsx:26 permite reintentar; hay freno de 20/min por instancia (route.ts:26). .env.local no tiene APPLE_MAPKIT_*: el proveedor real solo existe en Vercel. La publicación del reporte nunca se identificó.

**Qué falta:** Plan: (1) pedir a Javier el enlace de la publicación. (2) Consulta de solo lectura: publicaciones 'disponible' sin ubicacion_geo o con location_map_available=false. (3) GET anónimo en prod a /api/products/<id>/location-map: pública con ubicación = 200 image/png, Cache-Control private, sin coordenadas ni URL firmada; inexistente = 404 not_available; pausada u oculta = 404. (4) En staging, sin claves, sale 503 temporarily_unavailable y la ficha debe mostrar Reintentar; un fixture sin ubicación da 404 location_missing; comprobar dueño, ajeno y visitante sin fuga por caché. (5) Si falta la coordenada es un dato, no un bug: decidir con Javier si se oculta el banner o se pide al vendedor. Registrar en D01-S05.

## Objetivo

Averiguar la causa del mensaje sobre el mapa de la ficha que se reportó: puede ser un dato que falta (la publicación no tiene ubicacion_geo), el proveedor Apple caído o mal configurado, el límite de peticiones, o que la RLS de la ruta y la de la ficha no coincidan. Además, confirmar con un smoke de solo lectura en prod que el proveedor real devuelve el PNG sin exponer coordenadas ni la URL firmada, y que la matriz dueño/ajeno/visitante y la caché cumplen el contrato D02-S05. La apariencia de la ficha no se toca.

## Pasos

1. 0. Confirmar qué código sirve prod (5 min). Hacer un GET anónimo a https://vicinomarket.com/api/products/00000000-0000-4000-8000-000000000000/location-map. Si devuelve 404 con cuerpo {"code":"not_available"}, prod ya lleva el código S05 (route.ts:29-33). Si el cuerpo viene vacío, sigue el código viejo de 4b6be86, que pintaba 'Mapa no disponible' ante CUALQUIER fallo, sin distinguir la causa.
2. 1. Pedir a Javier, por Pedro o por Notion, el enlace de la publicación y una captura del texto exacto. Cada texto apunta a una causa (map-preview-error.ts). 'Mapa no disponible' a secas: cliente viejo, cualquier fallo. 'Mapa no disponible para esta publicación.': 404 not_available. 'Esta publicación no tiene una ubicación disponible.': 404 location_missing. 'La ubicación cambió…': 409. 'Hay muchas consultas al mapa…': 429. 'No se pudo cargar el mapa. Intenta de nuevo.': 503 del proveedor o de la base, o el timeout de 15 s del cliente. Sin recuadro de mapa y solo con el texto de la zona: la publicación no tiene ubicacion_geo (page.tsx:168-178 pone available=false).
3. 2. Revisar el histórico de Sentry (lo hace Pedro, o Claude desde el navegador integrado si ya hay sesión abierta): org vicino-5r, proyecto vicino-web, tag action:productLocationMap, últimos 30 días. El código viejo enviaba el error real ('Map provider unavailable') con el tag productId. Si aparecen muchos productId, el proveedor está caído para todos (clave de Vercel). Si sale uno solo, es un caso de dato. Ojo: los 404 y los 429 nunca llegaron a Sentry.
4. 3. Consulta de solo lectura en prod por la Management API, envuelta en 'begin; set transaction read only; … ; rollback;'. Contar las publicaciones con estatus 'disponible' y is_hidden=false en tres grupos: con ubicacion_geo, sin ubicacion_geo, y con texto en 'ubicacion' pero sin punto. Con el slug de Javier, leer de esa fila solo estatus, is_hidden, (ubicacion_geo is null), updated_at y profiles.is_hidden del vendedor. Sin PII ni coordenadas. La columna es geography(POINT,4326), que no admite puntos 3D ni otro SRID, así que un location_missing con punto guardado es casi imposible.
5. 4. Smoke anónimo en prod con el script nuevo scripts/staging/smoke-preview-mapa-prod.mjs: solo GET y como máximo 4 llamadas que lleguen a Apple. El id de una publicación pública con ubicación sale del paso 3 o de PostgREST con anon. Comprobaciones: (a) theme=light y theme=dark dan 200, image/png, firma 89 50 4E 47, 'Cache-Control: private, max-age=86400', nosniff, sin 'x-vercel-cache: HIT' al repetir, y el cuerpo no contiene 'apple-mapkit', 'signature' ni 'teamId'; (b) un UUID inexistente da 404 con el JSON exacto {code:'not_available'} y 'private, no-store'; (c) el id 'abc' da 404 not_available; (d) el id de una publicación pausada (paso 3) da 404 not_available. Si (a) da 503 temporarily_unavailable, el proveedor está roto en prod y se pasa al paso 6.
6. 5. En el mismo script, con Playwright como visitante, abrir la ficha a 375x812 y a 1280x800: el <img> carga desde un blob:, aparece el círculo de zona y una sola petición por ficha (no una por layout), y caches.keys() del service worker no guarda location-map (regla NetworkOnly en next.config.ts:118-122).
7. 6. SOLO si prod da 503 o Sentry no dice la causa: cambio mínimo que no toca la apariencia. lib/geo/product-map-snapshot.ts lanza un error con un 'reason' de valores cerrados (config_missing | http_<status> | timeout | bad_content_type). route.ts:71-76 lo añade como tag de Sentry, con el mensaje genérico de siempre y nunca la URL ni la firma. Pedro revisa en Vercel (Production) que APPLE_MAPKIT_TEAM_ID, APPLE_MAPKIT_KEY_ID y APPLE_MAPKIT_PRIVATE_KEY existan y que la clave tenga el servicio de Snapshots. Push a master = despliegue a prod: necesita la autorización de Pedro, el loop CODEX y pnpm build.
8. 7. Matriz en staging, sin claves de Apple (una petición autorizada acaba en 503). Levantar la web con 'node scripts/staging/dev-contra-staging.mjs' (:3100) y correr el script nuevo scripts/staging/e2e-preview-mapa.mjs. En scripts/staging/fixtures.mjs, añadir a crearProducto la opción sinUbicacion (ubicacion_geo = null; el trigger de cobertura acepta null). Fixtures: vendedor V, comprador C y visitante. Productos: P1 disponible, P2 pausado, P3 oculto, P4 sin ubicación, P5 de un vendedor que bloquea a C, P6 de un vendedor suspendido.
9. 8. Casos de staging. Visitante en P1: 503 temporarily_unavailable con Retry-After 5; la UI muestra 'No se pudo cargar el mapa…' y 'Reintentar en N s'; al hacer clic sale 1 solo GET nuevo. Visitante en P2, P3 y P6: 404 not_available. Dueño V en P2: 503 (pasa la RLS de creador). C en P2: 404. C en P5: 404. P4 con GET directo: 404 location_missing, y la ficha no pinta el recuadro. Todos los errores llevan 'private, no-store' y un cuerpo que es solo {code}. El último caso es la ráfaga: 21 GET seguidos; el número 21 da 429 rate_limited con Retry-After 60 y la cuenta atrás en la UI. Al final, limpiar() y comprobar que quedan 0 fixtures.
10. 9. Si el caso reportado resulta ser un dato (sin ubicacion_geo), no es un bug. Llevar a Javier la decisión, con el conteo del paso 3: (a) dejarlo como está hoy, sin recuadro y solo con el texto de la zona; (b) mostrar al dueño, en su propia ficha, un aviso para que añada la ubicación. La opción (b) es rediseño y copy reservados a Javier; Claude no la implementa.
11. 10. Registrar la evidencia (SHA servido, estados, headers, conteos, fixtures 0) en docs/PENDIENTES-2026-09-26.md, en una sección PREVIEW-mapa. Anotarlo en Notion, en D01-S05 y en la página de la jornada del 26-sep, y cerrar R05, S05-preview y G-mapa-preview si procede.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/api/products/[id]/location-map/route.ts (lectura; solo cambia en el paso 6: tag de Sentry en l.71-76)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/geo/product-map-snapshot.ts (solo en el paso 6: reason cerrado del fallo del proveedor)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/geo/map-preview-error.ts (lectura: tabla de texto a código)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/product/location-banner.tsx (lectura; sin cambios de apariencia)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx (lectura: available en l.168-178)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/next.config.ts (lectura: NetworkOnly de location-map en l.118-122)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs (opción sinUbicacion en crearProducto)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-preview-mapa.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/smoke-preview-mapa-prod.mjs (nuevo, solo GET)
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-s05-map-server.ts (caso nuevo solo en el paso 6)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (registro)

## Pruebas

- Regresión de la API: node node_modules/tsx/dist/cli.mjs scripts/test-s05-map-server.ts (10 casos; route real con transporte sintético)
- Regresión de UI: pnpm --filter web exec playwright test --config playwright.s05.config.ts
- Smoke de solo lectura en prod: E2E_BASE=https://vicinomarket.com node scripts/staging/smoke-preview-mapa-prod.mjs (PNG privado sin secretos; 404 not_available para inexistente, 'abc' y pausada; SW sin caché)
- E2E contra staging: node scripts/staging/dev-contra-staging.mjs + node scripts/staging/e2e-preview-mapa.mjs (matriz visitante/dueño/ajeno/bloqueo/suspendido, location_missing, 503 con Reintentar, 429 al final, limpiar() = 0)
- Solo si se hace el paso 6: caso nuevo en scripts/test-s05-map-server.ts. Exige el tag reason y que ni el tag ni el mensaje contengan 'SECRET_SIGNED_URL'. Además, prueba unitaria con jiti de la clasificación del reason en product-map-snapshot con fetch simulado (pnpm --filter web exec jiti <archivo>.test.ts), y luego pnpm type-check, lint y pnpm build
- Consulta de solo lectura en prod dentro de 'begin; set transaction read only; … rollback;', con los conteos anotados en PENDIENTES

## Riesgos

- Cada GET de prod que da 200 es un snapshot de Apple que cuesta cuota: limitar el smoke a 4 como máximo y no repetirlo en bucle
- Staging no tiene claves de Apple, así que el 200 y la caché de un PNG real solo se pueden comprobar en prod, como visitante
- Es probable que el reporte fuera del cliente viejo (4b6be86), que no distinguía causas. Si el proveedor funciona hoy, el caso puede no reproducirse y solo Sentry mostrará qué pasó
- Los 404 y los 429 nunca llegan a Sentry; sin el enlace de Javier, el caso de dato no se puede atribuir a una publicación concreta
- El freno de 20/min es por IP y por instancia: detrás de un CGNAT móvil o de la WiFi de un campus puede dar 429 a usuarios legítimos. Subirlo cuesta dinero y lo decide Pedro
- La prueba de ráfaga agota el freno en memoria del servidor local: correrla la última
- La consulta en prod tiene que ser de solo lectura (transacción read only + rollback) y no sacar PII ni coordenadas
- Si la causa es un dato, la solución visible (aviso al vendedor u ocultar la sección) es rediseño o copy de Javier: no implementarla

## Requiere antes

- Enlace (o slug) de la publicación reportada y captura del texto exacto, ambos de Javier; no bloquean los pasos 0, 3, 4, 5, 7 y 8
- Acceso a Sentry (org vicino-5r, proyecto vicino-web), sea de Pedro o una sesión abierta en el navegador integrado; en local no hay token de Sentry
- Si prod da 503: que Pedro revise APPLE_MAPKIT_TEAM_ID, APPLE_MAPKIT_KEY_ID y APPLE_MAPKIT_PRIVATE_KEY en Vercel (Production) y en Apple Developer; en .env.local no existen
- Autorización explícita de Pedro para cualquier push a master (auto-despliegue a prod) si se hace el paso 6
- Que .staging/staging.json esté vigente (existe); fixtures solo del dominio @staging.vicino.test, sin cuentas reales ni seed
- Para cerrar del todo: ver la ficha en la app Capacitor en un iPhone o iPad (Javier o Pedro)

**Responsable:** Claude (diagnóstico, scripts y registro). Javier: enlace y captura del caso, y decisión si es un dato. Pedro: Sentry, variables APPLE_MAPKIT_* en Vercel y autorización de cualquier push a master.

**Estimación:** 3-4 h de Claude: 0,5 h para los pasos 0 y 3, 0,5-1 h para el smoke de prod, 1,5-2 h para la matriz de staging y 0,5 h de registro. Hay que sumar 1 h si hace falta el paso 6. Aparte queda la espera del enlace de Javier y la revisión de Sentry y Vercel por parte de Pedro.

**Ejecutable por Claude ahora:** sí
