# Plan FIX-solicitudes-fixtures

**Pendiente:** Fixtures de solicitudes: header fijo en /solicitudes/[id] y filtrado del feed contra la BD

**Fuentes en Notion:** A l.32,36 (BUG-HDR-detalle-solicitud); E l.1315-1321,1337 (D01-S01-solicitudes-feed-bd)

**Estado conciliado (26-sep ~23:30):** pendiente. 209caf7 cambió solicitudes/[id]/page.tsx:155 sin probarlo. fixtures.mjs no crea purchase_requests ni purchase_request_categories, y limpiar() no las borra. El visitante no ve solicitudes abiertas.

**Qué falta:** Plan: (1) crearSolicitud() en fixtures.mjs, con 2 o más categorías, y su borrado en limpiar(). (2) Sesión de un usuario fixture en :3100. (3) Ampliar e2e-header-fijo con /solicitudes/<id>: tras el scroll, el header en top 0 y la barra de la solicitud debajo, sin taparse. (4) Paso 7 de S01: elegir una categoría deja solo sus tarjetas y la X las devuelve todas. (5) limpiar() en 0. Objetivo: 28-sep.

## Objetivo

Probar de verdad dos cosas sobre datos sintéticos del staging. Primero, que en /solicitudes/<id> el header móvil queda fijo en top 0 y la barra de la solicitud (page.tsx:155, cambiada en 209caf7 sin prueba) queda justo debajo, sin taparse. Segundo, el paso 7 de S01: en /?feed=solicitudes, al elegir una categoría quedan solo sus tarjetas y la X las devuelve todas. limpiar() tiene que dejar 0 fixtures. Hallazgo al leer el código: el visitante del e2e de producción no ve solicitudes porque no trae la cookie vicino_location. Sin ella, SolicitudesFeed (solicitudes-feed.tsx:74) pinta "Activa tu ubicación" y nunca llama al RPC. No es la RLS: purchase_requests deja leer a anon las filas abiertas. Además, el paso 3 de e2e-header-fijo.mjs da OK sin datos y se salta la comprobación de la barra cuando scrollY es 0, así que su 3/3 es un falso verde para el detalle.

## Pasos

