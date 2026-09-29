# Estado local — S05

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
