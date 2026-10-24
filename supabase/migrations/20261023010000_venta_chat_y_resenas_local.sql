-- VENTA-CHAT-01. Additive, unshipped migration. No historic terms are inferred.
BEGIN;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS intent_status text
  CHECK(intent_status IS NULL OR intent_status IN ('pending','accepted','rejected'));
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS intent_snapshot jsonb;
ALTER TABLE public.sale_confirmations ADD COLUMN IF NOT EXISTS purchase_intent_message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.sale_confirmations ADD COLUMN IF NOT EXISTS terms_snapshot jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_purchase_intent_sale ON public.messages(sale_confirmation_id)
 WHERE message_type='purchase_intent' AND sale_confirmation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sale_confirmations_purchase_intent_message_unique ON public.sale_confirmations(purchase_intent_message_id)
 WHERE purchase_intent_message_id IS NOT NULL;
-- Existing intents remain readable but cannot acquire invented terms from today's listing.
UPDATE public.messages SET intent_status=CASE WHEN sale_confirmation_id IS NULL THEN 'pending' ELSE 'accepted' END
 WHERE message_type='purchase_intent' AND intent_status IS NULL;

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
     'priceMode',p.modo_precio,'price',CASE WHEN p.modo_precio='fijo' AND p.precio>0 THEN p.precio ELSE NULL END,
     'quantity',1,'sellerId',p.creador_id,'buyerId',NEW.autor_id,'notes',NULL);
 END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_messages_purchase_intent_status ON public.messages;
CREATE TRIGGER trg_messages_purchase_intent_status BEFORE INSERT OR UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION public.set_purchase_intent_status();

-- Ordinary clients can send text/attachments; structured messages and links originate in RPCs.
ALTER POLICY "Participants can send messages" ON public.messages WITH CHECK(
 auth.uid()=autor_id AND NOT vicino_guard.cuenta_suspendida()
 AND EXISTS(SELECT 1 FROM public.chats c WHERE c.id=messages.chat_id AND auth.uid() IN(c.comprador_id,c.vendedor_id))
 AND clave_idempotencia IS NULL AND message_type='user_text' AND sale_confirmation_id IS NULL
 AND intent_status IS NULL AND intent_snapshot IS NULL
);
-- SECURITY INVOKER is deliberate: nested authorized RPCs retain their SQL owner,
-- while a JWT claimant cannot opt into the backend role by changing claims/GUCs.
CREATE OR REPLACE FUNCTION public.guard_purchase_intent_metadata() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls)) THEN RETURN NEW; END IF;
 IF NEW.intent_status IS DISTINCT FROM OLD.intent_status OR NEW.sale_confirmation_id IS DISTINCT FROM OLD.sale_confirmation_id
  OR NEW.intent_snapshot IS DISTINCT FROM OLD.intent_snapshot OR NEW.message_type IS DISTINCT FROM OLD.message_type
  OR NEW.publicacion_id IS DISTINCT FROM OLD.publicacion_id OR NEW.chat_id IS DISTINCT FROM OLD.chat_id
  OR NEW.autor_id IS DISTINCT FROM OLD.autor_id THEN
  RAISE EXCEPTION 'Los metadatos de operacion solo cambian mediante RPC' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER aa_guard_purchase_intent_metadata BEFORE UPDATE ON public.messages
 FOR EACH ROW EXECUTE FUNCTION public.guard_purchase_intent_metadata();

