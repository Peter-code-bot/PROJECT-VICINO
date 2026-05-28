-- =============================================================================
-- VICINO Marketplace — Cleanup Script
-- =============================================================================
-- Borra TODO el contenido generado por usuarios (publicaciones, ventas, reviews,
-- chats, mensajes, favoritos, etc.) y elimina las cuentas no preservadas.
--
-- Preserva: usuarios con rol 'admin' o 'moderator' en user_roles (auth.users +
-- profiles + seller_verification + trust_level_verification + user_roles).
-- Resetea sus stats denormalizados a cero para que partan limpios.
--
-- Uso:
--   1) Correr la sección 1 (PRE-FLIGHT) primero para revisar qué se va a tocar.
--   2) Si todo cuadra, correr el script completo (incluye BEGIN/COMMIT).
--   3) Verificar la sección 5 (resumen final).
--
-- NO es una migración — no versionar en supabase/migrations/. Es un script
-- one-shot para limpiar entornos demo.
-- =============================================================================

-- ===========================================================================
-- 1. PRE-FLIGHT CHECK (NO DESTRUCTIVO — correr primero como dry-run)
-- ===========================================================================
-- Descomenta este bloque, ejecútalo solo, y revisa el output ANTES de seguir.
/*
SELECT '== Admins/moderators que se preservarán ==' AS info;
SELECT u.email, p.nombre, p.nombre_negocio, ur.role
FROM user_roles ur
JOIN auth.users u ON u.id = ur.user_id
LEFT JOIN profiles p ON p.id = ur.user_id
WHERE ur.role IN ('admin','moderator')
ORDER BY ur.role, u.email;

SELECT '== Conteos actuales (antes de borrar) ==' AS info;
SELECT 'profiles' AS tabla, COUNT(*) AS total FROM profiles
UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users
UNION ALL SELECT 'products_services', COUNT(*) FROM products_services
UNION ALL SELECT 'sale_confirmations', COUNT(*) FROM sale_confirmations
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'chats', COUNT(*) FROM chats
UNION ALL SELECT 'messages', COUNT(*) FROM messages
UNION ALL SELECT 'favorites', COUNT(*) FROM favorites
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications
ORDER BY tabla;
*/

-- ===========================================================================
-- 2. CLEANUP TRANSACCIONAL
-- ===========================================================================
BEGIN;

-- 2.1. Snapshot de usuarios a preservar (admins + moderators)
CREATE TEMP TABLE _preserved_users AS
SELECT DISTINCT user_id
FROM user_roles
WHERE role IN ('admin','moderator');

SELECT '== Usuarios preservados ==' AS info, COUNT(*) AS total FROM _preserved_users;

-- 2.2. Borrado en orden inverso de dependencias (hojas → raíz)
-- Las tablas con ON DELETE CASCADE no necesitan limpieza explícita,
-- pero las borramos para tener verificación + claridad.

-- 2.2.1. Reviews (hijas de sale_confirmations y profiles)
DELETE FROM reviews;

-- 2.2.2. Messages (hijas de chats)
DELETE FROM messages;

-- 2.2.3. Notifications (hijas de profiles)
-- Tabla puede no existir si la migración correspondiente no se aplicó;
-- envolvemos en DO para no romper.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='notifications') THEN
    EXECUTE 'DELETE FROM notifications';
  END IF;
END $$;

-- 2.2.4. Sale confirmations (hijas de products_services y profiles)
DELETE FROM sale_confirmations;

-- 2.2.5. Disputes (si existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='disputes') THEN
    EXECUTE 'DELETE FROM disputes';
  END IF;
END $$;

-- 2.2.6. Bookings (si existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='bookings') THEN
    EXECUTE 'DELETE FROM bookings';
  END IF;
END $$;

-- 2.2.7. Favorites
DELETE FROM favorites;

-- 2.2.8. Service availability (si existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='service_availability') THEN
    EXECUTE 'DELETE FROM service_availability';
  END IF;
END $$;

-- 2.2.9. Product variants (cascade desde products_services pero explícito por seguridad)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='product_variants') THEN
    EXECUTE 'DELETE FROM product_variants';
  END IF;
