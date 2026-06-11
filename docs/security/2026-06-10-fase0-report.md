# VICINO - FASE 0: Verificacion del Audit de Seguridad

Fecha: 2026-06-10
Baseline auditado: commit `83132f9` = `origin/master` = produccion (`https://vicinomarket.com`).
Metodo: verificacion read-only del codigo real (migraciones + app + edge functions) contra el
texto del audit de Alejandro. NO se confio en el texto del audit; cada hallazgo se reverifico.

Estado git al momento: HEAD local sincronizado a `83132f9` via fast-forward (estaba 9 commits
detras; los 9 eran solo UI/layout/chat). Worktree limpio.

Nota de alcance: el estado VIVO de la base de datos (grants/policies efectivos) solo se confirma
con el pack `2026-06-10-fase0-bloque-a.sql` corrido en Supabase Studio, porque el ledger
`schema_migrations` esta desincronizado y hay policies creadas a mano en el Dashboard. Los
hallazgos marcados "(confirmar vivo)" dependen de esos grants.

---

## Veredictos (14 hallazgos)

CONFIRMADO = vulnerable hoy en el codigo. PARCIAL = mitigado en parte. Ninguno resulto FALSO
POSITIVO puro.

| # | Hallazgo | Veredicto | Sev | Evidencia (file:line) |
|---|---|---|---|---|
| 1 | make_admin(text) privesc | CONFIRMADO (confirmar vivo) | Crit 9.8 | 20260410000001_admin_setup.sql:3-15 SECURITY DEFINER, sin guard, sin REVOKE; 20260425000001:14-15 solo fija search_path |
| 2 | PII/columnas profiles + coords exactas | CONFIRMADO (parcial) | Alto 8.6 | row-SELECT YA endurecido: 20260429120001_moderation_rls.sql:71 DROP "Anyone can view profiles" -> :73-96 block_aware_profiles_select. Problema VIGENTE = columnas (sin REVOKE de email/telefono/rfc/ubicacion_lat/lng/fcm_token). Coords exactas al cliente: meta-row.tsx:14-15,97-124 via product-detail-*.tsx (seller.ubicacion_lat/lng). Fuzzing solo en nearby_products() RPC (20260515000001), no en SELECT de tabla |
| 3 | Edge send-push sin auth, service_role | CONFIRMADO | Alto 8.8 | supabase/functions/send-push/index.ts:25-37 confia en payload.record (NO recarga de DB), usa SUPABASE_SERVICE_ROLE_KEY, CORS *. Valida allowedTables+type pero receiverId sale del record. config.toml sin bloque [functions.send-push] |
| 4 | RPCs de chat BOLA/IDOR | CONFIRMADO (confirmar vivo) | Alto 8.1 | 20260320000009_chats_messages.sql:41-74 get_or_create_chat y :98-115 mark_messages_as_read confian en params, sin auth.uid(), sin REVOKE |
| 5 | Mass-assign profiles | CONFIRMADO | Crit 9.1 | 20260320000002_profiles.sql:107-110 "Users can update own profile" sin restriccion de columnas -> set is_verified, trust_points, trust_level, es_vendedor, is_hidden. RPC seguro existe (20260521000011) pero la policy amplia sigue |
| 6 | sale_confirmations completable unilateral | CONFIRMADO | Alto 8.1 | 20260320000007_sale_confirmations.sql:136-138 UPDATE sin WITH CHECK de columnas -> un participante setea ambos flags + status='completed' en un PATCH; trigger :60-93 completa venta, otorga trust, sube ventas_count |
| 7 | Mass-assign reviews + products | CONFIRMADO | Alto 7.5 | 20260320000008_reviews.sql:154-157 reviewed_id puede flip visible/is_hidden/reportada. 20260320000004:93-96 + 20260602000001:88-91 owner setea ventas_count/vistas_count/favoritos_count/is_hidden. Nombres del audit CORRECTOS |
| 8 | appointments publico y manipulable | CONFIRMADO | Alto 8.2 | 20260412000001_appointments.sql:24 SELECT USING(true) nunca dropeado; :25 INSERT confia en seller_id (sin validar contra creador del producto); :26 UPDATE sin restriccion de columnas |
| 9 | Cualquiera publica productos (sin gate vendedor) | CONFIRMADO | Alto 7.5 | 20260320000004:89-91 + 20260602000001:84-86 INSERT solo exige creador_id=auth.uid(), sin es_vendedor. middleware.ts:113-130 gatea solo la ruta UI. Decision: fix = gate es_vendedor=true |
| 10 | Inyeccion logica .or() en busqueda | CONFIRMADO (parcial) | Med 5.3 | buscar/page.tsx:62-84 interpola params.q en .or() con solo transform vocal->_, sin escapar %,(). Severidad real baja-media |
| 11 | CSP Report-Only + unsafe-inline/eval | CONFIRMADO (tradeoff) | Med 6.1 | next.config.ts:33 script-src 'self' 'unsafe-inline' 'unsafe-eval', :57 Content-Security-Policy-Report-Only. Intencional por comentario (monitoreo PWA/Realtime). DIFERIDO |
| 12 | Bucket review-media permisivo | CONFIRMADO (parcial) | Med 6.5 | 20260320000017_storage_buckets.sql:33-41 bucket publico; :75-81 INSERT solo exige auth.uid() IS NOT NULL, sin path-scoping. 20260425000002_harden_storage_policies.sql endurece otros buckets pero NO review-media. Matiz: allowed_mime_types=image/* a nivel bucket SI lo aplica Supabase -> subir HTML arbitrario parcialmente bloqueado; abuso de path/overwrite sigue |
| 13 | Mobile/source-maps/firebase | CONFIRMADO | Med 5.5 | AndroidManifest.xml:4 allowBackup="true"; build.gradle:38 release minifyEnabled false; google-services.json Firebase client key (publica por diseno, restringir por SHA en consola). Source maps: apps/web/public/sw.js.map + workbox-*.js.map TRACKED en git con sourcesContent -> viola regla del proyecto (artefactos PWA nunca se commitean). Solo source-maps se arregla ahora |
| 14 | has_role filtra roles de cualquiera | CONFIRMADO (confirmar vivo) | Bajo/Med 4.3 | 20260320000002:129-136 SECURITY DEFINER sin guard _user_id=auth.uid() -> enumeracion de admins. Usado por MUCHAS policies; el fix no debe romperlas |

### Correcciones de precision al texto del audit

- #2: el audit dice RLS de fila "no oculta" como unico problema; en realidad el row-SELECT ya fue
  endurecido (block_aware_profiles_select). El problema VIGENTE es columnas (no hay REVOKE de
  columnas), que el patron de fila no cubre.
- #5: el payload del audit usa rating_promedio (la columna real es average_rating) e is_hidden (que
  SI existe en profiles pero agregada por 20260429120000_moderation_reports.sql, no en el DDL base).
  El core del hallazgo (mass-assign de is_verified/trust_*/es_vendedor) es real.
