# Proposal -- CH-3: mass-assignment column locks + sale RPCs (#5/#6/#7)

## Why

Audit findings #5 (CWE-915/639, Crit 9.1), #6 (CWE-362/840/915, Alto 8.1), #7 (CWE-915,
Alto 7.5). `anon` AND `authenticated` had table-wide UPDATE/INSERT on `profiles`,
`products_services`, `reviews`, and `sale_confirmations`, so a direct PostgREST PATCH (bypassing
the app) could mass-assign privileged columns. RLS row-ownership does NOT protect columns.

- **#5 profiles**: a user could set `is_verified`, `trust_points`, `trust_level`, `es_vendedor`,
  `is_hidden`, `average_rating*`, `total_sales`, or read/overwrite `email`, `rfc`,
  `ubicacion_lat/lng`, `fcm_token` -> fake verification, trust inflation, suspension bypass.
- **#6 sale_confirmations**: a participant could set BOTH `buyer_confirmed` AND
  `seller_confirmed` (and `status='completed'`) in one PATCH -> unilaterally complete a sale,
  inflating reputation/rankings and bumping `ventas_count` via the completion trigger.
- **#7 reviews/products**: the reviewed user could flip `visible`/`is_hidden`/`reportada`; a
  product owner could set `ventas_count`/`vistas_count`/`favoritos_count`/`is_hidden`.

## What (applied in Studio, Camino 2, COMMIT; mirrored as migrations)

- **CH-3a (#5)** -- `REVOKE UPDATE ON profiles FROM anon, authenticated`;
  `GRANT UPDATE (foto, fcm_token) TO authenticated`. All other profile writes go through the
  existing `update_profile_and_pause_products` SECURITY DEFINER RPC.
- **CH-3b (#7 products)** -- `REVOKE UPDATE ... FROM anon, authenticated`; `GRANT UPDATE`
  of the owner-editable column allowlist only. New `increment_product_view(uuid)` SECURITY
  DEFINER RPC (GRANT anon, authenticated) owns the `vistas_count` write that the detail page
  used to do directly.
- **CH-3c (#7 reviews)** -- `REVOKE UPDATE ... FROM anon, authenticated`;
  `GRANT UPDATE (respuesta, respuesta_fecha) TO authenticated`.
- **CH-3a-fix** -- 5 stat trigger functions (`check_sale_completion`,
  `handle_sale_cancellation`, `update_profile_trust_level`, `update_separated_ratings`,
  `update_user_rating_on_review`) made `SECURITY DEFINER` + locked `search_path` so their writes
  to the now-revoked stat columns keep working.
- **CH-3d (#6)** -- `confirm_sale(uuid)` and `cancel_sale(uuid, text)` SECURITY DEFINER RPCs
  that derive the actor from `auth.uid()` and touch only that participant's own flag/cancel;
  `REVOKE UPDATE, DELETE, TRUNCATE ON sale_confirmations FROM anon, authenticated` (SELECT +
  INSERT kept).

Migrations: `20260610000004_ch3_stats_triggers_security_definer.sql`,
`20260610000005_ch3_column_locks_and_view_rpc.sql`,
`20260610000006_ch3_sale_confirmation_rpcs.sql`.

App edits (3 call sites that wrote revoked columns directly):
`chat/actions.ts` confirmSale -> `confirm_sale`, cancelSale -> `cancel_sale`;
`[categoria]/[slug]/page.tsx` `vistas_count` UPDATE -> `increment_product_view`.

## Scope

### IN
- Column-level REVOKE/GRANT on the 4 tables; the 3 new RPCs; stat triggers -> DEFINER; the 3
  app call-site migrations; mirror migrations + delta spec.

### OUT
- #9 products INSERT es_vendedor gate -> CH-4. #2 PII column SELECT REVOKE -> separate change.
- #14 has_role -> LAST.

## Caller inventory (no edits needed for these -- already write only allowlisted columns)

profiles: avatar (`foto`), push hook (`fcm_token`). products: createProduct INSERT,
updateProductFull, delete/toggle (`estatus`), order (`sort_order`), gallery
(`galeria_imagenes`/`imagen_principal`/`gallery_sizes`). reviews: respondToReview
(`respuesta`/`respuesta_fecha`). Full inventory: `docs/security/2026-06-10-ch3-mass-assignment-prep.md`.

## Success criteria

1. A direct PATCH setting `profiles.is_verified` (or trust_*/es_vendedor/is_hidden) returns
   42501; `foto`/`fcm_token` self-update still succeeds.
2. A direct PATCH on `sale_confirmations` returns 42501; `confirm_sale` sets only the caller's
   flag; a single call cannot complete a sale; non-participant `confirm_sale`/`cancel_sale` ->
   forbidden.
3. A direct PATCH setting `products.vistas_count`/`is_hidden` returns 42501; the detail page
   view counter still increments via `increment_product_view`.
4. A direct PATCH setting `reviews.visible`/`is_hidden` returns 42501; responding to a review
   still works.
5. Sale completion, rating recompute, and trust-level updates still run (stat triggers DEFINER).
6. `pnpm build` green; no residual direct writes to stats/flags/is_hidden in `apps/web`.
