-- S04-B. Producto compartido con CAS y confirmaciones atomicas.
-- No modifica ventas historicas ni los roles originales del chat (recibos).
-- Aplicar antes de publicar el cliente nuevo: los endpoints antiguos de
-- escritura directa dejan de estar autorizados. No ejecutar contra produccion
-- como parte de las pruebas; scripts/test-s04b-sql.ts usa datos sinteticos.
BEGIN;

ALTER TABLE public.chats ADD COLUMN producto_revision integer NOT NULL DEFAULT 0
  CHECK (producto_revision >= 0);
ALTER TABLE public.sale_confirmations
  ADD COLUMN clave_idempotencia uuid,
  ADD COLUMN producto_revision integer CHECK (producto_revision >= 0);
CREATE UNIQUE INDEX sale_confirmations_actor_clave_unica
  ON public.sale_confirmations (initiated_by, clave_idempotencia)
  WHERE clave_idempotencia IS NOT NULL;
CREATE UNIQUE INDEX messages_unique_sale_proposed
  ON public.messages (sale_confirmation_id)
  WHERE message_type = 'sale_proposed' AND sale_confirmation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.avanzar_producto_revision_chat()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  -- Incluye iniciar_conversacion/get_or_create_chat y el ON DELETE SET NULL.
  -- Un mensaje/recibo/cambio de ocultamiento no invalida el formulario.
  IF NEW.ultimo_producto_id IS DISTINCT FROM OLD.ultimo_producto_id THEN
    NEW.producto_revision := OLD.producto_revision + 1;
  ELSE
    NEW.producto_revision := OLD.producto_revision;
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER chat_producto_revision
  BEFORE UPDATE ON public.chats FOR EACH ROW
  EXECUTE FUNCTION public.avanzar_producto_revision_chat();

