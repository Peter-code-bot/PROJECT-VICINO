-- get_or_create_chat: el INSERT del par ya no puede morir con 23505.
--
-- La funcion hace SELECT del par y, si no existe, INSERT. Entre las dos
-- sentencias otra peticion (otra pestana, o iniciar_conversacion desde la
-- ficha mientras avisarCitaEnChat abre el mismo chat) puede crear el par, y
-- entonces el INSERT choca con idx_chats_pair y la llamada muere con un
-- unique_violation crudo que chat/page.tsx pinta como "chat contigo mismo".
-- Reproducido el 12-sep-2026 en el proyecto de pruebas durante la revision
-- del contrato de chat (dos transacciones concurrentes sobre el mismo par).
--
-- ARREGLO: ON CONFLICT sobre la expresion exacta de idx_chats_pair
-- (LEAST/GREATEST) y relectura. Misma firma, mismo cuerpo que 20260912130000
-- en todo lo demas (guardias de actor, bloqueo, suspension, unhide de un solo
-- lado). Sin cambios de tipos ni de TypeScript.
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
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  IF p_comprador_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'forbidden: el comprador tiene que ser quien llama'
      USING ERRCODE = '42501';
  END IF;

  IF p_vendedor_id IS NULL OR p_vendedor_id = v_actor THEN
    RAISE EXCEPTION 'no puedes iniciar un chat contigo mismo';
  END IF;

  IF NOT EXISTS (
       SELECT 1 FROM profiles p
        WHERE p.id = p_vendedor_id AND p.is_hidden = FALSE
     )
     OR p_vendedor_id = ANY (vicino_guard.bloqueados_conmigo())
  THEN
    RAISE EXCEPTION 'vendedor no disponible' USING ERRCODE = 'P0002';
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

-- ---------------------------------------------------------------------------
-- VERIFY (proyecto de pruebas, dos sesiones):
--   sesion 1: BEGIN; (B) SELECT get_or_create_chat('<B>', '<A>');   -- sin COMMIT todavia
--   sesion 2: BEGIN; (B) SELECT get_or_create_chat('<B>', '<A>');   -- espera
--   sesion 1: COMMIT;
--   sesion 2: -> devuelve el MISMO uuid en vez de 23505.
--   SELECT count(*) FROM pg_proc WHERE proname = 'get_or_create_chat';   -- 1
-- ---------------------------------------------------------------------------
