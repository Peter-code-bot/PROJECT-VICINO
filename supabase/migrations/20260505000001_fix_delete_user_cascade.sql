-- Fix: ON DELETE CASCADE/SET NULL para permitir eliminación de cuentas de usuario
-- Tablas afectadas: trust_level_verification, bookings, chats, sale_confirmations,
--                   reviews, disputes, appointments

-- trust_level_verification (referencia directa a auth.users)
ALTER TABLE trust_level_verification DROP CONSTRAINT trust_level_verification_user_id_fkey;
ALTER TABLE trust_level_verification ADD CONSTRAINT trust_level_verification_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- bookings (referencia directa a auth.users)
ALTER TABLE bookings DROP CONSTRAINT bookings_comprador_id_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_comprador_id_fkey
  FOREIGN KEY (comprador_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE bookings DROP CONSTRAINT bookings_vendedor_id_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_vendedor_id_fkey
  FOREIGN KEY (vendedor_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- chats
ALTER TABLE chats DROP CONSTRAINT chats_comprador_id_fkey;
ALTER TABLE chats ADD CONSTRAINT chats_comprador_id_fkey
  FOREIGN KEY (comprador_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE chats DROP CONSTRAINT chats_vendedor_id_fkey;
ALTER TABLE chats ADD CONSTRAINT chats_vendedor_id_fkey
  FOREIGN KEY (vendedor_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- sale_confirmations: participantes → CASCADE; campos nullable → SET NULL
ALTER TABLE sale_confirmations DROP CONSTRAINT sale_confirmations_buyer_id_fkey;
ALTER TABLE sale_confirmations ADD CONSTRAINT sale_confirmations_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE sale_confirmations DROP CONSTRAINT sale_confirmations_seller_id_fkey;
ALTER TABLE sale_confirmations ADD CONSTRAINT sale_confirmations_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE sale_confirmations DROP CONSTRAINT sale_confirmations_initiated_by_fkey;
ALTER TABLE sale_confirmations ADD CONSTRAINT sale_confirmations_initiated_by_fkey
  FOREIGN KEY (initiated_by) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE sale_confirmations DROP CONSTRAINT sale_confirmations_cancelled_by_fkey;
ALTER TABLE sale_confirmations ADD CONSTRAINT sale_confirmations_cancelled_by_fkey
  FOREIGN KEY (cancelled_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE sale_confirmations DROP CONSTRAINT fk_sale_chat;
ALTER TABLE sale_confirmations ADD CONSTRAINT fk_sale_chat
  FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL;

-- reviews
ALTER TABLE reviews DROP CONSTRAINT reviews_reviewer_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE reviews DROP CONSTRAINT reviews_reviewed_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_reviewed_id_fkey
  FOREIGN KEY (reviewed_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE reviews DROP CONSTRAINT reviews_sale_confirmation_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_sale_confirmation_id_fkey
  FOREIGN KEY (sale_confirmation_id) REFERENCES sale_confirmations(id) ON DELETE CASCADE;

-- disputes: participantes → CASCADE; admin (nullable) → SET NULL
ALTER TABLE disputes DROP CONSTRAINT disputes_reporter_id_fkey;
ALTER TABLE disputes ADD CONSTRAINT disputes_reporter_id_fkey
  FOREIGN KEY (reporter_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE disputes DROP CONSTRAINT disputes_reported_id_fkey;
ALTER TABLE disputes ADD CONSTRAINT disputes_reported_id_fkey
  FOREIGN KEY (reported_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE disputes DROP CONSTRAINT disputes_admin_id_fkey;
ALTER TABLE disputes ADD CONSTRAINT disputes_admin_id_fkey
  FOREIGN KEY (admin_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- appointments
ALTER TABLE appointments DROP CONSTRAINT appointments_buyer_id_fkey;
ALTER TABLE appointments ADD CONSTRAINT appointments_buyer_id_fkey
  FOREIGN KEY (buyer_id) REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE appointments DROP CONSTRAINT appointments_seller_id_fkey;
ALTER TABLE appointments ADD CONSTRAINT appointments_seller_id_fkey
  FOREIGN KEY (seller_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- FKs que referencian products_services sin CASCADE
-- (bloquean la cascada secundaria cuando los listings de un vendedor se eliminan)
ALTER TABLE sale_confirmations DROP CONSTRAINT sale_confirmations_product_id_fkey;
ALTER TABLE sale_confirmations ADD CONSTRAINT sale_confirmations_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products_services(id) ON DELETE CASCADE;

ALTER TABLE reviews DROP CONSTRAINT reviews_product_id_fkey;
ALTER TABLE reviews ADD CONSTRAINT reviews_product_id_fkey
  FOREIGN KEY (product_id) REFERENCES products_services(id) ON DELETE CASCADE;

ALTER TABLE bookings DROP CONSTRAINT bookings_servicio_id_fkey;
ALTER TABLE bookings ADD CONSTRAINT bookings_servicio_id_fkey
  FOREIGN KEY (servicio_id) REFERENCES products_services(id) ON DELETE CASCADE;

-- chats.ultimo_producto_id es nullable → SET NULL cuando el producto se elimina
ALTER TABLE chats DROP CONSTRAINT chats_ultimo_producto_id_fkey;
ALTER TABLE chats ADD CONSTRAINT chats_ultimo_producto_id_fkey
  FOREIGN KEY (ultimo_producto_id) REFERENCES products_services(id) ON DELETE SET NULL;