CREATE OR REPLACE FUNCTION public.freeze_sale_terms() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p public.products_services%ROWTYPE; snap jsonb;
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.terms_snapshot IS DISTINCT FROM OLD.terms_snapshot OR NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.buyer_id IS DISTINCT FROM OLD.buyer_id OR NEW.seller_id IS DISTINCT FROM OLD.seller_id
      OR NEW.precio_acordado IS DISTINCT FROM OLD.precio_acordado OR NEW.cantidad IS DISTINCT FROM OLD.cantidad
      OR NEW.notas IS DISTINCT FROM OLD.notas OR NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago
      OR NEW.tipo_entrega IS DISTINCT FROM OLD.tipo_entrega OR NEW.initiated_by IS DISTINCT FROM OLD.initiated_by THEN
     RAISE EXCEPTION 'Las condiciones acordadas son inmutables' USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF NEW.purchase_intent_message_id IS NOT NULL THEN
   SELECT intent_snapshot INTO snap FROM public.messages WHERE id=NEW.purchase_intent_message_id;
 ELSE
   SELECT * INTO p FROM public.products_services WHERE id=NEW.product_id FOR SHARE;
   snap:=jsonb_build_object('productId',p.id,'title',p.titulo,
    'kind',CASE WHEN p.tipo::text='servicio' THEN 'service' ELSE 'product' END);
 END IF;
 NEW.terms_snapshot:=snap || jsonb_build_object('price',NEW.precio_acordado,'quantity',NEW.cantidad,
   'notes',NEW.notas,'buyerId',NEW.buyer_id,'sellerId',NEW.seller_id);
 RETURN NEW;
END; $$;
CREATE TRIGGER freeze_sale_terms BEFORE INSERT OR UPDATE ON public.sale_confirmations
 FOR EACH ROW EXECUTE FUNCTION public.freeze_sale_terms();

ALTER TABLE public.reviews ALTER COLUMN sale_confirmation_id DROP NOT NULL;
ALTER TABLE public.reviews ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS origen text NOT NULL DEFAULT 'venta' CHECK(origen IN ('venta','local'));
ALTER TABLE public.reviews ADD CONSTRAINT reviews_origin_consistent CHECK
 ((origen='venta' AND sale_confirmation_id IS NOT NULL AND product_id IS NOT NULL)
 OR (origen='local' AND sale_confirmation_id IS NULL AND product_id IS NULL AND review_type='buyer_to_seller'));

ALTER POLICY "Participants can create reviews on completed sales" ON public.reviews WITH CHECK (
 auth.uid()=reviewer_id AND origen='venta' AND NOT vicino_guard.cuenta_suspendida()
 AND NOT reviewed_id=ANY(vicino_guard.bloqueados_conmigo())
 AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=reviews.reviewed_id AND NOT p.is_hidden)
 AND EXISTS(SELECT 1 FROM public.sale_confirmations s WHERE s.id=reviews.sale_confirmation_id
  AND s.status='completed' AND s.product_id=reviews.product_id
  AND ((reviews.review_type='buyer_to_seller' AND s.buyer_id=auth.uid() AND s.seller_id=reviews.reviewed_id)
    OR (reviews.review_type='seller_to_buyer' AND s.seller_id=auth.uid() AND s.buyer_id=reviews.reviewed_id)))
);

CREATE UNIQUE INDEX IF NOT EXISTS reviews_local_unique ON public.reviews(reviewer_id,reviewed_id) WHERE origen='local';

CREATE OR REPLACE FUNCTION public.update_user_rating_on_review() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid; points integer;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.reviewed_id ELSE NEW.reviewed_id END;
 UPDATE public.profiles SET average_rating=coalesce((SELECT avg(rating)::numeric(3,2) FROM public.reviews WHERE reviewed_id=target AND visible AND NOT is_hidden),0),
 reviews_count=(SELECT count(*) FROM public.reviews WHERE reviewed_id=target AND visible AND NOT is_hidden), updated_at=now() WHERE id=target;
 IF TG_OP='INSERT' AND NEW.origen='venta' AND EXISTS(SELECT 1 FROM public.sale_confirmations sc
   WHERE sc.id=NEW.sale_confirmation_id AND sc.status='completed' AND sc.product_id=NEW.product_id
    AND ((NEW.review_type='buyer_to_seller' AND sc.buyer_id=NEW.reviewer_id AND sc.seller_id=NEW.reviewed_id)
      OR (NEW.review_type='seller_to_buyer' AND sc.seller_id=NEW.reviewer_id AND sc.buyer_id=NEW.reviewed_id))) THEN
   points:=CASE NEW.rating WHEN 5 THEN 5 WHEN 4 THEN 3 WHEN 3 THEN 1 WHEN 1 THEN -2 ELSE 0 END;
   UPDATE public.profiles SET trust_points=greatest(0,trust_points+points) WHERE id=NEW.reviewed_id;
   UPDATE public.profiles SET trust_points=trust_points+2 WHERE id=NEW.reviewer_id;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.update_separated_ratings() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE target uuid;
