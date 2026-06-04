-- Push notification trigger for appointments (citas).
--
-- Mismo patron que push_on_message_pgnet (validado en prod): trigger AFTER INSERT
-- que encola un POST async via pg_net hacia la edge function send-push, mimicando
-- el formato del Database Webhook payload para que send-push no requiera cambio
-- de codigo adicional.
--
-- Reemplaza al webhook viejo push-on-booking del Dashboard (broken: llamaba a
-- supabase_functions.http_request, extension ausente). Adicionalmente, el webhook
-- estaba apuntando a la tabla bookings (que no recibe inserts en la app); la
-- tabla real de citas es public.appointments — send-push se ajusto en commit
-- 76b7e39 para procesar 'appointments' con record.seller_id como receptor.
--
-- Auth: lee la service_role JWT desde Vault (mismo secret 'service_role_key' que
-- ya usa push_on_message_pgnet, sembrado por Pedro). Rotaciones futuras solo
-- requieren actualizar el secret del Vault, no esta trigger SQL.
--
-- Robustez: el trigger NUNCA hace fallar el INSERT del appointment. Si Vault no
-- tiene el secret o pg_net lanza error, se loguea WARNING y RETURN NEW para que
-- la cita se guarde igual.

CREATE OR REPLACE FUNCTION public.call_send_push_on_appointment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret
    INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key';

  IF v_key IS NULL THEN
    RAISE WARNING 'service_role_key not in vault; skipping push for appointment id=%', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body    := jsonb_build_object(
      'type',       'INSERT',
      'table',      'appointments',
      'schema',     'public',
      'record',     to_jsonb(NEW),
      'old_record', null
    )
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Nunca dejar que un fallo de dispatch de push bloquee el INSERT del appointment.
  RAISE WARNING 'push dispatch failed for appointment id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_on_appointment_pgnet ON public.appointments;
CREATE TRIGGER push_on_appointment_pgnet
  AFTER INSERT ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.call_send_push_on_appointment();
