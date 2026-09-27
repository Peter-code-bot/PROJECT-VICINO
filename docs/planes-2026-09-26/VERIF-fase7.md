# Plan VERIF-fase7

**Pendiente:** Fase 7: una corrida unificada de navegación, build y e2e en móvil sobre el SHA de master

**Fuentes en Notion:** G l.1811-1812 (G-fase7-verificacion)

**Estado conciliado (26-sep ~23:30):** parcial. Security Audit en verde en 4f5577b y en los 5 commits anteriores; build 56/56 en cada bloque. En prod a 390x844: header 3/3, Villahermosa 3/3 y campus como visitante. Nada probado en iPhone.

**Qué falta:** Plan: en una sola corrida sobre 4f5577b, s01-verificaciones.spec.ts y los e2e de scripts/staging/ (chat-venta, campus, chips, header, villahermosa) a 390 y 1280, más los recorridos de ida y vuelta por la navegación y la ficha. Registrar en D01 el SHA, el entorno y el resultado. El recorrido en iPhone/iPad queda para Javier y Pedro.

## Objetivo

Hacer una sola corrida sobre la app en 4f5577b (el mismo código que cc385bc, porque el diff entre ambos solo toca docs/PENDIENTES-2026-09-26.md). Incluye build, pruebas unitarias, las pruebas aisladas de navegación, los e2e de staging (chips, campus y chat-venta) y un smoke de solo lectura en producción (header, Villahermosa, S01, navegación, ficha como visitante y recorridos de ida y vuelta), todo a 390 y a 1280. El resultado se registra en D01 con SHA, entorno y X/Y por suite. El recorrido en iPhone/iPad se entrega como lista de pasos a Javier y Pedro.

## Pasos

