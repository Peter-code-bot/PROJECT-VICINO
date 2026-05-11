-- Bloque A: Eliminar trigger que inserta en notifications para mensajes de chat.
-- La separación visual ya existía (filtros en layout.tsx y notificaciones/page.tsx),
-- pero el trigger seguía llenando la tabla con filas fantasma nunca mostradas.
-- Los contadores de no-leídos de chat se mantienen en chats.no_leidos_comprador/vendedor
-- via el trigger increment_unread_count (independiente, no se toca).
--
-- Pre-check ejecutado: notify_new_message() solo era usada por on_new_message_notify.

DROP TRIGGER IF EXISTS on_new_message_notify ON messages;
DROP FUNCTION IF EXISTS notify_new_message();
