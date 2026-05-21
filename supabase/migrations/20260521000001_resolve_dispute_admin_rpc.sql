-- =============================================================================
-- resolve_dispute_admin RPC — transactional admin dispute resolution
-- =============================================================================
--
-- Reemplaza el patron UPDATE + INSERT separados en
-- apps/web/app/admin/disputes/actions.ts por una sola transaccion atomic.
--
-- Garantiza:
--   - Solo admins pueden ejecutar (has_role check con SECURITY DEFINER bypass de RLS).
--   - Decision restringida a estados terminales (resolved_buyer/resolved_seller/closed).
--   - UPDATE solo dispara si el estado actual es open o under_review (anti re-resolucion).
--   - Si el INSERT a audit_log falla, todo el UPDATE se revierte.
--   - search_path fijado a (public, pg_temp) para prevenir injection.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.resolve_dispute_admin(
  p_dispute_id UUID,
  p_decision public.dispute_status,
  p_nota TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated_id UUID;
  v_actor UUID := auth.uid();
BEGIN
  -- Guard 1: actor autenticado
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated: auth.uid() is null';
  END IF;

  -- Guard 2: actor tiene rol admin
  IF NOT public.has_role(v_actor, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  -- Guard 3: decision dentro del subset terminal valido
  -- (excluye 'open' y 'under_review' del enum dispute_status)
  IF p_decision NOT IN (
    'resolved_buyer'::public.dispute_status,
    'resolved_seller'::public.dispute_status,
    'closed'::public.dispute_status
  ) THEN
    RAISE EXCEPTION 'invalid decision: %', p_decision;
  END IF;

  -- UPDATE con guard de estado previo + RETURNING para detectar 0 filas
  UPDATE public.disputes
  SET status      = p_decision,
      resolucion  = NULLIF(p_nota, ''),
      admin_id    = v_actor,
      resolved_at = now()
  WHERE id = p_dispute_id
    AND status IN (
      'open'::public.dispute_status,
      'under_review'::public.dispute_status
    )
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RAISE EXCEPTION 'dispute not found or already resolved';
  END IF;

  -- INSERT en audit_log dentro de la misma transaccion.
  -- Si esto falla por cualquier razon, el UPDATE de arriba se revierte.
  INSERT INTO public.audit_log (actor_id, action, target_type, target_id, metadata)
  VALUES (
    v_actor,
    'resolve_dispute',
    'dispute',
    p_dispute_id::text,
    jsonb_build_object(
      'decision', p_decision::text,
      'nota', p_nota
    )
  );

  RETURN v_updated_id;
END;
$$;

-- Solo usuarios autenticados pueden invocar el RPC; el guard interno hace el resto.
REVOKE ALL ON FUNCTION public.resolve_dispute_admin(UUID, public.dispute_status, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_dispute_admin(UUID, public.dispute_status, TEXT) TO authenticated;

COMMENT ON FUNCTION public.resolve_dispute_admin(UUID, public.dispute_status, TEXT) IS
  'Transactional admin dispute resolution. Validates admin role via has_role, '
  'transitions disputes.status with WHERE guard against terminal states, writes '
  'audit_log atomically. RAISE EXCEPTION on invalid actor/state/decision. '
  'SECURITY DEFINER + SET search_path = public, pg_temp mitigates search_path injection.';