- #7: nombres ventas_count/vistas_count/favoritos_count del audit son CORRECTOS.
- #12: allowed_mime_types=image/* a nivel bucket ya bloquea subir HTML arbitrario (lo aplica
  Supabase); queda el abuso de path/overwrite por falta de path-scoping.
- #13: Sentry ya borra sus propios source maps (next.config.ts:137 deleteSourcemapsAfterUpload:true);
  el problema real son los maps de PWA (sw.js.map, workbox-*.map) commiteados a public/.
- Patron positivo: el repo YA tiene el patron de hardening correcto en
  20260521000011_rpc_update_profile_and_pause.sql (guard auth.uid()=p_user_id + REVOKE ALL FROM
  PUBLIC + REVOKE EXECUTE FROM anon + GRANT TO authenticated + SET search_path). Se reutiliza para
  los RPC vulnerables.

---

## Enmiendas al plan (firmadas, aplicar al escribir cada cambio)

1. CH-3 NO usa triggers BEFORE UPDATE en profiles. Un trigger rompe el RPC
   update_profile_and_pause (SECURITY DEFINER que hace UPDATE is_hidden por dentro; auth.uid() sigue
   siendo el user normal -> el trigger bloquearia su escritura legitima). Fix correcto = GRANT a
   nivel columna, no triggers:
   - #5 profiles: REVOKE UPDATE ON profiles FROM authenticated;
                  GRANT UPDATE (foto, fcm_token, bio, nombre, telefono, ubicacion) TO authenticated;
                  (is_verified/trust_*/es_vendedor/is_hidden -> 403 a nivel columna. Avatar y push
                   siguen OK. El RPC como owner no lo afecta el GRANT.)
   - #7 reviews:  REVOKE UPDATE; GRANT UPDATE (respuesta, respuesta_fecha) TO authenticated;
   - #7 products: REVOKE UPDATE; GRANT UPDATE solo de columnas editables que escribe
                  vender/actions.ts (sin stats, sin is_hidden) -> enumerar al escribir.
   - #6 sale_confirmations: NO column-grant, NO trigger. Va por RPC confirm_sale(p_sale_id) que
                  deriva auth.uid() y setea SOLO el flag del actor (patron canonico
                  update_profile_and_pause). REVOKE UPDATE ON sale_confirmations FROM authenticated.