1. 1. Congelar la base. Correr git fetch y confirmar que HEAD = origin/master = 4f5577bad1b0feda0412a0080200031e4cc9db33, que git status --porcelain está vacío y que git diff --stat cc385bc 4f5577b -- apps queda vacío. Si otra sesión está commiteando en este working tree, hacer la corrida en un git worktree de 4f5577b.
2. 2. Ver qué SHA sirve producción. Bajar el HTML de https://vicinomarket.com, sacar los /_next/static/chunks/*.js y buscar en ellos el SHA de 40 caracteres que Next inyecta como NEXT_PUBLIC_RELEASE (apps/web/next.config.ts l.20 y l.320). Tiene que ser cc385bc4f7a3… o 4f5577bad1b0…; si es otro, se para y se avisa. Como respaldo: gh api repos/Peter-code-bot/PROJECT-VICINO/commits/4f5577b/status.
3. 3. Revisar staging. La lista de supabase/migrations tiene que coincidir con .staging/aplicadas.json (hoy las dos terminan en 20260926100000). Usuarios @staging.vicino.test: 0 (limpiar() y leer() de scripts/staging/fixtures.mjs). No tocar nunca borrar.mjs.
4. 4. Preparar la herramienta en la rama test/fase7-corrida, creada desde 4f5577b. En scripts/staging/lib.mjs, agregar contextoE2E(defecto): lee E2E_VIEWPORT=ANCHOxALTO y pone isMobile/hasTouch si el ancho es menor de 768. Agregar también salidaE2E(): .staging/e2e/<E2E_ETIQUETA>. Sin esas variables, todo se comporta como hoy.
5. 5. Cambiar una línea (el newContext y el OUT) en e2e-header-fijo.mjs, e2e-villahermosa.mjs, e2e-campus-home.mjs, e2e-chips-home.mjs y e2e-chat-venta.mjs, para que usen contextoE2E con su viewport actual como defecto (390x844 o 420x860) y salidaE2E.
6. 6. Crear scripts/staging/e2e-ida-vuelta.mjs como visitante y en solo lectura, con E2E_BASE y contextoE2E. Pasos: (a) Home, bajar 1500, abrir una ficha, atrás: pathname / con scroll a ±200 y sin .esqueleto-demorado visible. (b) Ficha, botón aria-label=Volver (gallery-top-bar.tsx l.103-109): vuelve por el historial. (c) Entrada directa a la ficha en un contexto nuevo, Volver: cae en / (se registra history.length). (d) /buscar?q=mesa&sort=price_asc, ficha, atrás: q y sort se conservan. (e) Solo a 390: #nav-inicio, #nav-buscar, #nav-inicio y dos veces atrás; pathnames correctos, ningún 404 ni pageerror. Una captura por paso.
7. 7. Crear apps/web/playwright.fase7.config.ts: sin dotenv, sin seed, sin storageState y sin webServer; baseURL=E2E_BASE; testMatch s01-verificaciones, navegacion y product-detail; grepInvert /con sesion|como vendedor|visitor autenticado|owner/. Proyectos: 'mobile' (390x844, isMobile, hasTouch, testIgnore s01, que ya fija sus propios 1280x800 y 375x812) y 'desktop' (1280x800). Se conservan esos nombres porque navegacion #3 y product-detail #7 los consultan.
8. 8. Revisar que la herramienta no cambia la app. git diff --stat 4f5577b -- apps/web ':(exclude)apps/web/playwright.fase7.config.ts' tiene que quedar vacío, y node --check tiene que pasar en los 7 .mjs.
9. 9. Bloque build sobre el código de 4f5577b: cd apps/web && pnpm type-check && pnpm lint && pnpm build. Anotar exit codes, 56/56 páginas y BUILD_ID.
10. 10. Unitarias: cd apps/web && pnpm exec tsx --test lib/feed-cursor.test.ts lib/freno-en-memoria.test.ts lib/geo/location-search.test.ts lib/navigation/restauracion-ui.test.ts. Desde la raíz: pnpm exec tsx scripts/test-navigation-critical.ts y pnpm exec tsx scripts/test-retorno-vender.ts.
11. 11. Navegación aislada (sin .env ni cuentas): cd apps/web && pnpm exec playwright test -c playwright.gestures.config.ts --output ../../.staging/e2e/fase7-4f5577b/gestures (a 390 con touch). Después, -c playwright.frontend.config.ts --output ../../.staging/e2e/fase7-4f5577b/frontend (1280 y 375). El --output evita que escriban en C:/Users/pedro/reports.
12. 12. Staging. Levantar en segundo plano node scripts/staging/dev-contra-staging.mjs (:3100) y precalentar / y /buscar. Para W en 390x844 y 1280x800, con E2E_VIEWPORT=W y E2E_ETIQUETA=fase7-4f5577b/W: e2e-chips-home.mjs, e2e-campus-home.mjs y e2e-chat-venta.mjs, en ese orden y uno a la vez. Al final: 0 fixtures restantes y apagar el dev server.
13. 13. Producción en solo lectura, con E2E_BASE=https://vicinomarket.com. e2e-header-fijo.mjs solo a 390; a 1280 es N/A porque el header móvil vive en un div md:hidden (ver 209caf7). e2e-villahermosa.mjs y e2e-ida-vuelta.mjs a 390 y a 1280. Luego cd apps/web && pnpm exec playwright test -c playwright.fase7.config.ts --output ../../.staging/e2e/fase7-4f5577b/pw-prod. Al terminar, repetir el paso 2: el SHA de prod no debió cambiar.
14. 14. Clasificar cada FALLO. Se reproduce a mano en el navegador con el mismo viewport y se etiqueta como bug real (repro + archivo), prueba desactualizada o ruido de entorno (next dev frente al build, o datos). En esta corrida no se arregla nada. Lo visual no cuenta como bug: es de Javier.
15. 15. Registrar en Notion, en la sección 'D01 — Matriz de pruebas y acta de cierre' de la página de la jornada, la fila 'Fase 7 — corrida unificada'. Datos: SHA de la app 4f5577b, SHA de la herramienta, SHA servido en prod, ref de staging (sin claves), navegador y viewports, X/Y por suite, rutas de evidencia y estado PASA / FALLA / N/A / PENDIENTE DISPOSITIVO. Replicar el resumen en docs/PENDIENTES-2026-09-26.md.
16. 16. Hacer commit de la herramienta (test(fase7): ...) y de los docs (docs(pendientes): ...). El push va después del smoke de prod, porque un push a master redespliega Vercel. Si Pedro no quiere ese redespliegue, se queda en la rama test/fase7-corrida.
17. 17. Entregar a Javier y Pedro la lista para iPhone/iPad en el build de TestFlight. Qué revisar: header y cápsula nativa con safe areas al bajar en Home, ficha y Solicitudes; MapKit, GPS, tap, arrastre y pinch con Villahermosa; arranque en frío desde un enlace sin bucle (cc385bc); ida y vuelta Home↔ficha con el gesto de borde; campus como estudiante. Queda en D01 como PENDIENTE DISPOSITIVO.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/lib.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-header-fijo.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-villahermosa.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-campus-home.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-chips-home.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-chat-venta.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-ida-vuelta.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/playwright.fase7.config.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- Solo lectura, como referencia: apps/web/tests/s01-verificaciones.spec.ts, apps/web/tests/navegacion.spec.ts, apps/web/tests/product-detail.spec.ts, apps/web/playwright.gestures.config.ts, apps/web/playwright.frontend.config.ts, apps/web/components/product/gallery-top-bar.tsx, apps/web/next.config.ts, scripts/staging/fixtures.mjs, scripts/staging/dev-contra-staging.mjs
- Notion: página de la jornada del 26-sep, sección 'D01 — Matriz de pruebas y acta de cierre'

