-- Agregar tipo de vendedor a profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS seller_type TEXT DEFAULT 'casual';

-- Los que ya tienen nombre de tienda → business
UPDATE profiles SET seller_type = 'business'
WHERE nombre_negocio IS NOT NULL AND nombre_negocio != '' AND es_vendedor = true;