BEGIN
 target:=CASE WHEN TG_OP='DELETE' THEN OLD.reviewed_id ELSE NEW.reviewed_id END;
 UPDATE public.profiles SET
 average_rating_as_seller=coalesce((SELECT avg(rating)::numeric(3,2) FROM public.reviews WHERE reviewed_id=target AND review_type='buyer_to_seller' AND visible AND NOT is_hidden),0),
 reviews_count_as_seller=(SELECT count(*) FROM public.reviews WHERE reviewed_id=target AND review_type='buyer_to_seller' AND visible AND NOT is_hidden),
 average_rating_as_buyer=coalesce((SELECT avg(rating)::numeric(3,2) FROM public.reviews WHERE reviewed_id=target AND review_type='seller_to_buyer' AND visible AND NOT is_hidden),0),
 reviews_count_as_buyer=(SELECT count(*) FROM public.reviews WHERE reviewed_id=target AND review_type='seller_to_buyer' AND visible AND NOT is_hidden) WHERE id=target;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS recalc_rating_on_review ON public.reviews;
CREATE TRIGGER recalc_rating_on_review AFTER INSERT OR UPDATE OR DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_user_rating_on_review();
DROP TRIGGER IF EXISTS update_separated_ratings_trigger ON public.reviews;
CREATE TRIGGER update_separated_ratings_trigger AFTER INSERT OR UPDATE OR DELETE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_separated_ratings();

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


-- Existing confirmar_venta settlement rules remain: actual participants may settle prior
-- pending trades even when suspended. New creation/acceptance is strictly guarded.
-- Explicit proposal terms are total MXN for the stated quantity. They never imply receipt.
DROP FUNCTION IF EXISTS public.responder_intencion_compra(uuid,text);
CREATE FUNCTION public.responder_intencion_compra(p_message_id uuid,p_accion text,
 p_precio numeric DEFAULT NULL,p_cantidad integer DEFAULT NULL,p_notas text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); msg public.messages%ROWTYPE; chat public.chats%ROWTYPE;
 sale public.sale_confirmations%ROWTYPE; prod public.products_services%ROWTYPE;
 cid uuid; other_user uuid; price numeric; qty integer; proposal boolean;
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
 price:=CASE WHEN proposal THEN p_precio ELSE (msg.intent_snapshot->>'price')::numeric END;
 qty:=CASE WHEN proposal THEN p_cantidad ELSE 1 END;
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

CREATE OR REPLACE FUNCTION public.publicar_resena_local(p_reviewed_id uuid,p_rating integer,p_comentario text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); r public.reviews%ROWTYPE;
BEGIN
 IF actor IS NULL OR vicino_guard.cuenta_suspendida() THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_reviewed_id IS NULL OR p_rating IS NULL OR p_rating NOT BETWEEN 1 AND 5 OR actor=p_reviewed_id OR length(p_comentario)>1000 THEN
  RAISE EXCEPTION 'Datos invalidos' USING ERRCODE='22023'; END IF;
 IF p_reviewed_id=ANY(vicino_guard.bloqueados_conmigo()) OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_reviewed_id AND NOT is_hidden) THEN
  RAISE EXCEPTION 'Vendedor no disponible' USING ERRCODE='PT404'; END IF;
 INSERT INTO public.reviews(reviewer_id,reviewed_id,review_type,rating,comentario,origen,visible)
 VALUES(actor,p_reviewed_id,'buyer_to_seller',p_rating,nullif(btrim(p_comentario),''),'local',true)
 ON CONFLICT(reviewer_id,reviewed_id) WHERE origen='local' DO UPDATE
 SET rating=excluded.rating,comentario=excluded.comentario,updated_at=now() RETURNING * INTO r;
 -- Keep moderation's visible/is_hidden state on edit.
 RETURN jsonb_build_object('success',true,'review',to_jsonb(r));
END; $$;