## Pruebas

- Build: pnpm type-check, lint y build en apps/web con exit 0, 56/56 páginas y BUILD_ID registrado.
- Unitarias con node:test + tsx: los 4 *.test.ts de apps/web/lib, más scripts/test-navigation-critical.ts y scripts/test-retorno-vender.ts, todos en verde.
- Playwright aislado: playwright.gestures.config.ts (390, touch) y playwright.frontend.config.ts (1280 y 375), sin red, sin .env y sin cuentas.
- E2E contra staging (web local :3100, fixtures @staging.vicino.test): e2e-chips-home, e2e-campus-home y e2e-chat-venta, cada uno a 390x844 y a 1280x800. Al terminar, 0 fixtures restantes.
- Smoke de solo lectura en prod (visitante): e2e-header-fijo a 390; e2e-villahermosa y e2e-ida-vuelta a 390 y 1280; playwright.fase7.config.ts con S01 (1280 y 375), navegación #1-#3 y ficha #1/#5/#6/#7.
- Control de SHA: el SHA de la app es igual antes y después; el SHA que sirve prod (NEXT_PUBLIC_RELEASE en el bundle) es cc385bc o 4f5577b y no cambia durante la corrida; el diff de la herramienta sobre apps/web, sin contar la config nueva, está vacío.
- Criterio de cierre: la fila de D01 está completa con X/Y por suite, cada FALLO clasificado con repro y el iPhone/iPad marcado como PENDIENTE DISPOSITIVO.

## Riesgos

- Los e2e de staging corren contra next dev (dev-contra-staging.mjs), no contra el build de producción. El build se valida con el paso 9 y con el smoke de prod; esa diferencia se anota en D01.
- Si alguien hace push a master durante la corrida, prod se redespliega y el SHA ya no coincide. Por eso se revisa el SHA servido antes y después, y nada se empuja hasta terminar el smoke.
- Hay specs viejas (product-detail de MP#06, s01) que pueden dar rojos falsos con la UI actual. Todo fallo se reproduce a mano antes de llamarlo bug, y en esta corrida no se editan pruebas ni app.
- s01-verificaciones.spec.ts fija su móvil en 375x812, no en 390. Se registra así; la cobertura a 390 viene de los scripts con E2E_VIEWPORT y del proyecto 'mobile' de la config fase7.
- El header fijo es solo de móvil (md:hidden): a 1280 es N/A, no FALLO.
- En el paso (c) de ida y vuelta, history.length en Playwright puede no ser 1 en una pestaña nueva. Se registra el valor y, si Volver no cae en /, se reproduce en un navegador real antes de abrir un bug.
- Si un script de staging revienta, pueden quedar fixtures. limpiar() corre en el catch y al final se revisa que el conteo sea 0. borrar.mjs no se usa nunca.
- Las pruebas a 390 con isMobile/hasTouch pueden destapar diferencias que la corrida previa a 420 sin isMobile no veía (sobre todo en chat-venta). Son hallazgos que se clasifican, no motivo para ajustar la prueba en la misma corrida.
- Las cuentas de VICINO_TEST_EMAIL (seed.spec.ts) y los tests con sesión (navegacion #4/#5, product-detail #2-#4, navigation-return) quedan fuera por la regla de no usar cuentas reales. Esa matriz autenticada es de PT06, con roles dedicados en staging.

## Requiere antes

- Ninguna decisión bloquea la parte web: .staging/staging.json existe, staging ya tiene todas las migraciones de master y Chromium/Chrome corrieron esta noche.
- Confirmar que ninguna otra sesión commitea en el mismo working tree durante la corrida; si hay una, usar un git worktree de 4f5577b.
- Visto bueno de Pedro para hacer push a master de los commits de herramienta y docs, porque dispara un redespliegue en Vercel con el mismo código de la app. Sin ese visto bueno quedan en la rama test/fase7-corrida.
- Para iPhone/iPad: dispositivo con el build de TestFlight, en manos de Javier o Pedro.

**Responsable:** Claude (web, staging, smoke de prod y registro en D01). Javier y Pedro: recorrido en iPhone/iPad.

**Estimación:** 3.5 a 4.5 h. Herramienta (helpers, config y script de ida y vuelta): unos 60 min. Build, unitarias y aisladas: unos 30 min. Staging 3 scripts x 2 viewports: 35-45 min. Smoke de prod: unos 25 min. Clasificación de fallos: 30-45 min. D01, PENDIENTES y commit: unos 20 min. El recorrido en iPhone/iPad va aparte: 45-60 min de Javier o Pedro con el dispositivo.

**Ejecutable por Claude ahora:** sí
