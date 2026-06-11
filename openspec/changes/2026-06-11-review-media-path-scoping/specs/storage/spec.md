# Spec -- storage / review-media (delta)

> Domain: object-level authorization for the `review-media` storage bucket.
> DELTA spec from change `2026-06-11-review-media-path-scoping`. Last updated 2026-06-11.

## Context

`review-media` holds buyer/seller review photos. It is public-read by design. Its INSERT policy
previously checked only that the caller was authenticated -- no binding between the object path and
the uploader -- so any authenticated user could write to any path; there was no DELETE policy.

## Requirement R1 -- uploads SHALL be owner path-scoped

WHEN an authenticated user uploads an object to `review-media`, the first segment of the object path
(`(storage.foldername(name))[1]`) SHALL equal the uploader's `auth.uid()`. Any other first segment
SHALL be rejected.

### Scenario: upload under own prefix succeeds
- GIVEN an authenticated user U
- WHEN U uploads to `review-media` with name `U.id/<sale>/<file>`
- THEN the upload is accepted

### Scenario: upload under another user's prefix is rejected
- GIVEN an authenticated user U
- WHEN U uploads to `review-media` with name `<other-uuid>/<file>`
- THEN the upload is rejected (42501)

## Requirement R2 -- deletes SHALL be owner path-scoped

WHEN an authenticated user deletes an object from `review-media`, the first path segment SHALL equal
their `auth.uid()`; deleting another user's object SHALL be rejected.

### Scenario: owner deletes own object
- WHEN U deletes a `review-media` object named `U.id/...`
- THEN it succeeds

### Scenario: cross-user delete is rejected
- WHEN U deletes a `review-media` object named `<other-uuid>/...`
- THEN it is rejected

## Requirement R3 -- no permissive un-scoped INSERT policy SHALL remain

WHEN evaluating `review-media` INSERT authority, there SHALL be exactly one INSERT policy and it
SHALL be the owner-scoped one. The prior `"Authenticated upload review media"`
(`auth.uid() IS NOT NULL`) SHALL NOT exist, because PERMISSIVE OR semantics would let it bypass R1.

### Scenario: loose policy absent
- WHEN listing `storage.objects` INSERT policies touching `review-media`
- THEN only `"Owner upload review media"` is present

## Requirement R4 -- public read SHALL be preserved

WHEN anyone reads a `review-media` object, it SHALL be served (`"Public read review media"`,
`USING bucket_id='review-media'`, unchanged), so existing review galleries keep rendering.

### Scenario: existing review media still loads
- GIVEN a review with media uploaded before this change
- WHEN any visitor views the review
- THEN the stored public URL still resolves

## Implementation notes
- Mirror migration: `20260611000002_review_media_path_scoping.sql`.
- App emits `${user.id}/${saleConfirmationId}/...` since commit `8d06342` (#12 step 1).
- Bucket `allowed_mime_types = image/*` already blocks HTML/SVG stored-XSS (orthogonal to authz).
