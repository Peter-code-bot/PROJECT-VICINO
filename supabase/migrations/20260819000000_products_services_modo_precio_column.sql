ALTER TABLE products_services ALTER COLUMN precio DROP NOT NULL;

ALTER TABLE products_services
  ADD COLUMN IF NOT EXISTS modo_precio text NOT NULL DEFAULT 'precio';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'products_services_modo_precio_check') THEN
    ALTER TABLE products_services ADD CONSTRAINT products_services_modo_precio_check
      CHECK (modo_precio IN ('precio','cotizacion','reservacion'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'products_services_modo_precio_coherente') THEN
    ALTER TABLE products_services ADD CONSTRAINT products_services_modo_precio_coherente
      CHECK (modo_precio <> 'precio' OR precio IS NOT NULL);
  END IF;
END $$;

-- Los grants de products_services son COLUMNA POR COLUMNA, deliberadamente.
-- ADD COLUMN nunca los hereda. Sin esto toda edición muere con 42501.
GRANT SELECT (modo_precio), INSERT (modo_precio), UPDATE (modo_precio)
  ON products_services TO authenticated;
GRANT SELECT (modo_precio) ON products_services TO anon;
