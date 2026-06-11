-- =============================================================================
-- CH-3a/b/c -- column-level write locks on profiles / products_services / reviews
-- + increment_product_view RPC (audit findings #5, #7)
-- Change: openspec/changes/2026-06-10-mass-assignment-column-locks
-- =============================================================================
-- WHY: anon AND authenticated had table-wide UPDATE on these tables, so a direct
-- PostgREST PATCH could mass-assign privileged columns (profiles.is_verified /
-- trust_* / es_vendedor / is_hidden / email / rfc / ubicacion_lat,lng / fcm_token;
-- products stats + is_hidden; reviews visible / is_hidden / reportada). RLS row
-- ownership does NOT protect columns. Fix: revoke UPDATE and grant only the safe
-- columns the app actually writes; privileged columns become writable only by
-- SECURITY DEFINER RPCs / triggers / admin.
--
-- STATUS: applied in Studio (Camino 2, COMMIT). Idempotent mirror. Depends on
-- 20260610000004 (stats triggers already SECURITY DEFINER) so trigger writes to
-- the revoked stat columns keep working.
--
-- Column allowlists derived from docs/security/2026-06-10-ch3-mass-assignment-prep.md
-- (every direct client write was inventoried).
-- =============================================================================

-- ---- #5 profiles: only foto + fcm_token are written directly by the client ----
-- (avatar uploader -> foto; push hook -> fcm_token). Everything else (nombre/bio/
-- ubicacion/telefono/es_vendedor/...) goes through update_profile_and_pause_products
-- (SECURITY DEFINER), which bypasses this column grant.
REVOKE UPDATE ON public.profiles FROM anon, authenticated;
GRANT  UPDATE (foto, fcm_token) ON public.profiles TO authenticated;

-- ---- #7 products_services: owner-editable columns only (NO stats / is_hidden) ----
REVOKE UPDATE ON public.products_services FROM anon, authenticated;
GRANT  UPDATE (
  titulo, descripcion, precio, ubicacion, ubicacion_geo, tipo_entrega, estado,
  color, delivery_radius_km, precio_negociable, allow_appointments,
  appointment_start_time, appointment_end_time, appointment_duration_minutes,
  galeria_imagenes, imagen_principal, gallery_sizes, estatus, sort_order
) ON public.products_services TO authenticated;
-- Blocked at the column-grant layer: ventas_count, vistas_count, favoritos_count,
-- is_hidden, creador_id, categoria (frozen by writer-stop).

-- view counter: the product detail page used to UPDATE vistas_count directly (any
-- viewer). That now 42501s. Move it to a SECURITY DEFINER RPC that owns the stat.
CREATE OR REPLACE FUNCTION public.increment_product_view(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.products_services
  SET vistas_count = COALESCE(vistas_count, 0) + 1
  WHERE id = p_id;
END;
$$;
REVOKE ALL    ON FUNCTION public.increment_product_view(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.increment_product_view(UUID) TO anon, authenticated;

-- ---- #7 reviews: the reviewed user may only write their response ----
REVOKE UPDATE ON public.reviews FROM anon, authenticated;
GRANT  UPDATE (respuesta, respuesta_fecha) ON public.reviews TO authenticated;
-- Blocked: visible, is_hidden, reportada, motivo_reporte, rating, comentario.
-- (Creating a NEW review stays governed by the reviews INSERT policy.)
