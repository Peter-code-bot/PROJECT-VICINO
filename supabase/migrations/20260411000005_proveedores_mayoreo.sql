-- Insertar categoría padre: Proveedores y Mayoreo
INSERT INTO categories (nombre, slug, icono, orden, activo)
VALUES ('Proveedores y Mayoreo', 'proveedores-mayoreo', 'Warehouse', 25, true)
ON CONFLICT (slug) DO NOTHING;

-- Insertar subcategorías
DO $$
DECLARE
  parent_uuid UUID;
BEGIN
  SELECT id INTO parent_uuid FROM categories WHERE slug = 'proveedores-mayoreo';
  IF parent_uuid IS NULL THEN RETURN; END IF;

  INSERT INTO categories (nombre, slug, icono, orden, activo, parent_id) VALUES
    ('Alimentos al mayoreo', 'alimentos-mayoreo', 'UtensilsCrossed', 1, true, parent_uuid),
    ('Ropa y Textiles al mayoreo', 'ropa-mayoreo', 'Shirt', 2, true, parent_uuid),
    ('Tecnología al mayoreo', 'tecnologia-mayoreo', 'Smartphone', 3, true, parent_uuid),
    ('Materiales de construcción', 'materiales-construccion', 'Hammer', 4, true, parent_uuid),
    ('Limpieza al mayoreo', 'limpieza-mayoreo', 'Sparkles', 5, true, parent_uuid),
    ('Papelería al mayoreo', 'papeleria-mayoreo', 'BookOpen', 6, true, parent_uuid),
    ('Cosméticos al mayoreo', 'cosmeticos-mayoreo', 'Palette', 7, true, parent_uuid),
    ('Insumos para restaurantes', 'insumos-restaurantes', 'UtensilsCrossed', 8, true, parent_uuid),
    ('Materias primas', 'materias-primas', 'Package', 9, true, parent_uuid),
    ('Otros mayoreo', 'otros-mayoreo', 'MoreHorizontal', 10, true, parent_uuid)
  ON CONFLICT (slug) DO NOTHING;
END $$;
