-- MP#07 Fase 2 — Atomic profile-update + product-pause RPC.
--
-- Problem: apps/web/app/(marketplace)/perfil/actions.ts performed two separate
-- writes (UPDATE profiles, then UPDATE products_services) when the user
-- flipped es_vendedor off. If the second update failed, the user landed in a
-- divergent state — profile says "not seller" but products still listed as
-- `disponible`. The previous mitigation was "self-healing" idempotence: every
-- subsequent save retried the pause. Functional, but not atomic.
--
-- Solution: a single SECURITY DEFINER function that performs BOTH updates in
-- one transaction. Functions in Postgres run inside an implicit transaction,
-- so either both updates succeed or neither does.
--
-- Authorization: SECURITY DEFINER + explicit check that auth.uid() = p_user_id
-- inside the function. Without this check, any authenticated user could
-- update any profile by passing a different p_user_id.
--
-- Schema-locked search_path follows the project pattern set in
-- 20260425000001_fix_security_definer_search_path.sql to prevent search_path
-- injection.

CREATE OR REPLACE FUNCTION public.update_profile_and_pause_products(
  p_user_id               UUID,
  p_nombre                TEXT,
  p_bio                   TEXT,
  p_foto                  TEXT,
  p_ubicacion             TEXT,
  p_es_vendedor           BOOLEAN,
  p_seller_type           TEXT,
  p_nombre_negocio        TEXT,
  p_descripcion_negocio   TEXT,
  p_metodos_pago_aceptados TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller          UUID := auth.uid();
  v_products_paused INTEGER := 0;
  v_profile_found   INTEGER := 0;
BEGIN
  -- Authorization: caller must be the profile owner. SECURITY DEFINER bypasses
  -- RLS, so we MUST enforce this explicitly. Anonymous calls (v_caller IS
  -- NULL) are rejected.
  IF v_caller IS NULL OR v_caller <> p_user_id THEN
    RAISE EXCEPTION 'No autorizado'
      USING ERRCODE = '42501', HINT = 'auth.uid() must match p_user_id';
  END IF;

  -- Validate seller_type early so we don't half-write on bad input. Mirrors
  -- the zod enum on the client (casual | business).
  IF p_seller_type IS NOT NULL AND p_seller_type NOT IN ('casual', 'business') THEN
    RAISE EXCEPTION 'seller_type inválido: %', p_seller_type
      USING ERRCODE = '22023';
  END IF;

  -- Write #1: profile. Server is the source of truth for the "seller-only
  -- fields are nulled when es_vendedor = false" rule — even if the caller
  -- sends populated values, we coerce them to NULL/casual.
  UPDATE public.profiles
  SET
    nombre                   = p_nombre,
    bio                      = p_bio,
    foto                     = p_foto,
    ubicacion                = p_ubicacion,
    es_vendedor              = p_es_vendedor,
    seller_type              = CASE WHEN p_es_vendedor THEN COALESCE(p_seller_type, 'casual') ELSE 'casual' END,
    nombre_negocio           = CASE WHEN p_es_vendedor THEN p_nombre_negocio        ELSE NULL END,
    descripcion_negocio      = CASE WHEN p_es_vendedor THEN p_descripcion_negocio   ELSE NULL END,
    metodos_pago_aceptados   = CASE WHEN p_es_vendedor THEN p_metodos_pago_aceptados ELSE NULL END
  WHERE id = p_user_id;

  GET DIAGNOSTICS v_profile_found = ROW_COUNT;
  IF v_profile_found = 0 THEN
    RAISE EXCEPTION 'Perfil no encontrado para id %', p_user_id
      USING ERRCODE = 'P0002';
  END IF;

  -- Write #2: pause any `disponible` products if the user is no longer a
  -- seller. Wrapped in the same transaction as Write #1 by virtue of being
  -- inside the same function — if this fails, the profile UPDATE rolls back.
  IF NOT p_es_vendedor THEN
    UPDATE public.products_services
    SET estatus = 'pausado'
    WHERE creador_id = p_user_id
      AND estatus = 'disponible';

    GET DIAGNOSTICS v_products_paused = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object(
    'profile_updated', TRUE,
    'products_paused', v_products_paused
  );
END;
$$;

-- Grant execute to authenticated users. anon stays blocked.
REVOKE ALL ON FUNCTION public.update_profile_and_pause_products(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

-- Supabase's project-level default privileges grant EXECUTE on every new
-- function in `public` directly to anon, authenticated, and service_role
-- (set via ALTER DEFAULT PRIVILEGES at provisioning, not in user migrations).
-- These are direct grants, so REVOKE FROM PUBLIC does NOT remove them. We
-- revoke from anon explicitly to enforce the auth.uid() gate at the grants
-- layer too — defense-in-depth in case the in-function auth check is ever
-- weakened by a future refactor. Pattern mirrors 20260320000019_account_deletion.sql.
REVOKE EXECUTE ON FUNCTION public.update_profile_and_pause_products(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) FROM anon;

GRANT EXECUTE ON FUNCTION public.update_profile_and_pause_products(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.update_profile_and_pause_products(
  UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) IS
  'MP#07 Fase 2: atomic profile update + product pause. Replaces two separate '
  '.update() calls in perfil/actions.ts. SECURITY DEFINER with explicit '
  'auth.uid() = p_user_id check. Returns { profile_updated, products_paused }.';

-- ─────────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual)
-- DROP FUNCTION IF EXISTS public.update_profile_and_pause_products(
--   UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
-- );
-- Then revert apps/web/app/(marketplace)/perfil/actions.ts to the two-update flow.
-- ─────────────────────────────────────────────────────────────────────────────
