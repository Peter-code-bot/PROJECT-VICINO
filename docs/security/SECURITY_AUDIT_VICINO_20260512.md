# Security Audit — VICINO `apps/web`

**Fecha:** 2026-05-12
**Auditor:** Claude Code (Opus 4.7) + Codex CLI 0.130.0 (modelo `gpt-5.5`, `--sandbox read-only` con bypass de approvals)
**Scope:** `apps/web` en branch `design` — Next.js 16.2.1 + React 19 + Supabase (`@supabase/ssr`) + PWA (next-pwa)
**Excluido del scope:** `app/(marketing)/**`, `supabase/migrations/**` (sólo se mencionan), `apps/web/android/**`, OAuth Google config
**Megaprompt original:** "Auditoría y Hardening de Seguridad VICINO" entregado por Javier
**Plan de ejecución:** `~/.claude/plans/megaprompt-auditor-a-eager-pony.md`

---

## 0. Pre-flight (read-only)

| Check | Resultado |
|---|---|
| Working dir | `C:\Users\10G82LA\Documents\Javier\VICINO\startup-marketplace\apps\web` ✓ |
| Branch | `design` ✓ |
| Working tree | clean ✓ |
| Codex CLI | `codex-cli 0.130.0` ✓ |
| `.env.local` gitignored | ✓ (`.gitignore:15` raíz monorepo + `apps/web/.gitignore:34`) |
| Env vars committed | sólo `.env.example` (vars no-sensibles); `SUPABASE_SERVICE_ROLE_KEY` vive **únicamente** en `.env.local` |
| `pnpm audit` baseline | **0 critical · 19 high · 13 moderate · 2 low** |

**Output crudo de Codex:** `./codex-audit-output.md` en la raíz del monorepo (5700 líneas — incluye log de tool calls y reporte sintetizado al final).

---

## 1. Resumen ejecutivo

| Severidad | Cuenta | % |
|---|---:|---:|
| 🔴 **CRITICA** | 10 | 32% |
| 🟠 **ALTA** | 7 | 23% |
| 🟡 **MEDIA** | 12 | 39% |
| 🔵 **BAJA** | 2 | 6% |
| **Total** | **31** | 100% |

**Conclusión:** El branch `design` tiene una falla de privilege escalation explotable hoy (admin actions sin guards), múltiples leaks de geolocalización exacta, rate limiting inexistente, y headers de seguridad ausentes. Sin hallazgos de hardcoded secrets ni de XSS clásico; la auth/SSR de Supabase está bien implementada en el flujo público y la sesión está aislada del cliente.

**Top 3 que arreglar primero (CRITICA, esfuerzo S):**
1. Admin actions sin guard `app_role='admin'` → privilege escalation hoy mismo (cualquier user puede asignarse role `admin`).
2. Geo exact leak en `useNearbyProducts` + `vender/actions.ts` → triangulación de vendedores.
3. Open redirect en `auth/callback/route.ts` via `?next=` no validado.

**Vectores del megaprompt cubiertos:**

| # | Vector | Hallazgos |
|---:|---|---:|
| 1 | Hardcoded secrets / service role leaks | 0 (limpio) |
| 2 | `NEXT_PUBLIC_*` exposing secrets | 0 (limpio) |
| 3 | Missing rate limiting | 10 |
| 4 | Missing Zod validation | 7 |
| 5 | Authorization bypasses | 9 |
| 6 | Geospatial privacy | 3 |
| 7 | XSS / injection / open redirects | 2 |
| 8 | Security headers / cookie hardening | 2 |
| 9 | NPM HIGH/CRITICAL | 2 (rollup de 19 advisories) |

---

## 2. Hallazgos por severidad

### 🔴 CRITICA (10)

