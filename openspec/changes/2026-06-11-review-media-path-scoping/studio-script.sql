-- =============================================================================
-- #12 review-media path-scoping -- STUDIO SCRIPT
-- Change: 2026-06-11-review-media-path-scoping
-- =============================================================================
-- STATUS: ALREADY APPLIED (Camino 2, COMMIT). Idempotent. Canonical SQL in
-- 20260611000002_review_media_path_scoping.sql.
-- =============================================================================

-- ---- BLOCK 1: SNAPSHOT (read-only) ----
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
  AND (qual ILIKE '%review-media%' OR with_check ILIKE '%review-media%' OR policyname ILIKE '%review media%')
ORDER BY cmd, policyname;
SELECT id, public, allowed_mime_types FROM storage.buckets WHERE id='review-media';

-- ---- BLOCK 2: APPLY (see migration for full bodies) ----
-- DROP POLICY "Authenticated upload review media";  -- loose: auth.uid() IS NOT NULL (PERMISSIVE risk)
-- CREATE "Owner upload review media" INSERT WITH CHECK foldername[1]=auth.uid()::text;
-- CREATE "Owner delete review media" DELETE USING foldername[1]=auth.uid()::text;
-- "Public read review media" (SELECT) untouched.

-- ---- BLOCK 3: VERIFY ----
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='storage' AND tablename='objects'
  AND (qual ILIKE '%review-media%' OR with_check ILIKE '%review-media%' OR policyname ILIKE '%review media%')
ORDER BY cmd, policyname;
-- expect exactly 3: Owner upload (INSERT, foldername[1]=uid), Owner delete (DELETE, foldername[1]=uid),
-- Public read (SELECT, bucket_id='review-media'). NO "Authenticated upload review media".

-- ---- BLOCK 4: SMOKE (SET LOCAL ROLE authenticated; set jwt sub; BEGIN/ROLLBACK) ----
-- INSERT INTO storage.objects(bucket_id,name,owner) VALUES ('review-media','<OTHER_UUID>/x.jpg',...) -> 42501
-- INSERT ... name='<SELF_UUID>/x.jpg' -> ok
-- DELETE FROM storage.objects WHERE name LIKE '<OTHER_UUID>/%' AND bucket_id='review-media' -> 0 rows / denied
