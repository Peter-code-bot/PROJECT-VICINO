# VICINO — OpenSpec Project Constitution

> Source-of-truth para el workflow OpenSpec en VICINO.
> Para reglas que carga Claude Code automáticamente, ver [`../CLAUDE.md`](../CLAUDE.md) raíz.
> Cuando exista contradicción entre ambos, **`CLAUDE.md` gana** (se carga siempre; este file solo en ciclo OpenSpec).

## 1. Proyecto

VICINO es un marketplace de proximidad mexicano. Producción en `https://vicinomarket.com` (Vercel + dominio canonical desde 2026-05-01).

## 2. Stack

| Capa | Tecnología | Notas |
|---|---|---|
| Frontend | Next.js 16 (App Router) + TypeScript strict | RSC + Server Actions, no Pages Router |
| UI | Tailwind CSS + shadcn/ui (componentes copiados en `apps/web/components/`) | No reinventar primitives |
| Backend | Supabase Postgres + Auth + Storage + Edge Functions + pg_cron + pg_net | Service Role solo en Edge Functions, jamás en cliente |
| Monorepo | Turborepo + pnpm workspaces: `apps/web` + `packages/shared` | `@vicino/shared` exporta Zod validators + constants + utils + types |
| Deploy web | Vercel Hobby, push a `master` → producción auto | Crons Vercel daily-only (Hobby limit) |
| Crons sub-daily | Supabase `pg_cron` + `pg_net` con `vault.decrypted_secrets` | Patrón establecido en `supabase/migrations/20260531000001_pg_cron_schedules.sql` |
| Mobile | Capacitor `com.vicino.mx`, WebView carga URL live `https://vicinomarket.com` | Pre-Play Store, Internal Track pendiente |
| Observabilidad | Sentry web + Sentry Capacitor | Tags por action/step en `Sentry.captureException(...)` |

## 3. DB / Schema (workflow Camino 2 imperativo)

