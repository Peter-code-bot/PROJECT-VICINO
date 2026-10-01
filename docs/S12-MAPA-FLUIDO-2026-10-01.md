# S12 — Mapa fluido y correcciones visuales

01-oct-2026. Ejecutor: Codex, familia GPT-6. Base: fec6ae490d10f92de62813ad0839d2ad21315a6d. Plan operativo y registro de aceptación en [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263); [tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26). Javier autorizó implementación, pruebas y push a master para revisar producción.

## Cambios

- `publication-markers.ts`, `publication-map.tsx`, `use-mapkit.ts`: objetos de anotación por ID, actualización parcial de propiedades, listener único con payload vigente, deselect nativo al cerrar, altas antes de bajas. Limpieza completa al desmontar.
- `map-coverage.ts`, `map-explorer.tsx`: agrupación de celdas completas antes de intersectar viewport, límite300 y margen180 para refinar; overview85/70km. Seleccionar capa retenida utiliza su propio centro y revisión.
- `use-publication-coverage.ts`, `use-coverage-listings.ts`: retención solo en mismo contexto de consulta/visor/intento; fallo de nueva cobertura conserva capa compatible. Abort y cambio de generación síncronos al invalidar, evitando recache y tarjetas antiguas antes del cleanup.
- `location-map-preview.tsx`: imagen16:9 completa sin franjas ni pie ni flecha; enlace accesible con ubicación/retry como hermanos independientes.
- Buscar y `discovery-filters.tsx`: sin preview/snapshot; ubicación dentro de Filtros con selector existente, centro SSR/URL validado, borrador y foco conservados. Se restaura foco al terminar navegación si el botón estaba disabled. Un solo modal activo.
- `publication-results-drawer.tsx`: crema `--bg`, tarjetas grises `product-card-custom`, espacios y jerarquía existentes. Conserva animación, drag, X, Escape/Back, paginación, foco y safe areas.
- Alternativa de puntos oculta visualmente hasta recibir foco: conserva teclado/lector sin panel permanente. Mensajes de fallo ofrecen catálogo y controles útiles.

No hay cambios de SQL, dependencias, credenciales ni permisos. Coordenadas exactas siguen privadas; la proyección pública aproximada instalada continúa sin modificaciones. El formulario de publicaciones conserva su selector y la configuración S11 de punto sin círculo/control de radio.

## Comprobaciones locales

Desde la raíz del checkout, cada script se ejecutó con `node node_modules/tsx/dist/cli.mjs scripts/<archivo>`. Exit0 en los siete controles: **162 comprobaciones**.

| Script | PASS | Alcance |
|---|---:|---|
| test-s12-map-markers.ts |12| identidad y reconciliación, SDK sintético |
| test-s12-map-markers-browser.ts |24| efectos React/StrictMode, 390/1280px, SDK controlado |
| test-s12-map-clusters.ts |4| conteos, límites y estabilidad de nivel con celdas sintéticas |
| test-s11-map-cache.ts |17| transporte controlado y caché |
| test-s11-map-browser.ts |69| 390/820/1280px, componentes/hooks reales, SDK y transporte controlados |
| test-s12-preview-browser.ts |14| 320/375/390/1280px, PNG/navegación/GPS controlados y hoja |
| test-s12-filters-browser.ts |22| 320/375/1280px, filtros reales y límites externos controlados |

La suite de mapa procesa veinte pan/zoom en cuadros separados: mismo objeto de anotación, una instancia SDK y cero llamadas nuevas de publicaciones dentro de cobertura vigente. Prueba también A→B503 con alerta/fin pending/centroA y retryB; invalidación y liberación de respuesta anterior en el mismo ciclo en cobertura y detalle; paginación30+5, dark/reduced-motion, cierre/foco/drag, filtros/visor/ubicación y regresión del formulario.

Salida de la última ejecución del mapa, **truncada: primeras líneas y últimas líneas**, exit0:

```text
PASS 390 no permanent products or duplicate filters; one SDK; no GPS/geocode
PASS 390 20 pan/zoom events retain the same annotation and make zero new publication API calls
PASS 390 pin drawer loads 30, cursor appends 5, group remains frozen on camera
PASS 390 X closes and returns focus to the retained pin without opening the keyboard
PASS 390 focus-only keyboard points replace permanent panel; reopening resets page and keeps actual price modes
```

Se omiten los controles intermedios de390/820 y primera parte de1280. Últimas líneas:

```text
PASS 1280 failed coverage retains the original context, ends pending and retry recovers the new context
PASS 1280 same-cycle invalidation aborts late coverage before it can restore the old generation or cache
PASS 1280 same-cycle invalidation aborts late detail and expired cards never return
PASS 1280 SDK failure preserves accessible catalog link
PASS 1280 publication preview hides circle/control, preserves pin and saved radius contract
PASS 1280 other pickers retain their default radius preview
S11 map browser: 69/69 PASS; controlled SDK and transport
```

