# Design -- CH-3: mass-assignment column locks + sale RPCs (#5/#6/#7)

## Principle

RLS gates ROWS, not COLUMNS. A `USING (auth.uid() = id)` UPDATE policy lets the owner write
EVERY column of their own row. To stop mass-assignment you must control columns -- via
column-level GRANTs (PostgreSQL native) and/or SECURITY DEFINER RPCs for per-actor flows.
Triggers are NOT used for this (a BEFORE-UPDATE trigger would also fire on the legitimate
SECURITY DEFINER RPC writes and is harder to reason about) -- see the signed amendment in
`docs/security/2026-06-10-fase0-report.md`.

## Column-grant approach (#5 profiles, #7 products/reviews)

`REVOKE UPDATE ON <table> FROM anon, authenticated;` then
`GRANT UPDATE (<safe cols>) ON <table> TO authenticated;`. PostgREST honors column privileges:
a PATCH touching a non-granted column returns `42501 permission denied for column`. The
allowlists are exactly the columns the app writes directly (inventoried in the prep dossier):

- profiles: `foto, fcm_token` (avatar + push). Profile-form fields go via the DEFINER RPC.
- products_services: `titulo, descripcion, precio, ubicacion, ubicacion_geo, tipo_entrega,
  estado, color, delivery_radius_km, precio_negociable, allow_appointments,
  appointment_start_time/end_time/duration_minutes, galeria_imagenes, imagen_principal,
  gallery_sizes, estatus, sort_order`.
- reviews: `respuesta, respuesta_fecha`.

A SECURITY DEFINER function runs as its owner, so it BYPASSES these column grants -- that is
why `update_profile_and_pause_products` can still write `es_vendedor`, and the stat triggers can
still write `total_sales`/`average_rating*`/`ventas_count` once they are DEFINER.

## Stat-trigger collateral (CH-3a-fix)

Trigger functions run as the INVOKING user by default. After the profiles/products REVOKE, a
trigger fired by an authenticated user that writes a revoked stat column would 42501 and abort
the user's transaction (e.g. completing a sale would fail). Making the 5 stat triggers
`SECURITY DEFINER` (run as owner) restores those writes; locked `search_path` prevents
injection. `ALTER FUNCTION ... SECURITY DEFINER` is idempotent and does not need the body.
**Ordering**: this migration (20260610000004) must precede the REVOKE (20260610000005) on a
fresh replay.

## Per-actor RPCs (#6 sale_confirmations)

A column allowlist does NOT work for sale_confirmations: granting `status` would let a
participant set `status='completed'` directly, and granting the confirm flags would let one
party set BOTH. So `REVOKE UPDATE/DELETE/TRUNCATE` entirely (keep SELECT + INSERT) and route
the two mutating flows through SECURITY DEFINER RPCs:

- `confirm_sale(p_sale_id)`: rejects anon; participant guard; sets ONLY the caller's own flag
  via `CASE WHEN buyer_id = auth.uid() ...`; never touches the other side; the existing
  `check_sale_completion` trigger flips status when both are true. A non-pending sale matches 0
  rows -> no-op (the caller re-reads status to detect completion).
- `cancel_sale(p_sale_id, p_reason)`: rejects anon; participant guard; sets `status='cancelled'`
  + cancel fields only while pending; RETURNS `chat_id` (NULL if no longer pending -> caller
  shows "ya fue modificada").

The app keeps its idempotency pre-read (confirmSale) and the completed-message insert; only the
mutating statement changed.

## increment_product_view

The detail page incremented `vistas_count` directly (any viewer). With the allowlist that
42501s. `increment_product_view(p_id)` SECURITY DEFINER owns the write; granted to
`anon, authenticated` so anonymous views still count. Fire-and-forget from the page.

## CH-3e -- admin moderation collateral + LESSON

The column REVOKE broke a path the prep dossier did not inventory: admin moderation. The
moderation Server Actions (`apps/web/app/admin/moderation/actions.ts`) write the privileged
columns `is_hidden` / `visible` / `reportada` using the ordinary authenticated-role session
client (`requireAdmin`/`requireAdminOrModerator` both return `createClient()` -- there is NO
service-role client and no admin column GRANT). After the REVOKE every moderation write 42501'd,
and `resolveReport`'s hide branch did not check the error -> it returned `success: true` while
nothing happened.

**LESSON (recorded): the caller-write inventory MUST cover ADMIN/MODERATION routes, not only
end-user routes.** Three CH-3 collaterals all stem from omitting admin/privileged paths: the 5
stat triggers (write profiles/products stats), `update_trust_level_from_points` (trust columns),
and the moderation actions. Future prep dossiers must grep admin/* and trigger functions too.

Fix (same RPC philosophy): two SECURITY DEFINER RPCs that re-check `has_role(admin OR moderator)`
in-body and own the moderation writes, bypassing the user column grant:
- `moderate_set_content_hidden(p_target_type, p_target_id, p_hidden)` -- sets `is_hidden` on the
  right table; accepts both vocabularies (listing/product, user/profile, review, message).
- `moderate_review(p_review_id, p_visible, p_clear_reported)` -- sets `reviews.visible` and
  optionally clears `reportada`.
The app routes the 6 moderation writes through them AND surfaces the RPC error (the swallowed-
error bug is fixed). Note: the app gates suspend/review-moderation to admin-only while the RPCs
allow moderator too -- the app gate is the stricter layer; splitting the DB guard by target_type
is a possible defense-in-depth follow-up.

## Faithfulness

The RPC bodies are reconstructed from the applied behavior + the app's prior logic. Reconcile
against `SELECT pg_get_functiondef(oid)` for `confirm_sale`, `cancel_sale`,
`increment_product_view` and confirm the 5 stat triggers show `prosecdef = true`.
