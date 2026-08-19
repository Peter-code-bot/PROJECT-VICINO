# VICINO — Claude Code Context

## Proyecto

VICINO es un marketplace hiperlocal de proximidad en Puebla, México. Monorepo con:
- **Framework:** Next.js 16.2 (App Router) + React 19.2 + TypeScript
- **Styling:** Tailwind CSS v4 (CSS-based config, NO tailwind.config.ts)
- **Base de datos:** Supabase (PostgreSQL + PostGIS + Auth + Storage + Realtime) — NO Prisma
- **Auth:** Supabase Auth (`@supabase/ssr`) — NO NextAuth.js
- **Mobile:** Capacitor 8.3 (Android + iOS)
- **Package manager:** pnpm 9.15 + Turborepo
- **Estructura:** `apps/web` (frontend Next.js), `packages/shared` (@vicino/shared — 10 Zod validators), `supabase/` (82 migraciones, 5 Edge Functions)
- **Monitoring:** Sentry (`@sentry/nextjs` + `@sentry/capacitor`)
- **Email:** Resend
- **Maps:** Leaflet + react-leaflet
- **UI:** Framer Motion 12, Sonner (toasts), Recharts (charts), next-themes

## Comandos

```bash
pnpm dev          # Desarrollo
pnpm build        # Build
pnpm lint         # Linting
pnpm type-check   # TypeScript check
```

## Áreas Críticas

Las siguientes áreas requieren especial atención en code review:
- `apps/web/app/api/` — API routes de Next.js
- `supabase/migrations/` — Migraciones de base de datos
- `apps/web/lib/supabase/` — Cliente y helpers de Supabase
- Lógica de autenticación y Row Level Security (RLS) en Supabase
- Cualquier lógica de pagos o transacciones

---

## REGLA AUTOMÁTICA DE CALIDAD — CODEX ADVERSARIAL REVIEW LOOP

**ESTA REGLA ES OBLIGATORIA Y NO PUEDE SALTARSE.**

Después de CUALQUIER tarea que involucre escribir código nuevo, modificar código
existente, crear archivos, editar funciones, agregar features, o corregir bugs —
sin excepción y **SIN ESPERAR A QUE PEDRO LO PIDA** — ejecutar automáticamente:

### LOOP DE REVISIÓN (Evaluación Interna de Claude):

**ITERACIÓN 1:**
1. Realiza una evaluación interna simulando ser un auditor adversarial ("Perform an adversarial review. Challenge every design decision. Find bugs, security holes, data loss risks, edge cases, and failure modes. Be thorough and critical.").
2. Clasifica cada issue internamente:
   - 🔴 CRÍTICO: Bug que rompe funcionalidad, causa data loss, o afecta seguridad
   - 🟡 IMPORTANTE: Problema de diseño, performance, o edge case no trivial
   - 🟢 SUGERENCIA: Mejora opcional, estilo, optimización menor
3. Implementa un fix para CADA issue 🔴 CRÍTICO inmediatamente modificando el código.
4. Si hubo críticos → ITERACIÓN 2; si no → REPORTE FINAL

**ITERACIÓN 2:**
1. Vuelve a auditar el código con los nuevos cambios de forma rigurosa.
2. Clasifica nuevos issues, resuelve los críticos.
3. Si hay nuevos críticos → ITERACIÓN 3; si no → REPORTE FINAL

**ITERACIÓN 3 (máximo):**
1. Última auditoría de seguridad y edge cases.
2. Resolver críticos restantes → REPORTE FINAL

**REPORTE FINAL (obligatorio — no decir "listo" sin esto):**
```
🔄 CODEX REVIEW COMPLETADO
─────────────────────────
Iteraciones: X/3
Issues críticos resueltos: X
Issues importantes pendientes: X (requieren decisión de Pedro)
Sugerencias: X (opcionales)
Estado: ✅ LISTO PARA PUSH / ⚠️ REQUIERE REVISIÓN MANUAL

Issues importantes pendientes (si los hay):
[descripción + recomendación]

Próximo paso: [push / corregir / revisar con Pedro]
```

### EXCEPCIONES (cuándo NO ejecutar):
- Cambios solo en archivos `.md` o `.txt`
- Cambios solo en `.env`, `package.json`, `.gitignore` (sin lógica)
- Cambios en assets estáticos (imágenes, fonts, iconos)
- Cuando Pedro diga explícitamente "sin review" o "skip codex"

### ÁREAS DE MÁXIMA PRIORIDAD (nunca saltarse):
- API routes y Server Actions de Next.js (`apps/web/app/api/`)
- Migraciones de Supabase (`supabase/migrations/`)
- Políticas de Row Level Security (RLS)
- Autenticación y sesiones de usuario
- Lógica de marketplace (listings, transacciones, mensajes)
- Código Capacitor que accede a datos nativos (cámara, geolocalización)

