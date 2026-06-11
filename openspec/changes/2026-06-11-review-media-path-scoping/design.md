# Design -- #12: review-media path-scoping

## Why app-first (inverse order)

Every other finding applied the DB lock first, then migrated callers. Here that order is unsafe: the
upload path was `${saleConfirmationId}/...`, whose first segment is a sale id, not the uploader id.
If the owner WITH CHECK (`foldername[1] = auth.uid()`) had landed first, EVERY upload would fail
(`42501`) until the app changed. So step 1 (path change, `8d06342`) shipped first and is fully
backward compatible (the old loose policy still accepted the new path); step 2 (the owner policies)
lands second and only then closes the hole. At no point are uploads broken.

## Owner-scoping mechanism

Supabase Storage stores the object key in `storage.objects.name`. `(storage.foldername(name))[1]` is
the first `/`-delimited segment (Postgres arrays are 1-indexed). Requiring it to equal
`auth.uid()::text` ties write/delete authority to the directory named after the user -- the same
canonical pattern already used for `product-media`, `avatars`, `chat-media`, and
`verification-documents` (`20260425000002`, `20260602000001`). review-media was simply the one bucket
that pattern had not yet reached -- that gap IS #12.

## Why the loose policy must be DROPPED, not just supplemented

`storage.objects` RLS policies are PERMISSIVE: for a given command, a row is allowed if ANY policy's
predicate passes (logical OR). If `"Authenticated upload review media"` (`auth.uid() IS NOT NULL`)
had been left in place alongside `"Owner upload review media"`, any authenticated user would still
satisfy the loose policy and write to an arbitrary path -- the new owner policy would add nothing.
The fix therefore DROPs the loose INSERT and replaces it. The mirror encodes this explicitly and the
reconcile task asserts the loose policy is absent in production.

## DELETE policy (new)

There was no DELETE policy for review-media, so authenticated DELETE was implicitly denied (no
permissive policy). Adding `"Owner delete review media"` (owner-scoped) is a small capability
INCREASE (users may now delete their own review media), not a relaxation of anyone else's authority,
and it matches `"Owner delete product media"`. No app path uses it yet; it is defensive and future-proof.

## Public read unchanged

Review media is public by product design (review galleries render for anyone). `"Public read review
media"` (`USING bucket_id = 'review-media'`) is intentionally untouched. The fix is strictly about
WRITE/DELETE authority, not read exposure -- consistent with the other public buckets.

## Faithfulness

The migration is a reconstructed MIRROR of the policies Pedro applied live (live is authoritative).
Reconcile the two policy bodies and the absence of `"Authenticated upload review media"` against
`pg_policies` (`policyname`, `cmd`, `qual`, `with_check`) for `storage.objects` where
`bucket_id='review-media'`. The mirror uses `auth.uid()::text` as Pedro described; if production used
the perf-wrapped `(select auth.uid())::text`, that is functionally identical -- note it on reconcile.
