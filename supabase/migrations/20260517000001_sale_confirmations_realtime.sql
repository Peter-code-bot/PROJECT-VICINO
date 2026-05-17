-- Enable Realtime for sale_confirmations so the chat UI receives live
-- INSERT/UPDATE events without requiring a page refresh.
ALTER PUBLICATION supabase_realtime ADD TABLE sale_confirmations;
