# VICINO - CH-3 prep: dossier de escrituras directas (#5/#6/#7 mass-assignment)

Fecha: 2026-06-10 (read-only). #5 profiles, #6 sale_confirmations, #7 reviews+products_services.
El fix recorta los grants amplios (anon Y authenticated pueden hoy INSERT/UPDATE a nivel
tabla/columna sobre TODO) a un allowlist de columnas seguras + RPC para flujos por-actor. Esta
sesion mapea las escrituras LEGITIMAS para no romperlas. No SQL, no edits, no push.

## GATE 0
- HEAD: `3ad0d41` (security/fase0-audit-verification, en sync con remoto, worktree limpio).
- `last_seen_at`: **sin matches** en apps/web -> no hay heartbeat que choque con el REVOKE.

## Tabla de escrituras directas (cliente; excluye seed/dev scripts)

| tabla | file:line | tipo | columnas escritas | legitimo? | sobrevive al allowlist? |
|---|---|---|---|---|---|
| profiles | components/profile/avatar-with-upload.tsx:63 | UPDATE | `foto` | si (avatar) | SI (allowlist) |
| profiles | hooks/usePushNotifications.ts:52 | UPDATE | `fcm_token` | si (push token) | SI (allowlist) |
| profiles | (marketplace)/perfil/actions.ts:55 | RPC `update_profile_and_pause_products` | nombre, bio, foto, ubicacion, es_vendedor, seller_type, nombre_negocio, descripcion_negocio, metodos_pago_aceptados | si | SI (RPC SECURITY DEFINER, bypassea el grant) |
| products_services | (marketplace)/vender/actions.ts:294 | INSERT (createProduct) | creador_id, titulo, descripcion, precio, tipo, categoria, ubicacion, tipo_entrega, estatus, (+ estado/color/galeria/etc.) | si | INSERT (no es UPDATE allowlist; CH-4 le agrega gate es_vendedor) |
| products_services | (marketplace)/vender/actions.ts:568 | UPDATE (updateProductFull) | titulo, descripcion, precio, ubicacion, ubicacion_geo, tipo_entrega, estado, color, delivery_radius_km, precio_negociable, allow_appointments, appointment_start_time, appointment_end_time, appointment_duration_minutes, galeria_imagenes, imagen_principal, gallery_sizes | si | SI (allowlist) |
| products_services | (marketplace)/vender/actions.ts:639 | UPDATE (deleteProduct) | `estatus='eliminado'` | si | SI (allowlist: estatus) |
| products_services | (marketplace)/vender/actions.ts:666 | UPDATE (toggleProductStatus) | `estatus` | si | SI |
| products_services | (marketplace)/perfil/actions.ts:91 | UPDATE (updateProductsOrder) | `sort_order` | si | SI |
| products_services | components/product/product-gallery.tsx:132 | UPDATE | gallery_sizes, galeria_imagenes, imagen_principal | si | SI |
| **products_services** | **(marketplace)/[categoria]/[slug]/page.tsx:136** | **UPDATE** | **`vistas_count` (stat)** | si (contador de vistas) | **NO -> requiere RPC** |
| reviews | seller/reviews/actions.ts:24 | UPDATE (respondToReview) | `respuesta`, `respuesta_fecha` | si | SI (allowlist) |
| reviews | (account)/historial/review/review-form.tsx:97 | INSERT | sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, fotos | si | INSERT (lo gobierna la INSERT policy; no es UPDATE allowlist) |
| sale_confirmations | chat/actions.ts:253 | INSERT (createSaleConfirmation) | product_id, buyer_id, seller_id, chat_id, precio_acordado, cantidad, metodo_pago, notas, tipo_entrega | si | INSERT (lo gobierna la INSERT policy) |
| **sale_confirmations** | **chat/actions.ts:340** | **UPDATE (confirmSale)** | `buyer_confirmed`/`seller_confirmed` + `*_confirmed_at` (solo el lado del actor) | si | **NO -> RPC confirm_sale** |
| **sale_confirmations** | **chat/actions.ts:398** | **UPDATE (cancelSale)** | `status='cancelled'`, `cancelled_at`, `cancelled_by`, `cancel_reason` | si | **NO -> RPC cancel_sale** |

