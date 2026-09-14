-- Reversion de 20260912300000_iniciar_conversacion_idempotente.
--
-- Vive en docs/rollback/ y NO en supabase/migrations/ a proposito: nada debe
-- aplicarla en una replica. Se corre a mano, y SOLO despues de retirar del
-- codigo la llamada a iniciar_conversacion (apps/web/app/(marketplace)/chat/
-- actions.ts y apps/web/lib/chat/iniciar-conversacion.ts): si la app la sigue
-- llamando, cada "Quiero comprarlo" morira con PGRST202.
--
-- Que conserva: TODOS los mensajes. Los que nacieron con la clave solo la
-- pierden; los de message_type = 'purchase_intent' siguen siendo mensajes
-- validos (message_type es texto libre, sin CHECK) y el chat los pinta como
-- texto. No se borra ninguna fila de chats ni de messages.
--
-- Que quita: la RPC, el indice unico y la columna. Anota la reversion en el
-- ledger borrando la version, para que apply-migration.mjs pueda volver a
-- aplicar la migracion si se decide reintentar.

begin;

-- 1. La policy de INSERT vuelve a su forma de 20260912120000 (participante y
--    no suspendido), sin las clausulas sobre clave_idempotencia y message_type.
--    Va ANTES de borrar la columna: la expresion actual la referencia.
alter policy "Participants can send messages" on public.messages
  with check (
    (select auth.uid()) = autor_id
    and exists (
      select 1 from public.chats
       where chats.id = messages.chat_id
         and (chats.comprador_id = (select auth.uid())
              or chats.vendedor_id = (select auth.uid()))
    )
    and not (select vicino_guard.cuenta_suspendida())
  );

-- 2. La RPC, el indice y la columna.
drop function if exists public.iniciar_conversacion(uuid, uuid, text, uuid);
drop index if exists public.messages_autor_clave_idempotencia_unica;
alter table public.messages drop column if exists clave_idempotencia;

-- 3. 20260912310000 (get_or_create_chat con ON CONFLICT y sin EXECUTE para
--    anon, y la policy de INSERT de chats cerrada) se queda: es estrictamente
--    mas robusta y no depende de nada de lo que se quita aqui. Si aun asi se
--    quiere revertir, reaplicar el cuerpo de 20260912130000, devolver la
--    policy "Authenticated users can create chats" a
--    ((select auth.uid()) = comprador_id or (select auth.uid()) = vendedor_id)
--    y borrar esa version del ledger.

delete from supabase_migrations.schema_migrations where version = '20260912300000';

notify pgrst, 'reload schema';

commit;

-- VERIFY:
--   select count(*) from pg_proc where proname = 'iniciar_conversacion';                 -- 0
--   select count(*) from information_schema.columns
--    where table_name = 'messages' and column_name = 'clave_idempotencia';               -- 0
--   select count(*) from public.messages where message_type = 'purchase_intent';        -- los que hubiera: intactos
