-- MP#07 Fase 1 — Align product-media bucket size with form validation.
--
-- Problem: apps/web/app/(marketplace)/vender/product-form.tsx validates video
-- uploads at <= 50 MB, but storage bucket `product-media` was created at 20 MB
-- (20260320000017_storage_buckets.sql). Videos between 20–50 MB pass the form
-- and fail silently in Supabase Storage with a size error.
--
-- Decision: honor the form's 50 MB promise (raise the bucket cap). The form
-- code is unchanged.
--
-- Idempotent: UPDATE on a single bucket id is safe to re-run.

UPDATE storage.buckets
SET file_size_limit = 52428800  -- 50 MB = 50 * 1024 * 1024
WHERE id = 'product-media';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- UPDATE storage.buckets SET file_size_limit = 20971520 WHERE id = 'product-media';
-- ─────────────────────────────────────────────────────────────────────────────
