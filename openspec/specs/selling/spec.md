# Selling — Current State

Reverse-engineered from the codebase as of commit `81616cf` (rama `feat/openspec-2026-06-bootstrap`, after the categories domain spec was added). Captures the canonical behavior of the publish/edit/pause/delete product flow exposed at `/vender` and `/vender/[id]/editar`.

Every Requirement below is anchored to a real file:line in the repo; no behavior is asserted that cannot be pointed at code. Where the system depends on the categories domain, this spec references `openspec/specs/categories/spec.md` instead of duplicating.

## Purpose

VICINO sellers publish, edit, pause, resume, and soft-delete their listings (productos and servicios) from the `/vender` and `/seller/listings` surfaces. The server actions in `apps/web/app/(marketplace)/vender/actions.ts` are the single chokepoint for writes to `products_services` and the canonical entrypoint for media validation, ownership enforcement, soft-delete semantics, and dual-write to the `product_categories` pivot.

## Glossary

- **`createProduct`** — server action that INSERTs a new `products_services` row.
- **`updateProductFull`** — server action that UPDATEs an existing `products_services` row, partial-by-design (tri-state per field).
- **`deleteProduct`** — soft delete (`estatus = 'eliminado'`); the row stays in the DB.
- **`toggleProductStatus`** — flips `estatus` between `'disponible'` and `'pausado'`.
- **Tri-state UPDATE** — for each editable column, the form may omit the field (preserve current value), send the new value (overwrite), or send empty/null (clear). Convention varies per field; see the tri-state Requirement and per-field Requirements.
- **Media** — images and videos stored in the `product-media` Supabase Storage bucket, referenced from `products_services.imagen_principal` (TEXT) and `galeria_imagenes` (TEXT[]).
- **Soft delete** — never `DELETE FROM products_services`; always `UPDATE ... SET estatus = 'eliminado'` so foreign-key relationships (sale_confirmations, reviews, chat) remain intact.

## Requirements

### Requirement: Server actions require an authenticated session

WHEN `createProduct`, `updateProductFull`, `deleteProduct`, or `toggleProductStatus` is invoked without an authenticated user, the system SHALL redirect the caller to `/login` (or `/login?next=/vender` for the public publish surface) and SHALL NOT proceed with the write.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:206-211` (createProduct), `:362-367` (updateProductFull), `:627-632` (deleteProduct), `:654-659` (toggleProductStatus), and `apps/web/app/(marketplace)/vender/page.tsx:17-19` (public surface redirect).

#### Scenario: Anonymous user is redirected from /vender

- GIVEN a user with no Supabase session
- WHEN the user navigates to `/vender`
- THEN the server redirects to `/login?next=/vender`

#### Scenario: Anonymous server action call redirects

- GIVEN a server action is invoked without a session (defensively, since middleware should have caught it)
- WHEN `createProduct` runs `supabase.auth.getUser()` and receives no user
- THEN the action calls `redirect("/login")` before any DB write

### Requirement: Write operations are rate-limited per user

The system SHALL apply a write rate limit of 30 operations per minute per user via `writeRateLimit` to `createProduct`, `updateProductFull`, `deleteProduct`, and `toggleProductStatus`.

Anchored at `apps/web/lib/rate-limit.ts:55` (`writeRateLimit = makeLimiter("1 m", 30, "rl:write")`) and the call sites in `actions.ts:213, 372, 635, 662`.

#### Scenario: 31st write in a minute is rejected

- GIVEN a user has performed 30 product writes in the last minute
- WHEN the user invokes a 31st write action
- THEN the action returns `{ error: <rate-limit-error> }` before reaching the DB

### Requirement: Inputs are validated by Zod schemas

WHEN `createProduct` receives form data, the system SHALL parse it via `createProductSchema.safeParse(...)`. WHEN `updateProductFull` receives form data, the system SHALL parse it via `updateProductSchema.safeParse(...)` where `updateProductSchema = createProductSchema.partial()`. If validation fails, the action SHALL return `{ error: <first issue message> }` without touching the DB.

Anchored at `packages/shared/src/validators/product.ts:42-73` (schemas) and `apps/web/app/(marketplace)/vender/actions.ts:244-247` (CREATE parse), `:414-417` (UPDATE parse).

#### Scenario: Invalid titulo aborts createProduct

- GIVEN a CREATE form payload with `titulo` of length 2 (below min 3)
- WHEN `createProduct` parses it
- THEN the action returns `{ error: "Minimo 3 caracteres" }` (or the Zod-emitted equivalent)
- AND `products_services` is unchanged

### Requirement: UPDATE is tri-state per field

For each editable field on `updateProductFull`, the system SHALL preserve the current DB value when the field is absent from the form, overwrite when the field is present with a value, and (for fields that support it) clear when the field is present with empty string or null. The pattern is `if (parsed.data.X !== undefined) updateObj.X = parsed.data.X`.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:504-525` (the conditional spread pattern across `titulo`, `descripcion`, `precio`, `ubicacion`, `tipo_entrega`, `estado`, `color`). The general convention is documented in the comment at `:482-486`.

