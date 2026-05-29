-- Instrucciones:
-- 1. Ve al Dashboard de Supabase -> SQL Editor
-- 2. Crea un nuevo query
-- 3. Ejecuta el script. Ya está configurado con tu ID corto (U9387200).

DO $$
DECLARE
    -- Tu ID corto que proporcionaste:
    my_short_id TEXT := 'U9387200'; 
    
    -- Buscamos el UUID real asociado a tu ID corto
    my_user_id UUID := (SELECT id FROM profiles WHERE user_id = my_short_id LIMIT 1);
    
    -- Seleccionamos otro usuario al azar para que sea el comprador/vendedor de prueba
    other_user_id UUID := (SELECT id FROM profiles WHERE id != my_user_id LIMIT 1);
    
    -- IDs de los productos a crear
    prod1_id UUID := gen_random_uuid();
    prod2_id UUID := gen_random_uuid();
    prod3_id UUID := gen_random_uuid();
    prod_other_id UUID := gen_random_uuid();
    
    -- Variables para el bucle
    i INT;
    random_prod UUID;
    random_price DECIMAL(10,2);
    random_qty INT;
    
    -- Categorías (asumiendo que los slugs existen o se insertan como texto)
    cat_servicios UUID := (SELECT id FROM categories WHERE slug = 'servicios' LIMIT 1);
    cat_electronicos UUID := (SELECT id FROM categories WHERE slug = 'tecnologia' OR slug = 'electronica' LIMIT 1);
BEGIN
    -- Validaciones
    IF my_user_id IS NULL THEN
        RAISE EXCEPTION 'No se encontró tu usuario con el ID corto "%". Asegúrate de que sea correcto.', my_short_id;
    END IF;

    IF other_user_id IS NULL THEN
        RAISE EXCEPTION 'Necesitas al menos otro usuario en la base de datos (profiles) para simular ventas y compras. Crea una segunda cuenta de prueba primero.';
    END IF;

    ---------------------------------------------------------
    -- 1. INSERTAR PRODUCTOS Y SERVICIOS (Tuyos)
    ---------------------------------------------------------
    INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id, imagen_principal, galeria_imagenes, estatus)
    VALUES 
    (
        prod1_id, my_user_id, 
        'Mantenimiento Preventivo de PC', 
        'Servicio completo de limpieza, cambio de pasta térmica y optimización de sistema operativo para computadoras de escritorio y laptops.', 
        500.00, 'servicio', 'Servicios', cat_servicios, 
        'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=800&q=80', 
        ARRAY['https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=800&q=80'], 
        'disponible'
    ),
    (
        prod2_id, my_user_id, 
        'Laptop Dell XPS 15 (Seminueva)', 
        'Laptop Dell XPS 15 en excelente estado. Procesador Intel Core i7, 16GB RAM, 512GB SSD. Ideal para trabajo y diseño.', 
        15000.00, 'producto', 'Electrónica', cat_electronicos, 
        'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=800&q=80', 
        ARRAY['https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=800&q=80'], 
        'disponible'
    ),
    (
        prod3_id, my_user_id, 
        'Monitor UltraWide LG 29"', 
        'Monitor LG de 29 pulgadas, formato UltraWide. Perfecto para productividad y gaming casual. Incluye cable HDMI.', 
        3500.00, 'producto', 'Electrónica', cat_electronicos, 
        'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80', 
        ARRAY['https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80'], 
        'disponible'
    );

    ---------------------------------------------------------
    -- 2. INSERTAR PRODUCTO DE OTRO USUARIO (Para simular compras)
    ---------------------------------------------------------
    INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id, imagen_principal, galeria_imagenes, estatus)
    VALUES 
    (
        prod_other_id, other_user_id, 
        'Teclado Mecánico Keychron K2', 
        'Teclado mecánico inalámbrico, switches red. Casi nuevo.', 
        1200.00, 'producto', 'Electrónica', cat_electronicos, 
        'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=800&q=80', 
        ARRAY['https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=800&q=80'], 
        'disponible'
    );

    ---------------------------------------------------------
    -- 3. SIMULAR ~10 VENTAS COMPLETADAS (Tú eres el vendedor)
    ---------------------------------------------------------
    FOR i IN 1..10 LOOP
        -- Asignar uno de tus productos aleatoriamente basado en el índice
        IF i % 3 = 0 THEN
            random_prod := prod1_id; random_price := 500.00;
        ELSIF i % 3 = 1 THEN
            random_prod := prod2_id; random_price := 15000.00;
        ELSE
            random_prod := prod3_id; random_price := 3500.00;
        END IF;

        -- Cantidad aleatoria entre 1 y 2
        random_qty := floor(random() * 2 + 1)::INT;

        -- Insertar la venta con fechas escalonadas en los últimos 30 días
        INSERT INTO sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, cantidad, initiated_by, buyer_confirmed, seller_confirmed, status, created_at, completed_at)
        VALUES (
            random_prod, 
            other_user_id, 
            my_user_id, 
            random_price, 
            random_qty, 
            other_user_id, 
            TRUE, 
            TRUE, 
            'completed',
            NOW() - (i * 3 || ' days')::INTERVAL, 
            NOW() - (i * 3 || ' days')::INTERVAL + INTERVAL '12 hours'
        );
    END LOOP;

    -- Una venta adicional que esté "pendiente de confirmación" tuya
    INSERT INTO sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, cantidad, initiated_by, buyer_confirmed, seller_confirmed, status)
    VALUES (prod2_id, other_user_id, my_user_id, 15000.00, 1, other_user_id, TRUE, FALSE, 'pending_confirmation');

    ---------------------------------------------------------
    -- 4. SIMULAR ALGUNAS COMPRAS (Tú eres el comprador)
    ---------------------------------------------------------
    FOR i IN 1..3 LOOP
        INSERT INTO sale_confirmations (product_id, buyer_id, seller_id, precio_acordado, cantidad, initiated_by, buyer_confirmed, seller_confirmed, status, created_at, completed_at)
        VALUES (
            prod_other_id, 
            my_user_id, 
            other_user_id, 
            1200.00, 
            1, 
            my_user_id, 
            TRUE, 
            TRUE, 
            'completed',
            NOW() - (i * 5 || ' days')::INTERVAL,
            NOW() - (i * 5 || ' days')::INTERVAL + INTERVAL '4 hours'
        );
    END LOOP;

END $$;
