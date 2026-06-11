-- =============================================================================
-- CH-3a-fix -- stats trigger functions -> SECURITY DEFINER + locked search_path
-- Change: openspec/changes/2026-06-10-mass-assignment-column-locks
-- =============================================================================
-- WHY: CH-3 revokes broad UPDATE on profiles / products_services from
-- authenticated and grants only a safe column allowlist. But several TRIGGER
-- functions legitimately write the now-revoked stat columns (profiles.total_sales,
-- average_rating*, trust_points, trust_level; products_services.ventas_count).
-- A trigger function runs as the INVOKING user by default, so after the REVOKE
-- those writes would fail with 42501 and break sale completion / rating recompute.
-- Making them SECURITY DEFINER (run as the owner) lets them write the stat
-- columns; the locked search_path prevents search_path injection.
--
-- MUST run BEFORE the column-lock REVOKE migration (20260610000005) on a fresh
-- replay. Applied together in Studio (Camino 2, COMMIT) -- this is the idempotent
-- mirror. ALTER FUNCTION is idempotent.
-- =============================================================================

ALTER FUNCTION public.check_sale_completion()        SECURITY DEFINER;
ALTER FUNCTION public.check_sale_completion()        SET search_path = public, pg_temp;

ALTER FUNCTION public.handle_sale_cancellation()     SECURITY DEFINER;
ALTER FUNCTION public.handle_sale_cancellation()     SET search_path = public, pg_temp;

ALTER FUNCTION public.update_profile_trust_level()   SECURITY DEFINER;
ALTER FUNCTION public.update_profile_trust_level()   SET search_path = public, pg_temp;

ALTER FUNCTION public.update_separated_ratings()     SECURITY DEFINER;
ALTER FUNCTION public.update_separated_ratings()     SET search_path = public, pg_temp;

ALTER FUNCTION public.update_user_rating_on_review() SECURITY DEFINER;
ALTER FUNCTION public.update_user_rating_on_review() SET search_path = public, pg_temp;
