-- Recalculate ALL seller ratings retroactively
UPDATE profiles p SET
  average_rating_as_seller = COALESCE(sub.avg_r, 0),
  reviews_count_as_seller = COALESCE(sub.cnt, 0)
FROM (
  SELECT reviewed_id, AVG(rating)::DECIMAL(3,2) as avg_r, COUNT(*) as cnt
  FROM reviews WHERE review_type = 'buyer_to_seller' AND visible = true
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;

-- Recalculate ALL buyer ratings retroactively
UPDATE profiles p SET
  average_rating_as_buyer = COALESCE(sub.avg_r, 0),
  reviews_count_as_buyer = COALESCE(sub.cnt, 0)
FROM (
  SELECT reviewed_id, AVG(rating)::DECIMAL(3,2) as avg_r, COUNT(*) as cnt
  FROM reviews WHERE review_type = 'seller_to_buyer' AND visible = true
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;

-- Recalculate overall rating
UPDATE profiles p SET
  average_rating = COALESCE(sub.avg_r, 0),
  reviews_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT reviewed_id, AVG(rating)::DECIMAL(3,2) as avg_r, COUNT(*) as cnt
  FROM reviews WHERE visible = true
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;
