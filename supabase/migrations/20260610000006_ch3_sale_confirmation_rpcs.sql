-- =============================================================================
-- CH-3d -- sale_confirmations: per-actor RPCs + revoke direct mutation (#6)
-- Change: openspec/changes/2026-06-10-mass-assignment-column-locks
-- =============================================================================
-- WHY: the UPDATE policy let a participant set BOTH buyer_confirmed AND
-- seller_confirmed (and status='completed') in a single PATCH, so one party could
-- unilaterally complete a sale (grant trust, bump ventas_count via the completion
-- trigger). Fix: revoke direct UPDATE/DELETE; route confirmation + cancellation
-- through SECURITY DEFINER RPCs that derive the actor from auth.uid() and only
-- touch that actor's own flag. NO column allowlist here -- a grant on `status`
-- would re-open the unilateral-complete path.
--
-- STATUS: applied in Studio (Camino 2, COMMIT). Idempotent mirror (reconstructed
-- from the applied behavior; reconcile vs pg_get_functiondef). SELECT + INSERT on
-- sale_confirmations are kept (INSERT governed by its policy).
-- App: chat/actions.ts confirmSale -> confirm_sale; cancelSale -> cancel_sale.
-- =============================================================================

-- ---- confirm_sale: sets ONLY the caller's confirm flag ----
CREATE OR REPLACE FUNCTION public.confirm_sale(p_sale_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  -- Participant guard: only the buyer or seller of this sale may act.
  IF NOT EXISTS (
    SELECT 1 FROM public.sale_confirmations
    WHERE id = p_sale_id AND (buyer_id = v_actor OR seller_id = v_actor)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- Set ONLY the actor's own flag. The other side's flag is never touched, so a
  -- single call can never complete the sale by itself. The completion trigger
  -- (check_sale_completion) flips status when BOTH flags are true. A non-pending
  -- sale (race) matches 0 rows -> no-op (the caller re-reads status).
  UPDATE public.sale_confirmations
  SET buyer_confirmed     = CASE WHEN buyer_id  = v_actor THEN true ELSE buyer_confirmed END,
      buyer_confirmed_at  = CASE WHEN buyer_id  = v_actor AND NOT buyer_confirmed  THEN now() ELSE buyer_confirmed_at END,
      seller_confirmed    = CASE WHEN seller_id = v_actor THEN true ELSE seller_confirmed END,
      seller_confirmed_at = CASE WHEN seller_id = v_actor AND NOT seller_confirmed THEN now() ELSE seller_confirmed_at END
  WHERE id = p_sale_id
    AND status = 'pending_confirmation'
    AND (buyer_id = v_actor OR seller_id = v_actor);
END;
$$;
REVOKE ALL     ON FUNCTION public.confirm_sale(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.confirm_sale(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.confirm_sale(UUID) TO authenticated;

-- ---- cancel_sale: participant cancels a pending sale; returns chat_id ----
CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_chat  UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.sale_confirmations
    WHERE id = p_sale_id AND (buyer_id = v_actor OR seller_id = v_actor)
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE public.sale_confirmations
  SET status       = 'cancelled',
      cancelled_at  = now(),
      cancelled_by  = v_actor,
      cancel_reason = p_reason
  WHERE id = p_sale_id
    AND status = 'pending_confirmation'
  RETURNING chat_id INTO v_chat;

  RETURN v_chat;  -- NULL if the sale was no longer pending (race) -> caller shows "ya modificada"
END;
$$;
REVOKE ALL     ON FUNCTION public.cancel_sale(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_sale(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.cancel_sale(UUID, TEXT) TO authenticated;

-- ---- revoke direct mutation; keep SELECT + INSERT ----
REVOKE UPDATE, DELETE, TRUNCATE ON public.sale_confirmations FROM anon, authenticated;

-- =============================================================================
-- ROLLBACK (manual): DROP FUNCTION confirm_sale(UUID), cancel_sale(UUID, TEXT);
-- re-GRANT UPDATE ON sale_confirmations (NOT recommended -- re-opens #6) and revert
-- chat/actions.ts to the direct .update() flow.
-- =============================================================================
