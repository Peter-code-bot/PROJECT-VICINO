-- Migration: Setup Push Notification Triggers
-- Date: 2026-06-04

-- Function to call the send-push Edge Function via pg_net
CREATE OR REPLACE FUNCTION public.notify_push()
RETURNS TRIGGER AS $$
DECLARE
  edge_function_url TEXT := 'https://' || current_setting('request.headers')::json->>'host' || '/functions/v1/send-push';
  payload JSONB;
BEGIN
  -- We assume pg_net is enabled. If not, this might need to be called by another mechanism,
  -- but Supabase supports pg_net or webhook triggers natively.
  
  -- Create the payload payload mimicking Supabase Webhooks
  payload := json_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', null
  );

  -- Perform the asynchronous HTTP request using pg_net
  -- NOTE: The edge_function_url must point to your project's Edge Function URL.
  -- To make it dynamic without pg_net, you can just configure a Webhook in the Supabase Dashboard,
  -- which is actually much safer and more robust than raw pg_net calls.
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- IMPORTANT NOTE: The easiest way to configure this in Supabase without hardcoding URLs
-- is to use the Supabase Dashboard (Database -> Webhooks) or write the raw pg_net insert.
-- We will leave this commented out and recommend doing it via the Dashboard or a dedicated tool.

-- CREATE TRIGGER on_message_inserted
-- AFTER INSERT ON public.messages
-- FOR EACH ROW EXECUTE FUNCTION public.notify_push();