#### Scenario: Edit that only changes precio does not affect other fields

- GIVEN a product with `titulo='Laptop'`, `descripcion='Buena'`, `precio=10000`
- WHEN `updateProductFull` is called with form data containing only `precio=12000` (all other fields omitted)
- THEN the row's `precio` updates to 12000
- AND `titulo` remains `'Laptop'`, `descripcion` remains `'Buena'`

### Requirement: Gallery field always writes on UPDATE (intentional asymmetry)

IF the form includes `galeria_imagenes`, the system SHALL parse and write the value to `products_services.galeria_imagenes` always (an empty array means "remove all photos"). Unlike the tri-state pattern of other fields, the empty-vs-absent distinction does not apply: the form always sends the field, and an empty array is a meaningful "no photos" state, not "leave alone".

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:442-462` (parse + filter) and `:484-487` (always included in `updateObj`). The asymmetry is documented in the comment at `:442-445` ("ASIMETRIA INTENCIONAL").

#### Scenario: Empty gallery payload removes all photos

- GIVEN a product with 3 gallery photos
- WHEN `updateProductFull` is called with `galeria_imagenes='[]'`
- THEN the row's `galeria_imagenes` becomes `[]`
- AND `imagen_principal` becomes `null` (derived from `galeria_imagenes[0]`)

### Requirement: imagen_principal is derived from gallery[0] on UPDATE

WHEN `updateProductFull` builds the update object, the system SHALL set `imagen_principal = galeria_imagenes[0] ?? null`. The seller never sets `imagen_principal` independently of the gallery during edit.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:486`.

#### Scenario: Reordering gallery makes the new first photo the cover

- GIVEN a product with `galeria=[A, B, C]` and `imagen_principal=A`
- WHEN `updateProductFull` is called with `galeria=[B, A, C]`
- THEN `imagen_principal` becomes `B`

### Requirement: Media URLs are validated against the product-media bucket prefix