`node ../../.corepack/v1/pnpm/9.15.0/bin/pnpm.cjs --filter web type-check`: exit0, salida:

```text
> web@0.1.0 type-check C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-S10\apps\web
> tsc --noEmit
```

ESLint dirigido a doce archivos de aplicación: exit0, dos warnings preexistentes de variables usadas solo como tipos en Buscar, cero errores. Lint completo previo exit0,61 warnings,0errores. `pnpm audit --audit-level=high`: exit0,2moderadas,0altas/críticas, dependencias intactas. `git diff --check`: exit0, solo avisos de conversión LF→CRLF.

Build final: ejecutor local ignorado `apps/web/test-results/s12/local-runtime.cjs build` invoca el pnpm9.15.0 indicado arriba. Carga configuración local ya existente únicamente en memoria para el hijo. No escribe sus valores ni modifica archivos del checkout original. **Exit0**. Log completo ignorado `apps/web/test-results/s12/build-configured.txt`. Últimas líneas literales:

```text
├ ƒ /seller/cupones/nuevo
├ ƒ /seller/listings
├ ƒ /seller/reviews
├ ƒ /seller/ventas
├ ƒ /seller/verificacion
├ ƒ /settings
├ ƒ /solicitudes/[id]
├ ƒ /terminos
├ ƒ /vendedor/[id]
├ ƒ /vender
└ ƒ /vender/[id]/editar


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

## Revisión independiente y correcciones

Tres personas, dos rondas, JSON estructurado. R1 auditor approve; adversary conditional por carrera invalidación antes del cleanup; pragmatist conditional por falta de prueba del fallo de handoff. Se añadieron abort inmediato en ambos hooks y fixtures específicos. R2: auditor/adversary/pragmatist approve, findings vacíos. Resultado: ship con límites de aceptación física explícitos.

Durante QA se corrigieron dos fallos funcionales/medibles: foco de Filtros después de Aplicar mientras trigger disabled, y invalidación inmediata. Otros fallos de fixtures se resolvieron sin cambiar comportamiento: comparación de centro en petición correcta, foco esperado en marcador retenido y drag esperando fin de la animación de entrada. Una lectura de refs durante render que ESLint rechazó se sustituyó por estado de nivel.

## Fallos de entorno y límites

El primer build local sin configuración compiló, pero el smoke de páginas devolvió500 (7/8 en rojo,exit1). Diagnóstico del middleware:

```text
TypeError: Invalid URL
  code: 'ERR_INVALID_URL',
  input: 'undefined'
```

Comprobación únicamente de presencia confirmó las tres variables públicas de configuración ausentes. Se recompiló/inició cargando el archivo de configuración existente solo en memoria. El primer HTTP7/7 contra `localhost` no se acredita a este candidato: después se fijó127.0.0.1 para distinguir el servidor exacto.

Restricciones de sandbox ocasionaron `uv_os_get_passwd ENOMEM` en tsx y `EACCES` al descargar fuentes del build; los mismos controles se ejecutaron por el mecanismo de aprobación. El rechazo temporal de aprobación por cuota se resolvió al restablecerse los límites; se volvió a usar aprobación para git/node. No se usó Antigravity ni se eludió control. El browser de la app rechazó127.0.0.1 con `net::ERR_BLOCKED_BY_CLIENT`; la inspección local se hace en Chrome mediante Playwright.

Pruebas controladas y Chrome con viewport móvil no prueban el pintado/pinch en teléfono real. Permanecen pendientes Safari/iPhone/Android, lector/teclado físico y texto200%, p95/heap, cuentas y escenarios autenticados; PostGIS100k y regeneración completa de tipos/PAT siguen como pendientes previos. Tráfico cartográfico del proveedor se distingue de llamadas de publicaciones: no se promete coste de mapas nulo.

## Integración real y entrega

API del candidato configurado, comando PowerShell:

```powershell
$env:S11_BASE_URL = 'http://127.0.0.1:3000'
node node_modules/tsx/dist/cli.mjs scripts/test-s11-map-http.ts
```

Exit0, salida completa:

```text
PASS real national overview is complete, bounded and excludes eager publication cards
PASS national publication keyset covers every eligible row without duplicates
PASS one actual stable group has coherent counts and distinct sellers
INFO local coverage: 8 public cells, 1 pages, 35 publications
PASS local 50 km public cells page to completion in one consistent revision
PASS real type/price/category filters retain their membership
PASS an empty search returns zero counts without false points or cards
PASS invalid, oversized, malformed and stale requests fail privately
S11 HTTP: 7 PASS, 0 SKIP; 43 eligible national rows; 20 read-only requests; anonymous integration excludes account/device acceptance
```

Chrome real393px, `node test-results/s12/local-browser.cjs` desde apps/web, exit0, salida completa:

```text
PASS real Buscar has no snapshot and filters/location use one modal
INFO snapshot HTTP 200
PASS real Home Apple preview is complete 16:9 and clicking opens mapa
PASS real map group loads actual cards and Escape restores focus
S12 real browser: 3/3 PASS; anonymous Chrome 393px, no physical pinch/paint claim
```

Capturas ignoradas `apps/web/test-results/s12/real-home-393.png` y `real-drawer-393.png` inspeccionadas visualmente: preview completo sin franjas y créditos conservados; grupo real35/28, crema y tarjetas grises separadas. La primera ejecución usó timeout5s, inferior al tiempo de red; falló esperando imagen, la siguiente esperando conteo. Se ajustó espera por condición30s y pasó sin mocks. No se cambió aplicación por estos tiempos.

`node scripts/smoke-produccion.mjs --url http://127.0.0.1:3000`, exit1, salida completa:

