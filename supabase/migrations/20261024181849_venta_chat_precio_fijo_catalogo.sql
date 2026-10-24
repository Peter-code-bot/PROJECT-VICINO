-- VENTA-CHAT-01: fixed catalog totals; no changes to persisted terms or signatures.
-- Generated with Supabase CLI migration new. Apply after 20261023010000.
BEGIN;
CREATE OR REPLACE FUNCTION public.set_purchase_intent_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.products_services%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.intent_snapshot IS DISTINCT FROM OLD.intent_snapshot THEN
     RAISE EXCEPTION 'Las condiciones originales son inmutables' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 NEW.intent_snapshot:=NULL;
 NEW.intent_status:=NULL;
 IF NEW.message_type='purchase_intent' THEN
   SELECT * INTO p FROM public.products_services WHERE id=NEW.publicacion_id FOR SHARE;
   IF NOT FOUND OR p.creador_id=NEW.autor_id OR p.is_hidden IS DISTINCT FROM false OR p.estatus::text IS DISTINCT FROM 'disponible'
      OR NOT EXISTS(SELECT 1 FROM public.chats c WHERE c.id=NEW.chat_id
        AND NEW.autor_id IN(c.comprador_id,c.vendedor_id) AND p.creador_id IN(c.comprador_id,c.vendedor_id)) THEN
     RAISE EXCEPTION 'Producto no disponible' USING ERRCODE='PT404';
   END IF;
   NEW.intent_status:='pending';
   NEW.intent_snapshot:=jsonb_build_object('productId',p.id,'title',p.titulo,
     'kind',CASE WHEN p.tipo::text='servicio' THEN 'service' ELSE 'product' END,
     'priceMode',p.modo_precio,'priceNegotiable',p.precio_negociable,
     'price',CASE WHEN p.modo_precio='precio' AND NOT p.precio_negociable AND p.precio>0 THEN p.precio ELSE NULL END,
     'quantity',1,'sellerId',p.creador_id,'buyerId',NEW.autor_id,'notes',NULL);
 END IF;
 RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.iniciar_confirmacion_venta(
  p_chat_id uuid, p_producto_id uuid, p_revision_esperada integer, p_clave uuid,
  p_precio numeric, p_cantidad integer, p_metodo_pago text DEFAULT NULL,
  p_notas text DEFAULT NULL, p_tipo_entrega text DEFAULT NULL
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
  v_precio_total numeric;
BEGIN
  IF v_actor IS NULL OR (SELECT vicino_guard.cuenta_suspendida()) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_chat_id IS NULL OR p_producto_id IS NULL OR p_clave IS NULL
     OR p_revision_esperada IS NULL OR p_revision_esperada < 0
     OR p_precio IS NULL OR p_precio <= 0 OR p_precio > 99999999
     OR p_precio <> trunc(p_precio, 2) OR p_precio::text = 'NaN'
     OR p_cantidad IS NULL OR p_cantidad < 1 OR p_cantidad > 9999
     OR (p_tipo_entrega IS NOT NULL AND p_tipo_entrega NOT IN ('pickup', 'envio'))
     OR length(p_metodo_pago) > 200 OR length(p_notas) > 1000 THEN
    RAISE EXCEPTION 'Datos invalidos' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('chat:venta:' || v_actor::text, 0));
  SELECT * INTO v_chat FROM public.chats
    WHERE id = p_chat_id AND v_actor IN (comprador_id, vendedor_id) FOR UPDATE;
  IF NOT FOUND OR v_actor NOT IN (v_chat.comprador_id, v_chat.vendedor_id)
     OR v_chat.comprador_id = v_chat.vendedor_id THEN
    RAISE EXCEPTION 'Chat no disponible' USING ERRCODE = 'PT404';
  END IF;

  v_otro := CASE WHEN v_actor = v_chat.comprador_id THEN v_chat.vendedor_id ELSE v_chat.comprador_id END;
  IF v_otro = ANY(vicino_guard.bloqueados_conmigo()) OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id=v_otro AND NOT is_hidden) THEN
    RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='PT404';
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

  -- Only a new operation uses the current catalog; persisted retries returned above.
  -- PostgreSQL numeric multiplication keeps the total exact to the stored centavos.
  IF v_producto.modo_precio='precio' AND NOT v_producto.precio_negociable THEN
    v_precio_total := v_producto.precio * p_cantidad;
    IF v_precio_total IS NULL OR v_precio_total <= 0 OR v_precio_total > 99999999
       OR v_precio_total::text='NaN' OR p_precio IS DISTINCT FROM v_precio_total THEN
      RAISE EXCEPTION 'El precio del producto cambio; actualiza las condiciones'
        USING ERRCODE='PT409', HINT='price_changed';
    END IF;
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

  SELECT public.profile_public_name(nombre, es_vendedor, seller_type, nombre_negocio)
    INTO v_nombre FROM public.profiles WHERE id = v_actor;
  INSERT INTO public.messages (chat_id, autor_id, texto, publicacion_id, sale_confirmation_id, message_type)
    VALUES (p_chat_id, v_actor,
      chr(129309) || ' ' || coalesce(v_nombre, 'Alguien') || ' ha iniciado una confirmaci' || chr(243) || 'n de venta por "' ||
      v_producto.titulo || '" - $' || to_char(p_precio, 'FM999,999,990.00') || ' MXN. Confirma para completar la venta.',
      p_producto_id, v_venta.id, 'sale_proposed');

  RETURN jsonb_build_object('confirmation', to_jsonb(v_venta), 'repeated', false);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.responder_intencion_compra(p_message_id uuid,p_accion text,
 p_precio numeric DEFAULT NULL,p_cantidad integer DEFAULT NULL,p_notas text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); msg public.messages%ROWTYPE; chat public.chats%ROWTYPE;
 sale public.sale_confirmations%ROWTYPE; prod public.products_services%ROWTYPE;
 cid uuid; other_user uuid; price numeric; qty integer; proposal boolean; fixed_snapshot boolean;