WHEN `createProduct` or `updateProductFull` receives `imagen_principal` or `galeria_imagenes`, the system SHALL reject any URL that does not start with `${NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-media/`. The check returns `{ error: "URL ... invalida" }` before any DB write.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:193-200` (`PRODUCT_MEDIA_PREFIX` + `isValidProductMediaUrl`) and call sites at `:285, :289, :460, :474`.

#### Scenario: Malicious URL is rejected at the server boundary

- GIVEN a CREATE payload with `galeria_imagenes` including `"https://evil.example.com/avatar.jpg"`
- WHEN `createProduct` validates the URLs
- THEN the action returns `{ error: "Una o mas URLs de la galeria son invalidas" }`
- AND `products_services` is unchanged

### Requirement: Clients upload media directly to the product-media bucket

WHEN the seller selects a file in the product form, the client SHALL upload it directly to the `product-media` Supabase Storage bucket via `supabase.storage.from("product-media").upload(...)`, and SHALL pass the resulting public URL (from `.getPublicUrl(...)`) into the form payload that the server action validates against `isValidProductMediaUrl`.

Anchored at `apps/web/app/(marketplace)/vender/product-form.tsx:347-355` (upload + getPublicUrl) and `:394-395` (thumbnail upload for videos).

#### Scenario: Successful upload returns a valid public URL

- GIVEN the seller selects a JPEG image
- WHEN the form uploads it
- THEN the bucket stores the object and returns a public URL whose prefix matches `PRODUCT_MEDIA_PREFIX`
- AND the form includes that URL in the eventual `galeria_imagenes` field of the form data

### Requirement: product-media bucket has public-read, authenticated-write storage policies

The system SHALL configure the `product-media` Storage bucket with: public SELECT (anyone reads), INSERT requires `auth.uid() IS NOT NULL`, DELETE requires `auth.uid() IS NOT NULL`.

Anchored at `supabase/migrations/20260320000017_storage_buckets.sql:44-54`.

#### Scenario: Anonymous request reads product media

- GIVEN a public URL of an object in `product-media`
- WHEN an anonymous user requests it
- THEN the object is returned (HTTP 200)

#### Scenario: Anonymous upload is rejected

- WHEN an anonymous client attempts to upload to `product-media`
- THEN the storage layer rejects with RLS violation

### Requirement: product-media bucket caps file size and mime types

The `product-media` bucket SHALL enforce a 20 MB per-object size limit and SHALL accept only the mime types: `image/jpeg`, `image/png`, `image/webp`, `video/mp4`, `video/webm`, `video/quicktime`.

Anchored at `supabase/migrations/20260320000017_storage_buckets.sql:4-11`.

#### Scenario: Object above 20 MB is rejected

- GIVEN a client attempts to upload a 25 MB JPEG to `product-media`
- WHEN the storage layer evaluates the request
- THEN the upload is rejected because the object exceeds the bucket `file_size_limit`

#### Scenario: Unsupported mime type is rejected

- GIVEN a client attempts to upload a `.pdf` file to `product-media`
- WHEN the storage layer evaluates the request
- THEN the upload is rejected because `application/pdf` is not in `allowed_mime_types`

### Requirement: gallery_sizes is reset to null on photo removal

IF the UPDATE includes `removed_urls` with at least one entry, the system SHALL set `gallery_sizes = null` in the update object. (Rationale: removing a photo shifts the index of every subsequent surviving photo, breaking the saved `gallery_sizes` array; nulling forces ProductGallery to fall back to its default sizing.)

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:489-502` (with the explanatory comment that cites `ProductGallery.tsx:76-79` and `:145`).

#### Scenario: Edit that removes one photo nulls gallery_sizes

- GIVEN a product with `gallery_sizes = [3, 2, 1]` and 3 gallery photos
- WHEN the seller removes one photo (the form sends `removed_urls` with 1 entry)
- THEN the UPDATE sets `gallery_sizes = null`

#### Scenario: Edit that only adds new photos preserves gallery_sizes

- GIVEN a product with `gallery_sizes = [3, 2, 1]` and 3 gallery photos
- WHEN the seller appends a 4th photo without removing any (the form sends empty `removed_urls`)
- THEN the UPDATE does NOT touch `gallery_sizes`

### Requirement: Media cleanup is best-effort and never aborts the UPDATE

WHEN `updateProductFull` has confirmed a successful UPDATE and `removed_urls` is non-empty, the system SHALL call `cleanupRemovedMedia(supabase, removedUrls)` which deletes the orphaned storage objects (plus derived video thumbnails) on a best-effort basis. IF `storage.remove` returns an error or throws, the helper SHALL capture to Sentry with `tags: {source: "media-cleanup"}` and return `{ok, failed}` without throwing. The surrounding action SHALL NOT abort.

