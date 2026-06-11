# Proposal -- #12: review-media object-level authz (path-scoping)

## Why

Audit finding #12 (CWE-639 / CWE-284, Med 6.5). The `review-media` storage bucket had broken
object-level authorization:
- `"Authenticated upload review media"` INSERT policy checked only `auth.uid() IS NOT NULL`
  (`20260320000017:79`, left un-scoped by `20260425000002` and `20260602000001:628`) -> any
  authenticated user could write to ANY path in the bucket, including overwriting/poisoning paths
  conceptually belonging to other users' reviews.
- No owner-scoped DELETE policy existed at all.
- The app uploaded to `${saleConfirmationId}/...` -- a path NOT prefixed with the uploader id, so a
  naive path-scoping policy would have broken uploads.

Mitigating factor (already in place): the bucket restricts `allowed_mime_types` to `image/*`, so
HTML/SVG stored-XSS is already blocked; no extension allowlist was needed.

## What

Two-step fix (deliberately APP-FIRST, the inverse of the other findings, so the policy never
front-runs the path change):

- **Step 1 (app, commit `8d06342`)** -- `review-form.tsx` `uploadMedia()` now prefixes every object
  with the uploader id: path `${user.id}/${saleConfirmationId}/${ts}-${i}.${ext}`. `getPublicUrl`
  reuses the same path, so previews stay correct.
- **Step 2 (DB, applied in Studio, Camino 2, COMMIT)** -- `storage.objects` policies for
  `review-media`:
  - drop the loose `"Authenticated upload review media"` and create `"Owner upload review media"`
    (INSERT, authenticated, `WITH CHECK (storage.foldername(name))[1] = auth.uid()::text`).
  - create `"Owner delete review media"` (DELETE, authenticated, same owner-scope `USING`).
  - `"Public read review media"` (SELECT public) is left UNCHANGED (review media is public by design).

Migration (mirror): `supabase/migrations/20260611000002_review_media_path_scoping.sql`.

## Scope

### IN
- The 2 storage policies (drop loose INSERT + create owner INSERT/DELETE), the 1 app path change
  (already shipped as step 1), mirror migration + delta spec.

### OUT
- Re-pathing or backfilling existing review-media objects (old objects keep their old paths/URLs and
  are still served by the unchanged public SELECT).
- The latent bucket/app mime mismatch (the form offers video up to 50MB but the bucket allows only
  `image/*`) -- pre-existing, tracked as a separate follow-up.

## Caller impact

- `review-form.tsx` `uploadMedia` -> already emits `${user.id}/...` (step 1) -> satisfies the new
  owner WITH CHECK. It is the ONLY upload site to review-media (verified by repo sweep).
- Read/display side reads the stored `getPublicUrl` saved on the `reviews` row, not a reconstructed
  path -> existing reviews keep working; the public SELECT is unchanged.
- No app code deletes review-media today; the new DELETE policy is defensive (owner-only).

## Success criteria

1. An authenticated upload to a path whose first segment != `auth.uid()` is rejected.
2. A legit upload via `review-form` (path `${user.id}/...`) succeeds; the photo still previews.
3. No residual permissive INSERT policy (`"Authenticated upload review media"`) remains -- otherwise
   path-scoping is moot (PERMISSIVE OR semantics).
4. Existing reviews' media still loads (public SELECT intact).
5. `pnpm build` green (was already green at `8d06342`).