1. 1. Comprobación previa del staging, de solo lectura, con leer(). Deben existir purchase_requests y purchase_request_categories, y una sola función feed_nearby_requests (pg_proc = 1). Las categorías comida, postres y ropa tienen que estar en public.categories; también son visibles en CATEGORIES de @vicino/shared, que es lo que pinta el drawer. Si falta algo, parar: el esquema del staging está desfasado.
2. 2. En scripts/staging/fixtures.mjs, crear crearSolicitud(cfg, compradorId, { titulo, slugs, descripcion }). Hace un INSERT por SQL en purchase_requests con título '[FIXTURE] …', status 'open', expires_at now()+48h y ubicacion_geo en PUEBLA (pasa el trigger exigir_cobertura). Luego INSERT…SELECT en purchase_request_categories por slug. Lanza error si las filas insertadas no son slugs.length (el trigger admite un máximo de 3). Devuelve el id.
3. 3. En fixtures.mjs, limpiar(): antes de borrar auth.users, añadir 'delete from public.request_responses where seller_id in ids' y 'delete from public.purchase_requests where buyer_id in ids' (el borrado arrastra en cascada el pivote y las ofertas). El valor devuelto sigue siendo un número: usuarios del dominio + purchase_requests con título '[FIXTURE]%' + filas huérfanas del pivote. Así no se rompen los 4 scripts que lo llaman.
4. 4. En fixtures.mjs, exportar entrarPorUI(page, base, u), el mismo bucle de login de e2e-campus-home.mjs, y cookieUbicacion(ctx, base), que pone vicino_location con Puebla en el formato URL-encoded que escribe la app. No se tocan los e2e existentes.
5. 5. Nuevo scripts/staging/header-medidas.mjs. Recibe medir() y exigirFijo() de e2e-header-fijo.mjs y añade medirBarra(page): top y alto del div sticky que contiene el h1 'Solicitud', más si elementFromPoint en su centro cae dentro de la barra. e2e-header-fijo.mjs pasa a importarlos. Además pone la cookie de ubicación al visitante y, si no hay solicitudes, dice 'detalle SIN DATOS' en vez de darlo por cubierto.
6. 6. Nuevo scripts/staging/e2e-solicitudes.mjs: web local en :3100 contra staging, viewport 390x844 móvil. Crea un comprador y un lector fixture con completarOnboarding, y 3 solicitudes. A lleva [comida, postres] y una descripción de unas 40 líneas para que la página baje 600 px o más; B lleva [ropa] y C [comida]. Todo va dentro de try/finally con limpiar().
7. 7. Paso de base, sin UI: rpc feed_nearby_requests como anon en Puebla. Sin categoría debe devolver A, B y C; con 'ropa', solo B; con 'postres', solo A (su segunda categoría cuenta); con 'comida', A y C. Solo se cuentan filas [FIXTURE].
8. 8. Header en el detalle, con el visitante (con cookie) y con el lector (con sesión). Cada uno abre /solicitudes/<A> y baja 600. Se exige scrollY ≥ 300, header en top 0 con Rankings y Notificaciones, y barra en top igual al alto del header ±1 px (56). elementFromPoint dentro de la barra debe caer en la barra. Se guarda la captura .staging/e2e/header-solicitud.png.
9. 9. S01 paso 7 con la sesión del lector: /?feed=solicitudes y esperar las 3 tarjetas [FIXTURE]. Abrir [data-testid=filtro-categorias-trigger] y reintentar hasta ver role=dialog, para no perder el clic antes de hidratar. [data-categoria-slug=ropa] + Aplicar: queda solo B y el disparador muestra 'Ropa y Accesorios' con su X. Repetir con postres: queda solo A. Tocar [aria-label='Limpiar categoría']: vuelven A, B y C y el disparador dice 'Categorías'. Sin pageerror.
10. 10. Cierre: imprimir N/N y 'Fixtures restantes: 0'; el exit code es distinto de 0 si algo falla.
11. 11. Si la barra sale tapada, el arreglo es solo el offset top de apps/web/app/(marketplace)/solicitudes/[id]/page.tsx:155, sin cambiar la apariencia. Va en un commit aparte y su despliegue necesita el OK explícito de Pedro.
12. 12. Revisar git status (otra sesión commitea en el mismo working tree). Hacer commit solo de scripts/staging/* y de docs/PENDIENTES-2026-09-26.md: en la sección del header móvil, el detalle queda probado con evidencia; en S01, el paso 7 PASA. La página de Notion la actualiza el orquestador.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/header-medidas.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-header-fijo.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-solicitudes.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/solicitudes/[id]/page.tsx (solo si la barra sale tapada; línea 155)
- Solo lectura, como referencia: apps/web/components/solicitudes/solicitudes-feed.tsx, apps/web/components/shared/filtro-categorias-drawer.tsx, apps/web/lib/home-session-data.ts:69-96, supabase/migrations/20260912110000_feed_solicitudes_distancia_a_100m.sql, supabase/migrations/20260710000001_purchase_requests.sql

## Pruebas

- node --check en fixtures.mjs, header-medidas.mjs, e2e-header-fijo.mjs y e2e-solicitudes.mjs.
- node scripts/staging/dev-contra-staging.mjs (:3100) y luego node scripts/staging/e2e-solicitudes.mjs: todos los pasos OK (RPC, header del visitante, header del lector, filtro ropa, filtro postres, X, sin errores) y 'Fixtures restantes: 0'.
- Regresión de limpiar(): node scripts/staging/e2e-chips-home.mjs debe dar el mismo 6/6 de antes y 'Fixtures restantes: 0'.
- Smoke de solo lectura en producción: E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-header-fijo.mjs debe seguir 3/3. Si prod no tiene solicitudes abiertas en Puebla, el detalle sale 'SIN DATOS' y no OK.
- SQL de lectura en staging después de la corrida: count de auth.users del dominio staging.vicino.test = 0, de purchase_requests con título '[FIXTURE]%' = 0 y de purchase_request_categories huérfanas = 0.
- Evidencia: capturas .staging/e2e/header-solicitud.png y solicitudes-filtro.png, y la salida N/N pegada en docs/PENDIENTES.

## Riesgos

- Clic antes de hidratar: se pierde en silencio y el test lee el estado viejo. Hay que esperar role=dialog y reintentar, no usar esperas fijas.
- Chromium no emula env(safe-area-inset-top). Esto prueba el offset de 56 px, no el notch: el cierre en iPhone (cápsula nativa, safe areas) sigue pendiente en dispositivo.
- El staging puede tener otras solicitudes abiertas cerca de Puebla. Solo se cuentan tarjetas [FIXTURE], si no el conteo del filtro miente.
- Cambiar limpiar() afecta a e2e-chips-home, e2e-campus-home, e2e-chat-venta y probar-s04. Se mantiene el tipo de retorno (número) y se corre una regresión.
- Esquema del staging desfasado respecto de prod (pivote, RPC o categorías). La comprobación previa del paso 1 lo detecta antes de escribir.
- next dev compila en frío despacio (timeouts de 180 s) y la Management API puede dar 429 (lib.mjs ya reintenta).
- La página del detalle es corta sin descripción larga. Sin scroll real, la comprobación de la barra no significa nada: por eso se exige scrollY ≥ 300.
- Otra sesión commitea en el mismo working tree: revisar git status y hacer git add solo de los archivos del plan.

## Requiere antes

- Staging con claves en .staging/staging.json (existe) y SUPABASE_ACCESS_TOKEN en .env para la Management API.
- Web local levantada con scripts/staging/dev-contra-staging.mjs en :3100.
- Ninguna decisión de Javier: no hay cambio visual.
- Autorización explícita de Pedro solo si hace falta tocar page.tsx:155 y desplegar a producción.

**Responsable:** Claude

**Estimación:** ~3 h: 1 h de fixtures y helpers, 1.5 h de e2e-solicitudes con depuración de hidratación y compilación en frío, 0.5 h de regresión y docs. Objetivo: 28-sep-2026.

**Ejecutable por Claude ahora:** sí
