-- Migration: More Push Notification Triggers (Bookings, Sales)
-- Date: 2026-06-04

-- NOTA: Al igual que el trigger de mensajes, recomendamos configurar esto
-- a través del Dashboard de Supabase en la sección "Database -> Webhooks".
-- Allí crearás dos Webhooks nuevos apuntando a la URL de la Edge Function "send-push".

-- Webhook 1:
-- Table: bookings
-- Events: Insert
-- HTTP Method: POST
-- URL: https://[PROJECT_REF].supabase.co/functions/v1/send-push

-- Webhook 2:
-- Table: sale_confirmations
-- Events: Insert
-- HTTP Method: POST
-- URL: https://[PROJECT_REF].supabase.co/functions/v1/send-push

-- Código SQL para crearlos vía pg_net si estuviera habilitado localmente:

-- CREATE TRIGGER on_booking_inserted
-- AFTER INSERT ON public.bookings
-- FOR EACH ROW EXECUTE FUNCTION public.notify_push();

-- CREATE TRIGGER on_sale_confirmation_inserted
-- AFTER INSERT ON public.sale_confirmations
-- FOR EACH ROW EXECUTE FUNCTION public.notify_push();
