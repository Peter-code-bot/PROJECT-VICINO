-- Backfill combined average_rating + reviews_count for all profiles.
-- Idempotent: applies AVG(rating) over all visible reviews per reviewed_id.
-- Refs: VICINO mega prompt #03 — Fase 3
-- Reported by: Pedro (1-May-2026)

-- Note: the recalc_rating_on_review trigger keeps these fields up to date
-- going forward. This backfill is a safety net for any drift from prior bugs,
-- manual edits, or pre-trigger inserts. The original 2026-04-11 backfill
-- (20260411000006_recalculate_ratings.sql) populated these fields once;
-- this migration is a documented re-application after Fase 3 audit which
-- found 1 row of drift (resolved post-apply).

UPDATE profiles p SET
  average_rating = COALESCE(sub.avg_r, 0),
  reviews_count = COALESCE(sub.cnt, 0),
  updated_at = NOW()
FROM (
  SELECT
    reviewed_id,
    AVG(rating)::DECIMAL(3,2) AS avg_r,
    COUNT(*) AS cnt
  FROM reviews
  WHERE visible = TRUE
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;

-- Profiles WITHOUT any visible reviews stay at default 0 (correct — UI shows
-- 0 stars + "Nuevo"/"Sin reseñas" badge). We do NOT zero out untouched rows
-- in case downstream logic intentionally sets them elsewhere.

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual): the backfill is idempotent and only updates derived
-- fields. To revert:
-- 1. Use Supabase PITR to a point before this migration ran, OR
-- 2. Re-run the original 20260411000006_recalculate_ratings.sql (which
--    computes the same average_rating from the same source data — same
--    result). There is no destructive change to revert.
-- ─────────────────────────────────────────────────────────────────────────
