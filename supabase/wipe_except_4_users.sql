-- =============================================================================
-- VICINO Marketplace — Wipe All Data Except 4 Specific Accounts
-- =============================================================================
BEGIN;

-- 1. Snapshot de usuarios a preservar (Mío, Pedro, @, Review Google)
CREATE TEMP TABLE _preserved_users AS
SELECT id
FROM profiles
WHERE user_id IN ('U3666390', 'U2317694', 'U9387200', 'U8385965');

-- 2. Borrado en orden inverso de dependencias

-- Reviews
DELETE FROM reviews;

-- Messages
DELETE FROM messages;

-- Notifications
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='notifications') THEN
    EXECUTE 'DELETE FROM notifications';
  END IF;
END $$;

-- Sale confirmations
DELETE FROM sale_confirmations;

-- Disputes
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='disputes') THEN
    EXECUTE 'DELETE FROM disputes';
  END IF;
END $$;

-- Bookings
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bookings') THEN
    EXECUTE 'DELETE FROM bookings';
  END IF;
END $$;

-- Favorites
DELETE FROM favorites;

-- Service availability
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_availability') THEN
    EXECUTE 'DELETE FROM service_availability';
  END IF;
END $$;

-- Product variants
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='product_variants') THEN
    EXECUTE 'DELETE FROM product_variants';
  END IF;
END $$;

-- Media assets
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='media_assets') THEN
    EXECUTE 'DELETE FROM media_assets';
  END IF;
END $$;

-- Chats
DELETE FROM chats;

-- Reports
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='reports') THEN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='critical_reports') THEN
      EXECUTE 'DELETE FROM reports WHERE id NOT IN (SELECT report_id FROM critical_reports)';
    ELSE
      EXECUTE 'DELETE FROM reports';
    END IF;
  END IF;
END $$;

-- User blocks
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='user_blocks') THEN
    EXECUTE 'DELETE FROM user_blocks';
  END IF;
END $$;

-- Products / services
DELETE FROM products_services;

-- Coupons
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='coupons') THEN
    EXECUTE 'DELETE FROM coupons';
  END IF;
END $$;

-- Seller rankings snapshot
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='seller_rankings') THEN
    EXECUTE 'DELETE FROM seller_rankings';
  END IF;
END $$;

-- 3. Borrar auth.users NO preservados
DELETE FROM auth.users
WHERE id NOT IN (SELECT id FROM _preserved_users);

-- 4. Resetear stats de los usuarios preservados
UPDATE profiles SET
  total_sales = 0,
  average_rating = 0,
  average_rating_as_seller = 0,
  average_rating_as_buyer = 0,
  reviews_count = 0,
  reviews_count_as_seller = 0,
  reviews_count_as_buyer = 0
WHERE id IN (SELECT id FROM _preserved_users);

COMMIT;
