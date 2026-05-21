-- MP#07 Fase 3 — Extend rating recalc triggers to cover DELETE.
--
-- Problem: the two trigger functions defined in 20260320000008_reviews.sql
--   • update_user_rating_on_review  (AFTER INSERT only)
--   • update_separated_ratings       (AFTER INSERT OR UPDATE)
-- both use NEW.reviewed_id, so they cannot run on DELETE. As a result,
-- profiles.average_rating, reviews_count, average_rating_as_seller/buyer and
-- reviews_count_as_seller/buyer go stale whenever a row is removed from
-- `reviews` (admin hard-delete, account cascade in delete_user_cascade, etc.).
--
-- Solution:
--   1. Refactor both functions to pick the affected user via TG_OP:
--        DELETE → OLD.reviewed_id   /   INSERT|UPDATE → NEW.reviewed_id.
--      The aggregate SELECTs read the current state of `reviews`; on AFTER
--      DELETE the deleted row is already gone, so AVG/COUNT return the
--      correct post-delete value.
--   2. Drop and recreate both triggers to add DELETE to their event lists.
--
-- Scope guardrails:
--   • INSERT semantics preserved exactly (same trust_points logic).
--   • UPDATE semantics on `update_separated_ratings` preserved.
--   • Trust points are NOT reversed on DELETE — leaving that as a separate
--     policy decision (moderation deletes vs. account cascade may want
--     different behavior; the calling code can clamp explicitly when needed).
--   • Known asymmetry NOT fixed here: `recalc_rating_on_review` still does
--     not fire on UPDATE, so a soft-delete via `visible = FALSE` does not
--     refresh `average_rating` / `reviews_count`. `update_separated_ratings`
--     does cover UPDATE for the separated columns. Documenting and leaving
--     for a future scoped fix to avoid bundling more behavior change here.

-- ─────────────────────────────────────────────────────────────────────────────
-- Function 1: update_user_rating_on_review
--   Adds DELETE support. INSERT path is byte-for-byte identical in behavior.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_user_rating_on_review()
RETURNS TRIGGER AS $$
DECLARE
  v_target_user  UUID;
  new_avg        DECIMAL(3,2);
  review_count   INTEGER;
  points_to_add  INTEGER;
BEGIN
  -- Pick the affected user: OLD for DELETE, NEW for everything else.
  IF TG_OP = 'DELETE' THEN
    v_target_user := OLD.reviewed_id;
  ELSE
    v_target_user := NEW.reviewed_id;
  END IF;

  -- Recompute combined average + count from surviving visible rows.
  SELECT AVG(rating)::DECIMAL(3,2), COUNT(*)
  INTO new_avg, review_count
  FROM public.reviews
  WHERE reviewed_id = v_target_user AND visible = TRUE;

  UPDATE public.profiles
  SET average_rating = COALESCE(new_avg, 0),
      reviews_count  = COALESCE(review_count, 0),
      updated_at     = NOW()
  WHERE id = v_target_user;

  -- Trust points are only awarded on INSERT (preserves prior behavior).
  -- DELETE intentionally does NOT reverse them — see migration header.
  IF TG_OP = 'INSERT' THEN
    points_to_add := CASE
      WHEN NEW.rating = 5 THEN 5
      WHEN NEW.rating = 4 THEN 3
      WHEN NEW.rating = 3 THEN 1
      WHEN NEW.rating = 2 THEN 0
      WHEN NEW.rating = 1 THEN -2
      ELSE 0
    END;

    UPDATE public.profiles
    SET trust_points = GREATEST(0, trust_points + points_to_add)
    WHERE id = NEW.reviewed_id;

    -- Bonus trust points for writing a review (incentive).
    UPDATE public.profiles
    SET trust_points = trust_points + 2
    WHERE id = NEW.reviewer_id;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- Function 2: update_separated_ratings
--   Adds DELETE support. INSERT/UPDATE paths preserved.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_separated_ratings()
RETURNS TRIGGER AS $$
DECLARE
  v_target_user UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_user := OLD.reviewed_id;
  ELSE
    v_target_user := NEW.reviewed_id;
  END IF;

  -- Rating as seller
  UPDATE public.profiles SET
    average_rating_as_seller = COALESCE((
      SELECT AVG(rating)::DECIMAL(3,2) FROM public.reviews
      WHERE reviewed_id = v_target_user
        AND review_type = 'buyer_to_seller'
        AND visible = TRUE
    ), 0),
    reviews_count_as_seller = (
      SELECT COUNT(*) FROM public.reviews
      WHERE reviewed_id = v_target_user
        AND review_type = 'buyer_to_seller'
        AND visible = TRUE
    )
  WHERE id = v_target_user;

  -- Rating as buyer
  UPDATE public.profiles SET
    average_rating_as_buyer = COALESCE((
      SELECT AVG(rating)::DECIMAL(3,2) FROM public.reviews
      WHERE reviewed_id = v_target_user
        AND review_type = 'seller_to_buyer'
        AND visible = TRUE
    ), 0),
    reviews_count_as_buyer = (
      SELECT COUNT(*) FROM public.reviews
      WHERE reviewed_id = v_target_user
        AND review_type = 'seller_to_buyer'
        AND visible = TRUE
    )
  WHERE id = v_target_user;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- Triggers: drop + recreate to extend the event list.
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS recalc_rating_on_review ON public.reviews;
CREATE TRIGGER recalc_rating_on_review
  AFTER INSERT OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_user_rating_on_review();

DROP TRIGGER IF EXISTS update_separated_ratings_trigger ON public.reviews;
CREATE TRIGGER update_separated_ratings_trigger
  AFTER INSERT OR UPDATE OR DELETE ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.update_separated_ratings();

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- Restore both functions to their pre-MP#07 bodies (see
-- supabase/migrations/20260320000008_reviews.sql lines 35-112) and recreate
-- the original triggers:
--   DROP TRIGGER IF EXISTS recalc_rating_on_review ON public.reviews;
--   CREATE TRIGGER recalc_rating_on_review
--     AFTER INSERT ON public.reviews
--     FOR EACH ROW EXECUTE FUNCTION update_user_rating_on_review();
--   DROP TRIGGER IF EXISTS update_separated_ratings_trigger ON public.reviews;
--   CREATE TRIGGER update_separated_ratings_trigger
--     AFTER INSERT OR UPDATE ON public.reviews
--     FOR EACH ROW EXECUTE FUNCTION update_separated_ratings();
-- ─────────────────────────────────────────────────────────────────────────────