Anchored at `apps/web/lib/media/cleanup.ts:24-69` (helper) and `apps/web/app/(marketplace)/vender/actions.ts:616` (call site without try/catch).

#### Scenario: Storage delete fails but UPDATE succeeded

- GIVEN `updateProductFull` updated the row successfully
- AND `cleanupRemovedMedia` returns `{ok: 0, failed: 3}` due to a transient storage error
- WHEN the action returns
- THEN `revalidatePath("/seller/listings")` is called
- AND the seller is redirected to `/seller/listings` (the orphan files become reconciliation debt, not a user-visible error)

### Requirement: Slug is auto-generated by a BEFORE INSERT trigger

WHEN a row is INSERTed into `products_services` without a slug (or with empty slug), the trigger `set_product_slug` SHALL compute a slug from the `titulo` (lowercased, ASCII-folded, non-alphanumerics replaced with hyphens) and append a 6-character random suffix from `gen_random_uuid()`.

Anchored at `supabase/migrations/20260320000004_products_services.sql:38-64` (`generate_product_slug()` function + `set_product_slug` trigger).

#### Scenario: New product gets a slug like laptop-dell-xps-15-a1b2c3

- GIVEN a CREATE with `titulo = "Laptop Dell XPS 15"`
- WHEN the INSERT runs
- THEN the trigger sets `slug` to a string matching the regex `^laptop-dell-xps-15-[a-z0-9]{6}$`

### Requirement: Slug is UNIQUE and invariant after creation

The `products_services.slug` column SHALL be `UNIQUE`. WHEN `updateProductFull` updates a product, the system SHALL NOT include `slug` in the update object, so the slug is invariant after creation. This preserves shared links (WhatsApp, email, social media) even when the seller changes titulo, categoria, or any other field.

Anchored at `supabase/migrations/20260320000004_products_services.sql:9` (`slug TEXT UNIQUE`) and the absence of `slug` in `updateProductFull`'s `updateObj` (verified by grep of `actions.ts`). The tradeoff is documented in `CLAUDE.md` section "Limitaciones conocidas".

#### Scenario: Editing titulo does not change slug

- GIVEN a product with `slug = "laptop-dell-xps-15-a1b2c3"` and `titulo = "Laptop Dell XPS 15"`
- WHEN the seller edits `titulo` to `"Laptop Dell XPS 15 - Excelente Estado"`
- THEN the row's `slug` remains `"laptop-dell-xps-15-a1b2c3"`

### Requirement: Newly published products start with estatus disponible

WHEN `createProduct` INSERTs a new row, the system SHALL set `estatus = 'disponible'` regardless of any form input.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:303`.

#### Scenario: CREATE always sets estatus disponible

- GIVEN a CREATE form payload (any valid input)
- WHEN `createProduct` builds the INSERT object
- THEN the INSERTed row has `estatus = 'disponible'`
- AND the value is hardcoded, not driven by form input

### Requirement: Pause and resume via toggleProductStatus

The system SHALL expose `toggleProductStatus(id, newStatus)` where `newStatus` is `'disponible'` or `'pausado'`. The action SHALL UPDATE the row with `.eq("id", id).eq("creador_id", user.id)` (ownership defense in depth) and call `revalidatePath("/seller/listings")` before returning `{success: true}`.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:650-681`.

#### Scenario: Pausing a product hides it from public listings

- GIVEN a product P owned by seller S with `estatus = 'disponible'`
- WHEN S calls `toggleProductStatus(P.id, 'pausado')`
- THEN `products_services.estatus` for P becomes `'pausado'`
- AND `/seller/listings` is revalidated
- AND public listing surfaces no longer include P (RLS SELECT policy filters by `estatus = 'disponible'`)

### Requirement: Delete is soft (estatus eliminado)

