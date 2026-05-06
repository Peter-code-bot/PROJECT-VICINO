# Sistema de Moderación VICINO — Setup y Operación

Implementación completa para Google Play Store Closed Testing. Cubre reportes
de contenido, bloqueo de usuarios, auto-hide automático, panel admin, alertas
por email y flujo CSAM.

> Repo: `Peter-code-bot/startup-marketplace` · Branch: `master`
> Implementado: 2026-04-29

---

## 1. Componentes desplegados

### 1.1 Backend (Supabase)
- `supabase/migrations/20260429120000_moderation_reports.sql`
  Tablas `reports` y `user_blocks`. Enums `report_target_type`, `report_status`,
  `report_reason` (incluye `child_safety`). Columnas `is_hidden` en
  `products_services`, `reviews`, `messages`, `profiles`. View
  `v_active_reports_count`. Trigger `auto_hide_on_threshold` (3+ reports).
- `supabase/migrations/20260429120001_moderation_rls.sql`
  RLS en `reports` y `user_blocks`. Reemplazo de policies SELECT permisivas en
  `profiles`/`reviews`/`products_services`/`messages` con versiones
  block-aware bidireccionales.
- `supabase/migrations/20260429120002_migrate_legacy_review_reports.sql`
  Crea usuario sistema `system@vicinomarket.com` (UUID determinístico
  `00000000-0000-0000-0000-000000000001`). Migra reportes legacy de
  `reviews.reportada=true` a la tabla `reports`.
- `supabase/migrations/20260429120003_csam_critical_reports.sql`
  Tabla `critical_reports` (audit trail legal CSAM). Trigger
  `handle_child_safety_report` para auto-hide inmediato.
- `supabase/migrations/20260429120004_immutable_audit_logs.sql`
  Hardening de compliance MX (5+ años). Reemplaza policy `FOR ALL` de
  `critical_reports` por 3 policies selectivas (SELECT/INSERT/UPDATE) +
  triggers `BEFORE UPDATE/DELETE` con `RAISE EXCEPTION` en
  `critical_reports` y `audit_log` (defense-in-depth contra
  `service_role` BYPASSRLS).

### 1.2 API routes
- `apps/web/app/api/reports/route.ts` (POST) — crea reportes con validación zod,
  self-report check, manejo amistoso de UNIQUE constraint, rate limit aplicado
  vía middleware (10/hora/IP en `lib/security/rate-limit.ts`).
- `apps/web/app/api/admin/report-webhook/route.ts` (POST) — handler del
  Database Webhook de Supabase. Verifica `x-webhook-secret`, manda email vía
  Resend, dedup de bursts (>5 en 5 min), email URGENTE para CSAM.

### 1.3 Frontend
- Modal: `apps/web/components/moderation/report-modal.tsx`
- Menu button (⋯): `apps/web/components/moderation/report-menu-button.tsx`
- Hook bloqueo: `apps/web/lib/moderation/use-block-user.ts`
- Tipos compartidos: `packages/shared/src/validators/moderation.ts`
- Email helper: `apps/web/lib/email/resend.ts`
- Botones inyectados en:
  - `app/(marketplace)/[categoria]/[slug]/page.tsx` (producto + sus reseñas)
  - `app/(marketplace)/perfil/profile-header.tsx` (perfil público)
  - `app/(marketplace)/perfil/profile-tabs.tsx` (reseñas en perfil)
  - `app/(marketplace)/chat/[id]/chat-window.tsx` (mensajes ajenos)

### 1.4 Admin panel
- Índice `/admin/moderation` con 4 cards + banner CSAM.
- Sub-páginas: `/reviews`, `/listings`, `/users`, `/messages`, `/critical`.
- Componente compartido `report-row-actions.tsx` con acciones Resolver,
  Desestimar, Suspender (admin-only).
- Form CSAM `critical/critical-report-form.tsx` para registrar denuncia.

### 1.5 Legales
- `/terminos` actualizado: secciones 13 (Reportes y Conducta) y 14
  (Seguridad Infantil). Email de contacto: `admin@vicinomarket.com`.

---

## 2. Setup post-deploy (acción humana)

### 2.1 Crear cuenta Resend
1. Ir a https://resend.com y registrarse.
2. Verificar dominio `vicinomarket.com`. Agregar registros DNS (SPF, DKIM)
   que provee Resend.