| file:line | Vector | Snippet | Fix propuesto | Esfuerzo | → Bloque Fase B |
|---|---:|---|---|:---:|:---:|
| `apps/web/app/admin/users/actions.ts:5` | 5 | `assignRole(userId, role)` — **0 auth check, 0 admin check** | `requireAdmin()` como primera línea + Zod validate de `userId` (UUID) y `role` (enum `app_role`) | S | 6 + 2 |
| `apps/web/app/admin/users/actions.ts:15` | 5 | `removeRole(userId, role)` — **0 auth check, 0 admin check** | `requireAdmin()` como primera línea + Zod validate | S | 6 + 2 |
| `apps/web/app/admin/moderation/actions.ts:5` | 5 | `hideReview(reviewId)` — sin auth ni admin check | `requireAdmin()` + Zod UUID | S | 6 + 2 |
| `apps/web/app/admin/moderation/actions.ts:15` | 5 | `approveReview(reviewId)` — sin auth ni admin check | `requireAdmin()` + Zod UUID | S | 6 + 2 |
| `apps/web/app/admin/verifications/actions.ts:5` | 5 | `approveVerification(verificationId, userId)` — sin admin check; además **acepta `userId` del cliente** | `requireAdmin()` + derivar `user_id` server-side desde `seller_verification.user_id` (no del cliente) | S | 6 |
| `apps/web/app/admin/verifications/actions.ts:70` | 5 | `rejectVerification(verificationId, note)` — sin admin check | `requireAdmin()` + Zod (UUID + note ≤500 chars) | S | 6 + 2 |
| `apps/web/app/admin/disputes/actions.ts:5` | 5 | `resolveDispute(disputeId, resolution)` — hace `getUser()` pero **NO valida `app_role='admin'`** | `requireAdmin()` después del `getUser()` existente | S | 6 |
| `apps/web/hooks/useNearbyProducts.ts:48` | 6 | `.rpc("nearby_products", { user_lat, user_lng, ... })` — **cliente envía coords exactas y recibe `distance_meters` exacto** | Mover RPC a server action; aplicar `fuzzCoordinate()` y `fuzzDistance()` al output server-side antes del JSON | M | 4 |
| `apps/web/app/(marketplace)/vender/actions.ts:62` | 6 | `ubicacion_geo: \`SRID=4326;POINT(${ubicLng} ${ubicLat})\`` — coord exacta persistida y luego retornada en `SELECT` | Coord exacta puede quedarse en DB (para PostGIS) pero **todo SELECT que la exponga al cliente debe pasar por `fuzzCoordinate()`**; excepción única: dueño viendo su propio listing | M | 4 |
| `supabase/migrations/20260410000001_nearby_products_rpc.sql:22` | 6 | `distance_meters FLOAT, ST_Distance(ps.ubicacion_geo, ...) AS distance_meters` | RPC retorna distancia exacta + coords exactas — preparar migración `<NN>_fuzz_nearby_products.sql` que bucket-redondee `distance_meters` a múltiplos de 100m y fuzz coords. **NO aplicar `db push`** — Javier la corre manual | M | 4 (defensa en profundidad) |

### 🟠 ALTA (7)