WHEN `deleteProduct(id)` is called, the system SHALL UPDATE the row to `estatus = 'eliminado'` filtered by `.eq("id", id).eq("creador_id", user.id)`. The row is NEVER physically deleted from `products_services`. This preserves foreign-key relationships (sale_confirmations, reviews, chat messages) that may reference the product.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:623-648`.

#### Scenario: Deleted product disappears from listings but row persists

- GIVEN a product P owned by seller S
- WHEN S calls `deleteProduct(P.id)`
- THEN `products_services.estatus` for P becomes `'eliminado'`
- AND P does not appear in any public listing
- AND queries that JOIN sale_confirmations or reviews still find P's row when needed

### Requirement: estado field applies only to productos

WHERE `tipo === 'producto'` AND the form sends a non-empty `estado` value, the system SHALL persist `estado` on CREATE. WHERE `tipo === 'servicio'`, the system SHALL leave `estado` null.

For UPDATE, the system SHALL update `estado` only when the form sends a non-null value (`parsed.data.estado !== undefined && parsed.data.estado !== null`).

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:305-308` (CREATE conditional spread) and `:515-517` (UPDATE guard).

#### Scenario: Servicio CREATE never sets estado

- GIVEN a CREATE with `tipo = 'servicio'` and `estado = 'nuevo'` somehow in the payload
- WHEN `createProduct` runs
- THEN the INSERTed row has `estado = null` (the conditional spread excludes the field)

### Requirement: color field is tri-state and applies only to productos

The system SHALL accept the `color` field only from the edit form of products with `tipo === 'producto'`. The handling SHALL be tri-state: absent (preserve current DB value), present with empty string (clear to null via the parser at `actions.ts:411-413`), present with a value (overwrite). For `tipo === 'servicio'`, the form does not render the field, so `color` is left untouched.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:410-414` (parse: empty string -> null) and `:521-525` (UPDATE: `parsed.data.color !== undefined`).

#### Scenario: Clearing color sets it to null

- GIVEN a product with `color = 'rojo'`
- WHEN `updateProductFull` is called with `color = ''` (empty string)
- THEN the row's `color` becomes `null`

### Requirement: ubicacion_geo is only set when both lat and lng are truthy

The system SHALL set `ubicacion_geo = 'SRID=4326;POINT(<lng> <lat>)'` only when both `ubicacion_lat` and `ubicacion_lng` form values evaluate truthy. WHEN one is zero or missing, the field is left untouched on UPDATE (preserves existing) or null on CREATE.

Rationale documented in code: in edit mode the map widget starts at 0,0; "no touch" means "preserve existing geo". A real coordinate exactly at 0,0 (Greenwich meridian, equator) is "extremely unlikely" for VICINO (Mexico).

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:317-321` (CREATE) and `:557-559` (UPDATE) with explanatory comment.

#### Scenario: Edit without touching map preserves existing geo

- GIVEN a product with `ubicacion_geo = POINT(-99.13 19.43)` (Mexico City)
- WHEN the seller edits the product without interacting with the map widget (lat=0, lng=0 in the form payload)
- THEN `ubicacion_geo` remains `POINT(-99.13 19.43)`

### Requirement: Ownership is enforced by defense-in-depth filter plus RLS

WHEN `updateProductFull`, `deleteProduct`, or `toggleProductStatus` writes to `products_services`, the system SHALL include `.eq("creador_id", user.id)` in the query as defense in depth. The RLS policy `Sellers can update own products` (`USING (auth.uid() = creador_id) WITH CHECK (auth.uid() = creador_id)`) is the primary guard; the explicit filter is the backup.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:570-571` (UPDATE), `:640-641` (delete), `:667-668` (toggle), and `supabase/migrations/20260320000004_products_services.sql:93-100` (RLS policies).

#### Scenario: Attacker UPDATE on another seller's product is rejected

- GIVEN seller A is authenticated and product P is owned by seller B
- WHEN A calls `updateProductFull(P.id, ...)`
- THEN the UPDATE matches zero rows (the `.eq("creador_id", user.id)` filter excludes P)
- AND `.maybeSingle()` returns `null`
- AND the action returns `{ error: "Esta publicacion ya no existe." }`

### Requirement: UPDATE refuses to edit soft-deleted products

The system SHALL include `.neq("estatus", "eliminado")` in `updateProductFull`'s query so a soft-deleted product cannot be re-edited (even by its owner).

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:572`.

