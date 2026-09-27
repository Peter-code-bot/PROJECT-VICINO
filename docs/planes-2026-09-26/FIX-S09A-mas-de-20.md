# Plan FIX-S09A-mas-de-20

**Pendiente:** S09-A: tope silencioso de 20 en el modo campus y 'Ver todo' que pierde la categoría

**Fuentes en Notion:** A l.18 (S09A-navegacion-mas-de-20); D l.1130,1140-1143 (S09-integracion-home-busqueda-perfil, caso >20)

**Estado conciliado (26-sep ~23:30):** pendiente. Verificado ahora: lib/home-session-data.ts:215 (result_limit: 20) y :246 (.limit(20)) traen solo 20 publicaciones universitarias, y universityCarousels (l.265) arma la intersección con esas 20. home-session.tsx:134 y :201 enlazan a /buscar?category=universidad y pierden la categoría. e2e-campus-home no prueba 'Ver todo', la vuelta atrás ni más de 20.

**Qué falta:** Plan: (1) en staging, fixture con 25 o más publicaciones de una universidad en 2 categorías, con las de X más viejas; reproducir. (2) Arreglo sin tocar la apariencia: intersección por categoría en el servidor con su propio límite, o marca de 'hay más'; que 'Ver todo' conserve la categoría con un segundo parámetro en /buscar dentro del ámbito universitario (la pertenencia se sigue resolviendo en el servidor). (3) Ampliar e2e-campus-home: Ver todo, página 2, atrás con chips y scroll, más de 20. (4) tsc, lint, build y CI; subir a master con el OK de Pedro.

## Objetivo

Que el modo campus de Home no se corte en silencio en 20 publicaciones (con Universidad + X ya no debe decir 'No hay publicaciones de X' cuando X solo tiene publicaciones más viejas) y que el 'Ver todo' de cada fila universitaria lleve a /buscar dentro de la universidad y de ESA categoría, con paginación y vuelta atrás intactas. Sin cambiar apariencia ni migraciones. Verificado en el código: home-session-data.ts:215 y :246 piden 20; :265 agrupa esas 20; home-category-order.tsx:84 declara vacío con base en ellas; home-session.tsx:134 enlaza a /buscar?category=universidad sin categoría. La l.201 ('Lo mejor en tu universidad') está bien así: no hay categoría que conservar. /buscar descarta la categoría en modo universidad porque page.tsx:260 salta la rama de categoría cuando universityOnly. El RPC admite hasta 300 (safe_limit, migración 20260913120000), así que no hace falta migración.

## Pasos

