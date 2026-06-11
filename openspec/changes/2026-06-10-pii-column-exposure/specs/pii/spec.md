# Spec -- pii (delta)

> Domain: column-level read authorization for PII on `profiles`.
> DELTA spec from change `2026-06-10-pii-column-exposure`. Last updated 2026-06-10.

## Context

`profiles` mixes public columns (nombre, foto, ratings, es_vendedor, trust_level, user_id
handle, ...) with PII (email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token). RLS gates
rows, not columns; PII must be restricted at the column-grant layer.

## Requirement R1 -- PII columns SHALL NOT be readable by anon/authenticated

WHEN anon or authenticated reads `profiles`, the columns `email`, `telefono`, `rfc`,
`ubicacion_lat`, `ubicacion_lng`, `fcm_token` SHALL NOT be SELECTable (column SELECT revoked);
all other columns (including the public `user_id` handle and `is_hidden`) remain readable.

### Scenario: direct PII read is rejected
- GIVEN an anon or authenticated client
- WHEN it requests `select=email,telefono,rfc,ubicacion_lat,ubicacion_lng,fcm_token` on profiles
- THEN the database returns 42501 and no PII is returned

### Scenario: public columns still readable
- WHEN a client reads `nombre, foto, trust_level, user_id, ubicacion, es_vendedor` (public)
- THEN the read succeeds (public seller pages, search, rankings unaffected)

## Requirement R2 -- the owner SHALL read their own PII via a definer RPC

WHEN a user needs their OWN PII (profile page / edit form), they SHALL obtain it via
`get_my_profile()` (SECURITY DEFINER, `WHERE id = auth.uid()`), not a direct column read.

### Scenario: self gets own email
- GIVEN an authenticated user
- WHEN they call `get_my_profile()`
- THEN they receive their own full profile row including email/telefono/rfc

## Requirement R3 -- admin SHALL read PII via guarded definer RPCs

WHEN admin tooling needs PII (users panel, verification submitter email), it SHALL use
`admin_list_users()` / `admin_get_user(uuid)` (SECURITY DEFINER + `has_role(admin)` guard), or a
service-role server-side read on an admin-only page -- never a public view.

### Scenario: admin lists users with email
- GIVEN an admin
- WHEN the admin users panel loads
- THEN `admin_list_users()` returns profiles incl. email; a non-admin caller is rejected (forbidden)

## Implementation notes
- Mirror migration: `20260610000009_ch6_pii_column_restrict.sql`.
- Do NOT revoke `user_id` (public handle on vendedor/[id]) or `is_hidden` (admin moderation read).
- fcm_token has no client reader (only the send-push edge fn via service role).
- Coords are not exposed by the app today (detail join does not fetch them).