-- This helper exposes only a verified bit for an already public review; never sale data.
CREATE OR REPLACE FUNCTION vicino_guard.review_is_verified(p_review_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.reviews r JOIN public.sale_confirmations s ON s.id=r.sale_confirmation_id
  WHERE r.id=p_review_id AND r.origen='venta' AND r.visible AND NOT r.is_hidden
   AND s.status='completed' AND s.product_id=r.product_id
   AND NOT r.reviewed_id=ANY(vicino_guard.bloqueados_conmigo())
   AND NOT r.reviewer_id=ANY(vicino_guard.bloqueados_conmigo())
   AND ((r.review_type='buyer_to_seller' AND s.buyer_id=r.reviewer_id AND s.seller_id=r.reviewed_id)
     OR (r.review_type='seller_to_buyer' AND s.seller_id=r.reviewer_id AND s.buyer_id=r.reviewed_id)))
$$;
-- Invoker read paths preserve product/profile/review RLS. Only the private boolean and own-row
-- helpers bypass sale/review RLS, with explicit author/public predicates.
CREATE OR REPLACE FUNCTION vicino_guard.own_local_review(p_seller uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',id,'rating',rating,'comentario',comentario,'visible',visible AND NOT is_hidden)
 FROM public.reviews WHERE reviewer_id=auth.uid() AND reviewed_id=p_seller AND origen='local'
 AND NOT p_seller=ANY(vicino_guard.bloqueados_conmigo())
$$;
CREATE OR REPLACE FUNCTION public.leer_resenas_local(p_reviewed_id uuid,p_offset integer DEFAULT 0,p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 IF p_reviewed_id IS NULL OR p_offset IS NULL OR p_offset<0 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Datos invalidos' USING ERRCODE='22023'; END IF;
 IF p_reviewed_id=ANY(vicino_guard.bloqueados_conmigo()) OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_reviewed_id AND NOT is_hidden) THEN
  RAISE EXCEPTION 'Vendedor no disponible' USING ERRCODE='PT404'; END IF;
 WITH eligible AS MATERIALIZED(SELECT * FROM public.reviews r WHERE r.reviewed_id=p_reviewed_id
  AND r.review_type='buyer_to_seller' AND r.visible AND NOT r.is_hidden
  AND NOT r.reviewer_id=ANY(vicino_guard.bloqueados_conmigo())),
 page AS(SELECT * FROM eligible ORDER BY created_at DESC,id DESC OFFSET p_offset LIMIT p_limit)
 SELECT jsonb_build_object('reviews',coalesce((SELECT jsonb_agg(jsonb_build_object(
  'id',r.id,'rating',r.rating,'comentario',r.comentario,'created_at',r.created_at,'review_type',r.review_type,
  'respuesta',r.respuesta,'respuesta_fecha',r.respuesta_fecha,'reviewer_id',r.reviewer_id,
  'is_verified',vicino_guard.review_is_verified(r.id),
  'profiles',(SELECT jsonb_build_object('id',p.id,'nombre',p.nombre,'foto',p.foto,'trust_level',p.trust_level,
    'es_vendedor',p.es_vendedor,'seller_type',p.seller_type,'nombre_negocio',p.nombre_negocio) FROM public.profiles p WHERE p.id=r.reviewer_id),
  'products_services',(SELECT jsonb_build_object('id',p.id,'titulo',p.titulo,'slug',p.slug,'categoria',p.categoria,'imagen_principal',p.imagen_principal)
    FROM public.products_services p WHERE p.id=r.product_id AND NOT p.is_hidden AND p.estatus::text<>'eliminado')) ORDER BY r.created_at DESC,r.id DESC) FROM page r),'[]'::jsonb),
  'summary',(SELECT jsonb_build_object('count',count(*),'average',coalesce(avg(rating),0),'buckets',jsonb_build_object(
    '1',count(*) FILTER(WHERE rating=1),'2',count(*) FILTER(WHERE rating=2),'3',count(*) FILTER(WHERE rating=3),
    '4',count(*) FILTER(WHERE rating=4),'5',count(*) FILTER(WHERE rating=5))) FROM eligible),
  'own_local_review',vicino_guard.own_local_review(p_reviewed_id)) INTO result;
 RETURN result;
END; $$;

CREATE OR REPLACE FUNCTION public.get_chat_operations(p_chat_id uuid,p_cursor jsonb DEFAULT NULL,
 p_limit integer DEFAULT 20,p_ids uuid[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE actor uuid:=auth.uid(); chat public.chats%ROWTYPE; other_user uuid; result jsonb;
 cursor_time timestamptz; cursor_id uuid;
BEGIN
 IF actor IS NULL THEN RAISE EXCEPTION 'No autorizado' USING ERRCODE='42501'; END IF;
 IF p_chat_id IS NULL OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 OR cardinality(p_ids)>100 THEN
  RAISE EXCEPTION 'Datos invalidos' USING ERRCODE='22023'; END IF;
 IF p_cursor IS NOT NULL THEN
  IF jsonb_typeof(p_cursor)<>'object' OR NOT p_cursor ?& ARRAY['createdAt','id'] THEN RAISE EXCEPTION 'Cursor invalido' USING ERRCODE='22023'; END IF;
  BEGIN cursor_time:=(p_cursor->>'createdAt')::timestamptz; cursor_id:=(p_cursor->>'id')::uuid;
  EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'Cursor invalido' USING ERRCODE='22023'; END;
  IF cursor_time IS NULL OR cursor_id IS NULL THEN RAISE EXCEPTION 'Cursor invalido' USING ERRCODE='22023'; END IF;
 END IF;
 SELECT * INTO chat FROM public.chats WHERE id=p_chat_id AND actor IN(comprador_id,vendedor_id);
 IF NOT FOUND THEN RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='PT404'; END IF;
 other_user:=CASE WHEN actor=chat.comprador_id THEN chat.vendedor_id ELSE chat.comprador_id END;
 IF other_user=ANY(vicino_guard.bloqueados_conmigo()) OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=other_user AND NOT is_hidden) THEN
  RAISE EXCEPTION 'Chat no disponible' USING ERRCODE='PT404'; END IF;
 WITH operations AS(
  SELECT s.id,s.purchase_intent_message_id intent_id,s.id sale_id,s.product_id,
   coalesce(s.terms_snapshot,jsonb_build_object('title','Producto de la operación','kind','product',
     'price',s.precio_acordado,'quantity',s.cantidad,'notes',s.notas)) snap,
   CASE WHEN s.terms_snapshot IS NOT NULL AND s.status='cancelled' AND s.cancelled_by IS DISTINCT FROM s.initiated_by THEN 'rejected'
    WHEN s.purchase_intent_message_id IS NOT NULL AND s.status='pending_confirmation' THEN 'accepted' ELSE s.status::text END status,
   CASE WHEN s.purchase_intent_message_id IS NULL THEN 'manual' ELSE 'purchase' END source,
   s.buyer_id,s.seller_id,s.initiated_by,coalesce(s.buyer_confirmed,false) buyer_confirmed,coalesce(s.seller_confirmed,false) seller_confirmed,
   coalesce(m.created_at,s.created_at) created_at,s.completed_at,s.cancelled_at,s.cancel_reason
  FROM public.sale_confirmations s LEFT JOIN public.messages m ON m.id=s.purchase_intent_message_id
  WHERE s.chat_id=p_chat_id AND actor IN(s.buyer_id,s.seller_id)
  UNION ALL
  SELECT m.id,m.id,NULL::uuid,m.publicacion_id,m.intent_snapshot,
   CASE WHEN m.intent_snapshot IS NULL THEN 'legacy' WHEN m.intent_status='rejected' THEN 'rejected' ELSE 'requested' END,
   'purchase',m.autor_id,coalesce((m.intent_snapshot->>'sellerId')::uuid,
      CASE WHEN m.autor_id=chat.comprador_id THEN chat.vendedor_id ELSE chat.comprador_id END),m.autor_id,
   false,false,m.created_at,NULL::timestamptz,NULL::timestamptz,NULL::text
  FROM public.messages m WHERE m.chat_id=p_chat_id AND m.message_type='purchase_intent' AND NOT m.is_hidden
   AND NOT EXISTS(SELECT 1 FROM public.sale_confirmations s WHERE s.purchase_intent_message_id=m.id OR s.id=m.sale_confirmation_id)
 ), filtered AS(
  SELECT * FROM operations o WHERE (p_cursor IS NULL OR (o.created_at,o.id)<(cursor_time,cursor_id))
  AND (p_ids IS NULL OR o.id=ANY(p_ids) OR o.intent_id=ANY(p_ids) OR o.sale_id=ANY(p_ids)
    OR EXISTS(SELECT 1 FROM public.messages m WHERE m.id=ANY(p_ids) AND m.chat_id=p_chat_id AND m.sale_confirmation_id=o.sale_id))
 ), page AS(SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT p_limit),
 rendered AS(SELECT o.*,jsonb_build_object('id',o.id,'intentMessageId',o.intent_id,'saleId',o.sale_id,
  'status',CASE WHEN o.snap IS NULL THEN 'legacy' ELSE o.status END,'source',o.source,'productId',o.product_id,
  'title',coalesce(o.snap->>'title','Producto'),'kind',coalesce(o.snap->>'kind','product'),
  'price',(o.snap->>'price')::numeric,'quantity',coalesce((o.snap->>'quantity')::integer,1),'notes',o.snap->>'notes',
  'buyerId',o.buyer_id,'sellerId',o.seller_id,'initiatedBy',o.initiated_by,'buyerConfirmed',o.buyer_confirmed,
  'sellerConfirmed',o.seller_confirmed,'createdAt',o.created_at,'completedAt',o.completed_at,
  'cancelledAt',o.cancelled_at,'cancelReason',o.cancel_reason,
  'product',(SELECT jsonb_build_object('id',p.id,'titulo',p.titulo,'slug',p.slug,'categoria',p.categoria)
    FROM public.products_services p WHERE p.id=o.product_id AND NOT p.is_hidden AND p.estatus::text<>'eliminado'),
  'canRespond',o.snap IS NOT NULL AND o.status='requested' AND actor=o.seller_id AND NOT vicino_guard.cuenta_suspendida()
    AND EXISTS(SELECT 1 FROM public.products_services p WHERE p.id=o.product_id AND p.creador_id=actor AND NOT p.is_hidden AND p.estatus::text='disponible'),
  'canConfirm',o.snap IS NOT NULL AND o.status IN('accepted','pending_confirmation')
    AND ((actor=o.buyer_id AND NOT o.buyer_confirmed) OR (actor=o.seller_id AND NOT o.seller_confirmed)),
  'canReject',o.snap IS NOT NULL AND ((o.status='requested' AND actor=o.seller_id AND NOT vicino_guard.cuenta_suspendida())
    OR o.status IN('accepted','pending_confirmation'))) item FROM page o)
 SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(item ORDER BY created_at DESC,id DESC) FROM rendered),'[]'::jsonb),
  'nextCursor',CASE WHEN (SELECT count(*) FROM filtered)>p_limit THEN
    (SELECT jsonb_build_object('createdAt',created_at,'id',id) FROM page ORDER BY created_at,id LIMIT 1) ELSE NULL END) INTO result;
 RETURN result;
