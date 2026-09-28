-- Reversion de 20260927150000_quitar_notify_push_sin_autorizacion.
--
-- Vive en docs/rollback/ y NO en supabase/migrations/: se corre a mano.
-- ADVERTENCIA: devuelve el POST SIN autorizacion que deja un 401 por cada venta
-- o reserva nueva en net._http_response. Solo tiene sentido si algo dependia de
-- ese POST (no deberia: el push real es push_on_sale_pgnet / push-on-booking).
-- Es la definicion que tenia produccion el 27-sep-2026.

begin;

CREATE OR REPLACE FUNCTION public.notify_push()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  edge_function_url TEXT := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push';
  payload JSONB;
BEGIN
  payload := json_build_object(
    'type', TG_OP,
    'table', TG_TABLE_NAME,
    'schema', TG_TABLE_SCHEMA,
    'record', row_to_json(NEW),
    'old_record', null
  );
  PERFORM net.http_post(
    url := edge_function_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := payload
  );
  RETURN NEW;
END;
$function$;

CREATE TRIGGER on_sale_confirmation_inserted
  AFTER INSERT ON public.sale_confirmations
  FOR EACH ROW EXECUTE FUNCTION public.notify_push();
CREATE TRIGGER on_booking_inserted
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_push();

commit;
