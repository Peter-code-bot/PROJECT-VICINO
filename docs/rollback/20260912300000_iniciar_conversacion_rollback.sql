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

drop function if exists public.iniciar_conversacion(uuid, uuid, text, uuid);
drop index if exists public.messages_autor_clave_idempotencia_unica;
alter table public.messages drop column if exists clave_idempotencia;

delete from supabase_migrations.schema_migrations where version = '20260912300000';

notify pgrst, 'reload schema';

commit;

-- VERIFY:
--   select count(*) from pg_proc where proname = 'iniciar_conversacion';                 -- 0
--   select count(*) from information_schema.columns
--    where table_name = 'messages' and column_name = 'clave_idempotencia';               -- 0
--   select count(*) from public.messages where message_type = 'purchase_intent';        -- los que hubiera: intactos
