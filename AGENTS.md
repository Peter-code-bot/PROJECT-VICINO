# VICINO — Continuidad entre equipos

## Fuente operativa

Notion es la fuente de verdad. Antes de escribir allí, leer el
[Enrutador](https://app.notion.com/p/3b698e8a0cfa8197a430dcee1f531992) y el
[Master](https://app.notion.com/p/3b598e8a0cfa81759090d993ad8805e7).
Editar las páginas existentes mediante Notion MCP. Obsidian es histórico y de solo lectura.

Para continuar esta entrega, leer el bloque vigente al inicio del
[plan de la jornada](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263),
su sección de transferencia a Mac y el
[brand book](https://app.notion.com/p/c8098e8a0cfa83c2b32d01df5ec49663).
No usar las secciones históricas para sustituir el orden vigente.
Si Notion no está conectado, preparar el entorno y recuperar el plan antes de rediseñar.

## Ejecución

- Leer `.agents/AGENTS.md` y las instrucciones de cada directorio antes de editar.
- Usar la versión de pnpm fijada en `packageManager`; instalar con lockfile congelado.
- No imprimir ni subir secretos, archivos de sesión, `.env.local`, certificados o perfiles de firma.
- Mantener RLS y validar entradas; autenticar Server Actions con `supabase.auth.getUser()`.
- Conservar identidad verde, Outfit/Inter, tokens y márgenes aprobados. Las skills no sustituyen decisiones de diseño.
- Verificar cambios antes de declararlos terminados. Distinguir prueba aislada, prueba real y despliegue.
- Los cambios de esta entrega necesitan validación funcional en dispositivos/cuentas de prueba.
- No ejecutar seeds ni migraciones remotas como parte de preparar la Mac.
- Documentar avances significativos en la Bitácora de Notion y alinear `PROGRESS.md`.
- Esta entrega se sube a `master` por instrucción de Javier. La retención de producción (`ignoreCommand` + `hold-production-for-s04.mjs`) **ya no existe**: se retiró en `6ee06be` (26-sep, 23:26 UTC) y el script se borró el 27-sep. Cada push a `master` despliega a producción.
- S04 (`20260925010000`) y la vuelta de `sale_confirmations` a Realtime (`20260926100000`) están aplicadas en producción desde el 26-sep (~23:45 UTC). Reversión conjunta: `docs/rollback/` + Instant Rollback de Vercel. El historial y las instrucciones de continuidad están en Notion y en `docs/PENDIENTES-2026-09-26.md`.
