-- Reversion de 20260926100000_realtime_vuelve_a_publicar_sale_confirmations.
--
-- Vive en docs/rollback/ y NO en supabase/migrations/ a proposito: nada debe
-- aplicarla en una replica. Se corre a mano.
--
-- ADVERTENCIA: revertir esto VUELVE A ROMPER el chat en vivo. Con
-- sale_confirmations fuera de la publicacion, el servidor de Realtime rechaza
-- el canal `chat:<id>` ENTERO (chat-window.tsx escucha chats, messages y
-- sale_confirmations en el mismo canal) y reaparece el P0 "Sincronizacion
-- pendiente. Tus mensajes se conservan." Solo tiene sentido si antes se quita
-- la escucha de sale_confirmations de chat-window.tsx, o si publicar la tabla
-- resulta causar un problema peor (por ejemplo, de carga en Realtime).
--
-- No toca datos: solo la publicacion. Idempotente: no falla si la tabla ya no
-- esta publicada. No borra la version del ledger; volver a aplicar la
-- migracion original la publica otra vez.
--
-- Escrita el 27-sep-2026 (faltaba; lo marco la revision de pendientes).

begin;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sale_confirmations'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.sale_confirmations;
  END IF;
END
$$;

-- Verificacion: la tabla ya no debe aparecer.
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sale_confirmations'
  ) THEN
    RAISE EXCEPTION 'sale_confirmations sigue publicada';
  END IF;
END
$verify$;

commit;