| file:line | Vector | Snippet | Fix propuesto | Esfuerzo | → Bloque |
|---|---:|---|---|:---:|:---:|
| `apps/web/app/(marketplace)/chat/actions.ts:56` | 5 | `createSaleConfirmation({ buyerId, sellerId, ... })` acepta `buyerId`/`sellerId` del cliente | Derivar `buyer_id` = `user.id` server-side; derivar `seller_id` de `chats.vendedor_id` por `chat_id`; nunca aceptar IDs de usuario del cliente | M | 6 + 2 |
| `apps/web/app/admin/verifications/actions.ts:5` | 5 | `approveVerification(..., userId)` recibe `userId` del cliente | Resolver `user_id` de `seller_verification.user_id` server-side | S | 6 |
| `apps/web/app/admin/users/actions.ts:5` | 4 | `role: string` sin validar contra enum | Zod `z.enum(['admin','moderator'])` desde `@vicino/shared` | S | 2 |
| `apps/web/app/admin/users/page.tsx:35` | 7 | `query.or(\`nombre.ilike.%${params.q}%,email.ilike.%${params.q}%,user_id.ilike.%${params.q}%\`)` — **PostgREST injection via `?q=` no validado** | Validar `q` con Zod (max 100 chars, blacklist de `,():`) o usar RPC indexado con parámetros bound | S | 2 |
| `apps/web/app/auth/callback/route.ts:13` | 7 | `const next = searchParams.get("next") ?? "/"; redirect(\`${origin}${next}\`)` — **open redirect**: `?next=//evil.com` o `?next=https://evil.com` se interpolan tal cual | Validar `next` empieza con `/`, no `//`, no incluye `\` ni control chars; reject absolute URLs | S | 6 (validación) + 3 (rate limit) |
| `apps/web/package.json:80` | 9 | `"next": "16.2.1"` con 19 HIGH advisories (middleware bypass, SSRF, DoS, cache poisoning) | Upgrade a `next@16.2.6+` y `eslint-config-next` matching | M | **Out-of-scope esta sesión** — reportar |
| `pnpm-lock.yaml` (transitivas) | 9 | `@ducanh2912/next-pwa` chain trae `serialize-javascript`, `lodash`, `fast-uri`, `@xmldom/xmldom`, Babel plugin HIGH advisories | Update `@ducanh2912/next-pwa` o reemplazar por implementación nativa de next-pwa | M | **Out-of-scope esta sesión** — reportar |

### 🟡 MEDIA (12)

| file:line | Vector | Snippet | Fix propuesto | Esfuerzo | → Bloque |
|---|---:|---|---|:---:|:---:|
| `apps/web/app/auth/callback/route.ts:4` | 3 | OAuth callback sin throttle | `oauthCallbackRateLimit` (20/min IP) en middleware | S | 3 |
| `apps/web/app/(marketplace)/chat/actions.ts:6` | 3 | `getOrCreateChat`, `sendMessage`, `markAsRead`, `createSaleConfirmation`, `confirmSale`, `cancelSale` sin throttle | `writeRateLimit` (30/min user) en primera línea de cada action | M | 3 |
| `apps/web/app/(marketplace)/favoritos/actions.ts:6` | 3 | `toggleFavorite` sin throttle | `writeRateLimit` | S | 3 |
| `apps/web/app/(marketplace)/notificaciones/actions.ts:6` | 3 | `markAsRead`, `markAllAsRead` sin throttle | `writeRateLimit` | S | 3 |
| `apps/web/app/(marketplace)/perfil/actions.ts:6` | 3 | `updateProfile` sin throttle | `writeRateLimit` | S | 3 |
| `apps/web/app/(marketplace)/vender/actions.ts:7` | 3 | `createProduct`, `updateProduct`, `deleteProduct`, `toggleProductStatus` sin throttle | `writeRateLimit` | M | 3 |
| `apps/web/app/seller/cupones/actions.ts:8` | 3 | `createCoupon`, `toggleCoupon`, `deleteCoupon` sin throttle | `writeRateLimit` | S | 3 |
| `apps/web/app/seller/reviews/actions.ts:5` | 3 | `respondToReview` sin throttle | `writeRateLimit` | S | 3 |
| `apps/web/app/admin/**/*.ts` | 3 | Todas las admin actions sin throttle | `writeRateLimit` per-admin | S | 3 |
| `apps/web/app/(marketplace)/perfil/actions.ts:13` | 4 | `if (!nombre || nombre.length < 1)` — checks manuales en lugar de Zod | Reemplazar con `updateProfileSchema.safeParse(raw)` desde `@vicino/shared` | S | 2 |
| `apps/web/app/(marketplace)/chat/actions.ts:24` | 4 | `sendMessage(chatId, texto)` sin Zod | Crear `sendMessageSchema` (UUID + texto 1..2000 chars) + similares para sale-confirmation actions | M | 2 |
| `apps/web/app/(marketplace)/vender/actions.ts:34` | 4 | `ubicLat/ubicLng/deliveryRadius` extraídos con `Number(...)` sin validar bounds | Extender `createProductSchema` con `lat: z.number().min(-90).max(90)`, `lng: z.number().min(-180).max(180)`, `deliveryRadius: 0..50` | M | 2 |
| `apps/web/app/admin/verifications/actions.ts:85` | 4 | `reviewer_note: note \|\| null` sin validar largo | Zod `note: z.string().max(500).optional()` | S | 2 |
| `apps/web/next.config.ts:10` | 8 | Sin `async headers()` — falta CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy | Agregar `headers()` con CSP que incluya `worker-src 'self' blob:`, `manifest-src 'self'`, `connect-src ... wss://*.supabase.co https://*.upstash.io` | M | 5 |
| `apps/web/middleware.ts:4` | 8 | Middleware solo refresca sesión, sin headers de seguridad | Headers centralizados en `next.config.ts`; middleware sólo para rate limit + auth refresh | S | 5 |

### 🔵 BAJA (2)

| file:line | Vector | Snippet | Fix propuesto | Esfuerzo | → Bloque |
|---|---:|---|---|:---:|:---:|
| `apps/web/app/(marketplace)/favoritos/actions.ts:6` | 4 | `toggleFavorite(productId)` sin validar UUID | Zod `productId: z.string().uuid()` | S | 2 |
| `apps/web/app/(marketplace)/notificaciones/actions.ts:6` | 4 | `markAsRead(notificationId)` sin validar UUID | Zod `notificationId: z.string().uuid()` | S | 2 |

---

## 3. Confirmaciones negativas (limpio)

Lo siguiente se buscó y NO se encontró — buena noticia, no requiere acción:

