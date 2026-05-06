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

**O decir "haz deploy" a Claude Code** — skill `deploy-project` activada.

### Estado del deploy
- **Plataforma:** Vercel
- **Sitio:** PENDIENTE — crear con Alejandro
- **CI/CD target:** master → producción | design → preview

### Variables de entorno (configurar en Vercel Dashboard, NO en repo)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`

### Branches
- **master** — Pedro (backend, lógica, integraciones)
- **design** — Alejandro (UI/UX, componentes visuales)
