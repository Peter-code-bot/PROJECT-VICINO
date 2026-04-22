-- Función genérica para crear notificación
CREATE OR REPLACE FUNCTION create_notification(
  p_user_id UUID,
  p_tipo TEXT,
  p_titulo TEXT,
  p_mensaje TEXT,
  p_data JSONB DEFAULT '{}'
)
RETURNS void AS $$
BEGIN
  INSERT INTO notifications (user_id, tipo, titulo, mensaje, data, leida, created_at)
  VALUES (p_user_id, p_tipo, p_titulo, p_mensaje, p_data, false, NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger: Notificar al recibir mensaje nuevo
CREATE OR REPLACE FUNCTION notify_new_message()
RETURNS TRIGGER AS $$
DECLARE
  v_sender_name TEXT;
  v_other_user_id UUID;
  v_chat RECORD;
BEGIN
  SELECT * INTO v_chat FROM chats WHERE id = NEW.chat_id;
  IF v_chat IS NULL THEN RETURN NEW; END IF;

  -- El otro usuario (el que NO envió el mensaje)
  IF NEW.autor_id = v_chat.comprador_id THEN
    v_other_user_id := v_chat.vendedor_id;
  ELSE
    v_other_user_id := v_chat.comprador_id;
  END IF;

  SELECT nombre INTO v_sender_name FROM profiles WHERE id = NEW.autor_id;

  PERFORM create_notification(
    v_other_user_id,
    'message',
    'Nuevo mensaje',
    COALESCE(v_sender_name, 'Alguien') || ' te envió un mensaje',
    jsonb_build_object('chat_id', NEW.chat_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_new_message_notify ON messages;
CREATE TRIGGER on_new_message_notify
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION notify_new_message();

-- Trigger: Notificar cuando alguien inicia confirmación de venta
CREATE OR REPLACE FUNCTION notify_sale_confirmation_created()
RETURNS TRIGGER AS $$
DECLARE
  v_initiator_name TEXT;
  v_other_user_id UUID;
  v_product_name TEXT;
BEGIN
  IF NEW.initiated_by = NEW.buyer_id THEN
    v_other_user_id := NEW.seller_id;
  ELSE
    v_other_user_id := NEW.buyer_id;
  END IF;

  SELECT nombre INTO v_initiator_name FROM profiles WHERE id = NEW.initiated_by;
  SELECT titulo INTO v_product_name FROM products_services WHERE id = NEW.product_id;

  PERFORM create_notification(
    v_other_user_id,
    'sale_confirmation',
    'Confirmación de venta',
    COALESCE(v_initiator_name, 'Alguien') || ' quiere confirmar la venta de "' || COALESCE(v_product_name, 'producto') || '"',
    jsonb_build_object('sale_id', NEW.id, 'product_id', NEW.product_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_sale_confirmation_notify ON sale_confirmations;
CREATE TRIGGER on_sale_confirmation_notify
  AFTER INSERT ON sale_confirmations
  FOR EACH ROW EXECUTE FUNCTION notify_sale_confirmation_created();

-- Trigger: Notificar cuando la venta se completa
CREATE OR REPLACE FUNCTION notify_sale_completed()
RETURNS TRIGGER AS $$
DECLARE
  v_product_name TEXT;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    SELECT titulo INTO v_product_name FROM products_services WHERE id = NEW.product_id;

    PERFORM create_notification(
      NEW.buyer_id, 'sale_completed', '¡Venta completada!',
      'La venta de "' || COALESCE(v_product_name, 'producto') || '" fue confirmada. ¡Deja tu reseña!',
      jsonb_build_object('sale_id', NEW.id, 'product_id', NEW.product_id)
    );
    PERFORM create_notification(
      NEW.seller_id, 'sale_completed', '¡Venta completada!',
      'La venta de "' || COALESCE(v_product_name, 'producto') || '" fue confirmada. ¡Deja tu reseña!',
      jsonb_build_object('sale_id', NEW.id, 'product_id', NEW.product_id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_sale_completed_notify ON sale_confirmations;
CREATE TRIGGER on_sale_completed_notify
  AFTER UPDATE ON sale_confirmations
  FOR EACH ROW EXECUTE FUNCTION notify_sale_completed();

-- Trigger: Notificar cuando recibes una review
CREATE OR REPLACE FUNCTION notify_new_review()
RETURNS TRIGGER AS $$
DECLARE
  v_reviewer_name TEXT;
BEGIN
  SELECT nombre INTO v_reviewer_name FROM profiles WHERE id = NEW.reviewer_id;

  PERFORM create_notification(
    NEW.reviewed_id, 'review_reminder',
    'Nueva reseña',
    COALESCE(v_reviewer_name, 'Alguien') || ' te dejó una reseña de ' || NEW.rating || ' estrellas',
    jsonb_build_object('review_id', NEW.id, 'sale_id', NEW.sale_confirmation_id)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_new_review_notify ON reviews;
CREATE TRIGGER on_new_review_notify
  AFTER INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION notify_new_review();