3. Crear API key con permiso "Send emails".
4. Confirmar que `admin@vicinomarket.com` y `moderation@vicinomarket.com` y
   `alerts@vicinomarket.com` reciben correos (testear).

### 2.2 Generar webhook secret
```bash
openssl rand -hex 32
```
Guardar el resultado en lugar seguro.

### 2.3 Configurar variables de entorno (Netlify Dashboard)
Para preview Y producción:
```
RESEND_API_KEY=<api key de Resend>
SUPABASE_WEBHOOK_SECRET=<output de openssl>
ADMIN_EMAIL=admin@vicinomarket.com
RESEND_FROM_NORMAL=VICINO Moderation <moderation@vicinomarket.com>
RESEND_FROM_URGENT=VICINO Alerts <alerts@vicinomarket.com>
```

### 2.4 Aplicar migraciones de DB
```bash
# Desde la raíz del repo
npx supabase db push
```
O desde el Dashboard: Database > Migrations > Apply.

> ⚠️ **Backup primero.** En producción haz `supabase db dump` antes de aplicar.

### 2.5 Crear el Database Webhook en Supabase Dashboard
1. Database > Webhooks > Create a new webhook.
2. Configuración:
   - **Name:** `report-notifier`
   - **Table:** `public.reports`
   - **Events:** `Insert` (solo)
   - **Type:** HTTP Request
   - **HTTP Method:** POST
   - **URL:** `https://<dominio-de-prod>/api/admin/report-webhook`
   - **HTTP Headers:**
     - `Content-Type: application/json`
     - `x-webhook-secret: <SUPABASE_WEBHOOK_SECRET>`
3. Save.

> Esta config NO se guarda en el repo (UI-only). Documentarla aquí es la
> única forma de no perderla al recrear el proyecto.

### 2.6 Asignar rol admin
En el SQL Editor del Dashboard de Supabase:
```sql
SELECT make_admin('pedro@vicinomarket.com');
SELECT make_admin('alejandro@vicinomarket.com');
```
La función `make_admin(email)` ya existe en
`supabase/migrations/20260410000001_admin_setup.sql`.

### 2.7 Instalar dependencia
```bash
pnpm install
```
La dep `resend` ya quedó añadida a `apps/web/package.json`.

---

## 3. Procedimiento ante reporte CSAM (acción humana)

Cuando recibas un email con asunto `[VICINO][🚨 CRÍTICO] Reporte de seguridad
infantil`:

1. **No abrir el contenido en presencia de terceros.** Acceder solo desde el
   panel admin en una sesión privada.
2. **Recopilar evidencia:** capturas del contenido, target_id, reporter info.
   El target ya quedó auto-oculto por trigger, pero el row sigue en DB.
3. **Presentar denuncia:**
   - **Policía Cibernética CDMX:** policia.cibernetica@ssc.cdmx.gob.mx · 55 5242-5100 ext 5086
   - **Policía Cibernética Puebla:** 222 219 8155
   - **FGR Fiscalía Especial:** Avenida Paseo de la Reforma 211-213, CDMX
   - Online: https://www.gob.mx/sspc/acciones-y-programas/ciberseguridad
4. **Obtener folio o expediente** de la autoridad.
5. **Registrar en panel admin:** `/admin/moderation/critical` → marcar el
   reporte con el folio + notas.
6. **Conservar comprobantes ≥ 5 años** (carpeta legal segura).

---

## 4. Testing end-to-end

### 4.1 Flujo normal de reporte
1. Crear 2 cuentas: A (reporter) y B (autor).
2. Como B, publicar un producto.
3. Como A, abrir el producto, click "⋯" → "Reportar este producto" → motivo
   "Spam" → enviar.
4. Verificar:
   - Toast de éxito en UI.
   - Row en `public.reports` con `target_type='listing'`, `status='pending'`.
   - Email en `admin@vicinomarket.com`.

### 4.2 Auto-hide a 3 reportes
1. Como A, B y C, reportar el mismo producto (3 cuentas distintas).
2. Verificar `products_services.is_hidden = TRUE`.
3. Verificar que el producto no aparece en `/buscar` para usuarios autenticados.

### 4.3 Bloqueo bidireccional
1. Como A, ir al perfil de B → "⋯" → "Bloquear usuario".
2. Verificar:
   - A ya no ve productos/reseñas/mensajes de B.
   - **B tampoco ve productos/reseñas/mensajes de A** (RLS bidireccional).