END $$;

-- 2.2.10. Media assets (si existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='media_assets') THEN
    EXECUTE 'DELETE FROM media_assets';
  END IF;
END $$;

-- 2.2.11. Chats
DELETE FROM chats;

-- 2.2.12. Reports (si existe)
-- IMPORTANTE: reports con critical_reports asociado NO se pueden borrar
-- (trigger BEFORE DELETE en critical_reports — compliance MX 5+ años).
-- Borramos solo reports sin critical_reports asociado.
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

-- 2.2.13. User blocks (si existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='user_blocks') THEN
    EXECUTE 'DELETE FROM user_blocks';
  END IF;
END $$;

-- 2.2.14. Products / services
DELETE FROM products_services;

-- 2.2.15. Coupons (si existe)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='coupons') THEN
    EXECUTE 'DELETE FROM coupons';
  END IF;
END $$;

-- 2.2.16. Seller rankings snapshot (si existe — se regenera por cron)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='seller_rankings') THEN
    EXECUTE 'DELETE FROM seller_rankings';
  END IF;
END $$;

-- 2.2.17. audit_log: NO se borra
-- audit_log tiene trigger BEFORE DELETE/UPDATE → RAISE EXCEPTION (compliance MX 5+ años,
-- migración 20260429120004). Cualquier intento de DELETE rollearía toda la transacción.
-- El historial de acciones admin se conserva intencionalmente. Si necesitas resetearlo
-- en un entorno de test, hazlo desde Supabase Studio con permisos especiales o pídelo
-- a un DBA.

-- Las filas viejas de audit_log con actor_id de usuarios borrados quedan con actor_id = NULL
-- automáticamente (FK ON DELETE SET NULL en migración 20260425000003).

-- 2.3. Borrar auth.users NO preservados (cascade limpia profiles, seller_verification,
-- trust_level_verification, etc. de esos usuarios)
DELETE FROM auth.users
WHERE id NOT IN (SELECT user_id FROM _preserved_users);

-- 2.4. Resetear stats denormalizados de los admins preservados
-- (sus ventas/productos/reviews ya fueron borrados arriba)
UPDATE profiles SET
  total_sales = 0,
  average_rating = 0,
  average_rating_as_seller = 0,
  average_rating_as_buyer = 0,
  reviews_count = 0,
  reviews_count_as_seller = 0,
  reviews_count_as_buyer = 0,
  trust_points = 0,
  trust_level = 'nuevo'
WHERE id IN (SELECT user_id FROM _preserved_users);

COMMIT;

-- ===========================================================================
-- 3. VACUUM (opcional, recomendado tras borrado masivo)
-- ===========================================================================
-- VACUUM ANALYZE products_services;
-- VACUUM ANALYZE sale_confirmations;
-- VACUUM ANALYZE reviews;
-- VACUUM ANALYZE profiles;

-- ===========================================================================
-- 4. VERIFICACIÓN POST-CLEANUP
-- ===========================================================================
SELECT '== Estado post-cleanup ==' AS info;

SELECT 'profiles (deben ser solo admins/mods)' AS tabla, COUNT(*) AS total FROM profiles
UNION ALL SELECT 'auth.users', COUNT(*) FROM auth.users
UNION ALL SELECT 'user_roles', COUNT(*) FROM user_roles
UNION ALL SELECT 'products_services (= 0)', COUNT(*) FROM products_services
UNION ALL SELECT 'sale_confirmations (= 0)', COUNT(*) FROM sale_confirmations
UNION ALL SELECT 'reviews (= 0)', COUNT(*) FROM reviews
UNION ALL SELECT 'chats (= 0)', COUNT(*) FROM chats
UNION ALL SELECT 'messages (= 0)', COUNT(*) FROM messages
UNION ALL SELECT 'favorites (= 0)', COUNT(*) FROM favorites
ORDER BY tabla;

-- Lista final de usuarios preservados con su rol
SELECT '== Usuarios preservados con sus roles ==' AS info;
SELECT u.email, p.nombre, ur.role, p.trust_level, p.total_sales
FROM auth.users u
JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN profiles p ON p.id = u.id
ORDER BY ur.role, u.email;
