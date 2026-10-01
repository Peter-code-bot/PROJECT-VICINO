# Estado local — S10

## 2026-09-30 — S10 desplegado y verificado en producción

- **Sello: Codex, familia GPT-6. Corte 18:43:34 CDMX.** Master `1cbcb8b38dcc31b2d6eefb89310d4dae21d73056`, push sin fuerza confirmado. CI: cuatro controles success; Vercel `65hs6WixR74rkxszR3o1Fvs5FsmM`, Deployment has completed. [Mapa activo](https://vicinomarket.com/mapa), abierto en el navegador de la app.
- Verificación posterior: HTTP real anónimo 7/7 exit 0 (42 elegibles), smoke de producción 8/8 exit 0. Veinte lecturas API/red: p50 202 ms, p95 327 ms, máximo 606 ms; excluye render/SDK/teléfono físico. Apple real autorizado/cargado; vista inicial 7 publicaciones/2 vendedores y selección accesible desde tarjeta 6 resultados del punto.
- Aplicación `23a7bcb`, con Next/eslint-config-next 16.3.6 y brace-expansion resuelto 1.1.21. Build/49 pruebas locales/lint/audit HIGH/Gitleaks aprobados antes del push. Puntos públicos aproximados; coordenadas privadas protegidas. Solo control de expansión de radio oculto en el formulario, selector conservado.
- Aceptación restante: cuentas dedicadas y formulario autenticado, móviles físicos, gestos nativos del pin/expiración/offline, cancelación PostgREST y revisión de Javier. No se declara completa con mocks ni prueba anónima. Evidencia final en [acta web](docs/S10-ENTREGA-WEB-2026-09-30.md) y [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9). Este cierre documental no modifica aplicación ni requiere otro despliegue de producción.

## 2026-09-30 — S10-W: entrega web autorizada y verificación final

- **Sello: Codex, familia GPT-6.** Inicio 17:54:49 CDMX. Javier autoriza push a producción después de las pruebas; resuelve el rechazo de exportación previo. `origin/master` sigue en `bd80379`. Se entregará sin fuerza y sin modificar el checkout original.
- La página/API/enlaces comparten activación por defecto; `NEXT_PUBLIC_VICINO_MAP_ENABLED=false` y rebuild permiten apagarla. La BD ya está instalada, no se reaplica. Solo se oculta el control de radio del formulario; selector y datos conservados.
- **Corte de pruebas 18:31:44 CDMX:** candidato de aplicación `23a7bcb`, pruebas locales 49/49 y HTTP real anónimo 7/7 con 42 elegibles, repetidas tras parches; smoke del build final 8/8. Build final Next 16.3.6 exit 0, 57/57 páginas, TypeScript integrado; lint completo exit 0 (0 errores/149 warnings existentes/generados). Gitleaks 8.28.0: 4 commits, sin fugas, exit 0. Auditoría HIGH exit 0, cero HIGH/CRITICAL (2 MODERATE). Next/eslint-config-next 16.3.6 y floor brace-expansion ^1.1.20 (resuelto 1.1.21) cierran avisos detectados antes del push. Apple real acreditado en el candidato; títulos corregidos. Entrega preparada y autorización Git comprobada por dry-run. El resultado de push/CI/producción se registra en el [DevLog vigente](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).
- Configuración local existente reutilizada por proceso, sin copiar/imprimir secretos ni incluir service_role. Su Redis no resuelve DNS: el limitador compartido entra en fail-open y el freno local permanece; no se acredita cuota global. No se cambiaron credenciales ni se provisionaron servicios.
- Pendientes de aceptación: cuentas dedicadas/bloqueos bajo sesiones HTTP reales, cancelación efectiva PostgREST, iPhone/Android físicos y revisión visual de Javier. Se distinguirán de verificación del despliegue y pruebas automatizadas.

## 2026-09-30 — S10-R: migración instalada en producción; entrega web pendiente

- **Sello: Codex, familia GPT-6.** Continuación desde 16:56:59 CDMX; corte de pruebas 17:30:42. Código `b57aa89`, base `bd80379`, misma rama y checkout aislado. El trabajo original se conserva.
- Acceso por dashboard de Supabase, VICINO/main PRODUCTION. Javier autorizó expresamente instalar `20260930220000`; COMMIT confirmado, ledger version/name/statements y recarga PostgREST. Proyección aproximada generada, GiST y RPC instalados. No se actualizaron puntos privados/radios ni se sembraron tablas públicas.
- PostGIS 3.3.7: 19 controles sintéticos PASS; matriz temporal 0/1/300/301/10 000 PASS, GiST confirmado por EXPLAIN. p95 de 20 llamadas SQL: 232.75 ms con 10 000 sintéticos y 5.00 ms sobre catálogo real instalado (42 elegibles). Permisos anon/authenticated, columnas privadas y RLS comprobados después del COMMIT. No incluye red/API/SDK ni equivale a sesiones reales dedicadas.
- Generador de transacción y SQL reproducibles añadidos. Acta/evidencia/incidencias: [S10-POSTGIS-2026-09-30.md](docs/S10-POSTGIS-2026-09-30.md) y DevLog de Notion. Capturas ignoradas en `apps/web/test-results/s10/`.
- Tipos regenerados desde dashboard (exportaciones idénticas); se mantienen Insert/Update `never` para la geometría generada. Único diff: orden/formato de la firma RPC. Type-check web exit 0. Auditoría final: checksum de ledger coincide, firma Json → Json, columna generada almacenada y ACL/RLS protegidos.
- **Pendientes al corte 17:48:55 CDMX:** entrega web, proveedor Apple/dominio real, sesiones/cuentas, cancelación efectiva PostgREST, iPhone/Android, aceptación y activación/rebuild. Flag apagada por defecto; BD instalada no acredita despliegue web. Acta/scripts iniciales en `2709563`. Revisión automática rechazó el push antes de ejecutarlo por falta de autorización explícita de exportar al repositorio; se solicitó y está pendiente. GitHub CLI tiene token vencido; no se confunde con este rechazo. No hay PR ni deployment nuevo.

## 2026-09-30 — S10: mapa implementado y validado localmente; integración remota pendiente

- **Sello: Codex, familia GPT-6 (variante no expuesta).** Inicio 15:41:15 CDMX; validación local final 16:30:59 (49 min 44 s). Base `bd80379`, rama `feat/s10-mapa-publicaciones-20260930`, checkout aislado `PROJECT-VICINO-S10`. El checkout original y sus cambios se conservaron.
- Nueva página `/mapa`: MapKit, búsqueda/categorías/tipo/precio, zona visible o centro/radio del comprador, grupos de publicaciones, tarjetas paginadas, ubicaciones aproximadas, cambio manual, GPS explícito y recuperación de errores. Enlaces Inicio/Buscar/menú sujetos a `NEXT_PUBLIC_VICINO_MAP_ENABLED=true`; apagado por defecto.
- Formulario: solo `showRadiusControl={false}` en DeliveryMap. LocationPicker conserva mapa, pin, búsqueda, arrastre, zoom, círculo, default y valor del radio. No se migraron ni borraron radios históricos.
- Migración local `20260930220000`: proyección pública generada a dos decimales y RPC por área, todos los candidatos agrupados, visibilidad/bloqueo bilateral y cursor por consulta/usuario. API sin service_role, cuerpo acotado, validación de entrada/salida, cuotas, timeout y no-store. No devuelve ubicación privada.
- **Verificación:** build final **exit 0**, 57/57 páginas, TypeScript integrado; shared type-check/lint exit 0; lint de archivos modificados 0 errores, 5 warnings preexistentes (nuevos módulos sin warnings). Contratos 5/5, SQL 12/12, API 6/6 y navegador 25/25: **48/48 pruebas locales/sintéticas**. SQL en PGlite con sustitutos espaciales point/box; SDK/red/cache de navegador simulados. No acreditan PostGIS, Apple Maps real ni dispositivos físicos.
- **Pendientes:** acceso Supabase (lectura administrativa dio 401), aplicar/validar migración en staging y permisos reales, EXPLAIN/p95 y cancelación SQL, proveedor Apple real, cuentas dedicadas y iPhone/Android, aceptación visual y activación/rebuild. No está desplegado. Tipos SQL añadidos manualmente; regenerarlos al aplicar la migración.
- Plan, decisiones, incidencias y cambios: [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9), [Tests pendientes](https://app.notion.com/p/3ea98e8a0cfa8124a5cee689a2345b26). Capturas sintéticas no versionadas: `apps/web/test-results/s10/`.

Los estados anteriores se conservan como antecedentes.

## 2026-09-29 — N01/C01/V01 implementados, consolidados y auditados (VICTORY CONFIRMED)

- **Sello: Alejandro (Antigravity), ejecutor Gemini 3.8 Flash.** Rama `fix/navigation-chat-vender-20260929`, base `77465c7`. Regreso de comunidades por procedencia (N01, `a8b0159`), selector de vendedor previo a producto en chat (C01, `6b0342e`), apertura Vender con precarga acotada/feedback/loading (V01, `6722fb4`), y suite integral de verificación (R4, `23f33d8`).
- Build exit 0 (56/56 páginas); lint 0 errores; type-check 0 errores. Contratos 36/36; Next real Chromium/WebKit 14/14; S04-B 18/18; precarga 7/7; regresión navegación 23/23; pruebas adversarias independientes 60/60. Veredicto vinculante VICTORY CONFIRMED por Victory Auditor independiente tras Fase A, B y C.
- Pendientes: CI/entrega remota a master, medición antes/después con cuenta dedicada (20 frías y 20 calientes) y pase en dispositivos físicos (iPhone 1.1 build 6 y Android).
- Trabajo original y cambios anteriores conservados. Notion: [plan vigente](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), [Tests pendientes](https://app.notion.com/p/Tests-pendientes-3ea98e8a0cfa8124a5cee689a2345b26) y [DevLog](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 2026-09-29 — H00–H03 desplegados (09:59 CDMX)

- **Sello: Alejandro (GPT)**. [PR #49](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/49) integrado; master `77465c7`, Vercel producción confirmado y Security Audit verde.
- H01 responsive, H02 paginación/totales/errores y H03 retorno implementados. Datos 12/12, recorridos sintéticos 28/28, matriz responsive 96/96; build exit 0. Regresión PGRST103 corregida y fast-uri actualizado a 3.1.8 tras dos avisos HIGH del CI.
- Smoke sin sesión: login 200; historial, reseña y ventas 307 a login. Pendiente aceptación con cuentas reales dedicadas y dispositivos iPhone/Android; no se cierra el plan global.
- Trabajo original preservado. Sin migraciones/RLS. Este puntero de cierre es local; código entregado en f75f328 y a4fad14.
- Detalle, evidencia e incidencias: [DevLog de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 2026-09-28 — H00–H03 entrega técnica (actualización 29-sep 09:47 CDMX)

- **Sello: Alejandro (GPT)**. H01 responsive, H02 paginación/totales/errores y H03 continuidad de reseñas implementados en `fix/historial-cierre-20260928`.
- Datos 12/12; recorridos sintéticos Chromium/WebKit 28/28; matriz con CSS/fuentes compiladas 96/96 sin fallos. Corrección final de PGRST103 con regresión reproducida y resuelta; build final exit 0 (56/56 páginas). Recorridos finales repetidos 28/28 exit 0.
- Pendientes de aceptación: integración autenticada y pase físico iPhone/Android. Entrega remota en preparación, todavía no desplegada. Sin migraciones/RLS. Trabajo del checkout original preservado.
- Evidencia y estado actualizado: [DevLog de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 2026-09-28 — H00/H01 revisión independiente (20:35 CDMX)

- **Sello: Alejandro (GPT)**. Rama `fix/historial-cierre-20260928`, base `7337217`; antecedentes de S05 conservados debajo.
- H00/H01 **VALIDADOS LOCALMENTE**: build exit 0, suite reforzada 96/96 con CSS compilado y fuentes Inter/Outfit en Chromium/WebKit. Sin cambios adicionales de aplicación durante la revisión de la entrega de Gemini.
- Evidencia: `apps/web/test-results/historial/review-gpt-build-fonts-20260928/`; ejecución previa conservada en `after-gemini-20260928-2010/`.
- Pendientes: H02/H03, integración con cuentas y pase iPhone/Android. No desplegado ni cerrado en dispositivo.
- Fuente operativa y atribuciones: [DevLog de Notion](https://app.notion.com/p/3e898e8a0cfa8102bb65d911a5a284d9).

## 27-sep (mediodía) — Corte de Claude (sesión de Pedro)

- En producción el 27-sep:
  - `6111f49`: «Cambiar ubicación» con palomita arriba y sin botón inferior (Tarea 8).
  - `e8e02c9`: «Cerrar sesión» y «Eliminar cuenta» juntas en «Sesión».
  - `5874496` + migración `20260927100000`: borrar la cuenta de quien dejó filas en `audit_log` ya no falla a medias. `delete-account` v14.
  - `send-push` v21 (globo real y limpieza de tokens UNREGISTERED).
  - `6b5fa5e`: pantalla «Activa las notificaciones» con el diseño aprobado.
  - `0aeb2a5` + migración `20260927110000` (BUG-VERIF-IA): la nota de la IA dice si es sobre estas fotos (`ai_vigente`, `ai_analizado_en`) y nadie revisa su propia solicitud (VC403). Tipos regenerados en `962e358`.
  - `29ba6ac`: «Volver» desde Mis publicaciones regresa ahí.
- Pruebas nuevas en staging:
  - `probar-verificacion-ia.mjs` 15/15.
  - `e2e-retorno-vender.mjs` 8/8, `e2e-favoritos.mjs` 7/7, `e2e-solicitudes.mjs` 9/9 (con `crearSolicitud()` en fixtures).
  - `e2e-header-fijo.mjs` ya no da OK sin datos.
- ADRs nuevos en Notion (02_Architecture_ADR → Decisiones): S04 + Realtime, verificación IA / VC403, S09-A y nota S05.
- Registro: `docs/PENDIENTES-2026-09-26.md` y la página de la jornada en Notion.

## 27-sep — Corte de Claude (sesión de Pedro): lo que ya no es cierto abajo

- **La retención de producción ya no existe.** Alejandro retiró el `ignoreCommand` en `6ee06be` (26-sep, 23:26 UTC). S04 (`20260925010000`) y Realtime (`20260926100000`) se aplicaron en prod hacia las 23:45 UTC. El script `hold-production-for-s04.mjs` se borró el 27-sep. Cada push a `master` despliega, así que las líneas de abajo que dicen "producción retenida" quedan superadas.
- En producción desde la noche del 26-sep:
  - `209caf7`: header móvil fijo.
  - `cdc6f96` + `5e14267`: Villahermosa y cobertura del buscador.
  - `c337ef7`: modo campus exclusivo (intersección, compañeros visibles pese a la RLS de `seller_verification` y fallo visible).
  - `cc385bc`: arranque en frío sin bucle y sin prefijos del token.
- Pruebas en prod: header 3/3 y Villahermosa 3/3. Campus 11/11 en staging.
- Revisión de todos los pendientes y 26 planes nuevos: `docs/planes-2026-09-26/`. Registro: `docs/PENDIENTES-2026-09-26.md`. DevLog: 01_DevLogs → `2026-09-26-noche-header-villahermosa-campus-y-pendientes`.

## 26-sep — Universidad para capturas (S09-A)

- Implementada la definición nueva de Notion §2.4.3: ficha Universidad en Home y opción en el selector de Búsqueda, con color institucional y destino `/buscar?category=universidad`.
- Universidad resuelta en servidor desde la credencial aprobada existente; mismo contrato en Home/Búsqueda. Filtra vendedores de esa institución con y sin ubicación; mantiene texto, orden y paginación. Sin pertenencia/no compañeros: no abre el catálogo completo. Fallos de consulta visibles.
- No cambia onboarding, modelo de credenciales, RLS ni esquema. S09 completo sigue pendiente; esta entrega cubre usuarios con universidad ya verificada.
- Build de producción exit 0 (incluye TypeScript). ESLint de los 8 archivos de producción: exit 0, 0 errores, 4 advertencias previas.
- `scripts/test-university.ts`: 20/20 escenarios; consultas reales con Auth/BD simulados y componentes reales en Chrome móvil/escritorio. Evidencias: `apps/web/test-results/university/`. No es prueba contra la BD remota ni capturas finales de iPhone.
- Integración conserva los commits nuevos de Pedro en master (Android y PT01). La corrección local equivalente de Favoritos queda respaldada por separado; prevalece la versión de Pedro.
- Producción sigue retenida por S04. Para ver estos cambios en la app/capturas hace falta un entorno que sirva esta versión; un push no equivale a desplegarla.

Actualizado: 26-sep-2026. Implementación y verificación técnica local completas.
Validación nativa/proveedor real e integración pendientes.

- Worktree PROJECT-VICINO-S05; rama de transferencia feat/ios-design-handoff-20260926; base 4b6be86.
- Conserva una copia de S01–S04 sin modificar sus worktrees.
- Cambiar ubicación mantiene su diseño y añade Aplicar ubicación (aprobado por Javier).
- Selección y radio en borrador; cancelación segura; zoom independiente; onboarding confirma al entrar.
- Preview protegido con errores diferenciados y reintento manual.
- 84 casos aprobados (10 API, 48 navegador, 12 regresiones Playwright, 14 sesión/geometría).
- Build final exit 0, 56/56 páginas, BUILD_ID Q9bhw3YqwnY671FM7855p; TypeScript correcto.
- Lint sin errores, un aviso previo en LocationPicker. SDK/GPS/red simulados en pruebas.
- Destino solicitado por Javier: master remoto. Consultar el SHA publicado y el acta de transferencia en Notion.
- Producción retenida mediante ignoreCommand de Vercel: REST confirmó que falta chats.producto_revision (42703). La consulta administrativa devolvió 401; no se aplicó ninguna migración remota.
- Retirar la retención solo después de aplicar/verificar S04 y comprobar chat/ventas. Subir código a master no acredita despliegue.
- Orden vigente: skills → brand book → piloto/alcance nativo → implementación por familias → verificación → TestFlight → App Store.
- En Mac: `node scripts/prepare-mac.mjs --install --sync-ios` usa pnpm fijado y no aplica migraciones ni sube builds.
- PGlite declarado en el lockfile; pruebas SQL sin carpeta temporal externa. Scripts S01/S03 resuelven dependencias desde apps/web.
- Seed local con datos de cuentas excluido de la transferencia; no es parte del release.
- Verificación de transferencia: build exit 0, BUILD_ID FOf4VxKdWSjklrtKO0bK5; tipos exit 0; SQL 21/21; Favoritos 17/17; escaneo de secretos sin hallazgos en los cambios.
- `prepare-mac.mjs` pasó revisión sintáctica; en Windows rechaza la preparación nativa. Ejecución macOS/Xcode pendiente.

Fuente operativa: [Plan en Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263), S05/D01/D02-S05.
DevLog: entrada 2026-09-26-s05-mapas-confirmacion-y-preview en la
[Bitácora](https://app.notion.com/p/14a98e8a0cfa83eb9ef00133a04ec7fd).
