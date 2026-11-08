-- Reversion de 20261108210000_ubicacion_exacta_por_publicacion.sql
-- Una sola transaccion (BEGIN..COMMIT): si algo falla a la mitad, no queda a medias.
--
-- ANTES de correr esto, revertir el codigo (merge revertido y redeploy): la
-- app nueva escribe ubicacion_precision al publicar y llama a
-- search_map_publications_v4, ubicacion_publica_de_publicacion y
-- ubicacion_de_mi_publicacion. Sin la app nueva, nada de esto se usa.
--
-- Para APAGAR la funcion sin tocar la base basta con el codigo: con la
-- migracion aplicada y la app anterior desplegada, todo se ve como antes.
--
-- Esto BORRA la eleccion exacta/aproximada de cada publicacion. Si se quiere
-- conservar, guardar antes:
--   SELECT id, ubicacion_precision, ubicacion_revision FROM public.products_services
--    WHERE ubicacion_precision = 'exacta';

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.search_map_publications_v4(jsonb);
DROP FUNCTION IF EXISTS public.ubicacion_publica_de_publicacion(uuid, integer);
DROP FUNCTION IF EXISTS public.ubicacion_de_mi_publicacion(uuid);
DROP TRIGGER IF EXISTS zz_ubicacion_publica_derivada ON public.products_services;
DROP FUNCTION IF EXISTS public.derivar_ubicacion_publica();
DROP FUNCTION IF EXISTS public.ubicacion_publica_punto(text, public.geometry, public.geography, integer);

ALTER TABLE public.products_services DROP CONSTRAINT IF EXISTS products_services_ubicacion_exacta_coherente;
ALTER TABLE public.products_services DROP CONSTRAINT IF EXISTS products_services_ubicacion_precision_valida;
ALTER TABLE public.products_services
  DROP COLUMN IF EXISTS ubicacion_exacta,
  DROP COLUMN IF EXISTS ubicacion_revision,
  DROP COLUMN IF EXISTS ubicacion_precision;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- La fila del ledger se quita aparte, a mano:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261108210000';
-- Y despues: node scripts/gen-types.mjs