Notas: las escrituras a otras tablas vistas en el grep (seller_verification, messages,
notifications, product_categories, media_assets, chats, appointments) NO son #5/#6/#7 y se
gobiernan por sus propias policies (appointments es #8/CH-4). Seed scripts del root
(clean-and-seed-real.ts, fix-seed.ts, inspect-db.ts) son dev-only, fuera del surface cliente.

## Allowlist propuesto por tabla (UPDATE para `authenticated`)

> Patron: `REVOKE INSERT, UPDATE ON <tabla> FROM anon;` (anon no escribe nada) +
> `REVOKE UPDATE ON <tabla> FROM authenticated; GRANT UPDATE (<cols seguras>) TO authenticated;`
> Las columnas sensibles quedan 403 a nivel columna; solo mutables por RPC/trigger/admin.

- **profiles**: `GRANT UPDATE (foto, fcm_token) TO authenticated`.
  - Bloquea: is_verified, verified_at, trust_points, trust_level, total_sales, average_rating,
    average_rating_as_seller/buyer, reviews_count*, is_hidden, email, rfc, ubicacion_lat,
    ubicacion_lng, user_id, es_vendedor.
  - nombre/bio/ubicacion/telefono/seller-fields YA van por el RPC `update_profile_and_pause_products`
    (SECURITY DEFINER) -> NO necesitan grant directo. (Decision: la enmienda firmada del P0
    listaba tambien bio/nombre/telefono/ubicacion en el allowlist; son inofensivas pero
    redundantes hoy. Minimo correcto = {foto, fcm_token}. Confirmar si se quiere el set amplio.)
- **products_services**: `GRANT UPDATE (titulo, descripcion, precio, ubicacion, ubicacion_geo,
  tipo_entrega, estado, color, delivery_radius_km, precio_negociable, allow_appointments,
  appointment_start_time, appointment_end_time, appointment_duration_minutes, galeria_imagenes,
  imagen_principal, gallery_sizes, estatus, sort_order) TO authenticated`.
  - Bloquea: ventas_count, vistas_count, favoritos_count, is_hidden, creador_id, categoria
    (congelada por writer-stop), rating/stats denormalizados.
  - **Requiere RPC nuevo `increment_product_view(p_id)`** (ver flag #1).
- **reviews**: `GRANT UPDATE (respuesta, respuesta_fecha) TO authenticated`.
  - Bloquea: visible, is_hidden, reportada, motivo_reporte, rating, comentario, fotos.
  - El INSERT de una review nueva (review-form) lo gobierna su INSERT policy (reviewer +
    venta completed) -> intacto.
- **sale_confirmations**: `REVOKE UPDATE ON sale_confirmations FROM authenticated` (NO column
  grant). Toda mutacion por RPC:
  - `confirm_sale(p_sale_id)` SECURITY DEFINER: deriva auth.uid(), setea SOLO el flag del actor
    (reemplaza chat/actions.ts:340).
  - `cancel_sale(p_sale_id, p_reason)` SECURITY DEFINER: participante-only, setea status='cancelled'
    + cancel fields (reemplaza chat/actions.ts:398).
  - Motivo de NO usar column-grant aqui: si `status` estuviera en un allowlist, un participante
    podria setear `status='completed'` directo, saltandose el requisito de ambos confirmados (#6).

## Flags: escrituras NO-por-RPC que tocan columna sensible (rompen con el allowlist)

1. **`vistas_count` (CRITICO para no romper).** `[categoria]/[slug]/page.tsx:136`
   `.update({ vistas_count: (product.vistas_count ?? 0) + 1 })` corre en SSR para cualquier
   viewer. Hoy la RLS `Sellers can update own products` (creador_id=auth.uid()) ya bloquea a
   no-owners (el contador casi no incrementa salvo que el dueno vea su propio producto), y el
   `.then()` traga el error. Con el allowlist (sin vistas_count) incluso el dueno daria 42501.
   **Fix:** RPC `increment_product_view(p_id)` SECURITY DEFINER (decide si EXECUTE a anon+auth o
   solo auth) + quitar el `.update({vistas_count})` del page y llamar el RPC. App edit: 1 sitio.
2. **sale_confirmations confirm/cancel.** chat/actions.ts:340 y :398 escriben flags/status
   transaccionales directo -> migrar a `confirm_sale` / `cancel_sale`. App edits: 2 sitios.

Las demas escrituras (profiles foto/fcm_token; products edit/delete/toggle/order/gallery;
reviews respuesta) ya tocan SOLO columnas del allowlist -> **cero edits de app** para esas.

## Resumen de impacto en app (para CH-3)
- **Sin edits:** profiles (avatar, push), products (updateProductFull, delete, toggle, order,
  gallery), reviews (respondToReview) -- ya escriben solo columnas allowlisted.
- **Con edits:** (a) reemplazar el write de `vistas_count` por `increment_product_view` RPC;
  (b) migrar `confirmSale`/`cancelSale` a `confirm_sale`/`cancel_sale` RPC.
- RPCs nuevos: `increment_product_view`, `confirm_sale`, `cancel_sale` (todos SECURITY DEFINER,
  REVOKE anon donde aplique, GRANT authenticated, search_path locked).
- Gate de BLOQUE A: A4 (privilegios de columna vivos en profiles) + A6 (policies vivas).
