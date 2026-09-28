-- Quitar notify_push(): el disparador de push heredado que manda SIN autorizacion.
--
-- Auditoria de push del 26-sep (docs/AUDITORIA-push-2026-09-26.md §3.1) y
-- comprobado de nuevo en solo lectura el 27-sep-2026 en produccion:
--   - notify_push() (redefinida en Studio) hace net.http_post a send-push con
--     solo Content-Type, SIN Authorization. Desde el 27-ago la puerta de
--     send-push lo rechaza: cada venta o reserva nueva deja un 401 en
--     net._http_response. Ese ruido tapa los 401 de verdad (Vault desalineado
--     tras una rotacion), que son los que importan.
--   - Cuelga de dos triggers: on_sale_confirmation_inserted
--     (sale_confirmations) y on_booking_inserted (bookings).
--   - El push REAL de esos dos eventos ya lo hacen push_on_sale_pgnet y
--     push-on-booking (call_send_push_on_*), con autorizacion y timeout. Quitar
--     notify_push no quita ningun aviso: solo el POST que muere en la puerta.
--   - Ademas mandaba row_to_json(NEW) entero y no tenia timeout.
--
-- Reversion (solo si hiciera falta): docs/rollback/20260927150000_quitar_notify_push_rollback.sql
-- Idempotente.

DROP TRIGGER IF EXISTS on_sale_confirmation_inserted ON public.sale_confirmations;
DROP TRIGGER IF EXISTS on_booking_inserted ON public.bookings;
DROP FUNCTION IF EXISTS public.notify_push();

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'notify_push'
             AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'notify_push sigue existiendo';
  END IF;
  -- El push real de ventas y reservas tiene que seguir en su sitio.
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.sale_confirmations'::regclass
                 AND tgname = 'push_on_sale_pgnet' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta push_on_sale_pgnet: no quitar notify_push sin el push real de ventas';
  END IF;
  IF to_regclass('public.bookings') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.bookings'::regclass
                     AND tgname = 'push-on-booking' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta push-on-booking: no quitar notify_push sin el push real de reservas';
  END IF;
END
$verify$;
