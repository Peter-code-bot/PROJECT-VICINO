# VICINO — Claude Code Context

## Proyecto

VICINO es un marketplace de startups. Monorepo con:
- **Framework:** Next.js (App Router) + TypeScript
- **Base de datos:** Supabase (PostgreSQL + Auth + Storage)
- **Mobile:** Capacitor (Android)
- **Package manager:** pnpm + Turborepo
- **Estructura:** `apps/web` (frontend Next.js), `packages/` (código compartido), `supabase/` (migraciones)

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

### LOOP DE REVISIÓN (via Bash tool):

**ITERACIÓN 1:**
1. Bash: `codex review --uncommitted "Perform an adversarial review. Challenge every design decision. Find bugs, security holes, data loss risks, edge cases, and failure modes. Be thorough and critical."`
2. Leer output completo y clasificar cada issue:
   - 🔴 CRÍTICO: Bug que rompe funcionalidad, causa data loss, o afecta seguridad
   - 🟡 IMPORTANTE: Problema de diseño, performance, o edge case no trivial
   - 🟢 SUGERENCIA: Mejora opcional, estilo, optimización menor
3. Implementar fix para CADA issue 🔴 CRÍTICO inmediatamente
4. Si hubo críticos → ITERACIÓN 2; si no → REPORTE FINAL

**ITERACIÓN 2:**
1. Bash: `codex review --uncommitted "Perform an adversarial review. Challenge every design decision. Find bugs, security holes, data loss risks, edge cases, and failure modes. Be thorough and critical."`
2. Clasificar nuevos issues, resolver críticos
3. Si hay nuevos críticos → ITERACIÓN 3; si no → REPORTE FINAL

**ITERACIÓN 3 (máximo):**
1. Bash: `codex review --uncommitted "Perform an adversarial review. Challenge every design decision. Find bugs, security holes, data loss risks, edge cases, and failure modes. Be thorough and critical."`
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

## Deploy — Netlify

**Preview (verificar antes de publicar):**
```bash
NETLIFY_AUTH_TOKEN="nfp_KkMGwMHpZ6jLDPA2i5zGbLFY313c89Rs4291" npx netlify deploy --build
```

**Producción:**
```bash
NETLIFY_AUTH_TOKEN="nfp_KkMGwMHpZ6jLDPA2i5zGbLFY313c89Rs4291" npx netlify deploy --build --prod
```

**O decir "haz deploy" a Claude Code** — skill `deploy-project` activada.

### Estado del deploy
- **Plataforma:** Netlify (cuenta Peter Bot / peter-code-bot)
- **Sitio:** PENDIENTE — crear con Alejandro
- **CI/CD target:** master → producción | design → preview

### Variables de entorno (configurar en Netlify Dashboard, NO en repo)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`

### Branches
- **master** — Pedro (backend, lógica, integraciones)
- **design** — Alejandro (UI/UX, componentes visuales)