### 4.4 CSAM
1. Como A, reportar un producto con motivo "Seguridad infantil".
2. Verificar:
   - `products_services.is_hidden = TRUE` inmediatamente.
   - Row en `public.critical_reports` con `authority_notified_at IS NULL`.
   - Email URGENTE en `admin@vicinomarket.com`.
   - Banner rojo en `/admin/moderation`.

### 4.5 Rate limit
1. Hacer 11 POST consecutivos a `/api/reports` desde la misma IP.
2. El 11º debe responder 429 con `Retry-After`.

### 4.6 Self-report
1. Como B (autor), intentar reportar tu propio producto via el modal.
2. El botón "⋯" debe estar oculto en el UI.
3. Si se intenta el POST manual, responde 403 con mensaje amigable.

### 4.7 Doble reporte
1. Como A, reportar el mismo producto dos veces.
2. El segundo intento responde 409 con toast informativo "Ya reportaste este
   contenido".

---

## 5. Limitaciones conocidas

### 5.1 Estado in-memory de webhook
El dedup de bursts (>5 emails en 5 min) usa `Map` por isolate de
serverless. Distintos isolates = contadores independientes. Aceptable a
escala MVP/Closed Testing. **Migrar a Vercel KV o Upstash Redis** cuando
volumen lo justifique.

### 5.2 Webhook secret simple
Se valida con comparación `===` (no HMAC, no `timingSafeEqual`). Suficiente
para esta etapa porque (a) el secret tiene 256 bits de entropía y (b)
Supabase enviará el webhook desde IPs conocidas. **TODO post-MVP:** migrar
a HMAC del payload con `timingSafeEqual` cross-runtime para resistir leaks
de logs.

### 5.3 Auto-hide solo en `listing` y `review`
Para `user` y `message`, el threshold de 3 reportes NO oculta automáticamente
(riesgo de abuso > beneficio). Solo CSAM dispara auto-hide en estos targets.
El admin debe ocultarlos manualmente via panel.

### 5.4 Sin push notifications
El admin se entera por email. Latencia depende del check de inbox. En el
futuro: integrar push o SMS para reportes CSAM.

### 5.5 Reporter de migración legacy
Los reportes históricos de `reviews.reportada=true` quedaron asignados al
usuario sistema (UUID `00000000-...01`) porque la información del reporter
real no se conservaba. El panel admin los muestra como reportados por
"VICINO System".

### 5.6 Capacitor + long-press
En la versión web/PWA, el botón "⋯" en mensajes de chat se ve siempre con
opacidad reducida y se intensifica al hover. Esto evita colisiones con el
long-press nativo de Android (que dispara selección de texto). Si en device
real el UX no encaja, considerar migrar a long-press con bloqueo de selección
nativa via Capacitor plugin de gestos.

### 5.7 CSAM auto-hide unilateral sin threshold (known tradeoff)
A diferencia del auto-hide normal (`auto_hide_on_threshold` requiere 3+
reportes activos), CSAM dispara `handle_child_safety_report` con un solo
reporte. El target queda oculto inmediatamente, sin importar quién reporta
ni si el reporte es genuino.

**Riesgo de abuso:** un atacante con 1 cuenta puede reportar a un competidor
o a contenido legítimo con `reason='child_safety'` y ese target queda oculto
hasta intervención manual del admin. Aplica a los 4 tipos: `listing`,
`review`, `user`, `message`.

**Por qué se acepta:** la prioridad legal de Compliance MX (Policía
Cibernética / FGR) supera el costo de no ocultar contenido CSAM real durante
la ventana de respuesta. Un falso positivo afecta a 1 usuario por minutos;
un falso negativo expone contenido CSAM real durante horas.