**Skill completa:** Ver `codex-review-loop` en SORV-System

---

## Deploy — Vercel

El deploy es automático: Vercel observa el repo en GitHub y dispara builds en cada push.

- **Push a `master`** → auto-deploy a producción (`https://vicinomarket.com`).
- **Push a cualquier otra rama** → preview deployment automático. La URL del preview aparece en el PR de GitHub y en el dashboard de Vercel.

No se ejecuta ningún comando manual desde local para deployar.

### Estado del deploy
- **Plataforma:** Vercel
- **URL producción:** `https://vicinomarket.com` (canonical desde 2026-05-01).
  `startup-marketplace-web.vercel.app` se mantiene como 308 -> vicinomarket.com por requisito de Google Play Data Safety URL.
- **CI/CD target:** master → producción | cualquier otra rama → preview automático

### Variables de entorno (configurar en Vercel Dashboard, NO en repo)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`

### Branches
- **master** — Pedro (backend, lógica, integraciones)
- **design** — Alejandro (UI/UX, componentes visuales)

---

## Lecciones institucionales (2026-05-29)

Lecciones de proceso destiladas de la jornada del 29 de mayo. Aplicables a
cualquier sesión que toque código, schema, RLS o git workflow.

### 1. `pnpm build` local antes de CADA push
El type-check que corre Vercel es 100% reproducible localmente (`pnpm build`
encadena el guard CI + `next build --webpack` con el mismo TS strict).
Este día rompimos producción dos veces porque un push se hizo sin correr el
build local primero (un type error de seed scripts ajeno + un type-check sin
verificar el rebase). Ambos rompimientos los habría atrapado un `pnpm build`
local antes de `git push`.

### 2. Smoke tests de RLS requieren `SET LOCAL ROLE`, no solo `set_config`
El SQL Editor de Supabase Studio corre como rol `postgres`, que **bypasea
RLS** salvo que la tabla tenga `FORCE ROW LEVEL SECURITY` (lo cual no es la
configuración por default). Pasar `set_config('request.jwt.claims', ...)`
solamente settea el claim que `auth.uid()` lee, pero NO cambia el rol de
sesión, así que la RLS sigue bypasseada. Patrón canónico para validar
policies bajo rol real:

```sql
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
-- <tests aquí>
ROLLBACK;
```

`ROLLBACK` garantiza que ninguna mutación del test persista, así que el
setup puede pausar/contaminar datos temporalmente sin riesgo de leak.
Lección original: durante el VERIFY de Sesión 5a un Test D de attacker
UPDATE pasó como falso negativo (UPDATE 3 en vez de UPDATE 0) porque corrió
como `postgres` que bypaseó la policy ownership-aware recién creada.

### 3. PASO 0 de verificación de schema antes de CREATE POLICY/FUNCTION o INSERT tipado
Antes de cualquier policy/función/INSERT que referencie otras tablas o
columnas, leer el DDL real de las tablas en cuestión y confirmar nombres,
tipos y constraints. No asumir contra notas de auditoría previas — pueden
estar desactualizadas. Precedentes:

- `profiles.role` no existía; el RBAC vive en `user_roles` pivot.
- `delete_account` no existía; la función real es `delete_user_data`.
- Columna de `media_assets` confirmada `type` (no `media_type`) leyendo el
  DDL de Sesión 5b.

Sin este audit el CREATE/INSERT rompe en runtime con `column does not exist`
o `function does not exist`, y se gasta tiempo diagnosticando lo que el
PASO 0 hubiera resuelto en 30 segundos.

