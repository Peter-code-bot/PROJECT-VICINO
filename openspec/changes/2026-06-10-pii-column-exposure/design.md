# Design -- CH-6: profiles PII column restriction (#2)

## Approach

`REVOKE SELECT (<pii cols>) ON profiles FROM anon, authenticated`. PostgREST honors column
privileges: a `select=email` (or `select=*`) by a role lacking that column SELECT returns
`42501 permission denied for column`. Public columns are NOT revoked, so the ~20 public reads
(seller pages, search, rankings, chat, joins) keep working with no change.

PII columns: `email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token`.

## Why not is_hidden / user_id

`user_id` (the public 8-char handle, rendered on `vendedor/[id]`) and `is_hidden` (read by admin
moderation) are NOT PII. Revoking them breaks public + admin pages. They stay SELECTable. (If the
live DB revoked them, reconcile -- see proposal RECONCILE.)

## Self access

A `select(*)` or any PII select for the OWNER's own row also fails (column grants are not
row-aware). `get_my_profile()` is SECURITY DEFINER (`LANGUAGE sql`, `WHERE id = auth.uid()`): it
runs as owner (bypasses the column grant) but only ever returns the caller's own row. Same shape
as `select(*)`, so `perfil/page.tsx` and `perfil/editar/page.tsx` swap to `rpc('get_my_profile')`
with minimal change. A `security_invoker=true` view would NOT work (runs with the caller's
privileges -> still 42501).

## Admin access (lesson CH-3: admin PII via guarded RPC, not a public view)

`admin_list_users()` (SETOF profiles) and `admin_get_user(uuid)` are SECURITY DEFINER with an
in-body `has_role(auth.uid(),'admin')` guard. `admin/users/page.tsx` swaps `.from('profiles')`
for `.rpc('admin_list_users')` and applies its `.select/.or/.in/.order/.limit` to the result set
(PostgREST applies them post-function). `admin/verifications/page.tsx` keeps the user-context
embed on public columns and fetches submitter emails via the page's existing service-role client
(`adminSupabase`) -- a batched server-side read that bypasses the column grant on an admin-only
page (the RPC `admin_get_user` is also available for per-row use).

## Coords / fcm_token

- Coords: the product detail join does NOT fetch `ubicacion_lat/lng` (the `sellerLat` prop is
  dead code -> always null). The REVOKE breaks nothing; the distance pill is already inert. A
  fuzzed-distance RPC (mirror of `nearby_products`) is an optional future enhancement.
- fcm_token: only the `send-push` edge function reads it (service role). No client reader.

## Faithfulness

Reconcile the REVOKE set (`information_schema.column_privileges`) and the 3 RPC bodies
(`pg_get_functiondef`) against this mirror; confirm user_id/is_hidden are NOT revoked.