2. #14 has_role: se SACA de CH-2 y es su propio cambio, AL FINAL (blast radius = todas las
   policies). Gatear con A11, no A8. No acoplarlo al fix limpio de los 2 RPC de chat.

3. CH-2 get_or_create_chat overload transitorio: conservar los NOMBRES de parametro EXACTOS
   (p_comprador_id, p_vendedor_id, p_producto_id) para que PostgREST resuelva la llamada viva. El
   shim 3-arg ignora p_comprador_id del cliente y usa auth.uid(). Cambiar nombres = romper app.

4. CH-6 "salvo self" NO se logra con REVOKE de columna (no es row-aware; revoca para todo
   authenticated, incluido el dueno). El self ve su propio email/telefono via vista security_invoker
   WHERE id = auth.uid() o RPC. Disenarlo explicito.

5. CH-4 appointments UPDATE "solo status" no basta: definir maquina de estados por actor (buyer
   cancela lo suyo, seller confirma lo suyo) o reaparece el #6. Confirmar allow_appointments con A12
   antes de escribir el trigger de INSERT.

6. #13 git rm --cached deja de trackear pero NO deja de SERVIR los maps si el build PWA los re-emite
   a public/. Confirmar si sw.js.map/workbox-*.map son artefactos vivos de next-pwa; si si,
   desactivar la emision de sourcemap del SW, o siguen descargables en prod.

7. chat/actions.ts esta en el set divergente recien rebaseado. Re-verificar los callers de
   get_or_create_chat (:43) y confirmSale/cancelSale contra el codigo en 83132f9 ANTES de escribir
   CH-2 y CH-3.

---

## Plan de remediacion (forward, GATED por A1-A12) - referencia ya corregida por enmiendas

| Orden | Slug (openspec/changes/2026-06-10-...) | Hallazgos | Mecanismo (post-enmiendas) | Gate |
|---|---|---|---|---|
| 1 (P0) | hotfix-make-admin-privesc | #1 | CREATE OR REPLACE con guard admin-only + REVOKE/GRANT; bootstrap admin como postgres | A1,A2,A3,A10 |
| 2 (P0/P1) | harden-chat-rpcs | #4 | get_or_create_chat DROP+CREATE 2-arg + shim 3-arg con NOMBRES exactos; mark_messages_as_read deriva auth.uid() misma firma | A3,A9 |
| 3 (P1) | mass-assignment-column-locks | #5, #6, #7 | GRANT a nivel columna (#5,#7); RPC confirm_sale + REVOKE UPDATE (#6); NO triggers | A4,A6 |
| 4 (P1) | appointments-and-insert-gates | #8, #9 | SELECT participantes + RPC get_booked_slots; maquina de estados por actor; INSERT trigger; products gate es_vendedor | A6,A12 |
| 5 (P1) | edge-and-storage-hardening | #3, #12 | send-push secret + recargar record de DB + CORS; review-media path-scoping | A7 |
| 6 (P1) | profile-pii-column-exposure | #2 | REVOKE columnas PII; self via vista security_invoker / RPC (no row-aware con grant) | A4 |
| 7 (P2) | source-maps-git-hygiene | #13 (solo maps) | git rm --cached + .gitignore; confirmar si next-pwa re-emite (enmienda 6) | - |
| 8 (ult) | has-role-info-disclosure | #14 | guard self-or-admin + REVOKE anon; AL FINAL (toca todas las policies) | A11 |

Verificacion futura por cambio: Camino 2 (READ->WRITE->VERIFY) en Studio con SET LOCAL ROLE
authenticated + jwt claims dentro de BEGIN; ... ROLLBACK;; pnpm build antes de push; CODEX
Adversarial Review Loop al cierre de cada /opsx:apply.

## Siguiente paso

Correr docs/security/2026-06-10-fase0-bloque-a.sql en Supabase Studio (read-only) y pegar los
resultados de A1-A12. Con el estado vivo confirmado se crea el primer cambio OpenSpec
(2026-06-10-hotfix-make-admin-privesc, P0).