### 4. pnpm 9 NO auto-corre el lifecycle `prebuild`
El package manager pnpm a partir de v7 dejó de ejecutar automáticamente
scripts `pre*`/`post*` custom (solo respeta los del lifecycle nativo de
`install`/`publish`). Por lo tanto un script `prebuild` declarado en
`package.json` **NO** corre antes de `pnpm build`. Para encadenar guards
de CI (ej. `check-no-todo.mjs` de MP#07 #9), usar `&&` directamente en el
script `build`:

```jsonc
"build": "node scripts/check-no-todo.mjs && next build --webpack"
```

Esto garantiza ejecución determinista en local, npm/pnpm, y Vercel.

### 5. Verificar premisas con git, no asumir
El estado de `master` cambia entre sesiones porque otros developers
(Alejandro en `design`, Javier en `master`) pushean en paralelo. Antes de
planear cualquier fix o asumir que algo "sigue local sin pushear",
ejecutar `git fetch origin master` + `git log --oneline -5` para
verificar el estado real contra `origin`. Lección original: una premisa
del playbook ("C1 sigue local, producción rota") fue refutada por
evidencia git — Javier ya había pusheado el mismo fix (con scope más
amplio) mientras se trabajaba localmente, así que mi commit habría sido
un duplicado redundante.

---

## Schema — los grants de `products_services` son columna por columna

Los `GRANT` de `products_services` se otorgan **columna por columna**, nunca a
nivel de tabla. Es deliberado: acota exactamente qué puede escribir el cliente
y evita que una columna interna quede expuesta sola por existir.

La consecuencia es una obligación, no una recomendación: **toda columna nueva
que el cliente escriba necesita su `GRANT` explícito en la misma migración que
la crea.**

```sql
GRANT SELECT (col), INSERT (col), UPDATE (col) ON products_services TO authenticated;
GRANT SELECT (col) ON products_services TO anon;  -- solo si el feed público la lee
```

`ADD COLUMN` **nunca** hereda los grants de las columnas hermanas: cada grant
por columna es un privilegio independiente, y una columna nueva nace sin
ninguno. Ejemplo canónico completo en
`supabase/migrations/20260819000000_products_services_modo_precio_column.sql`.

Verificación antes de dar por buena la migración:

```sql
SELECT grantee, privilege_type
FROM information_schema.column_privileges
WHERE table_name = 'products_services' AND column_name = '<col>';
```

### Incidente que originó la regla — `modo_precio` (agosto 2026)

`modo_precio` se agregó a `products_services` sin su `GRANT`. Resultado: **toda**
edición de publicación moría con `42501 permission denied for column modo_precio`
— no un caso borde, todas.

Lo que encareció el diagnóstico fue el mensaje. El usuario veía *"No tienes
permiso para editar esta publicación."*, que **no** era una verificación de
propiedad: era el `catch` genérico del `42501` en
`app/(marketplace)/vender/actions.ts` — el `if (updateErr)` de
`updateProductFull`, línea 634 en ese momento, con el `return` en la 636. El
texto apuntaba a RLS y ownership, y el fallo real era un privilegio de columna
faltante.

Dos cambios salieron de ahí (commit `e5e13de`) y conviene no revertirlos:

- El mensaje del `42501` ya no habla de propiedad. Hoy dice *"No se pudo
  guardar por un problema de permisos. Ya lo estamos revisando."*
  (`vender/actions.ts:645-646`). El caso real de "no eres el dueño" no pasa por
  aquí: cae en el 0-row de `.maybeSingle()` más abajo.
- `Sentry.captureException` va **antes** del `return` del `42501`, para no
  perder el `details` de Postgres — que es donde el motor nombra la columna o
  la policy que rechazó. Ese P0 se diagnosticó a ciegas justamente por
  perderlo.

---

## Limitaciones conocidas

### Editar publicación: cambiar categoría rompe la URL anterior del producto
La página de detalle vive en `/[categoria]/[slug]` y el `slug` NO se regenera al editar (queda invariante para no romper enlaces compartidos ni SEO). Si el vendedor cambia la categoría en el formulario de editar, la URL canónica del producto pasa de `/<categoria_vieja>/<slug>` a `/<categoria_nueva>/<slug>`. La ruta vieja deja de resolver (404). Enlaces compartidos por WhatsApp, email o redes sociales antes del cambio se rompen.

Tradeoff aceptado para MVP del feature Editar publicación (decisión D6, plan firmado 2026-05-26). Si las métricas de uso muestran que el cambio de categoría es frecuente, agregar un handler de fallback en `app/(marketplace)/[categoria]/[slug]/page.tsx` que busque por slug solo y haga 308 a la categoría actual.

---

## OpenSpec (Spec-Driven Development)

VICINO adoptó OpenSpec como herramienta de SDD para features no triviales. Reglas, stack y workflow viven en `openspec/project.md`. Este archivo (`CLAUDE.md`) sigue siendo la fuente que Claude Code carga siempre; `openspec/project.md` es para el ciclo `/opsx:*`. **Cuando contradigan, gana `CLAUDE.md`.**

Workflow nominal:
- `/opsx:explore <idea>` — investigación read-only en Plan Mode.
- `/opsx:propose <slug>` — crea `openspec/changes/<slug>/` con `proposal.md` + `design.md` + `tasks.md` + delta specs. Firma humana antes de `apply`.
- `/opsx:apply <slug>` — ejecuta `tasks.md`, escribe código real. **Invoca el CODEX Adversarial Review Loop al final** (no lo sustituye).
- `/opsx:archive <slug>` — mergea deltas a `openspec/specs/`, mueve change a `openspec/changes/archive/YYYY-MM-DD-<slug>/`.

Skip OpenSpec para bug fixes <50 LOC, hot-fixes, cambios solo de copy/i18n/CSS tokens, o tooling/CI cleanup — esos van con mega-prompt directo + GATE 0.