1. 0. git fetch; git status (otra sesión commitea en este mismo árbol); rama fix/s09a-campus-mas-de-20 desde origin/master 4f5577b. Levantar la web local contra staging con scripts/staging/dev-contra-staging.mjs (:3100).
2. 1. Reproducir en ROJO: añadir a scripts/staging/e2e-campus-home.mjs un bloque aislado con una TERCERA universidad (UNI_C='UPAEP') para no desplazar uniA1/uniA2 de los pasos actuales. Crear el vendedor C y el lector C. Insertar con un solo INSERT ... SELECT generate_series 22 publicaciones en c2 con created_at = now() - 2 días (las más viejas) y 22 en c1 más recientes, con '[FIXTURE] CAMPUS-C-VIEJO/NUEVO', ubicacion_geo en Puebla y su fila en product_categories (is_primary=true). Hace falta porque no hay trigger que llene el pivote y /buscar filtra por él. Correr: el paso '?cats=universidad,c2' debe FALLAR hoy, mostrando 'No hay publicaciones de c2 en UPAEP'.
3. 2. Función pura nueva en apps/web/lib/university-rows.ts (sin server-only, para poder probarla). filasCampus(products, { tamFila: 20, tamPool }) devuelve { filas, truncado }. Agrupa igual que hoy (primaryCategorySlug, luego categoria TEXT, luego 'sin-categoria'), recorta cada fila a 20, no muta la entrada y marca truncado cuando products.length === tamPool.
4. 3. apps/web/lib/home-session-data.ts. Constante UNIVERSITY_POOL_SIZE = 150, la misma que INITIAL_HOME_PAGE_SIZE y por debajo del tope de 300 del RPC, en l.215 (result_limit) y l.246 (.limit). universityCarousels (l.265) sale de filasCampus. universityProducts viaja recortado a 20 (el carrusel 'Lo mejor en tu universidad' queda igual). universityPoolTruncated se añade al valor (l.465). La pertenencia se sigue resolviendo en el servidor con getUniversitySellerIds.
5. 4. apps/web/lib/university.ts. Añadir universitySearchUrl(slug?), que da /buscar?category=universidad&subcategory=<slug>, codificado; ignora vacío o 'universidad'.
6. 5. apps/web/app/(marketplace)/home-session.tsx. En l.134 el enlace pasa a universitySearchUrl(slug). En l.201 usar UNIVERSITY_SEARCH_URL (mismo destino). En l.78, desestructurar universityPoolTruncated y pasarlo a HomeCategoryOrder. Mismas clases y mismo marcado.
7. 6. apps/web/components/home/home-category-order.tsx. Nueva prop universityTruncated (por defecto false, para que la memoria de sesión anterior al deploy siga valiendo). En campusSlots (l.76-84), si truncado y la categoría no tiene fila, el mismo <p role=status> no afirma 'No hay': lleva un enlace 'Ver todo' a universitySearchUrl(slug) con las clases de los enlaces existentes. Ese texto se consulta con Javier; mientras tanto va una propuesta neutra.
8. 7. apps/web/app/(marketplace)/buscar/page.tsx. Añadir subcategory a Props (l.30-40). Si universityOnly y subcategory es un slug de CATEGORIES distinto de 'universidad', la rama de categoría (l.260) usa ese slug. Solo ESTRECHA: se suma a la restricción por creador_id o seller_ids; nunca amplía. pageUrl (l.428-437) conserva subcategory para la página 2. categoryName (l.423) queda como '<Categoría> de <Universidad>', en el mismo span.
9. 8. apps/web/app/(marketplace)/buscar/search-filters.tsx l.200-202: al aplicar el filtro de categorías, limpiar subcategory (updateParams({ category, subcategory: undefined, page: undefined })) para que no quede una combinación imposible.
10. 9. Pruebas unitarias e integración: ver 'pruebas'. Después, re-correr e2e-campus-home en VERDE (los 11 pasos previos más los nuevos) y e2e-chips-home (6/6) como regresión.
11. 10. CODEX Adversarial Review Loop (obligatorio por CLAUDE.md), después pnpm type-check, pnpm lint y pnpm build (56/56). Medir el tamaño de la semilla de Home (JSON de /api/session/home) antes y después con el fixture C.
12. 11. Actualizar docs/PENDIENTES-2026-09-26.md l.197-198 con commit y evidencia. Push de la rama; merge a master (= prod) SOLO con el OK explícito de Pedro.
13. 12. Tras el OK y el deploy: smoke de solo lectura en prod como visitante (ver 'pruebas'); luego fixtures restantes = 0 en staging.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/home-session-data.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/university-rows.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/university-rows.test.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/university.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/home-session.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/home/home-category-order.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/buscar/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/buscar/search-filters.tsx
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-frontend-routes.ts
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-campus-home.mjs
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md

## Pruebas

