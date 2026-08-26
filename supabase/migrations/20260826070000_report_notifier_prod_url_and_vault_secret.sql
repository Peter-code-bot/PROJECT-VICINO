-- El aviso de reportes no llegaba a ninguna parte, y el secreto estaba a la vista.
--
-- El trigger `report-notifier` era un Database Webhook creado desde el Dashboard,
-- asi que su URL y sus headers vivian como literales dentro de pg_trigger.tgargs.
-- Dos consecuencias:
--
--   1. Apuntaba a un deployment de PREVIEW de Vercel
--      (vicinomarket-git-feat-moderation-mp04-...) que ya no existe: responde 410
--      Gone. Ningun reporte de usuario ha generado nunca un aviso, incluido el
--      camino URGENTE de `child_safety` que la route trata aparte.
--   2. El `x-webhook-secret` estaba en TEXTO PLANO en el catalogo de Postgres.
--      Cualquier pg_dump, snapshot o diff de esquema lo arrastra.
--
-- Nada de esto se noto porque el POST es asincrono: el 410 muere en
-- net._http_response, tabla que ningun proceso del sistema consulta.
--
-- El arreglo cambia el mecanismo, no solo la URL: se sustituye el webhook del
-- Dashboard por una funcion plpgsql que lee el secreto de Vault en cada disparo,
-- igual que ya hacen call_send_push_on_message y los tres jobs de pg_cron. Asi el
-- secreto deja de estar en el catalogo y rotarlo pasa a ser una sola escritura en
-- Vault, sin tocar la definicion del trigger.
--
-- REQUISITO: Vault debe tener un secreto llamado 'webhook_secret' cuyo valor
-- coincida con SUPABASE_WEBHOOK_SECRET en el entorno de Vercel. Si falta, el
-- trigger avisa por WARNING y deja pasar el INSERT: un fallo al notificar no
-- puede impedir que una persona levante un reporte.

CREATE OR REPLACE FUNCTION public.notify_report_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret
    INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'webhook_secret';

  IF v_secret IS NULL THEN
    RAISE WARNING 'webhook_secret no esta en Vault; no se notifica el reporte id=%', NEW.id;
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://vicinomarket.com/api/admin/report-webhook',
    headers := jsonb_build_object(
      'Content-Type',     'application/json',
      'x-webhook-secret', v_secret
    ),
    -- Mismo sobre que emite un Database Webhook de Supabase, porque
    -- apps/web/app/api/admin/report-webhook/route.ts espera exactamente esa forma.
    body    := jsonb_build_object(
      'type',       'INSERT',
      'table',      'reports',
      'schema',     'public',
      'record',     to_jsonb(NEW),
      'old_record', null
    ),
    -- 5000 ms (el default de pg_net) no alcanza para un arranque en frio. Mismo
    -- criterio que 20260826061500_pg_net_timeouts_for_cron_jobs.sql.
    timeout_milliseconds := 30000
  );

  RETURN NEW;

EXCEPTION WHEN OTHERS THEN
  -- Se traga el error a proposito: que la notificacion falle no puede abortar el
  -- INSERT y dejar a una persona sin poder reportar. El precio es que el fallo
  -- solo queda en el log de Postgres y en net._http_response — que es justo la
  -- ceguera de fondo de este proyecto. La solucion real es una alerta sobre las
  -- respuestas no-2xx, no un parche mas en este trigger.
  RAISE WARNING 'fallo al notificar el reporte id=%: % (sqlstate %)',
                NEW.id, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$function$;

-- CREATE OR REPLACE TRIGGER (PG 14+) sustituye la definicion vieja sin un DROP,
-- y con ella desaparece el literal del secreto que vivia en tgargs.
CREATE OR REPLACE TRIGGER "report-notifier"
AFTER INSERT ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.notify_report_created();

-- VERIFY:
--   1. Ya no queda ningun secreto literal en la definicion del trigger:
--      SELECT tgname, encode(tgargs,'escape')
--      FROM pg_trigger WHERE tgname = 'report-notifier';
--      -- esperado: sin argumentos (la funcion no recibe ninguno)
--
--   2. Vault tiene el secreto:
--      SELECT name FROM vault.decrypted_secrets WHERE name = 'webhook_secret';
--
--   3. Prueba de extremo a extremo, revertida (NO deja el reporte creado):
--      BEGIN;
--        INSERT INTO public.reports (reporter_id, target_type, target_id, reason)
--        VALUES ('<uuid>', 'listing', '<uuid>', 'other');
--      ROLLBACK;
--      -- y despues:
--      SELECT created, status_code, content FROM net._http_response
--      ORDER BY created DESC LIMIT 1;   -- esperado: 200, no 410 ni 401
--      -- El POST de pg_net se encola fuera de la transaccion, asi que sale
--      -- aunque el INSERT se revierta.
