# Proposal -- CH-6: restrict profiles PII columns + self/admin RPCs (#2)

## Why

Audit finding #2 (CWE-200 / CWE-359, Alto 8.6). `anon` and `authenticated` could SELECT PII
columns of `profiles` directly via PostgREST -- `email, telefono, rfc, ubicacion_lat,
ubicacion_lng, fcm_token` -- enabling doxxing, physical tracking, push spam, reidentification.
The row-SELECT was already gated (`block_aware_profiles_select`) but RLS gates rows, not columns.

## What (applied in Studio, Camino 2, COMMIT, VERIFY 0 PII rows)

- `REVOKE SELECT (email, telefono, rfc, ubicacion_lat, ubicacion_lng, fcm_token) ON profiles
  FROM anon, authenticated`. All other (public) columns stay readable.
- `get_my_profile()` SECURITY DEFINER (GRANT authenticated): returns the caller's OWN full row
  incl. PII (`WHERE id = auth.uid()`).
- `admin_list_users()` / `admin_get_user(uuid)` SECURITY DEFINER (guard `has_role admin`):
  admin PII reads.

App edits (the 4 call sites the REVOKE breaks, per the pre-write sweep):
- `perfil/page.tsx` `select("*")` (self) -> `rpc('get_my_profile')`.
- `perfil/editar/page.tsx` (self, email) -> `rpc('get_my_profile')`.
- `admin/users/page.tsx` (admin, email) -> `rpc('admin_list_users')` + filters on the result.
- `admin/verifications/page.tsx` (admin, embedded `profiles!user_id(... email ...)`) -> embed
  keeps public columns; submitter emails fetched via the page's existing service-role client.

Mirror migration: `supabase/migrations/20260610000009_ch6_pii_column_restrict.sql`.

## RECONCILE (RESOLVED) -- user_id / is_hidden are NOT revoked

An earlier apply also revoked `is_hidden` and `user_id`, breaking the public seller page + admin
moderation. Reconciled 2026-06-10: re-granted (VERIFY 4 correct rows). The mirror revokes only the
6 PII columns and explicitly re-grants user_id / is_hidden. They are NOT PII:
- **`user_id`** is the PUBLIC 8-char handle shown on the public seller page
  `vendedor/[id]/page.tsx:36` (and searchable). A public handle cannot be made private.
- **`is_hidden`** is read by the admin moderation list `admin/moderation/users/page.tsx:31`.

## Scope

### IN
- REVOKE SELECT on the 6 PII columns; the 3 read RPCs; the 4 app call-site migrations; mirror
  migration + delta spec.

### OUT
- Coords distance pill (currently inert -- the detail join does not fetch coords). Optional
  fuzzed-distance RPC later.
- #9 / #14 / remaining findings.

## Caller inventory (unaffected -- read only public columns)

~20 profiles reads request only public columns (nombre, foto, trust_level, ratings, es_vendedor,
ubicacion text, user_id, is_hidden, ...) -> intact. fcm_token has no client reader (only the
send-push edge fn via service role). Full inventory + sweep:
`docs/security/2026-06-10-ch6-pii-reads-prep.md`.

## Success criteria

1. A direct `curl profiles?select=email,telefono,rfc,ubicacion_lat,ubicacion_lng,fcm_token`
   as anon/authenticated returns no PII (42501 / empty).
2. The user's own profile + edit page still load (via get_my_profile, incl. own email).
3. The admin users panel + verifications panel still show emails (via admin RPC / service-role).
4. Public seller pages, search, rankings, chat still work (public columns intact).
5. `pnpm build` green; no residual user-client PII read of profiles.