- Unitarias (jiti, igual que lib/geo/location-search.test.ts de cdc6f96): cd apps/web && pnpm exec jiti lib/university-rows.test.ts. Casos: (a) 22 en X viejas más 22 en Y nuevas: las dos filas existen y ninguna pasa de 20. (b) length === tamPool: truncado=true; menos: false. (c) agrupación primary > TEXT > sin-categoria, igual que antes. (d) la entrada no se muta. (e) universitySearchUrl(): sin slug, con slug, slug con caracteres a codificar y 'universidad' ignorado.
- Integración en scripts/test-frontend-routes.ts, con load() y overrides de '@/lib/university-data'. getHomeSession con un cliente falso que devuelve 44 filas: universityCarousels incluye la categoría vieja, universityProducts.length === 20, universityPoolTruncated === false. Con 150 filas: true. /buscar como visitante con {category:'universidad', subcategory:X}: la consulta queda acotada (id = 0000... o seller_ids vacío con restrict) y nunca devuelve el catálogo general.
- E2E staging, node scripts/staging/e2e-campus-home.mjs contra :3100 con el bloque UPAEP. (1) '?cats=universidad,c2' muestra CAMPUS-C-VIEJO y no aparece 'No hay publicaciones'. (2) El carrusel 'Lo mejor en tu universidad' sigue con 20 tarjetas como máximo. (3) 'Ver todo' de la fila c2 lleva a /buscar?category=universidad&subcategory=c2; dice '22 resultados' y solo muestra UPAEP c2 (nada de UNI_A, general ni c1). (4) La página 2 conserva subcategory y trae 2. (5) Atrás hasta Home: ?cats=universidad,c2, los dos chips con aria-pressed=true y scrollY dentro de ±150 px del de antes. (6) Mismo caso (1) con la cookie vicino_location de Puebla (rama RPC). (7) Visitante en /buscar?category=universidad&subcategory=c2: 0 fixtures y el aviso de universidad verificada. (8) Cambiar la categoría en el filtro de /buscar quita subcategory de la URL. (9) Los 11 pasos existentes siguen en verde, sin errores de página y con fixtures restantes = 0.
- Regresión: node scripts/staging/e2e-chips-home.mjs 6/6.
- Build: pnpm type-check, pnpm lint (0 errores), pnpm build y CI verde (security.yml). Comparar con la línea base antes de atribuir un rojo al cambio.
- Smoke prod de solo lectura tras el merge autorizado, como visitante y sin cuentas reales: /, /?cats=universidad, /buscar?category=universidad y /buscar?category=universidad&subcategory=<slug> responden 200. En el último, 0 resultados y el aviso de universidad verificada (sin fuga del catálogo general). Revisar Sentry sin errores nuevos de 'university'.

## Riesgos

- Pool de 150: con más de 150 publicaciones de una universidad el vacío falso vuelve a ser posible. Queda mitigado con la marca universityPoolTruncated y el enlace a /buscar, no eliminado. Hoy prod tiene 1 credencial universitaria aprobada.
- Carga de la semilla de Home: universityCarousels puede pasar de 20 a 150 tarjetas repartidas en filas de 20 como máximo. Se mide el JSON antes y después; si crece demasiado, se baja el pool o las filas.
- Home agrupa por la categoría primaria (o el TEXT de respaldo) y /buscar filtra por el pivote, primarias y secundarias. 'Ver todo' puede mostrar más que la fila, igual que las filas generales. Una publicación antigua sin fila en product_categories sale en Home pero no en /buscar.
- Seguridad: subcategory tiene que ESTRECHAR siempre. Se valida contra CATEGORIES y solo aplica con universityOnly. La prueba del visitante y la de otra universidad lo cubren.
- Memoria de sesión anterior al deploy sin el campo nuevo: prop con valor por defecto false.
- Interferencia en el e2e: 44 publicaciones nuevas empujarían a uniA1/uniA2 fuera del top 20. Por eso el bloque va aislado en UPAEP.
- Otra sesión commitea en el mismo árbol: rama propia y git status antes de cada commit.
- En prod no se puede probar el caso de estudiante con más de 20 sin cuentas reales. La evidencia de ese caso vive en staging; prod solo como visitante.

## Requiere antes

- Nada para staging: las claves están en .staging/staging.json y el flujo dev-contra-staging ya se usó hoy.
- OK explícito de Pedro para hacer merge/push a master (= deploy a prod).
- Decisión no bloqueante: el nombre del parámetro nuevo de /buscar ('subcategory' propuesto); queda como contrato público de URL.
- Decisión no bloqueante de Javier: el texto del aviso cuando el pool de 150 se queda corto. Se propone uno neutro con las clases existentes.

**Responsable:** Claude (implementación y pruebas en staging). Pedro: OK para subir a master (= prod). Javier: visto bueno del texto del caso truncado (no bloquea).

**Estimación:** 5-7 h: 1 h fixture y reproducción en rojo, 2 h arreglo (5 archivos más 1 módulo nuevo), 1,5 h unitarias e integración, 1-2 h de corridas e2e contra staging (arranques lentos, timeouts de 180 s), build/CI y review. Más 15 min de smoke en prod tras el OK.

**Ejecutable por Claude ahora:** sí
