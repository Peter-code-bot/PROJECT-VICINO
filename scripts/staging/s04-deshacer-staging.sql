-- SOLO STAGING. Quita todo lo que crea 20260925010000 para poder reaplicarla
-- limpia con reaplicar-migracion.mjs. BORRA COLUMNAS: jamas contra produccion
-- (la reversion de produccion, sin perdida de datos, esta en docs/rollback/).
BEGIN;
DROP TRIGGER IF EXISTS chat_producto_revision ON public.chats;
DROP FUNCTION IF EXISTS public.avanzar_producto_revision_chat();
DROP FUNCTION IF EXISTS public.seleccionar_producto_chat(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.iniciar_confirmacion_venta(uuid, uuid, integer, uuid, numeric, integer, text, text, text);
DROP FUNCTION IF EXISTS public.confirmar_venta(uuid);
DROP INDEX IF EXISTS public.sale_confirmations_actor_clave_unica;
DROP INDEX IF EXISTS public.messages_unique_sale_proposed;
ALTER TABLE public.chats DROP COLUMN IF EXISTS producto_revision;
ALTER TABLE public.sale_confirmations DROP COLUMN IF EXISTS clave_idempotencia;
ALTER TABLE public.sale_confirmations DROP COLUMN IF EXISTS producto_revision;
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260925010000';
COMMIT;
