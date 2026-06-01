# Categories — Current State

Reverse-engineered from the codebase as of commit `bdddac4` (rama `feat/openspec-2026-06-bootstrap`). Captures the canonical behavior of the categories domain after the MP#08 #4 migration (Fase 1A reader migration, Fase 1B route + canonical link, Fase 1C writer-stop, MP#08 #9 review links).

Every Requirement below is anchored to a real file:line in the repo; no behavior is asserted that cannot be pointed at code.

## Purpose

VICINO is a multi-category marketplace. Products can belong to 1 to 3 categories, with exactly one designated "primary" that drives URLs, breadcrumbs, search ranking, and card badges. The category model evolved from a single `categoria TEXT NOT NULL` column on `products_services` (initial schema, 2026-03-20) to a dedicated `product_categories` pivot with `is_primary` and a 3-row cap (MP#08 #5c-1, 2026-05-29). The pivot is now the canonical store; the legacy TEXT column remains live but frozen post-Fase 1C writer-stop.

## Glossary

- **Pivot** — the `product_categories(product_id, categoria_id, is_primary, created_at)` table.
- **TEXT mirror** — `products_services.categoria TEXT NOT NULL`, the legacy single-category column. Written once on INSERT, never updated. Scheduled for DROP in Fase 2.
- **Primary** — the unique pivot row per product with `is_primary = true`.
- **Secondaries** — pivot rows with `is_primary = false` (0..2 per product).
- **Canonical slug** — one of the 24 active slugs in `public.categories` (post-migration `20260411000001_expand_categories.sql`).
- **Camino X** — the decision (Fase 1C, D1C-A) to keep writing `categoria` TEXT once on INSERT (placeholder for NOT NULL) instead of `ALTER COLUMN DROP NOT NULL`. The column is dropped in Fase 2.
- **Embed** — the PostgREST nested query `product_categories(is_primary, categories(slug, nombre))` that callers attach to their `.from("products_services").select(...)`.

## Requirements

### Requirement: Pivot table is the canonical store of category assignments

The system SHALL store product-category assignments in `public.product_categories` with composite PK `(product_id, categoria_id)`, foreign keys CASCADE on product deletion and RESTRICT on category deletion, and column `is_primary BOOLEAN NOT NULL DEFAULT false`.

Anchored at `supabase/migrations/20260529000001_product_categories_pivot_and_backfill.sql:44-49` (table DDL) and `20260530000002_pivot_is_primary_and_max3.sql:55-56` (is_primary column).

#### Scenario: Inserting a row honors the FKs and default

- GIVEN a `product_id` that exists in `products_services` and a `categoria_id` that exists in `public.categories`
- WHEN a row is inserted with those IDs and an `is_primary` value
- THEN the row persists with `created_at` defaulting to `NOW()`
- AND deleting the product CASCADES the pivot row
- AND deleting the category is RESTRICTed if any pivot row references it

### Requirement: Exactly one primary per product

The system SHALL enforce that for each `product_id`, at most one row has `is_primary = true`, via the partial unique index `product_categories_one_primary`.

Anchored at `supabase/migrations/20260530000002_pivot_is_primary_and_max3.sql:62-63`.

#### Scenario: Second primary insert is rejected

- GIVEN product P has one pivot row with `is_primary = true`
- WHEN a second pivot row for P is inserted with `is_primary = true`
- THEN the INSERT fails with a unique-constraint violation

### Requirement: At most 3 categories per product

The system SHALL enforce that each `product_id` has at most 3 rows in `product_categories`, via BEFORE INSERT trigger `trg_max_3_categories`.

Anchored at `supabase/migrations/20260530000002_pivot_is_primary_and_max3.sql:70-85`.

#### Scenario: Fourth category insert is rejected

- GIVEN product P has 3 pivot rows
- WHEN a 4th row for P is inserted
- THEN the INSERT fails with the error message `Max 3 categorias por producto (product_id=<uuid>)`

### Requirement: Categories input is validated at the application boundary

WHEN `createProduct` or `updateProductFull` receives a `categories` field, the system SHALL validate it as an array of `{slug: string, is_primary: boolean}` with the following rules:

- min 1 entry (`packages/shared/src/validators/product.ts:57`)
- max 3 entries (`packages/shared/src/validators/product.ts:58`)
- exactly one entry has `is_primary = true` (`packages/shared/src/validators/product.ts:59-62`)
- no duplicate slugs (`packages/shared/src/validators/product.ts:63-66`)
- each `slug` is one of the 35 canonical slugs in `CATEGORIES` (24 visible plus 10 hidden mayoreo subcategories) (`packages/shared/src/validators/product.ts:50-53`)

#### Scenario: Empty array is rejected

- WHEN `categories: []` is submitted
- THEN validation fails with `Selecciona al menos una categoria`

#### Scenario: Four categories is rejected

- WHEN `categories` has 4 entries
- THEN validation fails with `Maximo 3 categorias por producto`

#### Scenario: Zero primaries is rejected

- WHEN no entry has `is_primary = true`
- THEN validation fails with `Debe haber exactamente una categoria principal`

#### Scenario: Two primaries is rejected

- WHEN two entries have `is_primary = true`
- THEN validation fails with `Debe haber exactamente una categoria principal`

#### Scenario: Duplicate slugs are rejected

- WHEN two entries share the same slug
- THEN validation fails with `No puedes repetir la misma categoria`

#### Scenario: Unknown slug is rejected

- WHEN any entry's `slug` is not in `CATEGORIES`
- THEN validation fails with `Categoria no valida`

### Requirement: categoria TEXT is written once on CREATE only

WHEN a new product is INSERTed via `createProduct`, the system SHALL set `products_services.categoria = <primary slug>` to satisfy the `NOT NULL` constraint on the column.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:300` (the INSERT field) and `supabase/migrations/20260320000004_products_services.sql:12` (the NOT NULL declaration).

#### Scenario: New product CREATE writes the placeholder

- GIVEN `createProduct` receives `categories: [{slug:'tecnologia', is_primary:true}, {slug:'hogar', is_primary:false}]`
- WHEN the INSERT to `products_services` runs
- THEN `products_services.categoria = 'tecnologia'` is persisted
- AND `products_services.categoria` is never NULL

### Requirement: UPDATE never modifies categoria TEXT

IF the seller subsequently edits a product via `updateProductFull`, THEN the system SHALL NOT modify `products_services.categoria`. The column remains at its CREATE value indefinitely (Camino X, Fase 1C writer-stop).

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:504-512` (the block that previously set `updateObj.categoria` is removed; the comment cites Fase 1C explicitly).

#### Scenario: TEXT mirror stays frozen across primary changes

- GIVEN a product was created with primary `tecnologia` and `products_services.categoria = 'tecnologia'`
- WHEN the seller edits the product changing the primary to `hogar`
- THEN `products_services.categoria` still equals `'tecnologia'` after the UPDATE
- AND `product_categories` reflects the new primary `'hogar'`

### Requirement: Pivot is dual-written on every CREATE

WHEN a maintainer publishes a new product via `createProduct`, the system SHALL call `syncProductCategoriesForProduct(supabase, {productId, categories, mode: "create"})` which inserts N rows (1..3) into the pivot, primary row first (to satisfy the partial unique index against an empty state).

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:25-122` (the helper) and `:345` (the call inside `createProduct`).

#### Scenario: Three-category product creates three pivot rows

- GIVEN `createProduct` receives `categories: [{slug:'a', is_primary:true}, {slug:'b', is_primary:false}, {slug:'c', is_primary:false}]`
- WHEN the action completes successfully
- THEN `product_categories` has exactly 3 rows for that product
- AND exactly one row has `is_primary = true`
- AND the rows were inserted primary-first (the helper sorts by `Number(b.is_primary) - Number(a.is_primary)` before INSERT)

### Requirement: Pivot is replaced on UPDATE only when categories is present (tri-state)

WHEN `updateProductFull` receives a `categories` field in its form input, the system SHALL call `syncProductCategoriesForProduct(supabase, {productId, categories, mode: "update"})` which DELETEs all pivot rows for the product and then INSERTs the new set (primary first).

WHEN `updateProductFull` does NOT receive `categories` (field absent from the form), the system SHALL leave the pivot untouched.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:608` (the call inside `if (parsed.data.categories !== undefined)`).

#### Scenario: Update without categories preserves pivot

- GIVEN product P has 2 pivot rows
- WHEN `updateProductFull` is called with `categories` absent from the form (only titulo + precio change, for example)
- THEN `product_categories` for P remains unchanged
- AND `products_services.categoria` (frozen) remains unchanged

#### Scenario: Update with new categories replaces the whole set

- GIVEN product P has pivot rows `[{slug:'tecnologia', is_primary:true}, {slug:'hogar', is_primary:false}]`
- WHEN `updateProductFull` receives `categories: [{slug:'hogar', is_primary:true}]`
- THEN after the call, product P has exactly 1 pivot row: `{slug:'hogar', is_primary:true}`

### Requirement: Pivot sync failures do not abort the user flow

IF any step of `syncProductCategoriesForProduct` fails (delete error, category slug lookup error, insert error, orphan slug detection), THEN the system SHALL capture the failure to Sentry with `tags: {action: "syncProductCategories", step: <step>}` AND continue. The surrounding `createProduct` or `updateProductFull` SHALL return success because `categoria` TEXT placeholder is already saved for CREATE, and the prior state is preserved for UPDATE.

Anchored at `apps/web/app/(marketplace)/vender/actions.ts:25-122` (every error branch calls `Sentry.captureException(...)` or `Sentry.captureMessage(...)` and `return`s without throwing).

#### Scenario: Insert error is captured but createProduct succeeds

- GIVEN a transient RLS or network error causes the pivot INSERT to fail
- WHEN `createProduct` completes
- THEN `products_services` has the new row (with `categoria` TEXT placeholder)
- AND `product_categories` has 0 rows for that product
- AND a Sentry exception is recorded with `tags: {action: "syncProductCategories", step: "insert", mode: "create"}`
- AND the user is redirected to the product detail page normally (the empty pivot is handled by the fallback path in the detail page)

### Requirement: normalizeCardCategories returns a primary-first array

The system SHALL expose `normalizeCardCategories(embed: unknown): ProductCardCategory[]` that accepts the PostgREST embed shape `product_categories(is_primary, categories(slug, nombre))`, filters malformed rows (null `categories`, missing `slug` or `nombre`, wrong types) silently, and returns the survivors sorted primary-first (single primary first, secondaries in insertion order).

Anchored at `packages/shared/src/utils/category.ts:38-62`.

#### Scenario: Malformed rows are dropped silently

- GIVEN an embed array `[{is_primary: true, categories: null}, {is_primary: false, categories: {slug:'a', nombre:'A'}}]`
- WHEN `normalizeCardCategories` is called
- THEN the first row is dropped (null `categories`)
- AND the result is `[{slug:'a', nombre:'A', is_primary:false}]`

### Requirement: primaryCategorySlug returns primary slug or null

The system SHALL expose `primaryCategorySlug(embed: unknown): string | null` that returns the slug of the primary category if one exists, else null.

Anchored at `packages/shared/src/utils/category.ts:77-82`.

#### Scenario: Embed with one primary returns its slug

- GIVEN `embed = [{is_primary: true, categories: {slug: 'hogar', nombre: 'Hogar'}}]`
- WHEN `primaryCategorySlug(embed)` is called
- THEN the result is `'hogar'`

#### Scenario: Embed with no primary returns null

- GIVEN `embed = [{is_primary: false, categories: {slug: 'a', nombre: 'A'}}]`
- WHEN `primaryCategorySlug(embed)` is called
- THEN the result is `null`

#### Scenario: Undefined embed returns null

- GIVEN `embed = undefined`
- WHEN `primaryCategorySlug(embed)` is called
- THEN the result is `null`

### Requirement: primaryCategoryFull returns primary slug and nombre or null

The system SHALL expose `primaryCategoryFull(embed: unknown): {slug: string, nombre: string} | null` that returns both the slug and the display label of the primary category if one exists, else null.

Anchored at `packages/shared/src/utils/category.ts:84-90`.

#### Scenario: Embed with one primary returns its slug and nombre

- GIVEN `embed = [{is_primary: true, categories: {slug: 'hogar', nombre: 'Hogar'}}]`
- WHEN `primaryCategoryFull(embed)` is called
- THEN the result is `{slug: 'hogar', nombre: 'Hogar'}`

#### Scenario: Embed with no primary returns null

- GIVEN `embed = [{is_primary: false, categories: {slug: 'a', nombre: 'A'}}]`
- WHEN `primaryCategoryFull(embed)` is called
- THEN the result is `null`

### Requirement: Product cards derive href segment from pivot primary

WHEN `ProductCard` renders, the system SHALL derive the href category segment from `categories[0]?.slug` (primary of the pivot, since `categories` is pre-sorted primary-first by `normalizeCardCategories` in the caller) if `categories` is non-empty, falling back to the `categoria` prop (TEXT mirror) otherwise.

Anchored at `apps/web/components/product/product-card.tsx:84`.

#### Scenario: Card with multi-category product uses primary in href

- GIVEN `ProductCard` receives `categories: [{slug:'tecnologia', is_primary:true}, {slug:'hogar', is_primary:false}]` and `slug='laptop-x'` and `categoria='tecnologia'`
- WHEN the card renders
- THEN the href equals `/tecnologia/laptop-x`

#### Scenario: Card without embed falls back to TEXT mirror

- GIVEN `ProductCard` receives `categories: []` and `categoria='hogar'` and `slug='cama-y'`
- WHEN the card renders
- THEN the href equals `/hogar/cama-y` (the TEXT fallback fires)

### Requirement: Cards show a plus-N pill for products with secondary categories

WHERE the `categories` prop has more than one entry, `ProductCard` SHALL display a "+N" indicator next to the primary `CategoryBadge`, where N equals the count of secondary categories.

Anchored at `apps/web/components/product/product-card.tsx:166-175`.

#### Scenario: Three-category product shows +2

- GIVEN `ProductCard` receives `categories` with 1 primary plus 2 secondaries
- WHEN the card renders
- THEN the primary CategoryBadge is shown
- AND a small "+2" label is shown next to it

### Requirement: Search by category ranks primary matches above secondary

WHEN a user navigates to `/buscar?category=<slug>`, the system SHALL partition results into two tiers:

- products whose primary category matches the filter (sourced as `primaryIds`)
- products whose secondary category matches the filter (the rest of the matched set)

The system SHALL sort each tier independently by `params.sort` (price asc/desc, most_sold, or recency) and concatenate primary-first before paginating.

Anchored at `apps/web/app/(marketplace)/buscar/page.tsx:85` (`primaryIds` declaration), `:115` (assignment from the pivot query), `:124` (merge with `secondaryIds` to drive the `.in(orderedIds)` filter), and `:196-216` (the partition, sort, concatenate, paginate block).

#### Scenario: A product whose secondary category matches appears after a product whose primary matches

- GIVEN product X has primary 'tecnologia' and product Y has secondary 'tecnologia'
- AND both pass the other filters of the search
- WHEN the user navigates `/buscar?category=tecnologia&sort=most_sold` (or any sort)
- THEN X appears before Y in the result list, regardless of sort criterion

### Requirement: Detail page resolves by slug only

WHEN a user navigates `/[categoria]/[slug]`, the system SHALL resolve the product by `slug` only, ignoring the `[categoria]` URL segment. Both the `generateMetadata` lookup and the default export's data fetch use `.eq("slug", slug)` and never read `params.categoria`.

Anchored at `apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx:37` (generateMetadata fetch) and `:82` (default export fetch).

#### Scenario: Same slug under different categoria paths resolves to the same product

- GIVEN a product with `slug = 'laptop-x'` whose pivot primary is `'hogar'`
- WHEN a user navigates `/hogar/laptop-x`
- THEN the fetched product matches `slug = 'laptop-x'`
- WHEN the same user navigates `/tecnologia/laptop-x` (a stale path)
- THEN the fetched product is the same row, identified by `slug` only

#### Scenario: Fetch ignores params.categoria

- GIVEN any URL `/<anything>/<slug>`
- WHEN the page fetches `products_services`
- THEN the filter applied is `.eq("slug", slug)`
- AND no filter or condition references `params.categoria`

### Requirement: Detail page emits canonical and og:url pointing to the current primary

WHEN a user navigates `/[categoria]/[slug]`, the system SHALL compute `canonical = ${SITE_URL}/${primaryCategorySlug(pivot) ?? products_services.categoria}/${slug}` and emit it as both `<link rel="canonical">` and `<meta property="og:url">`.

`SITE_URL` is `process.env.NEXT_PUBLIC_SITE_URL` with a hardcoded fallback to `"https://vicinomarket.com"` so the canonical never renders as `https://undefined/...` in production.

Anchored at `apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx:23` (SITE_URL), `:42-46` (computation), `:51` (canonical), `:52-57` (openGraph.url).

#### Scenario: Canonical reflects current pivot primary even on stale URL paths

- GIVEN a product whose primary was once 'tecnologia' but is now 'hogar'
- WHEN a user opens the detail page (via any URL path)
- THEN `<link rel="canonical">` points to `https://vicinomarket.com/hogar/<slug>`

### Requirement: Legacy URLs with stale category segments still resolve

WHEN a user opens a legacy URL whose `[categoria]` segment no longer matches the product's current primary (typically a link shared before the seller changed the primary), the system SHALL still resolve the product and render the detail page successfully (HTTP 200).

This behavior is emergent from the slug-only fetch requirement above. It is a load-bearing promise of the system: shared links (WhatsApp, email, social media) must not break when a seller changes the primary category. Any future refactor that makes the fetch depend on `params.categoria` SHALL preserve this guarantee, or the project SHALL ship a 308 redirect handler from the stale path to the current primary before the change lands.

Anchored at `apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx:37` and `:82` (slug-only fetch is the mechanism); `:194-197` (breadcrumb href and label both read from the pivot, not from `params.categoria`).

#### Scenario: Old shared link with stale categoria still works

- GIVEN a product whose primary was once 'tecnologia' but is now 'hogar'
- AND a legacy WhatsApp link `/tecnologia/<slug>` from before the change
- WHEN a user opens that legacy link
- THEN the page returns HTTP 200
- AND the breadcrumb reads "Hogar" (current primary, from `primaryCategoryFull(pivot)`)
- AND `<link rel="canonical">` points to `/hogar/<slug>` (not the URL path)

### Requirement: Empty pivot falls back to TEXT mirror and emits Sentry warning

IF a product's pivot rows are empty (no row at all, or no row with `is_primary = true`), THEN the system SHALL:

- fall back to `products_services.categoria` (TEXT mirror) for the breadcrumb label, the card badge, and the href segment
- capture a Sentry warning with `tags: {action: "productDetailPage", step: "pivot_primary_fallback"}` so drift is observable

Anchored at `apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx:153` (the `primaryCat = primaryCategoryFull(...)` call), `:161` (the Sentry tag), `:168` (`categoryName = primaryCat?.nombre ?? null`), `:197` (the breadcrumb label fallback `categoryName ?? product.categoria.replaceAll("-", " ")`).

#### Scenario: Product with empty pivot still renders with TEXT fallback

- GIVEN a product whose `product_categories` rows are empty (improbable post-backfill but defensively handled)
- WHEN the detail page renders
- THEN the breadcrumb label uses `products_services.categoria` (with hyphens replaced by spaces)
- AND a Sentry warning is recorded with the `pivot_primary_fallback` step tag

### Requirement: ReviewProductLink derives href from pivot primary

WHEN `ReviewProductLink` renders with a `product` prop, the system SHALL compute `hrefSlug = primaryCategorySlug(product.product_categories) ?? product.categoria` and set the link's `href` to `/${hrefSlug}/${product.slug}`.

The 4 callers that fetch reviews (`apps/web/app/(marketplace)/perfil/page.tsx`, `apps/web/app/(marketplace)/vendedor/[id]/page.tsx`, `apps/web/app/seller/reviews/page.tsx`, `apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx`) each include the embed `product_categories(is_primary, categories(slug))` in their reviews SELECT, so the TEXT fallback should not fire in normal operation; firing it indicates a regression.

Anchored at `apps/web/components/shared/review-product-link.tsx:36` (`hrefSlug` computation) and `:39` (the href).

#### Scenario: Review link uses current primary, not the frozen TEXT

- GIVEN a product whose primary was 'tecnologia' at CREATE and is 'hogar' now (TEXT frozen at 'tecnologia')
- AND a review exists for that product
- WHEN ReviewProductLink renders for that review (in any of the 4 surfaces)
- THEN the link's href is `/hogar/<slug>`, not `/tecnologia/<slug>`

### Requirement: nearby_products RPC still reads frozen categoria TEXT (legacy)

The `nearby_products(user_lat, user_lng, radius_meters, category_filter, result_limit)` RPC SHALL return `categoria` from `products_services.categoria` (TEXT) and filter on `ps.categoria = category_filter` when `category_filter` is non-null.

Post Fase 1C writer-stop, this means the RPC returns and filters on the stale frozen TEXT for products edited after their CREATE. A product whose primary changed from 'tecnologia' to 'hogar' will still surface under `category_filter='tecnologia'` and will NOT surface under `category_filter='hogar'` via this RPC.

This is a known limitation scheduled for rewrite in Fase 2 (post-DROP of `categoria` TEXT).

Anchored at `supabase/migrations/20260515000001_fuzz_nearby_products.sql:29` (RETURN signature includes `categoria TEXT`), `:52` (`SELECT ps.categoria`), and `:77` (`AND (category_filter IS NULL OR ps.categoria = category_filter)`).

#### Scenario: Product edited after CREATE surfaces under its frozen TEXT category, not the current primary

- GIVEN a product P was created with primary `tecnologia` (so `products_services.categoria = 'tecnologia'`)
- AND P's primary was later changed to `hogar` via `updateProductFull` (TEXT is frozen by Fase 1C; pivot reflects `hogar`)
- WHEN a client calls `nearby_products(..., category_filter := 'tecnologia', ...)`
- THEN P is returned (the RPC matches by frozen TEXT)
- WHEN a client calls `nearby_products(..., category_filter := 'hogar', ...)`
- THEN P is NOT returned by the RPC, even though `hogar` is its current primary

#### Scenario: RPC output column reflects the frozen TEXT

- GIVEN the same product P as above
- WHEN the RPC returns P
- THEN the `categoria` column in the result row equals `'tecnologia'` (the frozen TEXT), not `'hogar'`

> **Note (same root cause)** — the generated `search_vector` column on `products_services` (defined at `supabase/migrations/20260320000004_products_services.sql:28-32`) includes `setweight(to_tsvector('spanish', COALESCE(categoria, '')), 'C')`. Because the column is `GENERATED ALWAYS AS ... STORED` and the source `categoria` is frozen post-1C, the tsvector contribution of category for any edited product is also frozen. Full-text search ranking against the category facet is therefore as stale as the RPC. Same root cause; same Fase 2 fix (DROP the column, regenerate the tsvector without it or sourced from the pivot).

### Requirement: Pivot table enforces ownership via Row Level Security

The system SHALL enable Row Level Security on `product_categories` with 4 ownership-aware policies covering SELECT, INSERT, UPDATE, and DELETE. Each policy matches rows whose `product_id` references a `products_services` row whose `creador_id = auth.uid()`.

The SELECT policy additionally permits anonymous users to see pivot rows of `disponible` products, so cards and listings render for non-logged-in visitors.

Anchored at `supabase/migrations/20260529000001_product_categories_pivot_and_backfill.sql:58` (ENABLE ROW LEVEL SECURITY) and `:62-115` (the 4 policies).

#### Scenario: Anon user sees pivot rows of disponible products

- GIVEN an anonymous user (no `auth.uid()`)
- WHEN they fetch `product_categories` joined to a product whose `estatus = 'disponible'`
- THEN they see the pivot rows

#### Scenario: Attacker INSERT against another seller's product is rejected

- GIVEN seller A is authenticated
- WHEN A attempts to INSERT a pivot row for product owned by seller B
- THEN the INSERT fails with `new row violates row-level security policy`

## Historical Notes (not requirements)

### One-time orphan remap (2026-05-29, migration `20260529000004_remap_orphan_categories.sql`)

Four historical products had `categoria` TEXT in display-format (`Electronica` or `Servicios`) instead of canonical slugs, so the backfill of MP#08 #1 Parte 1a skipped them (INNER JOIN on slug found no match). They were one-time remapped to the slug `tecnologia` (the closest real category for monitor, laptop, mechanical keyboard, and PC repair) and their pivot rows were backfilled. The migration is idempotent (the UPDATE matches only `categoria IN ('Electronica','Servicios')`; the INSERT uses `NOT EXISTS`).

This is the ancestor of the current invariant that all seeds and writes must use canonical lowercase slugs (see `supabase/insert_dummy_data.sql` after commit `185f289` for the fix).

### Canonical slug history

The 24 active slugs visible in `public.categories` are defined by `supabase/migrations/20260411000001_expand_categories.sql`, which runs `DELETE FROM categories` and re-INSERTs the canonical set. Pre-existing slugs from the original 12-category schema (`supabase/migrations/20260320000003_categories.sql`) like `servicios-profesionales` no longer exist post-`20260411000001`; that migration also runs `UPDATE products_services SET categoria = 'servicios-hogar' WHERE categoria = 'servicios-profesionales'` to keep existing products consistent.
