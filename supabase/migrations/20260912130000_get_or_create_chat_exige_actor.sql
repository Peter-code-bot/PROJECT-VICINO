-- get_or_create_chat recibia al comprador como argumento y se lo creia.
--
-- La funcion es SECURITY DEFINER (salta la RLS de chats) y su firma lleva
-- p_comprador_id como parametro sin comprobar que sea auth.uid(). Cualquier
-- cuenta autenticada podia, con una llamada directa al RPC:
--
--   - crear un chat entre dos personas ajenas (A y B, sin ser ninguna);
--   - des-ocultar un chat que la otra parte habia escondido, sin escribir
--     ningun mensaje (el bloque "unhide for both users");
--   - fijar ultimo_producto_id de un chat ajeno a cualquier producto.
--
-- Comprobado el 12-sep-2026 contra el ACL vivo: EXECUTE para authenticated,
-- sin ninguna comprobacion del actor en el cuerpo (20260320000009).
--
-- ARREGLO MINIMO, mismo nombre y misma firma para no tocar TypeScript ni los
-- tipos generados (el contrato nuevo de contacto/compra, con clave de
-- idempotencia, va en su propia rama y no sustituye a esta funcion todavia):
--
--   1. Sin sesion: excepcion. Si p_comprador_id no es quien llama: 42501.
--   2. Chat con uno mismo: excepcion (el servidor ya lo rechazaba; ahora
--      tambien la base, que es la que responde a la llamada directa).
--   3. Vendedor suspendido o con bloqueo en cualquier sentido: P0002 (no
--      existe para ti), igual que sus productos ya no existen para ti.
--   4. El unhide deja de tocar el lado de la OTRA persona. Quien abre el chat
--      lo ve; la otra parte lo vuelve a ver cuando llegue un mensaje (eso ya
--      lo hace el trigger unhide_chat_on_new_message). Antes, abrir la ficha
--      de un producto resucitaba en la lista del vendedor un chat vacio que
--      el habia borrado.
--
-- El resto (busqueda del par en los dos sentidos, INSERT, bump de
-- ultimo_producto_id) es el cuerpo vivo. search_path se re-declara porque
-- CREATE OR REPLACE sustituye la configuracion de la funcion; el ACL se
-- conserva.
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

  -- Vendedor suspendido, inexistente o con bloqueo en cualquier sentido: la
  -- misma respuesta en los tres casos, para no confirmar bloqueos.
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
    INSERT INTO chats (comprador_id, vendedor_id, ultimo_producto_id)
    VALUES (p_comprador_id, p_vendedor_id, p_producto_id)
    RETURNING id INTO chat_id;
  ELSE
    IF p_producto_id IS NOT NULL THEN
      UPDATE chats SET ultimo_producto_id = p_producto_id, updated_at = NOW()
      WHERE id = chat_id;
    END IF;
  END IF;

  -- Solo el lado de quien llama. El de la otra persona lo reabre el trigger
  -- unhide_chat_on_new_message cuando de verdad haya un mensaje.
  UPDATE chats SET
    oculto_para_comprador = CASE WHEN comprador_id = v_actor THEN FALSE ELSE oculto_para_comprador END,
    oculto_para_vendedor  = CASE WHEN vendedor_id  = v_actor THEN FALSE ELSE oculto_para_vendedor  END
  WHERE id = chat_id;

  RETURN chat_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- VERIFY (dentro de BEGIN ... ROLLBACK, con A y B perfiles reales no admin):
--
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<A>","role":"authenticated"}';
--
--   SELECT public.get_or_create_chat('<B>', '<A>');        -- 42501: A no es <B>
--   SELECT public.get_or_create_chat('<A>', '<A>');        -- excepcion: contigo mismo
--   SELECT public.get_or_create_chat('<A>', '<B>');        -- uuid (crea)
--   SELECT public.get_or_create_chat('<A>', '<B>');        -- el MISMO uuid
--
--   -- bloqueo: B bloquea a A (como postgres, antes del SET ROLE), y A llama:
--   SELECT public.get_or_create_chat('<A>', '<B>');        -- P0002
--
--   -- unhide de un solo lado: con el chat existente, oculto para el vendedor B:
--   UPDATE public.chats SET oculto_para_vendedor = true WHERE id = '<chat>';
--   SELECT public.get_or_create_chat('<A>', '<B>');
--   SELECT oculto_para_comprador, oculto_para_vendedor FROM public.chats
--    WHERE id = '<chat>';                                   -- false, true
--
--   SELECT count(*) FROM pg_proc WHERE proname = 'get_or_create_chat';  -- 1
--   SELECT proconfig FROM pg_proc WHERE proname = 'get_or_create_chat'; -- {search_path=public, pg_temp}
-- ---------------------------------------------------------------------------
