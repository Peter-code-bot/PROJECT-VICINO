-- =============================================================================
-- CH-2 -- Harden chat RPCs against BOLA/IDOR (audit finding #4)
-- Change: openspec/changes/2026-06-10-harden-chat-rpcs-bola
-- =============================================================================
-- WHY: get_or_create_chat and mark_messages_as_read were SECURITY DEFINER but
-- derived the acting user from a CLIENT-SUPPLIED parameter, not auth.uid(). A
-- direct PostgREST call (bypassing the app) could therefore operate as any user
-- (CWE-639 / CWE-862): create/reopen chats between arbitrary third parties, or
-- mark another user's messages read / zero their unread counter. Extra finding:
-- mark_messages_as_read's ELSE branch treated "not the buyer" as "is the seller",
-- so a logged-in NON-participant could zero the seller's unread counter.
--
-- WHAT (Option C -- signature-preserving): both functions keep their existing
-- signatures (so the 3 live call sites and PostgREST keep resolving -- no
-- deploy-order race, zero app edits) but now derive the actor from auth.uid()
-- and ignore the client-supplied id param. get_or_create_chat also rejects
-- self-chat and validates the product belongs to the seller. mark_messages_as_read
-- adds a participation guard. Both REVOKE anon and keep search_path locked.
--
-- STATUS: already applied by Pedro in Supabase Studio (Camino 2, COMMIT done).
-- VERIFY: both functions are authenticated|EXECUTE only, zero anon. This file is
-- the idempotent mirror for git. NOTE: reconstructed from the applied behavior
-- per the CH-2 design; reconcile against pg_get_functiondef if in doubt.
--
-- RUN MODEL: applied manually in Studio. NOT via supabase db push (ledger desynced).
-- Call sites unchanged: apps/web/app/(marketplace)/chat/actions.ts:43,197 and
-- apps/web/app/(marketplace)/chat/[id]/page.tsx:87 (all already pass user.id).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- get_or_create_chat -- buyer is ALWAYS auth.uid() (p_comprador_id ignored)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_or_create_chat(
  p_comprador_id UUID,
  p_vendedor_id  UUID,
  p_producto_id  UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_comprador UUID := auth.uid();
  chat_id     UUID;
BEGIN
  -- #4: the buyer is the caller, never the payload. p_comprador_id is kept in the
  -- signature (so existing 3-arg calls keep resolving) but IGNORED.
  IF v_comprador IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF v_comprador = p_vendedor_id THEN
    RAISE EXCEPTION 'no puedes iniciar un chat contigo mismo' USING ERRCODE = '22023';
  END IF;

  -- Validate the product actually belongs to the seller when one is provided.
  IF p_producto_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products_services
    WHERE id = p_producto_id AND creador_id = p_vendedor_id
  ) THEN
    RAISE EXCEPTION 'producto invalido' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO chat_id
  FROM public.chats
  WHERE (comprador_id = v_comprador  AND vendedor_id = p_vendedor_id)
     OR (comprador_id = p_vendedor_id AND vendedor_id = v_comprador);

  IF chat_id IS NULL THEN
    INSERT INTO public.chats (comprador_id, vendedor_id, ultimo_producto_id)
    VALUES (v_comprador, p_vendedor_id, p_producto_id)
    RETURNING id INTO chat_id;
  ELSE
    IF p_producto_id IS NOT NULL THEN
      UPDATE public.chats SET ultimo_producto_id = p_producto_id, updated_at = NOW()
      WHERE id = chat_id;
    END IF;
  END IF;

  -- Unhide for both participants (reopen-on-contact semantics, unchanged).
  UPDATE public.chats SET
    oculto_para_comprador = FALSE,
    oculto_para_vendedor  = FALSE
  WHERE id = chat_id;

  RETURN chat_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- mark_messages_as_read -- actor is ALWAYS auth.uid(); participation enforced
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_messages_as_read(
  p_chat_id UUID,
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_comprador UUID;
  v_vendedor  UUID;
BEGIN
  -- #4: the actor is auth.uid(), never the payload. p_user_id is IGNORED.
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT comprador_id, vendedor_id INTO v_comprador, v_vendedor
  FROM public.chats WHERE id = p_chat_id;

  IF v_comprador IS NULL THEN
    RETURN; -- chat not found: no-op
  END IF;

  IF v_user = v_comprador THEN
    UPDATE public.messages SET leido_por_comprador = TRUE
    WHERE chat_id = p_chat_id AND leido_por_comprador = FALSE;
    UPDATE public.chats SET no_leidos_comprador = 0 WHERE id = p_chat_id;
  ELSIF v_user = v_vendedor THEN
    UPDATE public.messages SET leido_por_vendedor = TRUE
    WHERE chat_id = p_chat_id AND leido_por_vendedor = FALSE;
    UPDATE public.chats SET no_leidos_vendedor = 0 WHERE id = p_chat_id;
  ELSE
    -- Participation guard: previously the ELSE branch let a NON-participant zero
    -- the seller's unread counter. Now non-participants are rejected.
    RAISE EXCEPTION 'forbidden: no eres participante de este chat'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- Grants: revoke anon, keep authenticated. (search_path already locked above and
-- in 20260425000001; auth.uid() guard rejects anon anyway -- defense in depth.)
-- ----------------------------------------------------------------------------
REVOKE ALL     ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) TO authenticated;

REVOKE ALL     ON FUNCTION public.mark_messages_as_read(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_messages_as_read(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mark_messages_as_read(UUID, UUID) TO authenticated;

COMMENT ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) IS
  'CH-2 (#4): buyer derived from auth.uid() (p_comprador_id ignored), self-chat '
  'rejected, product-belongs-to-seller validated. Signature preserved (no app edit).';
COMMENT ON FUNCTION public.mark_messages_as_read(UUID, UUID) IS
  'CH-2 (#4): actor derived from auth.uid() (p_user_id ignored) + participation '
  'guard (non-participants rejected). Signature preserved (no app edit).';

-- =============================================================================
-- ROLLBACK (manual): restore the pre-#4 bodies from 20260320000009 and re-grant
-- (NOT recommended -- re-opens the BOLA/IDOR). The REVOKE anon should remain.
-- =============================================================================
