-- =============================================================================
-- VICINO — Seed de publicaciones de Tecnología para el perfil de Pedro
-- Propósito: poblar el perfil de Pedro con 9 listings reales y coherentes
--            (tienda de electrónica + reparaciones) para tomar capturas de
--            pantalla y subirlas a la Google Play Store.
--
-- Dónde correr: SQL Editor de Supabase (producción).
-- Perfil objetivo: profiles.user_id = 'U2317694' (Pedro).
-- Imágenes: URLs públicas de Unsplash, verificadas (HTTP 200 + contenido).
--
-- Idempotencia: el bloque borra primero las 9 publicaciones por título+creador
-- antes de reinsertar, así que correrlo dos veces NO duplica.
-- =============================================================================

DO $$
DECLARE
  pedro_id   UUID := (SELECT id FROM profiles WHERE user_id = 'U2317694' LIMIT 1);
  cat_tec    UUID := (SELECT id FROM categories WHERE slug = 'tecnologia' LIMIT 1);
  geo_puebla geography := 'SRID=4326;POINT(-98.2063 19.0414)'; -- Puebla (lng, lat)
  ubic       TEXT := 'Centro Histórico, Puebla';
  new_id     UUID;
  titulos    TEXT[] := ARRAY[
    'Laptop Dell XPS 15 (seminueva)',
    'Monitor UltraWide LG 29"',
    'Teclado mecánico Keychron K2',
    'Audífonos Bluetooth TWS con estuche de carga',
    'Smartwatch con monitor de ritmo cardíaco',
    'Power bank 20,000mAh carga rápida 20W',
    'Mantenimiento preventivo de PC o laptop',
    'Cambio de pantalla de celular (mano de obra)',
    'Instalación de Windows 11 + Office'
  ];
BEGIN
  IF pedro_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el perfil de Pedro con user_id U2317694';
  END IF;
  IF cat_tec IS NULL THEN
    RAISE EXCEPTION 'No existe la categoría con slug "tecnologia"';
  END IF;

  -- Asegurar que Pedro sea vendedor, sin pisar datos reales existentes
  UPDATE profiles
     SET es_vendedor       = TRUE,
         nombre_negocio    = COALESCE(NULLIF(nombre_negocio, ''), 'TecnoPedro'),
         categoria_negocio = COALESCE(NULLIF(categoria_negocio, ''), 'tecnologia')
   WHERE id = pedro_id;

  -- Idempotencia: limpiar inserciones previas de este mismo seed
  DELETE FROM products_services
   WHERE creador_id = pedro_id
     AND titulo = ANY (titulos);

  -- ---------------------------------------------------------------------------
  -- 1. Laptop Dell XPS 15 (seminueva)
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[1],
     'Dell XPS 15 en excelente estado. Intel Core i7, 16GB RAM, 512GB SSD y pantalla FHD+. Batería con buena salud, cargador original incluido. Ideal para trabajo, diseño y estudio.',
     15000.00, 'producto', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'entrega_domicilio', 'disponible', TRUE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 2. Monitor UltraWide LG 29"
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[2],
     'Monitor LG UltraWide de 29 pulgadas, resolución 2560x1080. Perfecto para multitarea, edición y gaming casual. Incluye cable HDMI y base original. Sin pixeles muertos.',
     3500.00, 'producto', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'entrega_domicilio', 'disponible', TRUE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 3. Teclado mecánico Keychron K2
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[3],
     'Teclado mecánico inalámbrico Keychron K2, switches Brown, retroiluminación blanca. Compatible con Windows y Mac, conexión Bluetooth o cable USB-C. Como nuevo, en su caja.',
     1200.00, 'producto', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1595225476474-87563907a212?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 4. Audífonos Bluetooth TWS
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[4],
     'Audífonos inalámbricos TWS con Bluetooth 5.3, cancelación de ruido y estuche de carga. Hasta 30 horas de batería total. Nuevos, sellados, con garantía de 3 meses.',
     650.00, 'producto', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1606220588913-b3aacb4d2f46?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 5. Smartwatch con monitor de ritmo cardíaco
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[5],
     'Smartwatch con pantalla táctil, monitor de ritmo cardíaco, oxímetro, podómetro y notificaciones. Resistente al agua IP68. Compatible con Android e iOS. Nuevo en caja.',
     1800.00, 'producto', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1579586337278-3befd40fd17a?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1579586337278-3befd40fd17a?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 6. Power bank 20,000mAh carga rápida 20W
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[6],
     'Batería portátil de 20,000mAh con carga rápida PD 20W. Dos puertos USB y entrada USB-C. Carga tu celular hasta 4 veces. Indicador LED de batería. Nueva, con garantía.',
     480.00, 'producto', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 7. Mantenimiento preventivo de PC o laptop (servicio)
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[7],
     'Servicio completo de limpieza interna, cambio de pasta térmica, eliminación de virus y optimización del sistema. Para computadoras de escritorio y laptops. Entrega el mismo día.',
     500.00, 'servicio', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1597872200969-2b65d56bd16b?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 8. Cambio de pantalla de celular (servicio)
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[8],
     'Reemplazo de pantalla para iPhone y Android (Samsung, Xiaomi, Motorola). Precio de mano de obra; la refacción se cotiza según el modelo. Reparación en 30-60 minutos con garantía.',
     1800.00, 'servicio', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1512941937669-90a1b58e7e9c?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------------------
  -- 9. Instalación de Windows 11 + Office (servicio)
  -- ---------------------------------------------------------------------------
  INSERT INTO products_services
    (creador_id, titulo, descripcion, precio, tipo, categoria, categoria_id,
     imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo, tipo_entrega,
     estatus, precio_negociable)
  VALUES
    (pedro_id, titulos[9],
     'Formateo e instalación de Windows 11 con licencia, más paquete Office y programas básicos (navegador, antivirus, lectores). Incluye respaldo de tus archivos. Listo en el día.',
     800.00, 'servicio', 'tecnologia', cat_tec,
     'https://images.unsplash.com/photo-1587831990711-23ca6441447b?auto=format&fit=crop&w=800&q=80',
     ARRAY['https://images.unsplash.com/photo-1587831990711-23ca6441447b?auto=format&fit=crop&w=800&q=80'],
     ubic, geo_puebla, 'punto_encuentro', 'disponible', FALSE)
  RETURNING id INTO new_id;
  INSERT INTO product_categories (product_id, categoria_id, is_primary)
  VALUES (new_id, cat_tec, TRUE) ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Listo: 9 publicaciones de Tecnología creadas para Pedro (%).', pedro_id;
END $$;

-- =============================================================================
-- VERIFICACIÓN (correr aparte después del bloque)
-- =============================================================================
-- SELECT titulo, precio, tipo, estatus,
--        imagen_principal IS NOT NULL AS tiene_img
--   FROM products_services
--  WHERE creador_id = (SELECT id FROM profiles WHERE user_id = 'U2317694')
--  ORDER BY created_at DESC;
-- -> 9 filas, estatus='disponible', tiene_img=true.

-- =============================================================================
-- LIMPIEZA (opcional, tras tomar las capturas)
-- =============================================================================
-- Pausar (las oculta sin borrarlas):
-- UPDATE products_services SET estatus = 'pausado'
--  WHERE creador_id = (SELECT id FROM profiles WHERE user_id = 'U2317694');
-- Eliminar por completo:
-- DELETE FROM products_services
--  WHERE creador_id = (SELECT id FROM profiles WHERE user_id = 'U2317694');
