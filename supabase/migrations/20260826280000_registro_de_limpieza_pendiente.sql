-- Cuando borrar un archivo falla al eliminar una cuenta, que quede rastro.
--
-- delete-account limpia el almacenamiento en modo "best-effort": si el borrado
-- falla deja un console.warn y sigue. Acto seguido borra la cuenta de
-- auth.users, que es irreversible. A partir de ese momento el archivo queda
-- huerfano y SIN NINGUNA FORMA DE ENCONTRARLO: ya no hay usuario del que
-- colgarlo, ni fila que lo referencie, ni registro de que fallo.
--
-- No es hipotetico. En produccion ya hay archivos huerfanos (conteo, tamano y
-- desglose por carpeta en Notion): avatares de cuentas borradas, fotos de
-- resenas cuya venta ya no existe y la carpeta product-media/temp/ del flujo
-- viejo, donde ya ningun codigo escribe.
--
-- Algunos de esos archivos son fotos de personas que pidieron borrar su cuenta.
--
-- Esta tabla es el registro que faltaba. No arregla el borrado: hace que su
-- fallo se pueda ver y reintentar, que es la diferencia entre una deuda y una
-- fuga silenciosa.

CREATE TABLE IF NOT EXISTS public.storage_cleanup_pending (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket      TEXT NOT NULL,
  path        TEXT NOT NULL,
  -- El usuario ya no existe en auth.users cuando esto se escribe. Se guarda
  -- solo para poder agrupar y para saber a que borrado pertenecio.
  former_user_id UUID,
  motivo      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_storage_cleanup_pending_sin_resolver
  ON public.storage_cleanup_pending (created_at DESC)
  WHERE resolved_at IS NULL;

-- Nadie del lado del cliente tiene por que ver esto: son rutas de archivos de
-- personas que ya se fueron. Solo service_role, que es quien corre la Edge
-- Function y quien correria la barrida de reintento.
ALTER TABLE public.storage_cleanup_pending ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.storage_cleanup_pending FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.storage_cleanup_pending TO service_role;

-- Sin ninguna policy: con RLS activada y sin policies, ni anon ni authenticated
-- ven una sola fila aunque alguien les otorgara un GRANT por descuido.
-- service_role brinca RLS por definicion.

COMMENT ON TABLE public.storage_cleanup_pending IS
  'Archivos que delete-account no pudo borrar. Sin esto, el fallo desaparece con la cuenta.';

-- VERIFY:
--   SELECT has_table_privilege('anon','public.storage_cleanup_pending','SELECT');          -- false
--   SELECT has_table_privilege('authenticated','public.storage_cleanup_pending','SELECT'); -- false
--   SELECT relrowsecurity FROM pg_class WHERE oid='public.storage_cleanup_pending'::regclass; -- true
