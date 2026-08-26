-- Reconciliacion: dos deudas que la pagina de Notion ya tenia anotadas y que
-- impiden que el repo reconstruya produccion.
--
-- No cambia NADA en produccion. Todo lo de aqui ya existe alli. El valor es que
-- un entorno nuevo levantado solo desde supabase/migrations quede igual, en vez
-- de quedarse sin cuatro columnas y sin seis categorias.

-- ---------------------------------------------------------------------------
-- 1. Cuatro columnas fantasma en seller_verification
--
-- Existen en produccion y ninguna migracion las crea: se comprobo que no hay un
-- solo ADD COLUMN para ellas en las 100 migraciones del repo. Entraron por el
-- Dashboard o por SQL suelto.
--
-- Las cuatro las usa codigo vivo: verify-document.ts escribe ai_confidence_score
-- y ai_analysis_raw con el veredicto del modelo, y document_type y
-- university_name son lo que declara el vendedor al subir. Sin ellas, un entorno
-- nuevo revienta en la primera verificacion.
--
-- Los tipos y defaults se leyeron del information_schema de produccion, no se
-- dedujeron del codigo.
-- ---------------------------------------------------------------------------

ALTER TABLE public.seller_verification
  ADD COLUMN IF NOT EXISTS document_type       text DEFAULT 'INE'::text,
  ADD COLUMN IF NOT EXISTS university_name     text,
  ADD COLUMN IF NOT EXISTS ai_confidence_score integer,
  ADD COLUMN IF NOT EXISTS ai_analysis_raw     jsonb;

COMMENT ON COLUMN public.seller_verification.ai_confidence_score IS
  'Confianza del modelo al analizar el documento, 0-100. La escribe verify-document.ts con el cliente admin, nunca el usuario.';
COMMENT ON COLUMN public.seller_verification.ai_analysis_raw IS
  'Respuesta cruda del modelo. Se guarda entera para poder auditar una decision automatica despues.';

-- Nota sobre GRANTs: seller_verification usa permisos a nivel de TABLA, no
-- columna por columna como products_services, asi que estas cuatro no necesitan
-- GRANT propio. Lo que si las protege es el WITH CHECK que 20260826150000 y
-- 20260826151000 pusieron a las policies del usuario: puede declarar sus
-- documentos, nunca el veredicto.

-- ---------------------------------------------------------------------------
-- 2. Seis categorias fuera de banda
--
-- Entraron en el commit 364c605, que solo toco TypeScript. Existen en produccion
-- sin ninguna migracion que las respalde. Comparado slug a slug: 42 en
-- produccion, 6 sin respaldo.
--
-- Se reinsertan con los valores exactos de produccion, IDs incluidos, para que
-- un entorno nuevo genere las MISMAS claves. Si se dejaran a
-- gen_random_uuid(), las filas de product_categories que apuntan a estos ids no
-- casarian.
--
-- ON CONFLICT DO NOTHING sobre la PK y sobre slug: correrlo contra produccion es
-- un no-op.
-- ---------------------------------------------------------------------------

INSERT INTO public.categories (id, nombre, slug, icono, parent_id, orden, activo) VALUES
  ('8c0c9589-203f-4363-abd7-204651888843', 'Entretenimiento',      'entretenimiento',   'Ticket',       NULL, 26, true),
  ('18fafabb-1b2c-44ed-a129-05e3eedce465', 'Postres y Repostería', 'postres',           'Cake',         NULL, 27, true),
  ('859b0bec-182a-497b-9a79-4a3e3cb2752e', 'Electrodomésticos',    'electrodomesticos', 'Refrigerator', NULL, 28, true),
  ('b7dc034b-7b18-458b-9e81-9a47018fbd61', 'Herramientas',         'herramientas',      'Hammer',       NULL, 29, true),
  ('b8085eef-1f99-47d4-a6a3-459e56458813', 'Regalos y Detalles',   'regalos',           'Gift',         NULL, 30, true),
  ('3a41a20c-9ab7-4d5f-b347-86c58c43da08', 'Joyería',              'joyeria',           'Gem',          NULL, 31, true)
ON CONFLICT (id) DO NOTHING;

-- VERIFY:
--   Las cuatro columnas:
--     SELECT column_name FROM information_schema.columns
--     WHERE table_name='seller_verification'
--       AND column_name IN ('document_type','university_name',
--                           'ai_confidence_score','ai_analysis_raw');
--     -- esperado: 4 filas
--
--   Y que produccion no cambio: 42 categorias antes y despues.
--     SELECT count(*) FROM public.categories;
