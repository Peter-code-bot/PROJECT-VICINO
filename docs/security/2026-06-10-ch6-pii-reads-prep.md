# VICINO - CH-6 prep: dossier de lecturas de profiles (#2 PII)

Fecha: 2026-06-10 (read-only). #2: anon/authenticated pueden SELECT columnas PII de profiles
(email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token) sin restriccion (el row-SELECT ya
fue endurecido por block_aware_profiles_select, pero NO hay REVOKE a nivel columna). El fix =
REVOKE SELECT de esas 6 columnas + servir self/admin por RPC/vista definer. Este dossier
inventaria TODA lectura de profiles (incluido admin, leccion de CH-3) para no romper la app.

## GATE 0
- HEAD `114be19` (security/fase0-audit-verification, rebasada sobre master, worktree limpio).
- `public_profiles` NO existe. RPC fuzzed `nearby_products` SI existe (`20260515000001`).

## Hallazgos de precision

- **Coords NO se exponen hoy por la app.** El join de la pagina de detalle
  (`[categoria]/[slug]/page.tsx:75-78`) selecciona `id, nombre, foto, trust_level,
  metodos_pago_aceptados, average_rating, reviews_count, total_sales` -- **sin ubicacion_lat/lng**.
  `product-detail-{mobile,desktop}.tsx` pasa `sellerLat={seller.ubicacion_lat ?? null}`, pero
  `seller.ubicacion_lat` viene `undefined` -> el pill de distancia (MetaRow) recibe null y ya es
  **codigo muerto/inerte**. => REVOKE de coords NO rompe la app; solo cierra el curl directo.
- **fcm_token: ningun read cliente.** Solo lo lee el edge `send-push/index.ts:97,119` con
  service_role (bypassa grants). `usePushNotifications.ts:52` lo ESCRIBE. => REVOKE no rompe nada.
- **Self lee su PII con `select("*")`** (`perfil/page.tsx:20-22`) -> `*` incluye columnas revocadas
  -> Postgres da 42501 "permission denied for column". Hay que servir self por definer.

## Tabla de lecturas de profiles

| file:line | columnas | contexto | pide PII? | se rompe con REVOKE? |
|---|---|---|---|---|
| **app/(marketplace)/perfil/page.tsx:20-22** | `*` | SELF (eq id=user.id) | SI (email,telefono,rfc,coords,fcm_token via `*`) | **SI** -> self via RPC/vista definer |
| **app/(marketplace)/perfil/editar/page.tsx:18-20** | `nombre, email, foto, bio, ubicacion, es_vendedor, seller_type, nombre_negocio, descripcion_negocio, metodos_pago_aceptados, trust_level, user_id` | SELF | SI (`email`) | **SI** -> self definer |
| **app/admin/users/page.tsx:29-30** | `id, nombre, email, user_id, es_vendedor, trust_level, average_rating, total_sales, created_at` | ADMIN (listado) | SI (`email`) | **SI** -> admin RPC definer (guard has_role admin) |
| app/(marketplace)/vendedor/[id]/page.tsx:34-36 | `id, nombre, foto, bio, user_id, ubicacion, es_vendedor, seller_type, nombre_negocio, categoria_negocio, metodos_pago_aceptados, trust_level, trust_points, total_sales, average_rating, reviews_count, is_verified, created_at` | AJENO (perfil publico vendedor) | NO (ubicacion es texto, no coords; sin email) | NO |
| app/(marketplace)/vendedor/[id]/page.tsx:15-17 | `nombre, nombre_negocio, seller_type` | AJENO (metadata) | NO | NO |
| app/admin/moderation/users/page.tsx:30-31 | `id, nombre, user_id, foto, es_vendedor, nombre_negocio, is_hidden, trust_level, created_at` | ADMIN | NO | NO |
| app/(marketplace)/buscar/page.tsx:57-58,67-68 | `id, nombre, avatar_url, trust_level, average_rating, reviews_count` | AJENO (busqueda) | NO | NO |
| app/(marketplace)/buscar/usuarios/page.tsx:26-27 | idem | AJENO | NO | NO |
| app/(marketplace)/page.tsx:232-234 | `id, nombre, foto, trust_level` | AJENO (strip vendedores) | NO | NO |
| app/(marketplace)/page.tsx:99-101 | `es_vendedor` | SELF | NO | NO |
| app/(marketplace)/layout.tsx:43-45 | `nombre, foto, es_vendedor` | SELF | NO | NO |
| app/seller/layout.tsx:23-24 | `nombre_negocio, nombre, trust_level, es_vendedor` | SELF | NO | NO |
| app/seller/page.tsx:21-22 | `trust_level, trust_points, average_rating, reviews_count, total_sales` | SELF | NO | NO |
| app/(marketplace)/vender/page.tsx:23-24 + lib/supabase/middleware.ts:121-122 | `es_vendedor` | SELF (gate) | NO | NO |
| app/admin/page.tsx:21-26 | `id` (count) | ADMIN (metricas) | NO | NO |
| chat/actions.ts:275, chat/page.tsx:48, (account)/historial/review/page.tsx:50, app/actions/verify-document.ts:29, hooks/use-search-suggestions.ts:36 | `nombre` | varios | NO | NO |
| product detail join `[categoria]/[slug]/page.tsx:75-78` + reviews join `:101` | `id, nombre, foto, trust_level, metodos_pago_aceptados, average_rating, reviews_count, total_sales` | AJENO (embedded) | NO (sin coords/email) | NO |