**Mitigación operacional:**
1. **Email URGENTE inmediato al admin** vía Resend (Fase 3 del MP#04).
   Asunto `[VICINO][🚨 CRÍTICO]`. Latencia esperada: <30s desde el reporte.
2. **Admin revisa en `/admin/moderation/critical`** dentro de la primera
   hora desde la alerta. Si el reporte es abusivo:
   a. **Desestimar** el reporte en `/admin/moderation/users` (o el target
      type correspondiente). Esto cambia `reports.status='dismissed'`.
   b. **Unhide manual** del target: `UPDATE products_services SET is_hidden
      = FALSE WHERE id = ...` (o equivalente para los otros 3 tipos),
      registrado en `audit_log` vía la action server-side.
   c. **Considerar suspender al reporter** si el patrón de abuso es
      reiterado (≥2 falsos positivos child_safety en 30 días).
3. **`critical_reports` row queda registrado** (es inmutable post-Fase 5
   del MP#04). El admin puede agregar `notes` documentando el abuso, pero
   el reporte mismo no se borra. Esto es deseado para auditoría.

**Métricas a monitorear (post-MVP):**
- % de `critical_reports` que terminan con `reports.status='dismissed'`
  (proxy de tasa de abuso). Si > 30% sostenido, evaluar threshold=2 para
  `user` y `message`.
- Tiempo medio entre reporte CSAM y resolución admin. Objetivo < 1h.

---

## 6. TODOs documentados (no bloqueantes para Play Store)

### 6.1 Migrar webhook a HMAC
**Cuándo:** post-MVP, antes de Open Testing.
**Qué:** reemplazar header `x-webhook-secret` plano por HMAC SHA-256 del
payload, comparado con `timingSafeEqual`.

### 6.2 Eliminar columnas legacy de reviews
**Cuándo:** 2 releases después de hoy (≥ 2026-06-15).
**Qué:** drop `reviews.visible`, `reviews.reportada`, `reviews.motivo_reporte`.
Eliminar también el trigger `trg_reviews_sync_visibility`. La fuente única
pasa a ser `reviews.is_hidden` y `public.reports`.

### 6.3 Migrar rate limit a Vercel KV
**Cuándo:** cuando volumen >= 1000 reportes/mes.
**Qué:** reemplazar `Map` in-memory en `lib/security/rate-limit.ts` por
Vercel KV / Upstash Redis para que el límite sea consistente cross-isolate.

### 6.4 Migrar ReportModal a Drawer
**Cuándo:** cuando se ejecute el bloque de a11y estructural (Bloque 7).
**Qué:** reemplazar la implementación inline de `report-modal.tsx` por el
componente `<Drawer>` consolidado + `<FormError>`. Marcar grep
`TODO(bloque-7)` en el código del modal.

### 6.5 Bump Aviso de Privacidad v2.1 → v2.2
**Cuándo:** corrida documental separada.
**Qué:** actualizar `/privacidad` para mencionar (a) Sentry como
destinatario de transferencia internacional, (b) tratamiento de datos
derivado de reportes y bloqueos. Esta corrida NO modifica el aviso.

### 6.6 Coordinación con Bloque 6 (auth security middleware)
**Cuándo:** cuando se ejecute Bloque 6.
**Qué:** el rate limit de `/api/reports` está implementado dentro del
`middleware.ts` existente vía la entrada en `RATE_LIMITS`. Cuando Bloque 6
introduzca middleware adicional para auth/login/register, **mantener un
solo `middleware.ts` con un `matcher`** y consolidar reglas de rate limit en
el mismo `RATE_LIMITS` map.

### 6.7 Auto-recálculo de ratings cuando admin oculta review
**Cuándo:** mejora menor.
**Qué:** los triggers existentes `update_user_rating_on_review` y
`update_separated_ratings` filtran por `visible=true`. Cuando el admin oculta
una review (is_hidden=true), el rating del usuario reviewed NO se recalcula
automáticamente (se preserva el comportamiento legacy). Considerar agregar
trigger AFTER UPDATE OF is_hidden que dispare el recálculo.

---

## 7. Archivos críticos para grep / debug rápido

| Función | Archivo |
|---|---|
| Schema reports/blocks | `supabase/migrations/20260429120000_moderation_reports.sql` |
| RLS bloqueo bidireccional | `supabase/migrations/20260429120001_moderation_rls.sql` |
| Trigger CSAM | `supabase/migrations/20260429120003_csam_critical_reports.sql` |
| Inmutabilidad audit (compliance MX) | `supabase/migrations/20260429120004_immutable_audit_logs.sql` |
| Endpoint POST /api/reports | `apps/web/app/api/reports/route.ts` |
| Webhook handler | `apps/web/app/api/admin/report-webhook/route.ts` |
| Modal de reporte | `apps/web/components/moderation/report-modal.tsx` |
| Bloqueo de usuario | `apps/web/lib/moderation/use-block-user.ts` |
| Rate limit config | `apps/web/lib/security/rate-limit.ts` |
| Acciones server admin | `apps/web/app/admin/moderation/actions.ts` |
| Tipos compartidos | `packages/shared/src/validators/moderation.ts` |
| T&C secciones 13–14 | `apps/web/app/(marketplace)/terminos/page.tsx` |