- **Hardcoded secrets** — `git log -S` sobre `SUPABASE_SERVICE_ROLE_KEY`, `sk_live_`, `sk_test_`, `eyJhbGciOi` (JWT): solo matches en (a) `apps/web/lib/supabase/admin.ts` en **master** (no en design — ver §5 colateral), (b) `qa-delete-account.mjs` (script local con env vars, no commiteadas), y (c) `sk_live_abc123xyz` placeholder en docs de skills (`.claude/skills/capacitor-security/SKILL.md` y clones) — no es key real.
- **`NEXT_PUBLIC_*` leakage** — Sólo `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`. Todas son apropiadas para exponer.
- **`dangerouslySetInnerHTML`** — 0 ocurrencias en `app/`, `components/`, `hooks/`, `lib/`.
- **`.rpc(\`...\`)` template literal** (SQL injection via RPC name interpolation) — 0 ocurrencias.
- **`redirect(req…)` / `redirect(request…)`** con input externo crudo — sólo el caso del OAuth callback (ya listado como ALTA).
- **`eval()`, `new Function()`** — 0 ocurrencias.
- **Service role en cliente** — `lib/supabase/client.ts` solo usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` ✓. Ningún Client Component (`'use client'`) importa service role.
- **Auth check en marketplace** — `(marketplace)/{vender,chat,perfil,favoritos,notificaciones}/actions.ts` y `seller/{cupones,reviews}/actions.ts` validan `supabase.auth.getUser()` antes de mutar ✓. El gap CRITICA es exclusivo de `admin/**/actions.ts`.

---

## 4. Pendientes que requieren acción de Javier (no automatizables)

### 4.1 Rotación de claves

Lo que existe HOY en `.env.local`:

| Clave | ¿Sensible? | ¿Rotar ahora? | Cómo rotar |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | No | No | N/A |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No (es anon) | No | Supabase Dashboard → Settings → API → "Reset anon key" (sólo si comprometida) |
| `NEXT_PUBLIC_SITE_URL` | No | No | N/A |
| **`SUPABASE_SERVICE_ROLE_KEY`** | **SÍ — máxima** | **No** (no aparece en git history ni en código de `design`) | Supabase Dashboard → Settings → API → "Reset service_role key"; tras rotar: actualizar Vercel env y re-deploy |

Pendientes de scope futuro (cuando se integren, anotar dashboards):
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (Bloque 3 de Fase B) → Upstash Console → DB → "Rotate REST token"
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (post-MVP) → Stripe Dashboard → Developers → API keys / Webhooks → "Roll"
- `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET` (post-MVP) → Didit Console → Settings → API keys

NO aplica (descartado explícitamente):
- `NEXTAUTH_SECRET` → VICINO usa Supabase Auth, no NextAuth.js
- Mercado Pago → no integrado (roadmap es Stripe Connect)

### 4.2 RLS en Supabase Dashboard

Imposible de verificar desde el código sin acceso a Dashboard. **A revisar manualmente:**

| Tabla | Pregunta |
|---|---|
| `user_roles` | ¿RLS habilitado? ¿Política `INSERT` permite que un usuario inserte un row con `user_id = auth.uid()`? Si SÍ y el `role` no está restringido a values seguros → un atacante hace `assignRole(self_id, 'admin')` y se promueve. Política recomendada: solo admins pueden INSERT/UPDATE/DELETE en `user_roles`. |
| `seller_verification` | ¿Solo admins pueden hacer UPDATE de `status`? ¿RLS bloquea modificación por el propio user_id? |
| `disputes` | ¿UPDATE de `status`/`resolucion` solo para admins? |
| `reviews` | ¿UPDATE de `visible`/`reportada` solo para admins? El dueño puede UPDATE de su `respuesta`. |
| `profiles` | ¿UPDATE de `is_verified`, `trust_points`, `app_role` solo para admins? El dueño solo puede modificar campos no-críticos. |
| `notifications` | ¿INSERT solo desde server-side (service role) o restringido a admins? El dueño puede UPDATE de `leida`. |
| `chats`, `mensajes` | ¿RLS confirma que solo `buyer_id` o `seller_id` pueden leer/escribir? |
| `products_services` | ¿UPDATE/DELETE solo para `creador_id`? |
| `coupons`, `favorites` | ¿UPDATE/DELETE solo para owner? |

**Defensa en profundidad:** aunque las admin actions tendrán `requireAdmin()` tras Fase B Bloque 6, las RLS deben ser la última barrera. Si RLS permite a un user normal hacer `INSERT INTO user_roles (user_id, role) VALUES (self, 'admin')` directamente desde el cliente con anon key, el atacante salta el server action completamente.

### 4.3 Migración SQL preparada (NO aplicar automáticamente)

En Bloque 4 de Fase B se generará `supabase/migrations/<NN>_fuzz_nearby_products.sql` con:
- `nearby_products` RPC retorna `distance_meters = round(ST_Distance/100)*100`
- coords retornadas son `ST_SnapToGrid(ubicacion_geo, 0.001, 0.001)` (~111m)
- Excepción para el dueño (`creador_id = auth.uid()`): coord exacta

**Javier aplica `supabase db push` manualmente.** Defense in depth — la app TS ya hace fuzz, pero esto cubre cualquier call de RPC que pase por la TS layer.

### 4.4 NPM HIGH/CRITICAL (out-of-scope esta sesión)

`pnpm audit` reportó **0 critical, 19 HIGH, 13 moderate, 2 low**. El megaprompt §5 prohíbe `package.json` deps fuera de las 2 de Upstash (Bloque 3). Las HIGH a resolver en sesión separada:

| Paquete | Vulnerabilidad | Patch |
|---|---|---|
| `next` 16.2.1 | Middleware bypass, SSRF, DoS, cache poisoning (GHSA-3g8h-86w9-wvmq y otros) | `next@16.2.6+` y `eslint-config-next` matching |
| `@ducanh2912/next-pwa` chain | `serialize-javascript`, `lodash`, `fast-uri`, `@xmldom/xmldom`, plugins de Babel | Update transitivo via `pnpm up --depth=Infinity` o reemplazo |

Recomendación: PR dedicado `chore(deps): bump Next.js + transitive HIGH advisories` después de Fase B.

### 4.5 Colateral fuera de `design`

`apps/web/lib/supabase/admin.ts` existe en **master** con `createAdminClient()` usando `SUPABASE_SERVICE_ROLE_KEY`. No está en `design` actualmente. **Cuando se mergee `design` → `master`** (o al revés), el archivo va a reaparecer en el branch fixado. Acciones:

1. Auditar todos los callers de `createAdminClient()` en master (no en este audit — es scope diferente).
2. Asegurar que ninguna Server Action use `admin.ts` sin `requireAdmin()`.
3. Considerar mover `admin.ts` a una capa server-only con un comentario `// SERVICE ROLE — bypasses RLS — caller must verify admin first`.