```text
OK     home con ubicacion: el feed trae productos
OK     buscar sin acento encuentra el producto acentuado
OK     buscar por ejemplo de categoria
OK     aviso de privacidad publicado y versionado
OK     terminos publicados
FALLA  canonical apunta al dominio bueno   (HTTP 200, 103972 bytes)
       falta:  /<link rel="canonical" href="https:\/\/vicinomarket\.com\/privacidad"\/?>/
OK     rankings responde con contenido
OK     los enlaces de vendedor no apuntan a la ruta muerta /tienda/

1 de 8 en rojo.
```

La lectura del canonical público, exit0, devuelve `<link rel="canonical" href="http://localhost:3000/privacidad"/>`: configuración local de SITIO; no modificación de metadata en S12. La prueba del dominio real debe validar8/8 tras desplegar.

## Recibo de producción, 01-oct-2026

Aplicación/tests/evidencia: `ea0a3cb5e490bb3e982be3b9d563af53a95f7851`. Los20archivos, incluidos todos los nuevos módulos/scripts, están en el commit. Gitleaks8.28.0staged redactado exit0:

```text
5:40PM INF scanned ~172771 bytes (172.77 KB) in 260ms
5:40PM INF no leaks found
```

`git commit -m "fix(map): preserve annotations and simplify discovery surfaces"`: exit0. `git push origin HEAD:master`: exit0, salida completa:

```text
To https://github.com/Peter-code-bot/PROJECT-VICINO.git
   fec6ae4..ea0a3cb  HEAD -> master
```

`git rev-parse HEAD` devuelve el SHA indicado; `git status --short`, exit0/sin salida. Los cuatro checks de [Security Audit36942169812](https://github.com/Peter-code-bot/PROJECT-VICINO/actions/runs/36942169812) son completed/success: Escaneo de secretos, TypeScript type check (incluye lint), npm audit y Deriva de tipos vs produccion. La anotación de deriva sigue siendo warning **Tipos desfasados**, message literal:

```text
apps/web/types/database.types.ts no coincide con el esquema de produccion. Corre: node scripts/gen-types.mjs
```

No se acredita regeneración completa. Se mantiene el pendiente de PAT/tipos anterior. [Vercel6ieNoBPGmTqHFqRuMd2qNJMTMEhT](https://vercel.com/peters-projects-b65496a9/vicinomarket/6ieNoBPGmTqHFqRuMd2qNJMTMEhT) para el mismoSHA: success, Deployment has completed. Consulta GitHub commit/status, exit0, salida literal:

```json
{"state":"success","statuses":[{"context":"Vercel","description":"Deployment has completed","state":"success","target_url":"https://vercel.com/peters-projects-b65496a9/vicinomarket/6ieNoBPGmTqHFqRuMd2qNJMTMEhT"}]}
```

Después del despliegue, API real con `$env:S11_BASE_URL = 'https://vicinomarket.com'` y el script HTTP indicado arriba: **exit0,7PASS,0SKIP,43elegibles,20lecturas**; misma salida completa de casos que el candidato local. `node scripts/smoke-produccion.mjs`, **exit0**, salida completa:

```text
OK     home con ubicacion: el feed trae productos
OK     buscar sin acento encuentra el producto acentuado
OK     buscar por ejemplo de categoria
OK     aviso de privacidad publicado y versionado
OK     terminos publicados
OK     canonical apunta al dominio bueno
OK     rankings responde con contenido
OK     los enlaces de vendedor no apuntan a la ruta muerta /tienda/

8 comprobaciones, todas en verde.
```

Browser de la app abierto en `/mapa`, datos reales43publicaciones31vendedores, sin panel permanente. El mecanismo de control rechaza click dentro del shadowroot cerrado de MapKit (`Cannot click content inside a closed shadow root`); esto es límite de automatización, no evidencia de fallo del marcador. Acceso por teclado a grupo disponible. Aceptación pinch/tap físico y pintado estable siguen pendientes.

El recibo final de cualquier commit de cierre documental se registra en Notion; no cambia aplicación/DB. Reversión web: revert del commit S12 o rollback a `fec6ae4`, conservando DB aditiva instalada y contratos anteriores.
