-- =============================================================================
-- CH-3 mass-assignment column locks + sale RPCs (#5/#6/#7) -- STUDIO SCRIPT
-- Change: 2026-06-10-mass-assignment-column-locks
-- =============================================================================
-- STATUS: ALREADY APPLIED by Pedro (Camino 2, COMMIT). Idempotent. The canonical
-- SQL is split across migrations 20260610000004/000005/000006; this script is the
-- consolidated apply + verify record. Order matters: stat triggers DEFINER FIRST,
-- then the REVOKE/GRANT, then the sale RPCs.
-- =============================================================================

-- ---- BLOCK 1: SNAPSHOT (read-only) ----
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public'
  AND table_name IN ('profiles','products_services','reviews','sale_confirmations')
  AND grantee IN ('anon','authenticated')
ORDER BY table_name, grantee, privilege_type;

SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND grantee IN ('anon','authenticated')
ORDER BY grantee, column_name;

-- ---- BLOCK 2: APPLY (BEGIN/COMMIT -- all transactional DDL) ----
BEGIN;

-- 2a. stat triggers -> SECURITY DEFINER (must precede the REVOKE)
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

-- 2b. #5 profiles
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT  UPDATE (foto, fcm_token) ON public.profiles TO authenticated;

-- 2c. #7 products_services + view RPC
REVOKE UPDATE ON public.products_services FROM anon, authenticated;
GRANT  UPDATE (titulo, descripcion, precio, ubicacion, ubicacion_geo, tipo_entrega, estado,
  color, delivery_radius_km, precio_negociable, allow_appointments, appointment_start_time,
  appointment_end_time, appointment_duration_minutes, galeria_imagenes, imagen_principal,
  gallery_sizes, estatus, sort_order) ON public.products_services TO authenticated;

CREATE OR REPLACE FUNCTION public.increment_product_view(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$ BEGIN
  UPDATE public.products_services SET vistas_count = COALESCE(vistas_count,0)+1 WHERE id = p_id;
END; $$;
REVOKE ALL    ON FUNCTION public.increment_product_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_product_view(UUID) TO anon, authenticated;

-- 2d. #7 reviews
REVOKE UPDATE ON public.reviews FROM anon, authenticated;
GRANT  UPDATE (respuesta, respuesta_fecha) ON public.reviews TO authenticated;

-- 2e. #6 sale_confirmations RPCs + REVOKE
--   (full bodies in 20260610000006_ch3_sale_confirmation_rpcs.sql -- paste them here)
--   confirm_sale(p_sale_id), cancel_sale(p_sale_id, p_reason); then:
REVOKE UPDATE, DELETE, TRUNCATE ON public.sale_confirmations FROM anon, authenticated;

-- 2f. #7 collateral: admin/moderator moderation RPCs (full bodies in
--   20260610000008_ch3e_moderation_rpcs.sql): moderate_set_content_hidden(text,uuid,bool)
--   and moderate_review(uuid,bool,bool); both with has_role(admin|moderator) guard,
--   REVOKE anon / GRANT authenticated. They own the is_hidden/visible/reportada writes
--   that admin/moderation/actions.ts can no longer do directly after the REVOKE.

COMMIT;

-- ---- BLOCK 3: VERIFY (read-only) ----
-- 3a. profiles column UPDATE grant = only foto/fcm_token to authenticated; no table UPDATE
SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND privilege_type='UPDATE'
  AND grantee IN ('anon','authenticated') ORDER BY grantee, column_name;
-- 3b. sale_confirmations: only SELECT+INSERT for anon/authenticated
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='sale_confirmations' AND grantee IN ('anon','authenticated')
ORDER BY grantee, privilege_type;
-- 3c. stat triggers prosecdef=true
SELECT proname, prosecdef FROM pg_proc
WHERE proname IN ('check_sale_completion','handle_sale_cancellation','update_profile_trust_level',
                  'update_separated_ratings','update_user_rating_on_review','confirm_sale',
                  'cancel_sale','increment_product_view') ORDER BY proname;

-- ---- BLOCK 4: SMOKE (as authenticated; replace uuid) ----
-- attacker mass-assign -> expect 42501:
--   PATCH /rest/v1/profiles?id=eq.<me> { "is_verified": true }   -> 42501
--   PATCH /rest/v1/sale_confirmations?id=eq.<x> { "status":"completed" } -> 42501
--   PATCH /rest/v1/products_services?id=eq.<x> { "vistas_count": 999 }   -> 42501
-- legit: update foto / fcm_token; respuesta on a review; increment_product_view(<id>).