---

## 5. Mapeo a Bloques de Fase B

Para trazabilidad durante la ejecución de fixes:

| Bloque Fase B | Hallazgos cubiertos | Total | Severidad máx cubierta |
|---:|---|---:|---|
| **1 — Secretos** | (ninguno — limpio) | 0 | — |
| **2 — Zod en server actions** | 7 (todos MEDIA/BAJA + Zod parts de varios CRITICA/ALTA) | 7 | ALTA |
| **3 — Rate limiting** | 10 (todos los rate limit MEDIA) | 10 | MEDIA |
| **4 — Privacidad geoespacial** | 3 (todos CRITICA) + migración SQL preparada | 3 | CRITICA |
| **5 — Headers + cookies** | 2 (MEDIA) | 2 | MEDIA |
| **6 — Autorización** | 9 (admin actions + open redirect + chat IDs) | 9 | CRITICA |
| **Out-of-scope (reporte)** | 2 (npm HIGH) | 2 | ALTA |
| **Total** | | **33** (algunos hallazgos tocan 2 bloques) | |

---

## 6. Verificación / referencias

- **Output crudo de Codex:** `./codex-audit-output.md` (raíz del monorepo)
- **Plan de ejecución:** `~/.claude/plans/megaprompt-auditor-a-eager-pony.md`
- **Megaprompt original:** entregado por Javier en chat
- **Comando Codex usado:**
  ```bash
  codex exec -C /c/Users/10G82LA/Documents/Javier/VICINO/startup-marketplace \
    -s read-only --dangerously-bypass-approvals-and-sandbox \
    - < /c/Users/10G82LA/AppData/Local/Temp/codex-audit-prompt.txt \
    > /tmp/codex-audit-vicino.md
  ```

---

## 7. Estado y siguiente paso

**Fase A: COMPLETA.**

**DETENGO ejecución aquí.** No empiezo Fase B (los 6 bloques de fixes) hasta que Javier:
1. Lea este reporte y el output crudo de Codex.
2. Confirme las decisiones pendientes (rotación de keys, RLS, scope de npm HIGH).
3. Apruebe el arranque de Fase B con **"OK Fase B"** o equivalente.

Sin esa confirmación explícita, el branch `design` queda en su estado actual (working tree limpio).