CREATE OR REPLACE FUNCTION public.seleccionar_producto_chat(
  p_chat_id uuid, p_producto_id uuid, p_revision_esperada integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_chat public.chats%ROWTYPE;
  v_producto public.products_services%ROWTYPE;
  v_otro uuid;
BEGIN
  IF v_actor IS NULL OR (SELECT vicino_guard.cuenta_suspendida()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_chat_id IS NULL OR p_producto_id IS NULL OR p_revision_esperada IS NULL
     OR p_revision_esperada < 0 THEN
    RAISE EXCEPTION 'Datos invalidos' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_chat FROM public.chats
    WHERE id = p_chat_id AND v_actor IN (comprador_id, vendedor_id) FOR UPDATE;
  IF NOT FOUND OR v_actor NOT IN (v_chat.comprador_id, v_chat.vendedor_id)
     OR v_chat.comprador_id = v_chat.vendedor_id THEN
    RAISE EXCEPTION 'Chat no disponible' USING ERRCODE = 'PT404';
  END IF;
  v_otro := CASE WHEN v_actor = v_chat.comprador_id THEN v_chat.vendedor_id ELSE v_chat.comprador_id END;
  IF v_otro = ANY(vicino_guard.bloqueados_conmigo())
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_otro AND is_hidden = false) THEN
    RAISE EXCEPTION 'Chat no disponible' USING ERRCODE = 'PT404';
  END IF;
  IF v_chat.producto_revision <> p_revision_esperada THEN
    RAISE EXCEPTION 'El producto del chat cambio' USING ERRCODE = 'PT409', HINT = 'product_changed';
  END IF;
  SELECT * INTO v_producto FROM public.products_services WHERE id = p_producto_id FOR SHARE;
  IF NOT FOUND OR v_producto.creador_id NOT IN (v_chat.comprador_id, v_chat.vendedor_id)
     OR v_producto.estatus IS DISTINCT FROM 'disponible' OR v_producto.is_hidden IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Producto no disponible' USING ERRCODE = 'PT404';
  END IF;
  UPDATE public.chats SET ultimo_producto_id = p_producto_id, updated_at = now()
    WHERE id = p_chat_id RETURNING * INTO v_chat;
  RETURN jsonb_build_object('revision', v_chat.producto_revision, 'product', jsonb_build_object(
    'id', v_producto.id, 'titulo', v_producto.titulo, 'precio', v_producto.precio,
    'modo_precio', v_producto.modo_precio, 'imagen_principal', v_producto.imagen_principal,
    'creador_id', v_producto.creador_id, 'estatus', v_producto.estatus, 'is_hidden', v_producto.is_hidden));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.iniciar_confirmacion_venta(
  p_chat_id uuid, p_producto_id uuid, p_revision_esperada integer, p_clave uuid,
  p_precio numeric, p_cantidad integer, p_metodo_pago text DEFAULT NULL,
  p_notas text DEFAULT NULL, p_tipo_entrega text DEFAULT 'pickup'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_chat public.chats%ROWTYPE;
  v_producto public.products_services%ROWTYPE;
  v_venta public.sale_confirmations%ROWTYPE;
  v_otro uuid;
  v_comprador uuid;
  v_nombre text;
BEGIN
  IF v_actor IS NULL OR (SELECT vicino_guard.cuenta_suspendida()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_chat_id IS NULL OR p_producto_id IS NULL OR p_clave IS NULL
     OR p_revision_esperada IS NULL OR p_revision_esperada < 0
     OR p_precio IS NULL OR p_precio <= 0 OR p_precio > 99999999
     OR p_precio <> trunc(p_precio, 2) OR p_precio::text = 'NaN'
     OR p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 9999
     OR p_tipo_entrega IS NULL OR p_tipo_entrega NOT IN ('pickup', 'envio')
     OR length(p_metodo_pago) > 200 OR length(p_notas) > 1000 THEN
    RAISE EXCEPTION 'Datos invalidos' USING ERRCODE = '22023';
  END IF;
  -- Orden global actor -> chat. La clave es unica por actor incluso entre
  -- chats diferentes; dos reintentos ven siempre la misma fila comprometida.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat:venta:' || v_actor::text, 0));
  SELECT * INTO v_chat FROM public.chats
    WHERE id = p_chat_id AND v_actor IN (comprador_id, vendedor_id) FOR UPDATE;
  IF NOT FOUND OR v_actor NOT IN (v_chat.comprador_id, v_chat.vendedor_id)
     OR v_chat.comprador_id = v_chat.vendedor_id THEN
    RAISE EXCEPTION 'Chat no disponible' USING ERRCODE = 'PT404';
  END IF;
  SELECT * INTO v_venta FROM public.sale_confirmations
    WHERE initiated_by = v_actor AND clave_idempotencia = p_clave;
  IF FOUND THEN
    IF v_venta.chat_id IS DISTINCT FROM p_chat_id OR v_venta.product_id IS DISTINCT FROM p_producto_id
       OR v_venta.producto_revision IS DISTINCT FROM p_revision_esperada
       OR v_venta.precio_acordado IS DISTINCT FROM p_precio OR v_venta.cantidad IS DISTINCT FROM p_cantidad
       OR v_venta.metodo_pago IS DISTINCT FROM p_metodo_pago OR v_venta.notas IS DISTINCT FROM p_notas
       OR v_venta.tipo_entrega IS DISTINCT FROM p_tipo_entrega THEN
      RAISE EXCEPTION 'La clave corresponde a otra operacion' USING ERRCODE = 'PT409', HINT = 'idempotency_conflict';
    END IF;
    RETURN jsonb_build_object('confirmation', to_jsonb(v_venta), 'repeated', true);
  END IF;
  v_otro := CASE WHEN v_actor = v_chat.comprador_id THEN v_chat.vendedor_id ELSE v_chat.comprador_id END;
  IF v_otro = ANY(vicino_guard.bloqueados_conmigo())
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_otro AND is_hidden = false) THEN
    RAISE EXCEPTION 'Chat no disponible' USING ERRCODE = 'PT404';
  END IF;
  IF v_chat.producto_revision <> p_revision_esperada OR v_chat.ultimo_producto_id IS DISTINCT FROM p_producto_id THEN
    RAISE EXCEPTION 'El producto del chat cambio' USING ERRCODE = 'PT409', HINT = 'product_changed';
  END IF;
  SELECT * INTO v_producto FROM public.products_services WHERE id = p_producto_id FOR SHARE;
  IF NOT FOUND OR v_producto.creador_id NOT IN (v_chat.comprador_id, v_chat.vendedor_id)
     OR v_producto.estatus IS DISTINCT FROM 'disponible' OR v_producto.is_hidden IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Producto no disponible' USING ERRCODE = 'PT404';
  END IF;
  IF EXISTS (SELECT 1 FROM public.sale_confirmations WHERE chat_id = p_chat_id AND status = 'pending_confirmation') THEN
    RAISE EXCEPTION 'Ya hay una confirmacion en curso' USING ERRCODE = 'PT409', HINT = 'pending_confirmation';
  END IF;
  v_comprador := CASE WHEN v_producto.creador_id = v_chat.comprador_id THEN v_chat.vendedor_id ELSE v_chat.comprador_id END;
  INSERT INTO public.sale_confirmations (
    chat_id, product_id, buyer_id, seller_id, initiated_by, precio_acordado,
    cantidad, metodo_pago, notas, tipo_entrega, clave_idempotencia, producto_revision
  ) VALUES (
    p_chat_id, p_producto_id, v_comprador, v_producto.creador_id, v_actor, p_precio,
    p_cantidad, p_metodo_pago, p_notas, p_tipo_entrega, p_clave, p_revision_esperada
  ) RETURNING * INTO v_venta;
  SELECT nombre INTO v_nombre FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.messages (chat_id, autor_id, texto, publicacion_id, sale_confirmation_id, message_type)
    VALUES (p_chat_id, v_actor,
      chr(129309) || ' ' || coalesce(v_nombre, 'Alguien') || ' ha iniciado una confirmaci' || chr(243) || 'n de venta por "' ||
      v_producto.titulo || '" - $' || to_char(p_precio, 'FM999,999,990.00') || ' MXN. Confirma para completar la venta.',
      p_producto_id, v_venta.id, 'sale_proposed');
  RETURN jsonb_build_object('confirmation', to_jsonb(v_venta), 'repeated', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.confirmar_venta(p_confirmacion_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_venta public.sale_confirmations%ROWTYPE;
  v_chat_id uuid;
  v_titulo text;
BEGIN
  -- Una cuenta suspendida conserva confirmar/cancelar tratos previos.
  IF v_actor IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501'; END IF;
  IF p_confirmacion_id IS NULL THEN RAISE EXCEPTION 'Datos invalidos' USING ERRCODE = '22023'; END IF;
  -- Mismo orden de bloqueo que seleccionar/iniciar: chat antes que venta y
  -- producto. El trigger de completar actualiza producto y el mensaje toca
  -- chat; bloquear primero la venta invertiria el orden en dos conexiones.
  SELECT chat_id INTO v_chat_id FROM public.sale_confirmations
    WHERE id = p_confirmacion_id AND v_actor IN (buyer_id, seller_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmacion no disponible' USING ERRCODE = 'PT404'; END IF;
  IF v_chat_id IS NOT NULL THEN
    PERFORM 1 FROM public.chats WHERE id = v_chat_id FOR UPDATE;
  END IF;
  SELECT * INTO v_venta FROM public.sale_confirmations WHERE id = p_confirmacion_id FOR UPDATE;
  IF NOT FOUND OR v_actor NOT IN (v_venta.buyer_id, v_venta.seller_id) THEN
    RAISE EXCEPTION 'Confirmacion no disponible' USING ERRCODE = 'PT404';
  END IF;
  IF v_venta.status = 'completed' THEN
    RETURN jsonb_build_object('success', true, 'alreadyConfirmed', true, 'chat_id', v_venta.chat_id);
  END IF;
  IF v_venta.status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'La confirmacion ya no esta pendiente' USING ERRCODE = 'PT409', HINT = 'confirmation_closed';
  END IF;
  IF (v_actor = v_venta.buyer_id AND coalesce(v_venta.buyer_confirmed, false))
     OR (v_actor = v_venta.seller_id AND coalesce(v_venta.seller_confirmed, false)) THEN
    RETURN jsonb_build_object('success', true, 'alreadyConfirmed', true, 'chat_id', v_venta.chat_id);
  END IF;
  IF v_actor = v_venta.buyer_id THEN
    UPDATE public.sale_confirmations SET buyer_confirmed = true, buyer_confirmed_at = now()
      WHERE id = p_confirmacion_id RETURNING * INTO v_venta;
  ELSE
    UPDATE public.sale_confirmations SET seller_confirmed = true, seller_confirmed_at = now()
      WHERE id = p_confirmacion_id RETURNING * INTO v_venta;
  END IF;
  -- complete_sale_on_mutual_confirm ya fijó el estado y los puntos en esta
  -- transaccion. Si falla el mensaje, tambien se revierten esos efectos.
  IF v_venta.status = 'completed' AND v_venta.chat_id IS NOT NULL THEN
    SELECT titulo INTO v_titulo FROM public.products_services WHERE id = v_venta.product_id;
    INSERT INTO public.messages (chat_id, autor_id, texto, publicacion_id, sale_confirmation_id, message_type)
      VALUES (v_venta.chat_id, v_actor,
        chr(9989) || ' ' || chr(161) || 'Venta confirmada en VICINO! "' || coalesce(v_titulo, 'el producto') ||
        '" - $' || to_char(v_venta.precio_acordado, 'FM999,999,990.00') || ' MXN. Deja tu rese' || chr(241) || 'a.',
        v_venta.product_id, v_venta.id, 'sale_confirmed')
      ON CONFLICT (sale_confirmation_id) WHERE message_type = 'sale_confirmed' AND sale_confirmation_id IS NOT NULL
      DO NOTHING;
  END IF;
  RETURN jsonb_build_object('success', true, 'alreadyConfirmed', false, 'chat_id', v_venta.chat_id);
END;
$fn$;

-- Cancelar sigue siendo una escritura de participante. No puede reabrir una
-- venta terminal ni deshacer la confirmacion del otro lado por REST directo.
CREATE OR REPLACE FUNCTION public.guard_sale_confirmation_client_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $fn$
DECLARE v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL THEN RETURN NEW; END IF;
  IF v_actor NOT IN (OLD.buyer_id, OLD.seller_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending_confirmation' THEN
    RAISE EXCEPTION 'La confirmacion ya no esta pendiente' USING ERRCODE = 'PT409';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND
     (NEW.status <> 'cancelled' OR NEW.cancelled_by IS DISTINCT FROM v_actor) THEN
    RAISE EXCEPTION 'Transicion de confirmacion no permitida' USING ERRCODE = '42501';
  END IF;
  IF (NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
      OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
      OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason)
     AND (NEW.status <> 'cancelled' OR NEW.cancelled_by IS DISTINCT FROM v_actor) THEN
    RAISE EXCEPTION 'La cancelacion debe pertenecer a quien cancela' USING ERRCODE = '42501';
  END IF;
  IF NEW.buyer_confirmed IS DISTINCT FROM OLD.buyer_confirmed AND
     (v_actor <> OLD.buyer_id OR NEW.buyer_confirmed IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'Solo el comprador confirma su lado' USING ERRCODE = '42501';
  END IF;
  IF NEW.seller_confirmed IS DISTINCT FROM OLD.seller_confirmed AND
     (v_actor <> OLD.seller_id OR NEW.seller_confirmed IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'Solo el vendedor confirma su lado' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

-- Revocar tabla y columnas: un permiso de tabla anularia el cierre por columna.
-- Preservar los permisos de ocultamiento/borrado/recibos de chats.
REVOKE UPDATE ON public.chats FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (ultimo_producto_id, producto_revision) ON public.chats FROM PUBLIC, anon, authenticated;
GRANT UPDATE (no_leidos_comprador, no_leidos_vendedor, oculto_para_comprador,
  oculto_para_vendedor, deleted_at_comprador, deleted_at_vendedor, updated_at)
  ON public.chats TO authenticated;
GRANT SELECT (producto_revision) ON public.chats TO authenticated;
REVOKE INSERT ON public.sale_confirmations FROM PUBLIC, anon, authenticated;
REVOKE INSERT (product_id, buyer_id, seller_id, chat_id, precio_acordado, cantidad,
  metodo_pago, notas, tipo_entrega, initiated_by, clave_idempotencia, producto_revision)
  ON public.sale_confirmations FROM PUBLIC, anon, authenticated;
REVOKE UPDATE ON public.sale_confirmations FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (buyer_confirmed, buyer_confirmed_at, seller_confirmed, seller_confirmed_at)
  ON public.sale_confirmations FROM PUBLIC, anon, authenticated;
GRANT UPDATE (status, cancelled_at, cancelled_by, cancel_reason)
  ON public.sale_confirmations TO authenticated;
GRANT SELECT (clave_idempotencia, producto_revision) ON public.sale_confirmations TO authenticated;

REVOKE ALL ON FUNCTION public.seleccionar_producto_chat(uuid, uuid, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.iniciar_confirmacion_venta(uuid, uuid, integer, uuid, numeric, integer, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirmar_venta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seleccionar_producto_chat(uuid, uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.iniciar_confirmacion_venta(uuid, uuid, integer, uuid, numeric, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_venta(uuid) TO authenticated;

DO $verify$
BEGIN
  IF has_column_privilege('authenticated', 'public.chats', 'ultimo_producto_id', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.sale_confirmations', 'product_id', 'INSERT')
    OR has_column_privilege('authenticated', 'public.sale_confirmations', 'buyer_confirmed', 'UPDATE') THEN
    RAISE EXCEPTION 'La escritura directa del contrato S04 sigue abierta';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.chats', 'deleted_at_comprador', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.chats', 'no_leidos_vendedor', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.sale_confirmations', 'cancelled_by', 'UPDATE') THEN
    RAISE EXCEPTION 'Se revocaron permisos ajenos al contrato S04';
  END IF;
END;
$verify$;
COMMIT;
