# Spec -- mass-assignment (delta)

> Domain: column-level write authorization for VICINO's user-mutable tables.
> DELTA spec from change `2026-06-10-mass-assignment-column-locks`. Last updated 2026-06-10.

## Context

Supabase exposes a public PostgREST data plane. RLS gates rows, not columns; a row-ownership
UPDATE policy still lets the owner write every column. Privileged columns therefore need
column-level GRANTs and/or SECURITY DEFINER RPCs.

## Requirement R1 -- privileged columns SHALL NOT be client-writable

WHEN a client (anon or authenticated) issues an UPDATE on `profiles`, `products_services`, or
`reviews`, the database SHALL reject writes to privileged columns and allow only an explicit
safe allowlist. Privileged columns (non-exhaustive): profiles `is_verified`, `verified_at`,
`trust_points`, `trust_level`, `total_sales`, `average_rating*`, `reviews_count*`, `is_hidden`,
`email`, `rfc`, `ubicacion_lat/lng`, `user_id`, `es_vendedor`; products `ventas_count`,
`vistas_count`, `favoritos_count`, `is_hidden`; reviews `visible`, `is_hidden`, `reportada`,
`rating`, `comentario`.

### Scenario: mass-assignment PATCH is rejected
- GIVEN an authenticated user owning a profile row
- WHEN they PATCH `{ is_verified: true, trust_points: 999999 }` directly via PostgREST
- THEN the database returns `42501` and no privileged column is changed

### Scenario: allowlisted self-update still works
- GIVEN the same user
- WHEN they update `foto` or `fcm_token` (profiles), or a product's `titulo`/`precio`, or a
  review's `respuesta`
- THEN the update succeeds

### Scenario: privileged columns remain writable by server logic
- GIVEN a SECURITY DEFINER RPC (e.g. update_profile_and_pause_products) or a SECURITY DEFINER
  stat trigger
- WHEN it writes a privileged column (es_vendedor, total_sales, ventas_count, ...)
- THEN the write succeeds (the definer bypasses the column grant)

## Requirement R2 -- sale confirmation SHALL be per-actor and not unilaterally completable

WHEN a sale is confirmed or cancelled, the actor SHALL be derived from `auth.uid()`, a caller
SHALL only affect their own confirm flag, and direct UPDATE/DELETE on `sale_confirmations` SHALL
be revoked from anon/authenticated. A non-participant SHALL be rejected (`forbidden`).

### Scenario: one party cannot complete a sale alone
- GIVEN a pending sale where neither side has confirmed
- WHEN a participant calls `confirm_sale(id)`
- THEN only that participant's flag is set; the other flag is untouched; status stays pending

### Scenario: direct mutation is blocked
- WHEN any client issues an UPDATE/DELETE on `sale_confirmations` via PostgREST
- THEN it returns `42501` (only SELECT + INSERT remain)

### Scenario: non-participant is rejected
- WHEN a user who is neither buyer nor seller calls `confirm_sale`/`cancel_sale`
- THEN it raises `forbidden`

## Requirement R3 -- the product view counter SHALL be a definer RPC

WHEN the product detail page records a view, it SHALL call `increment_product_view(p_id)`
(SECURITY DEFINER, granted to anon + authenticated), NOT a direct UPDATE of `vistas_count`.

### Scenario: views still count after the column lock
- GIVEN `vistas_count` is no longer client-writable
- WHEN any viewer (anon or authenticated) opens a product detail page
- THEN `increment_product_view` increments the counter

## Implementation notes
- Column allowlists derived from the prep dossier (every direct client write inventoried).
- Stat triggers (check_sale_completion, handle_sale_cancellation, update_profile_trust_level,
  update_separated_ratings, update_user_rating_on_review) must be SECURITY DEFINER and applied
  before the REVOKE.
- Mirror migrations: 20260610000004 / 000005 / 000006.