END; $$;

REVOKE ALL ON FUNCTION public.responder_intencion_compra(uuid,text,numeric,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.responder_intencion_compra(uuid,text,numeric,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.publicar_resena_local(uuid,integer,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publicar_resena_local(uuid,integer,text) TO authenticated;
REVOKE ALL ON FUNCTION public.get_chat_operations(uuid,jsonb,integer,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_chat_operations(uuid,jsonb,integer,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.leer_resenas_local(uuid,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leer_resenas_local(uuid,integer,integer) TO authenticated,anon;
REVOKE ALL ON FUNCTION vicino_guard.review_is_verified(uuid),vicino_guard.own_local_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vicino_guard.review_is_verified(uuid),vicino_guard.own_local_review(uuid) TO authenticated,anon;
REVOKE ALL ON FUNCTION public.set_purchase_intent_status(),public.guard_purchase_intent_metadata(),public.freeze_sale_terms(),public.update_user_rating_on_review(),public.update_separated_ratings() FROM PUBLIC,anon,authenticated;
GRANT SELECT(intent_status,intent_snapshot) ON public.messages TO authenticated;
GRANT SELECT(purchase_intent_message_id,terms_snapshot) ON public.sale_confirmations TO authenticated;
GRANT SELECT(origen) ON public.reviews TO authenticated,anon;
NOTIFY pgrst, 'reload schema';
COMMIT;
