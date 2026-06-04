-- Drop chats_updated_at trigger.
--
-- Bug: el trigger BEFORE UPDATE bumpea updated_at en cualquier UPDATE a chats,
-- incluyendo mark_messages_as_read (que solo marca leidos) -> el chat subia al
-- top de la lista con solo abrirlo. Visualmente "el chat se reordena por leer".
--
-- Analisis de paths que escriben a chats:
--   - find_or_create_chat (cuando hay producto nuevo): bump manual OK
--   - increment_unread_count (trigger BEFORE INSERT messages): bump manual OK
--   - unhide_chat_on_new_message (trigger AFTER INSERT messages): bump manual OK
--   - mark_messages_as_read: NO bump -> arregla el bug
--   - hideChat (actions.ts): chat queda oculto -> bump irrelevante
--   - get_or_create_chat unhide block: sin bump al reabrir sin producto nuevo
--     -> comportamiento alineado con WhatsApp/iMessage (orden por mensaje, no por open)
--
-- La funcion handle_updated_at() NO se borra: la usan 8 triggers mas
-- (profiles, products_services, product_variants, media_assets,
-- sale_confirmations, reviews, coupons, verification).

DROP TRIGGER IF EXISTS chats_updated_at ON chats;
