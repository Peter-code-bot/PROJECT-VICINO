-- get_or_create_chat y la policy de INSERT de chats: cerrar lo que la
-- revision del contrato de chat encontro en los CAMINOS VIEJOS.
--
-- 1. El INSERT del par ya no puede morir con 23505. La funcion hace SELECT
--    del par y, si no existe, INSERT. Entre las dos sentencias otra peticion
--    (otra pestana, o iniciar_conversacion desde la ficha mientras
--    avisarCitaEnChat abre el mismo chat) puede crear el par, y entonces el
--    INSERT choca con idx_chats_pair y la llamada muere con un unique_violation
--    crudo que chat/page.tsx pinta como "chat contigo mismo". Reproducido el
--    12-sep-2026 en el proyecto de pruebas con dos transacciones concurrentes.
--    ARREGLO: ON CONFLICT sobre la expresion exacta de idx_chats_pair y
--    relectura.
--
-- 2. Mismas guardias que iniciar_conversacion donde faltaban: sin sesion es
--    42501 (antes un P0001 sin codigo); anon deja de tener EXECUTE (antes lo
--    tenia y solo lo frenaba el RAISE de dentro); y p_producto_id tiene que
--    ser de ESE vendedor y estar visible (antes avisarCitaEnChat podia colgar
--    en ultimo_producto_id un producto de cualquier otra persona).
--
-- 3. La policy de INSERT de chats. "Authenticated users can create chats"
--    solo exigia ser comprador o vendedor de la fila, asi que un usuario
--    bloqueado o suspendido se saltaba el PT404 de las RPC creando el chat por
--    REST: el bloqueador lo veia en su lista (chats no filtra bloqueos) aunque
--    los mensajes no. Se exige lo mismo que las RPC: comprador = quien llama,
--    vendedor distinto, sin bloqueo en ningun sentido y cuenta no suspendida.
--    Ningun codigo de apps/web inserta en chats directamente (solo las dos RPC,
--    que son SECURITY DEFINER y no pasan por la policy): comprobado con grep.
--
-- Misma firma y mismo cuerpo que 20260912130000 en todo lo demas (unhide de
-- un solo lado, bloqueo, suspension). Sin cambios de tipos ni de TypeScript.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_or_create_chat(
  p_comprador_id UUID,
  p_vendedor_id UUID,
  p_producto_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID := (SELECT auth.uid());
  chat_id UUID;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  IF p_comprador_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'forbidden: el comprador tiene que ser quien llama'
      USING ERRCODE = '42501';
  END IF;

  IF (SELECT vicino_guard.cuenta_suspendida()) THEN
    RAISE EXCEPTION 'Tu cuenta esta suspendida.' USING ERRCODE = '42501';
  END IF;

  IF p_vendedor_id IS NULL OR p_vendedor_id = v_actor THEN
    RAISE EXCEPTION 'no puedes iniciar un chat contigo mismo' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM profiles p
        WHERE p.id = p_vendedor_id AND p.is_hidden = FALSE
     )
     OR p_vendedor_id = ANY (vicino_guard.bloqueados_conmigo())
  THEN
    RAISE EXCEPTION 'vendedor no disponible' USING ERRCODE = 'P0002';
  END IF;

  -- El producto que se cuelga del chat tiene que ser de ese vendedor y estar
  -- visible. Se conserva P0002 (y no PT404) por compatibilidad con el codigo
  -- que ya traduce este RPC.
  IF p_producto_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM products_services ps
        WHERE ps.id = p_producto_id
          AND ps.creador_id = p_vendedor_id
          AND ps.is_hidden = FALSE
          AND ps.estatus NOT IN ('borrador', 'eliminado')
     )
  THEN
    RAISE EXCEPTION 'producto no disponible' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO chat_id
  FROM chats
  WHERE (comprador_id = p_comprador_id AND vendedor_id = p_vendedor_id)
     OR (comprador_id = p_vendedor_id AND vendedor_id = p_comprador_id);

  IF chat_id IS NULL THEN
    -- Si otra peticion creo el par entre el SELECT y este INSERT, no se
    -- muere con 23505: se relee y se sigue con el chat que ya existe.
    INSERT INTO chats (comprador_id, vendedor_id, ultimo_producto_id)
    VALUES (p_comprador_id, p_vendedor_id, p_producto_id)
    ON CONFLICT (LEAST(comprador_id, vendedor_id), GREATEST(comprador_id, vendedor_id)) DO NOTHING
    RETURNING id INTO chat_id;

    IF chat_id IS NULL THEN
      SELECT id INTO chat_id
      FROM chats
      WHERE (comprador_id = p_comprador_id AND vendedor_id = p_vendedor_id)
         OR (comprador_id = p_vendedor_id AND vendedor_id = p_comprador_id);
      IF p_producto_id IS NOT NULL THEN
        UPDATE chats SET ultimo_producto_id = p_producto_id, updated_at = NOW()
        WHERE id = chat_id;
      END IF;
    END IF;
  ELSE
    IF p_producto_id IS NOT NULL THEN
      UPDATE chats SET ultimo_producto_id = p_producto_id, updated_at = NOW()
      WHERE id = chat_id;
    END IF;
  END IF;

  UPDATE chats SET
    oculto_para_comprador = CASE WHEN comprador_id = v_actor THEN FALSE ELSE oculto_para_comprador END,
    oculto_para_vendedor  = CASE WHEN vendedor_id  = v_actor THEN FALSE ELSE oculto_para_vendedor  END
  WHERE id = chat_id;

  RETURN chat_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_or_create_chat(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_or_create_chat(uuid, uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Policy de INSERT de chats. Expresion viva hasta hoy:
--   (select auth.uid()) = comprador_id OR (select auth.uid()) = vendedor_id
-- ---------------------------------------------------------------------------
ALTER POLICY "Authenticated users can create chats" ON public.chats
  WITH CHECK (
    comprador_id = (SELECT auth.uid())
    AND vendedor_id IS DISTINCT FROM (SELECT auth.uid())
    AND NOT (vendedor_id = ANY ((SELECT vicino_guard.bloqueados_conmigo())::uuid[]))
    AND NOT (SELECT vicino_guard.cuenta_suspendida())
  );

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- VERIFY (proyecto de pruebas):
--   dos sesiones:
--     sesion 1: BEGIN; (B) SELECT get_or_create_chat('<B>', '<A>');   -- sin COMMIT todavia
--     sesion 2: BEGIN; (B) SELECT get_or_create_chat('<B>', '<A>');   -- espera
--     sesion 1: COMMIT;  sesion 2 -> devuelve el MISMO uuid en vez de 23505.
--   (anon)  SELECT get_or_create_chat('<B>', '<A>');                    -- 42501 permission denied
--   (B)     SELECT get_or_create_chat('<B>', '<A>', '<producto de C>');  -- P0002
--   (B, con C bloqueando a B) INSERT INTO chats (comprador_id, vendedor_id) VALUES ('<B>','<C>'); -- 42501
--   (B)     INSERT INTO chats (comprador_id, vendedor_id) VALUES ('<C>','<B>');                   -- 42501 (no soy el comprador)
--   (B)     INSERT INTO chats (comprador_id, vendedor_id) VALUES ('<B>','<A>');                   -- 1 fila
--   SELECT count(*) FROM pg_proc WHERE proname = 'get_or_create_chat';   -- 1
--   SELECT has_function_privilege('anon', 'public.get_or_create_chat(uuid,uuid,uuid)', 'EXECUTE'); -- false
-- ---------------------------------------------------------------------------