- Migraciones viven en `supabase/migrations/<YYYYMMDDNNNNNN>_<name>.sql`, **imperativas y timestampeadas**. Hoy: 68 archivos.
- SQL nuevo se valida con **SQL Camino 2**: en Supabase Studio, ejecutar primero un bloque READ (SELECT/EXPLAIN sin efectos), luego el WRITE (CREATE/ALTER/UPDATE/INSERT), luego un VERIFY (re-leer estado para confirmar). El SQL final ASCII-safe se commitea al archivo de migración.
- **Nunca aplicar SQL en producción sin el ciclo READ→WRITE→VERIFY documentado en el plan.**
- **NO existe `supabase/schemas/` declarativo.** **NO usar `supabase db diff`** para generar migraciones en este proyecto.
- Toda migración del schema (tablas, RLS, RPC, triggers, índices, pg_cron, pg_net) se prueba con rol real:

  ```sql
  BEGIN;
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
  -- tests aquí
  ROLLBACK;
  ```

  `ROLLBACK` garantiza que ninguna mutación del test persista. Patrón canónico (Lección institucional #2 de `CLAUDE.md`).
- **Antes** de cualquier policy/función/INSERT que referencie otras tablas o columnas, leer el DDL real y confirmar nombres + tipos + constraints (PASO 0, Lección institucional #3 de `CLAUDE.md`).
- **RLS está HABILITADA en todas las tablas de `public` de VICINO**. Sin excepción. No confundir con notas de "RLS disabled" que pertenezcan a otros proyectos (PetrBot u otros) — en VICINO RLS es mandatorio.

> **Nota futuro**: declarative schemas (`supabase/schemas/` + `supabase db diff`) son una mejora considerada para más adelante; no es prerequisito de SDD y se evalúa cuando duelan los conflictos de merge de migraciones imperativas. Hoy: imperativo.

## 4. Workflow (reglas reales del proyecto)

### Commits + git
- Mensajes **ASCII-safe**: sin acentos, sin emojis, sin Unicode no-ASCII en el subject ni el body.
- Convention loose: `feat(scope):`, `fix(scope):`, `refactor(scope):`, `chore(scope):`, `docs(scope):`. Una línea de subject + body de bullets ASCII si aplica.
- `git add` **explícito** por archivos intencionales — nunca `git add .` ni `git add -A`. Las razones específicas:
  - **PWA artifacts** (`apps/web/public/sw.js`, `sw.js.map`, `workbox-*.js`, `workbox-*.js.map`) se regeneran en cada build y **nunca** se commitean.
  - **`apps/web/android/keystore.properties`** contiene secrets — gitignored, jamás commitear su contenido.
  - **`.env`, `.env.local`, `apps/web/.env.local`** gitignored.
  - **`hs_err_pid*.log`, `replay_pid*.log`** (JVM crashes locales) son basura, no commitear.
- Branch operativo: `master` directo (pre-launch) con auto-deploy a producción. Cambios riesgosos van en rama `feat/<slug>` que Pedro mergea manualmente tras review.

### Pre-cambio (cuando aplica)
- **Plan Mode + GATE 0 obligatorios** para cambios que toquen schema, RLS, edge functions, crons, write paths, o cualquier feature no trivial. GATE 0 = `git fetch && git pull --rebase + git log + lecturas dirigidas para confirmar premisas`. Lección institucional #5 de `CLAUDE.md`: verificar premisas con git, no asumir.
- **Cross-viewport real mobile 375 + desktop 1280** antes de push visual (regla documentada en `apps/web/CLAUDE.md`). Stubs `<div>TODO</div>` deben fallar el build en producción, no solo en dev.
- **`pnpm build` local antes de cada `git push`** (Lección institucional #1). El type-check de Vercel es 100% reproducible localmente.

### Post-cambio
- **CODEX Adversarial Review Loop** automático tras cualquier código nuevo. Reglas no negociables en [`../CLAUDE.md`](../CLAUDE.md) sección "REGLA AUTOMÁTICA DE CALIDAD". OpenSpec NO sustituye este loop — lo invoca al final del `/opsx:apply`.
- **Vercel verde antes del siguiente item**: tras push, esperar dashboard Vercel marca el deploy como `Ready` antes de iniciar el siguiente trabajo. Si rompe, fix-forward.
- **Sentry observación 24h** para cambios que toquen write paths, RLS, o crons (sin spike de errores nuevos).

### Localización
- Producto **es-MX**: locale por default, fechas **DD/MM/YYYY**, moneda **MXN**. Server side: `Intl.DateTimeFormat("es-MX", ...)`, `Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" })`.
- Textos visibles al usuario en español neutro mexicano.

### Mobile-first
- **El WebView de Capacitor es el caso principal**, no el desktop. Cada feature pasa por `375x812` antes de `1280x800`.
- Componentes nuevos usan **shadcn primitives** (`apps/web/components/ui/`), no se reinventan.

## 5. Áreas críticas (referencia)

Las áreas que requieren revisión adversarial inmediata se definen en `../CLAUDE.md` raíz (secciones "Áreas Críticas" + "ÁREAS DE MÁXIMA PRIORIDAD"). Resumen:

- `apps/web/app/api/` — API routes / Server Actions
- `supabase/migrations/` — schema, RLS, RPC, triggers
- `apps/web/lib/supabase/` — cliente + helpers
- Lógica de autenticación, RLS, sesiones de usuario
- Lógica marketplace (listings, transacciones, mensajes)
- Código Capacitor que accede a datos nativos (cámara, geolocalización)

## 6. CODEX Review Loop (referencia)

VICINO tiene una constitución de calidad NO-NEGOCIABLE para review post-código: **CODEX Adversarial Review Loop**. Vive en `../CLAUDE.md` sección homónima. Resumen para OpenSpec:

- Tras cualquier escritura/modificación de código, hasta 3 iteraciones de auditoría adversarial.
- Issues 🔴 CRÍTICO se fix inmediatamente.
- Reporte final estructurado (iteraciones + críticos resueltos + importantes pendientes + sugerencias + estado).
- Excepciones: cambios solo en `.md`/`.txt`, `.env`/`package.json` sin lógica, assets estáticos, o cuando se diga "skip codex".

OpenSpec `/opsx:apply` debe **invocar** CODEX al cerrar implementación, no sustituirlo.

## 7. Lecciones institucionales (referencia)

VICINO tiene 5 lecciones destiladas de incidentes reales, documentadas en `../CLAUDE.md` raíz sección "Lecciones institucionales (2026-05-29)". Son aplicables a cualquier sesión OpenSpec:

1. **`pnpm build` local antes de cada push** — el type-check de Vercel es 100% reproducible local.
2. **Smoke tests de RLS** requieren `SET LOCAL ROLE`, no solo `set_config` (el SQL Editor bypasea RLS como `postgres` salvo `FORCE ROW LEVEL SECURITY`).
3. **PASO 0 de verificación de schema** antes de CREATE POLICY/FUNCTION o INSERT tipado — leer DDL real, no asumir contra notas viejas.
4. **pnpm 9 NO auto-corre lifecycle `prebuild`** — encadenar con `&&` directamente en el script `build`.
5. **Verificar premisas con git, no asumir** — `git fetch origin && git log --oneline -5` antes de planear cualquier fix.

## 8. Reglas para Claude Code dentro del ciclo OpenSpec

- **Plan Mode (Shift+Tab×2) por default** antes de cambios no triviales. `/opsx:explore` se queda en Plan Mode hasta que el plan esté firmado.
- **`/clear` entre features no relacionadas** para que el contexto no arrastre decisiones de un change a otro.
- **Modelo**: Sonnet 4.6 default para `/opsx:apply`. **Opus** para `/opsx:propose` y `/opsx:explore` (planning). **Haiku** para subagentes Explore que solo leen.
- **Sin emojis ni acentos en commits y outputs persistidos** (consistente con regla de git). Outputs efímeros (mensajes en chat) pueden usar Unicode libre.
- **`AskUserQuestion`** se usa cuando una decisión cambia el scope materialmente. Para clarificaciones triviales, preguntar directo en texto.

## 9. Workflow OpenSpec (ciclo nominal)

```
/opsx:explore <idea>   -> Plan Mode, investigacion read-only
/opsx:propose <slug>   -> Crea openspec/changes/<slug>/ con proposal.md + design.md +
                          tasks.md + delta-specs/. Firma humana de Pedro antes de avanzar.
/opsx:apply <slug>     -> Ejecuta tasks.md, escribe codigo real, invoca CODEX Review
                          Loop al final.
/opsx:archive <slug>   -> Mergea deltas a openspec/specs/, mueve change a
                          archive/YYYY-MM-DD-<slug>/.
```

Convención de slug: `YYYY-MM-DD-<kebab-case>`, ejemplo `2026-06-01-android-apk-release-pipeline`.

## 10. Out of scope (no es OpenSpec)

- **Bug fixes <50 LOC** o hot-fixes: van directo con mega-prompt + GATE 0, sin ciclo OpenSpec.
- **Cambios solo de copy/i18n/CSS tokens**: no requieren spec; van con commit directo + cross-viewport.
- **Tooling/CI cleanup** (ej. borrar dotfolders zombies): commit aparte, no requiere spec.
