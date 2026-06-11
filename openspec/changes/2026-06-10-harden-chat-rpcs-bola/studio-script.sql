-- =============================================================================
-- CH-2 -- Harden chat RPCs (BOLA/IDOR #4) -- SUPABASE STUDIO SCRIPT
-- Change: 2026-06-10-harden-chat-rpcs-bola
-- =============================================================================
-- STATUS: ALREADY APPLIED by Pedro in Studio (Camino 2, COMMIT done). VERIFY:
-- both functions are authenticated|EXECUTE only, zero anon. Re-runnable/idempotent.
--   BLOCK 1 snapshot -> BLOCK 2 dry-run (BEGIN/ROLLBACK) -> BLOCK 3 real (COMMIT)
--   -> BLOCK 4 verify. Functions + grants are transactional DDL (no CONCURRENTLY).
-- =============================================================================


-- =============================================================================
-- BLOCK 1 -- SNAPSHOT BEFORE (read-only)
-- =============================================================================
SELECT proname, prosecdef, proacl, pg_get_function_arguments(oid) AS args
FROM pg_proc WHERE proname IN ('get_or_create_chat', 'mark_messages_as_read');

SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name IN ('get_or_create_chat', 'mark_messages_as_read')
  AND grantee IN ('anon', 'authenticated')
ORDER BY routine_name, grantee;


-- =============================================================================
-- BLOCK 2 -- DRY-RUN (BEGIN/ROLLBACK -- persists nothing). Replace the <uuid>s.
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.get_or_create_chat(
  p_comprador_id UUID, p_vendedor_id UUID, p_producto_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_comprador UUID := auth.uid(); chat_id UUID;
BEGIN
  IF v_comprador IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF v_comprador = p_vendedor_id THEN
    RAISE EXCEPTION 'no puedes iniciar un chat contigo mismo' USING ERRCODE = '22023';
  END IF;
  IF p_producto_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.products_services WHERE id = p_producto_id AND creador_id = p_vendedor_id
  ) THEN
    RAISE EXCEPTION 'producto invalido' USING ERRCODE = '22023';
  END IF;
  SELECT id INTO chat_id FROM public.chats
  WHERE (comprador_id = v_comprador AND vendedor_id = p_vendedor_id)
     OR (comprador_id = p_vendedor_id AND vendedor_id = v_comprador);
  IF chat_id IS NULL THEN
    INSERT INTO public.chats (comprador_id, vendedor_id, ultimo_producto_id)
    VALUES (v_comprador, p_vendedor_id, p_producto_id) RETURNING id INTO chat_id;
  ELSE
    IF p_producto_id IS NOT NULL THEN
      UPDATE public.chats SET ultimo_producto_id = p_producto_id, updated_at = NOW() WHERE id = chat_id;
    END IF;
  END IF;
  UPDATE public.chats SET oculto_para_comprador = FALSE, oculto_para_vendedor = FALSE WHERE id = chat_id;
  RETURN chat_id;
END; $$;

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_chat_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_user UUID := auth.uid(); v_comprador UUID; v_vendedor UUID;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  SELECT comprador_id, vendedor_id INTO v_comprador, v_vendedor FROM public.chats WHERE id = p_chat_id;
  IF v_comprador IS NULL THEN RETURN; END IF;
  IF v_user = v_comprador THEN
    UPDATE public.messages SET leido_por_comprador = TRUE WHERE chat_id = p_chat_id AND leido_por_comprador = FALSE;
    UPDATE public.chats SET no_leidos_comprador = 0 WHERE id = p_chat_id;
  ELSIF v_user = v_vendedor THEN
    UPDATE public.messages SET leido_por_vendedor = TRUE WHERE chat_id = p_chat_id AND leido_por_vendedor = FALSE;
    UPDATE public.chats SET no_leidos_vendedor = 0 WHERE id = p_chat_id;
  ELSE
    RAISE EXCEPTION 'forbidden: no eres participante de este chat' USING ERRCODE = '42501';
  END IF;
END; $$;

REVOKE ALL     ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_chat(UUID, UUID, UUID) TO authenticated;
REVOKE ALL     ON FUNCTION public.mark_messages_as_read(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_messages_as_read(UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.mark_messages_as_read(UUID, UUID) TO authenticated;

-- ---- SMOKES (uncomment; run as real sessions) ----
-- S1 non-participant mark-read -> expect 'forbidden: no eres participante de este chat'
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<OUTSIDER_UUID>","role":"authenticated"}';
--   SELECT public.mark_messages_as_read('<CHAT_UUID>'::uuid, '<ANY_UUID>'::uuid);
-- ROLLBACK;
--
-- S2 get_or_create_chat ignores p_comprador_id -> chat created with auth.uid() as buyer
-- BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<BUYER_UUID>","role":"authenticated"}';
--   SELECT public.get_or_create_chat('<VICTIM_UUID>'::uuid, '<SELLER_UUID>'::uuid, NULL);
--   -- then: SELECT comprador_id FROM chats WHERE id = <returned>; -- must equal BUYER_UUID
-- ROLLBACK;

ROLLBACK;
-- ^ nothing persisted. If smokes pass, run BLOCK 3.


-- =============================================================================
-- BLOCK 3 -- REAL APPLY (same DDL, COMMIT). Paste the same two CREATE OR REPLACE
-- + the six REVOKE/GRANT statements from BLOCK 2 between BEGIN and COMMIT.
-- =============================================================================
-- BEGIN;
--   (two CREATE OR REPLACE FUNCTION ... as in BLOCK 2)
--   (six REVOKE/GRANT ... as in BLOCK 2)
-- COMMIT;


-- =============================================================================
-- BLOCK 4 -- VERIFY (read-only): both functions authenticated|EXECUTE, zero anon
-- =============================================================================
SELECT proname, prosecdef, proacl FROM pg_proc
WHERE proname IN ('get_or_create_chat', 'mark_messages_as_read');

SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name IN ('get_or_create_chat', 'mark_messages_as_read')
  AND grantee IN ('anon', 'authenticated')
ORDER BY routine_name, grantee;
-- Expected: only authenticated|EXECUTE rows; NO anon rows.
