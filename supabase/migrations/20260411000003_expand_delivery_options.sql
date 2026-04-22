-- Cambiar tipo_entrega de enum a TEXT para soportar más opciones
ALTER TABLE products_services ALTER COLUMN tipo_entrega TYPE TEXT USING tipo_entrega::TEXT;
ALTER TABLE products_services ALTER COLUMN tipo_entrega SET DEFAULT 'punto_encuentro';

-- Migrar valores existentes
UPDATE products_services SET tipo_entrega = 'punto_encuentro' WHERE tipo_entrega = 'pickup';
UPDATE products_services SET tipo_entrega = 'entrega_domicilio' WHERE tipo_entrega = 'envio';
UPDATE products_services SET tipo_entrega = 'punto_encuentro' WHERE tipo_entrega = 'ambos';

-- Eliminar el enum viejo (ya no se usa)
DROP TYPE IF EXISTS delivery_mode;
