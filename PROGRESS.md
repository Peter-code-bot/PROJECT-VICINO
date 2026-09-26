# Estado local — S05

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
