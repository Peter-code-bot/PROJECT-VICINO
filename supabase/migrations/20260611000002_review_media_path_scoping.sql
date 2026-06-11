-- =============================================================================
-- #12 -- review-media object-level authz / path-scoping (CWE-639 / CWE-284)
-- Change: openspec/changes/2026-06-11-review-media-path-scoping
-- =============================================================================
-- WHY: the review-media bucket's INSERT policy "Authenticated upload review media"
-- only checked `auth.uid() IS NOT NULL` (no path-scoping) -- it was the one bucket
-- left un-scoped after 20260425000002 / 20260602000001. Any authenticated user could
-- write to ANY path in the bucket, and there was no owner-scoped DELETE at all. Fix:
-- replace the loose INSERT with an owner-scoped one (the first path segment must equal
-- the uploader's auth.uid()) and add an owner-scoped DELETE.
--
-- The app already prefixes uploads with `${user.id}/${saleConfirmationId}/...`
-- (apps/web/.../review/review-form.tsx, commit 8d06342 -- #12 step 1), so legitimate
-- uploads satisfy the new WITH CHECK. The path change SHIPPED FIRST on purpose: applying
-- the policy before the path change would have broken every upload.
--
-- NOTE: storage.objects policies are PERMISSIVE (OR'd across policies for a command).
-- The loose "Authenticated upload review media" MUST be dropped -- if it survived, it
-- would keep permitting un-scoped writes and defeat this fix.
--
-- STATUS: applied in Studio (Camino 2, COMMIT). Idempotent mirror (reconcile vs
-- pg_policies). "Public read review media" (SELECT, USING bucket_id='review-media')
-- is intentionally UNCHANGED and not re-emitted here. The bucket also restricts
-- allowed_mime_types to image/* (HTML/SVG already blocked) -- no extension allowlist
-- was needed.
-- =============================================================================

-- ---- INSERT: replace the loose upload with an owner path-scoped one ----
DROP POLICY IF EXISTS "Authenticated upload review media" ON storage.objects;
DROP POLICY IF EXISTS "Owner upload review media" ON storage.objects;
CREATE POLICY "Owner upload review media" ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'review-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---- DELETE: owner path-scoped (no DELETE policy existed before) ----
DROP POLICY IF EXISTS "Owner delete review media" ON storage.objects;
CREATE POLICY "Owner delete review media" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'review-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- =============================================================================
-- ROLLBACK (manual, NOT recommended -- re-opens #12): DROP the two "Owner ... review
-- media" policies and restore "Authenticated upload review media" FOR INSERT TO
-- authenticated WITH CHECK (bucket_id = 'review-media' AND auth.uid() IS NOT NULL).
-- =============================================================================
