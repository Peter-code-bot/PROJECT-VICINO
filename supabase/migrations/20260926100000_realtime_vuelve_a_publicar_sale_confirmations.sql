-- El chat en vivo estaba muerto en produccion: causa del P0 "Sincronizacion
-- pendiente. Tus mensajes se conservan. [Reintentar]".
--
-- chat-window.tsx abre UN canal Realtime (`chat:<id>`) con cuatro escuchas:
-- chats UPDATE, messages INSERT/UPDATE y sale_confirmations *. Si una sola
-- escucha apunta a una tabla fuera de la publicacion, el servidor de Realtime
-- rechaza el canal ENTERO ("Unable to subscribe to changes with given
-- parameters ... table: sale_confirmations") y no entrega ni los mensajes: el
-- chat solo se entera al reconciliar, de ahi el aviso permanente.
--
-- 20260517000001 agrego sale_confirmations a supabase_realtime y esta en el
-- ledger de produccion, pero el 26-sep la publicacion de produccion solo tenia
-- chats, messages y notifications: se retiro fuera de banda. Reproducido en
-- staging con dos sesiones reales (el frame del servidor lo dice tal cual) y
-- corregido con esta misma sentencia.
--
-- Seguro de publicar: la RLS de SELECT de sale_confirmations limita cada fila
-- a su comprador y su vendedor (y admin), y `authenticated` tiene SELECT en
-- todas sus columnas, que es lo que Realtime evalua antes de entregar.
-- Idempotente: no falla si la tabla ya esta publicada.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sale_confirmations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sale_confirmations;
  END IF;
END
$$;