#### Scenario: Owner cannot edit a soft-deleted product

- GIVEN seller S owns product P and previously called `deleteProduct(P.id)` (so `estatus = 'eliminado'`)
- WHEN S calls `updateProductFull(P.id, ...)`
- THEN the UPDATE matches zero rows (the `.neq("estatus", "eliminado")` filter excludes P)
- AND the action returns `{ error: "Esta publicacion ya no existe." }`

### Requirement: UPDATE detects race with delete via maybeSingle

WHEN `updateProductFull`'s UPDATE statement matches zero rows (because the product was deleted between read and write, or never existed for this seller), the system SHALL detect this via `.select("id, tipo, categoria").maybeSingle()` returning `null` and SHALL return `{ error: "Esta publicacion ya no existe." }`.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:573-589`.

#### Scenario: Race with delete returns friendly message

- GIVEN seller S has the edit form open for product P
- AND between S submitting the form and the UPDATE running, P was soft-deleted (or transferred ownership, or never existed)
- WHEN the UPDATE runs
- THEN `.maybeSingle()` returns `null`
- AND the action returns `{ error: "Esta publicacion ya no existe." }` (not a raw Postgres or RLS error)

### Requirement: RLS denial is mapped to a friendly error message

IF a Supabase write returns Postgres error code `42501` (insufficient privilege / RLS violation), the system SHALL return `{ error: "No tienes permiso para editar esta publicacion." }` instead of leaking the raw error.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:577-579`.

#### Scenario: 42501 is translated to friendly Spanish error

- GIVEN a write that triggers a Postgres `42501` error (RLS violation)
- WHEN `updateProductFull` evaluates `updateErr.code`
- THEN the action returns `{ error: "No tienes permiso para editar esta publicacion." }`
- AND no Postgres internals leak to the client

### Requirement: Categories handling delegates to the categories domain

The selling actions SHALL handle product-category writes via the patterns defined in `openspec/specs/categories/spec.md`, specifically:

- "categoria TEXT is written once on CREATE only" (categories spec)
- "UPDATE never modifies categoria TEXT" (categories spec)
- "Pivot is dual-written on every CREATE" (categories spec)
- "Pivot is replaced on UPDATE only when categories is present" (categories spec)
- "Pivot sync failures do not abort the user flow" (categories spec)

This spec does not restate those Requirements. Refer to the categories spec for scenarios and anchors.

#### Scenario: Selling actions invoke the categories sync helper

- GIVEN `createProduct` is called with valid categories
- WHEN it finishes the INSERT to `products_services`
- THEN it calls `syncProductCategoriesForProduct(supabase, {productId, categories, mode: "create"})` as defined by the categories spec
- AND any further behavior of that helper is governed by `openspec/specs/categories/spec.md`, not by this spec

### Requirement: Post-CREATE redirect uses local primary slug, not the INSERT RETURNING

WHEN `createProduct` completes successfully, the system SHALL redirect to `/${primaryCategoria}/${data.slug}` where `primaryCategoria` is the local variable computed from the validated input (not `data.categoria` from the INSERT RETURNING). This is intentional: when Fase 2 drops the `categoria` TEXT column, `data.categoria` will be null but `primaryCategoria` is still the correct slug in memory.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:351-355` with the explanatory comment.

#### Scenario: Successful CREATE redirects to canonical primary path