(Seed/QA scripts en apps/web/*.ts y scripts/ son dev-only, fuera del surface cliente.)

## Propuesta publico vs privado

- **PUBLICAS (NO revocar SELECT)**: id, nombre, display_name, foto, bio, es_vendedor, seller_type,
  nombre_negocio, descripcion_negocio, categoria_negocio, metodos_pago_aceptados, trust_level,
  trust_points, total_sales, average_rating(+as_seller/as_buyer), reviews_count(+as_seller/as_buyer),
  is_verified, verified_at, user_id, ubicacion (texto), is_hidden, created_at, updated_at.
- **PRIVADAS (REVOKE SELECT FROM anon, authenticated)**: `email, telefono, rfc, ubicacion_lat,
  ubicacion_lng, fcm_token`.

## Como servir self / admin / distancia (sin exponer columnas crudas)

1. **Self ve su propia PII** -- via SECURITY DEFINER (bypassa el column grant), filtrado a la fila
   propia:
   - Opcion A (recomendada): RPC `get_my_profile()` RETURNS la fila de profiles WHERE id=auth.uid()
     (incluye email/telefono/rfc). GRANT EXECUTE authenticated. Migrar `perfil/page.tsx`
     (quitar `select("*")`) y `perfil/editar/page.tsx` a esta RPC.
   - Opcion B: vista `my_profile` con `security_invoker = false` y `WHERE id = auth.uid()` -- pero
     una RPC tipada es mas clara para el formulario de editar.
   NOTA: una vista `security_invoker = true` NO sirve aqui (correria con los privilegios del caller,
   sujeta al column REVOKE -> 42501).
2. **Admin lee PII (email)** -- RPC `admin_list_users(...)` / `admin_get_user(p_id)` SECURITY
   DEFINER con guard `has_role(auth.uid(),'admin')`. Migrar `admin/users/page.tsx`. (Leccion CH-3:
   las lecturas admin de PII NO pueden ir por la "vista publica"; van por RPC admin con guard.)
3. **Distancia** -- HOY inerte (el detail no trae coords). El REVOKE no la rompe. Si se quiere el
   pill, agregar RPC `seller_distance(p_seller_id)` o `nearby`-style que devuelva distancia
   **fuzzeada** (patron `nearby_products` `20260515000001`), nunca lat/lng crudos. Opcional, no
   requerido por #2.

## Flag de lecturas admin que necesitan PII (van por RPC admin, no por vista publica)
- `app/admin/users/page.tsx:29-30` (email). Unica lectura admin que pide PII. El resto de admin
  (`admin/moderation/users`, `admin/page`) no pide PII -> sin cambios.

## Impacto en app (resumen)
- **3 call sites a migrar**: `perfil/page.tsx` (self, quitar `*`), `perfil/editar/page.tsx` (self),
  `admin/users/page.tsx` (admin). Todos via RPC definer.
- **Cero cambios** para coords (codigo muerto) y fcm_token (solo edge). Las ~20 lecturas restantes
  piden solo columnas publicas -> intactas.
- RPCs nuevas: `get_my_profile()` (auth), `admin_list_users()`/`admin_get_user(uuid)` (guard admin).
- Gate de BLOQUE A: A4 (privilegios de columna vivos en profiles).

## Pre-write verification: select(*) sweep

Barrido read-only antes de aplicar el REVOKE, para confirmar que la lista de "se rompe = SI" esta
COMPLETA (incluyendo select("*"), select() vacio y joins embebidos `profiles!xx(...)`).

Metodo + resultado:
- `select("*")` / `select()` vacio sobre `from("profiles")` (multiline): **1 hit** -> `perfil/page.tsx:21`.
- joins embebidos `profiles(*)` / `profiles:xx(*)`: **0 hits** (ningun join trae `*` de profiles).
- `.select(...)` que pida una columna PRIVADA explicita (email/telefono/rfc/coords/fcm_token): **3 hits**
  -> `admin/users/page.tsx:30` (email), `perfil/editar/page.tsx:19` (email), y **NUEVO**
  `admin/verifications/page.tsx:61` (join `profiles!user_id(nombre, email, trust_level)`).

### Tabla FINAL de call sites que se rompen con el REVOKE

| file:line | tipo | columnas PII | contexto | accion de migracion |
|---|---|---|---|---|
| app/(marketplace)/perfil/page.tsx:21 | `select("*")` | todas (via *) | SELF | RPC `get_my_profile()`; quitar `*` |
| app/(marketplace)/perfil/editar/page.tsx:19-20 | PII explicita | email | SELF | RPC `get_my_profile()` |
| app/admin/users/page.tsx:30 | PII explicita | email | ADMIN | RPC admin definer (`admin_list_users`) |
| **app/admin/verifications/page.tsx:61** | **join embebido con PII** | **email** (`profiles!user_id(nombre, email, trust_level)`) | **ADMIN** | **RPC admin (p.ej. `admin_list_verifications()` que devuelva email del submitter, o admin_get_user por fila); quitar `email` del embed** |

(El resto de lecturas de profiles -- ~20 -- piden solo columnas publicas y NO usan `*` ni embed-* ->
intactas. Coords y fcm_token: sin cambios, ya analizados arriba.)

## VEREDICTO: B

Se encontro **1 call site adicional** no listado en el dossier original: `admin/verifications/page.tsx:61`
(join embebido `profiles!user_id(... email ...)`). La lista COMPLETA de breaks es de **4**:
`perfil/page.tsx`, `perfil/editar/page.tsx`, `admin/users/page.tsx`, `admin/verifications/page.tsx`.
=> Migrar los 4 (3 self/admin directos + 1 join admin) antes/junto con el REVOKE. No hay otros
`select("*")` ni joins-con-* sobre profiles.