BEGIN
 IF actor IS NULL OR vicino_guard.cuenta_suspendida() THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_message_id IS NULL OR p_accion IS NULL OR p_accion NOT IN('aceptar','rechazar') THEN
  RAISE EXCEPTION 'Datos invalidos' USING ERRCODE='22023'; END IF;
 proposal:=p_precio IS NOT NULL OR p_cantidad IS NOT NULL OR p_notas IS NOT NULL;
 IF proposal AND (p_accion<>'aceptar' OR p_precio IS NULL OR p_precio<=0 OR p_precio>99999999
   OR p_precio::text='NaN' OR p_precio<>trunc(p_precio,2) OR p_cantidad IS NULL
   OR p_cantidad NOT BETWEEN 1 AND 9999 OR length(p_notas)>1000) THEN
  RAISE EXCEPTION 'Datos invalidos' USING ERRCODE='22023'; END IF;
 -- Read only to identify the lock parent; serialize every mutation chat -> message -> sale.
 SELECT chat_id INTO cid FROM public.messages WHERE id=p_message_id;
 SELECT * INTO chat FROM public.chats WHERE id=cid AND actor IN(comprador_id,vendedor_id) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='PT404'; END IF;
 other_user:=CASE WHEN actor=chat.comprador_id THEN chat.vendedor_id ELSE chat.comprador_id END;
 IF other_user=ANY(vicino_guard.bloqueados_conmigo()) OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=other_user AND NOT is_hidden) THEN
  RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='PT404'; END IF;
 SELECT * INTO msg FROM public.messages WHERE id=p_message_id AND chat_id=chat.id FOR UPDATE;
 IF NOT FOUND OR msg.message_type<>'purchase_intent' OR msg.is_hidden THEN RAISE EXCEPTION 'Solicitud no disponible' USING ERRCODE='PT404'; END IF;
 IF actor=msg.autor_id THEN RAISE EXCEPTION 'No puedes responder tu solicitud' USING ERRCODE='42501'; END IF;
 IF msg.intent_snapshot IS NULL THEN RAISE EXCEPTION 'Solicita nuevamente las condiciones actuales' USING ERRCODE='PT409',HINT='legacy_intent_recreate'; END IF;
 IF actor IS DISTINCT FROM (msg.intent_snapshot->>'sellerId')::uuid OR msg.autor_id IS DISTINCT FROM (msg.intent_snapshot->>'buyerId')::uuid THEN
  RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF msg.intent_status='accepted' THEN
  IF p_accion<>'aceptar' THEN RAISE EXCEPTION 'Solicitud aceptada' USING ERRCODE='PT409'; END IF;
  SELECT * INTO sale FROM public.sale_confirmations WHERE id=msg.sale_confirmation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Confirmacion no disponible' USING ERRCODE='PT404'; END IF;
  IF proposal AND (sale.precio_acordado IS DISTINCT FROM p_precio OR sale.cantidad IS DISTINCT FROM p_cantidad OR sale.notas IS DISTINCT FROM nullif(btrim(p_notas),'')) THEN
   RAISE EXCEPTION 'La solicitud ya tiene otras condiciones' USING ERRCODE='PT409',HINT='idempotency_conflict'; END IF;
  RETURN jsonb_build_object('success',true,'status','accepted','confirmation',to_jsonb(sale),'chat_id',cid,'repeated',true);
 END IF;
 IF msg.intent_status='rejected' THEN
  IF p_accion<>'rechazar' THEN RAISE EXCEPTION 'Solicitud rechazada' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('success',true,'status','rejected','chat_id',cid,'repeated',true);
 END IF;
 IF p_accion='rechazar' THEN
  UPDATE public.messages SET intent_status='rejected' WHERE id=p_message_id;
  RETURN jsonb_build_object('success',true,'status','rejected','chat_id',cid,'repeated',false);
 END IF;
 SELECT * INTO prod FROM public.products_services WHERE id=msg.publicacion_id FOR SHARE;
 IF NOT FOUND OR prod.creador_id<>actor OR prod.is_hidden IS DISTINCT FROM false OR prod.estatus::text IS DISTINCT FROM 'disponible' THEN
  RAISE EXCEPTION 'Producto no disponible' USING ERRCODE='PT404'; END IF;
 -- The explicit flag identifies this contract version. Never infer new terms for
 -- pre-migration snapshots (including legacy 'fijo' or null-price snapshots).
 fixed_snapshot:=msg.intent_snapshot->>'priceMode'='precio'
   AND msg.intent_snapshot->'priceNegotiable'='false'::jsonb;
 qty:=CASE WHEN proposal THEN p_cantidad ELSE coalesce((msg.intent_snapshot->>'quantity')::integer,1) END;
 IF fixed_snapshot THEN
  price:=(msg.intent_snapshot->>'price')::numeric * qty;
  IF proposal AND p_precio IS DISTINCT FROM price THEN
   RAISE EXCEPTION 'El precio fijo debe coincidir con las condiciones originales'
    USING ERRCODE='PT409',HINT='price_changed'; END IF;
 ELSE
  price:=CASE WHEN proposal THEN p_precio ELSE (msg.intent_snapshot->>'price')::numeric END;
 END IF;
 IF price IS NULL OR price<=0 THEN RAISE EXCEPTION 'Acuerda un precio total' USING ERRCODE='PT409',HINT='price_required'; END IF;
 IF EXISTS(SELECT 1 FROM public.sale_confirmations WHERE chat_id=cid AND status='pending_confirmation') THEN
  RAISE EXCEPTION 'Ya hay una confirmacion en curso' USING ERRCODE='PT409',HINT='pending_confirmation'; END IF;
 INSERT INTO public.sale_confirmations(chat_id,product_id,buyer_id,seller_id,initiated_by,precio_acordado,cantidad,
   metodo_pago,tipo_entrega,notas,purchase_intent_message_id,producto_revision)
 VALUES(cid,msg.publicacion_id,msg.autor_id,actor,actor,price,qty,NULL,NULL,nullif(btrim(p_notas),''),msg.id,chat.producto_revision)
 RETURNING * INTO sale;
 UPDATE public.messages SET intent_status='accepted',sale_confirmation_id=sale.id WHERE id=msg.id;
 RETURN jsonb_build_object('success',true,'status','accepted','confirmation',to_jsonb(sale),'chat_id',cid,'repeated',false,'proposal',proposal);
END; $$;



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
    'modo_precio', v_producto.modo_precio, 'precio_negociable', v_producto.precio_negociable, 'imagen_principal', v_producto.imagen_principal,
    'creador_id', v_producto.creador_id, 'estatus', v_producto.estatus, 'is_hidden', v_producto.is_hidden));
END;
$fn$;


REVOKE ALL ON FUNCTION public.set_purchase_intent_status() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.iniciar_confirmacion_venta(uuid,uuid,integer,uuid,numeric,integer,text,text,text),
 public.responder_intencion_compra(uuid,text,numeric,integer,text),public.seleccionar_producto_chat(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.iniciar_confirmacion_venta(uuid,uuid,integer,uuid,numeric,integer,text,text,text),
 public.responder_intencion_compra(uuid,text,numeric,integer,text),public.seleccionar_producto_chat(uuid,uuid,integer) TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