- GIVEN a CREATE with categories `[{slug:'tecnologia', is_primary:true}]` succeeds
- AND the INSERT returns `{slug: 'laptop-dell-xps-15-a1b2c3'}`
- WHEN the action runs the redirect
- THEN the redirect target is `/tecnologia/laptop-dell-xps-15-a1b2c3`
- AND it uses `primaryCategoria` (the in-memory slug), not `data.categoria` from the RETURNING

### Requirement: Post-UPDATE revalidates seller listings and redirects there

WHEN `updateProductFull` completes successfully, the system SHALL call `revalidatePath("/seller/listings")` and then `redirect("/seller/listings")`.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:619-621`.

#### Scenario: Successful UPDATE redirects to /seller/listings

- GIVEN `updateProductFull` has succeeded and post-update cleanup (media + categories sync) ran
- WHEN the action returns
- THEN `revalidatePath("/seller/listings")` is called
- AND the response redirects the seller to `/seller/listings`

### Requirement: Post-toggle revalidates without redirect

WHEN `toggleProductStatus` completes successfully, the system SHALL call `revalidatePath("/seller/listings")` and return `{success: true}` (no redirect because the optimistic flip happens client-side in `seller/listings` UI).

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:677-680`.

#### Scenario: Successful toggle does not redirect

- GIVEN `toggleProductStatus` UPDATE succeeded
- WHEN the action returns
- THEN `revalidatePath("/seller/listings")` is called
- AND the return value is `{ success: true }`
- AND no `redirect(...)` is called (so the client-side caller can do its optimistic UI flip)

## Historical Notes (not requirements)

### `tipo` (producto/servicio) immutability is form-side, not server-side

The comment at `apps/web/app/(marketplace)/vender/actions.ts:372-374` declares `tipo is intentionally omitted` from the edit flow, and the edit form does not render a `tipo` field. However, `updateProductSchema = createProductSchema.partial()` technically accepts `tipo` if a future caller (admin tool, custom RPC) included it. The current enforcement is "the form does not send it" rather than "the server rejects it". Hardening would be `updateProductSchema = createProductSchema.partial().omit({tipo: true})` or an explicit server check.

Not formalized as a Requirement because the server does not enforce the invariant; documenting it as a Requirement would assert a guarantee the code does not back.

### Warning UI on /vender for non-seller profiles is not enforced server-side

The `/vender` page (`apps/web/app/(marketplace)/vender/page.tsx:47-63`) displays a warning banner when the authenticated user's `profile.es_vendedor` is false, encouraging them to activate seller mode in `/perfil`. However, `createProduct` does NOT check `es_vendedor` and will accept the form submission regardless. The current behavior is UX-as-nudge, not enforcement.

If this becomes a real abuse vector, hardening options include: (a) add a `.eq("es_vendedor", true)` precondition in `createProduct`, (b) add an RLS predicate on `products_services` INSERT that joins to `profiles`. Both are out of scope for the current spec.

Not formalized as a Requirement because the server does not enforce the gate; documenting it as a Requirement would assert a guarantee the code does not back.

### Fields out of scope for this spec (covered elsewhere or future)

- **Form UI details** (DnD reorder of photos via `@dnd-kit`, video thumbnail generation, image cropper, multi-step layout, dynamic delivery option filtering by tipo): pertinent to a `selling-form-ui` spec (future).
- **`/seller/listings` view** (the seller's own product dashboard): a `seller-dashboard` spec (future).
- **`/vender/[id]/editar` data prep** (how the form is seeded from the existing row + pivot fallback): partially covered in the categories spec; rest pertains to `selling-form-ui`.
- **Trust points and sale_confirmations / chat triggers off a product**: separate domains.
- **`vistas_count` and `favoritos_count` denormalized counters**: discovery / favorites domains.
- **`sort_order` column** (migration `20260530000001_product_sort_order.sql`): not written by `createProduct`/`updateProductFull`. Belongs to a separate seller-dashboard reorder feature.
