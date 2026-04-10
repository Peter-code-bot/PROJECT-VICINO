-- =============================================================================
-- VICINO Marketplace — Development Seed Data
-- 5 vendors, 240 products (20/category), 30 sale_confirmations, 50 reviews
-- =============================================================================

-- Desactivar triggers de usuario en tablas de productos/ventas/reviews
ALTER TABLE products_services DISABLE TRIGGER USER;
ALTER TABLE sale_confirmations DISABLE TRIGGER USER;
ALTER TABLE reviews DISABLE TRIGGER USER;

-- =============================================================================
-- 1. VENDOR PROFILES
-- =============================================================================
-- Estrategia: insertar auth.users (trigger handle_new_user auto-crea profiles),
-- luego UPDATE profiles con datos adicionales del vendedor.
DO $$
DECLARE
  v_maria   UUID := gen_random_uuid();
  v_carlos  UUID := gen_random_uuid();
  v_ana     UUID := gen_random_uuid();
  v_jorge   UUID := gen_random_uuid();
  v_sofia   UUID := gen_random_uuid();

  -- Arrays para productos
  p_id UUID;
  sc_id UUID;
BEGIN

-- Crear auth.users (trigger auto-crea profiles básicos)
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, raw_app_meta_data, raw_user_meta_data)
VALUES
  (v_maria, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'maria.garcia@demo.vicino.mx', crypt('demo12345', gen_salt('bf')), NOW(), NOW(), NOW(), '', '{"provider":"email","providers":["email"]}', '{"full_name":"María García"}'),
  (v_carlos, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'carlos.ramirez@demo.vicino.mx', crypt('demo12345', gen_salt('bf')), NOW(), NOW(), NOW(), '', '{"provider":"email","providers":["email"]}', '{"full_name":"Carlos Ramírez"}'),
  (v_ana, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana.lopez@demo.vicino.mx', crypt('demo12345', gen_salt('bf')), NOW(), NOW(), NOW(), '', '{"provider":"email","providers":["email"]}', '{"full_name":"Ana López"}'),
  (v_jorge, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jorge.hernandez@demo.vicino.mx', crypt('demo12345', gen_salt('bf')), NOW(), NOW(), NOW(), '', '{"provider":"email","providers":["email"]}', '{"full_name":"Jorge Hernández"}'),
  (v_sofia, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sofia.martinez@demo.vicino.mx', crypt('demo12345', gen_salt('bf')), NOW(), NOW(), NOW(), '', '{"provider":"email","providers":["email"]}', '{"full_name":"Sofía Martínez"}');

-- ---- María García — comida ---- (UPDATE, no INSERT — profile ya existe via trigger)
UPDATE profiles SET
  foto = 'https://i.pravatar.cc/150?u=maria', bio = 'Cocinera poblana con 10 años de experiencia. Mis tamales y pasteles son los favoritos del barrio.', es_vendedor = true, nombre_negocio = 'Delicias de María', descripcion_negocio = 'Comida casera y repostería artesanal hecha con ingredientes frescos y mucho amor.', categoria_negocio = 'comida', metodos_pago_aceptados = 'Efectivo, Transferencia', trust_level = 'estrella', trust_points = 600, total_sales = 45, average_rating = 4.80, average_rating_as_seller = 4.80, reviews_count = 40, reviews_count_as_seller = 40
WHERE id = v_maria;

UPDATE profiles SET
  foto = 'https://i.pravatar.cc/150?u=carlos', bio = 'Apasionado de la tecnología. Vendo gadgets y accesorios originales y reacondicionados a los mejores precios.', es_vendedor = true, nombre_negocio = 'TechCarlos', descripcion_negocio = 'Tecnología, gadgets y accesorios al mejor precio de Puebla.', categoria_negocio = 'tecnologia', metodos_pago_aceptados = 'Transferencia, Efectivo, MercadoPago', trust_level = 'confiable', trust_points = 250, total_sales = 20, average_rating = 4.50, average_rating_as_seller = 4.50, reviews_count = 18, reviews_count_as_seller = 18
WHERE id = v_carlos;

UPDATE profiles SET
  foto = 'https://i.pravatar.cc/150?u=ana', bio = 'Estilista profesional y fashionista. Productos de belleza y ropa de temporada seleccionada con cariño.', es_vendedor = true, nombre_negocio = 'Ana Beauty & Style', descripcion_negocio = 'Moda, belleza y accesorios para mujeres que quieren verse increíbles.', categoria_negocio = 'belleza', metodos_pago_aceptados = 'Efectivo, Transferencia, PayPal', trust_level = 'elite', trust_points = 1200, total_sales = 80, average_rating = 4.90, average_rating_as_seller = 4.90, reviews_count = 70, reviews_count_as_seller = 70
WHERE id = v_ana;

UPDATE profiles SET
  foto = 'https://i.pravatar.cc/150?u=jorge', bio = 'Profesional con más de 15 años de experiencia. Plomería, electricidad y servicios generales en Puebla y alrededores.', es_vendedor = true, nombre_negocio = 'Servicios JH', descripcion_negocio = 'Servicios profesionales a domicilio: plomería, electricidad, carpintería y más.', categoria_negocio = 'servicios-profesionales', metodos_pago_aceptados = 'Efectivo', trust_level = 'verificado', trust_points = 80, total_sales = 5, average_rating = 4.20, average_rating_as_seller = 4.20, reviews_count = 5, reviews_count_as_seller = 5
WHERE id = v_jorge;

UPDATE profiles SET
  foto = 'https://i.pravatar.cc/150?u=sofia', bio = 'Amante de los animales y la decoración. Todo para tu hogar y tus mascotas en un solo lugar.', es_vendedor = true, nombre_negocio = 'Casa & Mascotas Sofi', descripcion_negocio = 'Artículos para el hogar y mascotas. Entregas en zona Angelópolis y alrededores.', categoria_negocio = 'hogar', metodos_pago_aceptados = 'Transferencia, Efectivo', trust_level = 'confiable', trust_points = 220, total_sales = 15, average_rating = 4.60, average_rating_as_seller = 4.60, reviews_count = 12, reviews_count_as_seller = 12
WHERE id = v_sofia;
-- (profiles already created via handle_new_user trigger, updated above)

-- =============================================================================
-- 2. PRODUCTS — 240 total (20 per category)
-- =============================================================================

-- ===================== COMIDA (María) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_maria, 'Tamales oaxaqueños', 'Tamales de mole negro y pollo hechos con receta tradicional oaxaqueña. Envueltos en hoja de plátano con un sabor inigualable. Pedido mínimo de 6 piezas.', 15.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/tamales-oaxaquenos-m7k2/400/300', 'tamales-oaxaquenos-m7k2', 'Angelópolis', 'pickup', 18, 145),

(gen_random_uuid(), v_maria, 'Pastel tres leches', 'Delicioso pastel tres leches bañado en crema y decorado al gusto. Perfecto para fiestas y reuniones familiares. Rinde para 15 personas aproximadamente.', 350.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/pastel-tres-leches-q3w8/400/300', 'pastel-tres-leches-q3w8', 'Angelópolis', 'pickup', 12, 178),

(gen_random_uuid(), v_maria, 'Sushi rolls variados', 'Charola de 30 piezas de sushi con rolls de salmón, atún, camarón y philadelphia. Incluye salsa de soya, wasabi y jengibre. Preparados con ingredientes frescos del día.', 420.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/sushi-rolls-variados-p4t1/400/300', 'sushi-rolls-variados-p4t1', 'Angelópolis', 'ambos', 8, 120),

(gen_random_uuid(), v_maria, 'Hamburguesas artesanales', 'Hamburguesas con carne de res 100% artesanal, pan brioche horneado en casa y aderezos especiales. Incluye papas gajo como acompañamiento. Paquete de 4 hamburguesas completas.', 280.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/hamburguesas-artesanales-r5n9/400/300', 'hamburguesas-artesanales-r5n9', 'Angelópolis', 'ambos', 15, 190),

(gen_random_uuid(), v_maria, 'Tacos al pastor', 'Orden de 10 tacos al pastor con piña, cilantro y cebolla. Tortilla de maíz hecha a mano. La carne se marina por 24 horas para lograr el mejor sabor.', 120.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/tacos-al-pastor-v6j3/400/300', 'tacos-al-pastor-v6j3', 'Angelópolis', 'pickup', 20, 200),

(gen_random_uuid(), v_maria, 'Pizza casera', 'Pizza artesanal de 35cm con masa madre y salsa de tomate casera. Disponible en pepperoni, hawaiana o especial de la casa. Horneada en horno de piedra.', 180.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/pizza-casera-w8h5/400/300', 'pizza-casera-w8h5', 'Angelópolis', 'ambos', 14, 165),

(gen_random_uuid(), v_maria, 'Brownies de chocolate', 'Caja de 12 brownies de chocolate belga con nuez. Textura suave por dentro y crujiente por fuera. Ideales para regalo o para consentirte en casa.', 150.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/brownies-chocolate-x2g7/400/300', 'brownies-chocolate-x2g7', 'Angelópolis', 'ambos', 10, 130),

(gen_random_uuid(), v_maria, 'Empanadas argentinas', 'Docena de empanadas argentinas horneadas rellenas de carne, pollo o jamón y queso. Masa crujiente y relleno generoso. Se entregan calientes listas para disfrutar.', 200.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/empanadas-argentinas-y9f4/400/300', 'empanadas-argentinas-y9f4', 'Angelópolis', 'pickup', 7, 88),

(gen_random_uuid(), v_maria, 'Ceviche de camarón', 'Ceviche fresco de camarón con aguacate, pepino, cebolla morada y limón. Preparado al momento con ingredientes del mercado. Porción para 3-4 personas.', 180.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/ceviche-camaron-z1e6/400/300', 'ceviche-camaron-z1e6', 'Angelópolis', 'pickup', 9, 110),

(gen_random_uuid(), v_maria, 'Pozole rojo', 'Olla de pozole rojo de puerco con maíz cacahuazintle. Incluye tostadas, orégano, rábano y lechuga para acompañar. Rinde para 6 personas generosamente.', 250.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/pozole-rojo-a3d8/400/300', 'pozole-rojo-a3d8', 'Angelópolis', 'pickup', 11, 142),

(gen_random_uuid(), v_maria, 'Tortas ahogadas', 'Paquete de 6 tortas ahogadas estilo Guadalajara con birria de res y salsa de chile de árbol. El birote se hornea especialmente para que aguante la salsa.', 180.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/tortas-ahogadas-b5c2/400/300', 'tortas-ahogadas-b5c2', 'Angelópolis', 'pickup', 6, 75),

(gen_random_uuid(), v_maria, 'Enchiladas suizas', 'Charola de 12 enchiladas suizas de pollo con crema y queso gratinado. Salsa verde casera y tortilla de maíz. Listas para calentar y servir.', 220.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/enchiladas-suizas-c7b1/400/300', 'enchiladas-suizas-c7b1', 'Angelópolis', 'ambos', 13, 155),

(gen_random_uuid(), v_maria, 'Chilaquiles verdes', 'Porción familiar de chilaquiles verdes con pollo, crema, queso fresco y cebolla. Salsa verde de tomatillo hecha en molcajete. Incluye frijoles refritos.', 160.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/chilaquiles-verdes-d9a3/400/300', 'chilaquiles-verdes-d9a3', 'Angelópolis', 'pickup', 17, 185),

(gen_random_uuid(), v_maria, 'Hot dogs especiales', 'Paquete de 8 hot dogs con salchicha jumbo, tocino, cebolla caramelizada y salsas especiales. Pan tipo brioche suave. Perfectos para reuniones casuales.', 200.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/hot-dogs-especiales-e2z5/400/300', 'hot-dogs-especiales-e2z5', 'Angelópolis', 'ambos', 5, 67),

(gen_random_uuid(), v_maria, 'Sándwiches gourmet', 'Caja de 6 sándwiches gourmet variados: club, caprese, pollo pesto y más. Pan artesanal, ingredientes premium. Ideales para juntas de trabajo o picnic.', 300.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/sandwiches-gourmet-f4y7/400/300', 'sandwiches-gourmet-f4y7', 'Angelópolis', 'ambos', 4, 55),

(gen_random_uuid(), v_maria, 'Gelatinas artesanales', 'Set de 12 gelatinas individuales de diferentes sabores y diseños. Hechas con ingredientes naturales y decoradas a mano. Perfectas para fiestas infantiles.', 180.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/gelatinas-artesanales-g6x9/400/300', 'gelatinas-artesanales-g6x9', 'Angelópolis', 'pickup', 8, 95),

(gen_random_uuid(), v_maria, 'Pan de muerto', 'Pan de muerto artesanal de 500g con azúcar y esencia de azahar. Receta familiar de tres generaciones. Textura esponjosa y sabor auténtico poblano.', 80.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/pan-de-muerto-h8w2/400/300', 'pan-de-muerto-h8w2', 'Angelópolis', 'pickup', 19, 198),

(gen_random_uuid(), v_maria, 'Churros rellenos', 'Docena de churros rellenos de cajeta, chocolate o crema pastelera. Recién hechos y espolvoreados con azúcar y canela. Crujientes por fuera, suaves por dentro.', 120.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/churros-rellenos-i1v4/400/300', 'churros-rellenos-i1v4', 'Angelópolis', 'pickup', 16, 172),

(gen_random_uuid(), v_maria, 'Agua de horchata (1L)', 'Litro de agua de horchata preparada con arroz, canela y un toque de vainilla. Receta casera sin conservadores. Se entrega fría y lista para servir.', 35.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/agua-horchata-1l-j3u6/400/300', 'agua-horchata-1l-j3u6', 'Angelópolis', 'pickup', 20, 160),

(gen_random_uuid(), v_maria, 'Fruta picada con chile', 'Vaso grande de fruta fresca picada con chile, limón y chamoy. Incluye mango, piña, jícama, pepino y sandía. Preparada al momento con fruta de temporada.', 45.00, 'producto', 'comida', 'disponible', 'https://picsum.photos/seed/fruta-picada-chile-k5t8/400/300', 'fruta-picada-chile-k5t8', 'Angelópolis', 'pickup', 20, 195);

-- ===================== ROPA (Ana) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_ana, 'Vestido floral verano', 'Vestido largo con estampado floral en tonos pastel, tela ligera y fresca para el calor. Tallas S a XL disponibles. Perfecto para una salida casual o brunch.', 450.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/vestido-floral-verano-a2b4/400/300', 'vestido-floral-verano-a2b4', 'Cholula', 'ambos', 12, 180),

(gen_random_uuid(), v_ana, 'Chamarra de mezclilla', 'Chamarra de mezclilla clásica corte boyfriend con lavado medio. Bolsillos funcionales y botones metálicos. Combina con todo y es ideal para las noches frescas.', 550.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/chamarra-mezclilla-c3d5/400/300', 'chamarra-mezclilla-c3d5', 'Cholula', 'ambos', 8, 145),

(gen_random_uuid(), v_ana, 'Tenis Nike Air Force', 'Tenis Nike Air Force 1 blancos, nuevos en caja. Tallas 25 a 29 disponibles. Clásicos que nunca pasan de moda con suela Air para máxima comodidad.', 1800.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/tenis-nike-air-force-e4f6/400/300', 'tenis-nike-air-force-e4f6', 'Cholula', 'ambos', 6, 200),

(gen_random_uuid(), v_ana, 'Blusa bordada oaxaqueña', 'Blusa de algodón con bordado artesanal oaxaqueño hecho a mano. Colores vibrantes y diseño único. Cada pieza es diferente, perfecta para lucir cultura mexicana.', 380.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/blusa-bordada-oaxaquena-g5h7/400/300', 'blusa-bordada-oaxaquena-g5h7', 'Cholula', 'ambos', 15, 170),

(gen_random_uuid(), v_ana, 'Jeans slim fit', 'Jeans de mezclilla stretch corte slim fit con lavado oscuro. Cintura media y cierre de botón. Disponibles en tallas 28 a 36. Cómodos para uso diario.', 480.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/jeans-slim-fit-i6j8/400/300', 'jeans-slim-fit-i6j8', 'Cholula', 'ambos', 10, 155),

(gen_random_uuid(), v_ana, 'Sudadera hoodie negra', 'Sudadera tipo hoodie oversize en color negro con capucha y bolsillo canguro. Tela de algodón perchado súper suave. Unisex tallas S a XXL.', 350.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/sudadera-hoodie-negra-k7l9/400/300', 'sudadera-hoodie-negra-k7l9', 'Cholula', 'ambos', 14, 188),

(gen_random_uuid(), v_ana, 'Camisa de lino', 'Camisa de lino 100% natural en color beige, corte regular. Fresca y elegante para el verano poblano. Manga larga con opción de arremangar. Tallas M a XL.', 420.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/camisa-lino-m8n1/400/300', 'camisa-lino-m8n1', 'Cholula', 'ambos', 5, 92),

(gen_random_uuid(), v_ana, 'Falda midi plisada', 'Falda midi plisada en tono rosa empolvado con cintura elástica. Tela satinada con caída elegante. Perfecta para ocasiones semi-formales o una cita especial.', 390.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/falda-midi-plisada-o9p2/400/300', 'falda-midi-plisada-o9p2', 'Cholula', 'ambos', 7, 110),

(gen_random_uuid(), v_ana, 'Pantalón cargo', 'Pantalón cargo en color verde olivo con bolsillos laterales funcionales. Tela resistente de algodón. Estilo streetwear cómodo para el día a día. Tallas 28 a 34.', 420.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/pantalon-cargo-q1r3/400/300', 'pantalon-cargo-q1r3', 'Cholula', 'ambos', 9, 125),

(gen_random_uuid(), v_ana, 'Conjunto deportivo mujer', 'Conjunto de leggings y top deportivo en tela supplex. Diseño con soporte medio y cintura alta. Disponible en negro, gris y vino. Ideal para gym o running.', 520.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/conjunto-deportivo-mujer-s2t4/400/300', 'conjunto-deportivo-mujer-s2t4', 'Cholula', 'ambos', 18, 195),

(gen_random_uuid(), v_ana, 'Bolsa de mano piel', 'Bolsa de mano en piel sintética de alta calidad color camel. Compartimentos internos con cierre y espacio para laptop hasta 13 pulgadas. Elegante y funcional.', 650.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/bolsa-mano-piel-u3v5/400/300', 'bolsa-mano-piel-u3v5', 'Cholula', 'ambos', 11, 160),

(gen_random_uuid(), v_ana, 'Cinturón de cuero', 'Cinturón de cuero genuino con hebilla metálica en acabado plata. Ancho de 3.5cm, largo ajustable. Disponible en negro y café. Complemento perfecto para cualquier outfit.', 280.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/cinturon-cuero-w4x6/400/300', 'cinturon-cuero-w4x6', 'Cholula', 'ambos', 4, 70),

(gen_random_uuid(), v_ana, 'Lentes de sol Ray-Ban', 'Lentes de sol Ray-Ban modelo Wayfarer originales con estuche. Protección UV400 y armazón acetato negro. Incluye paño de limpieza y certificado de autenticidad.', 1200.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/lentes-sol-rayban-y5z7/400/300', 'lentes-sol-rayban-y5z7', 'Cholula', 'ambos', 3, 135),

(gen_random_uuid(), v_ana, 'Gorra New Era', 'Gorra New Era original modelo 59FIFTY con logo bordado. Ajuste cerrado, talla 7 a 7 5/8. Visera plana con sticker de autenticidad. Varios diseños disponibles.', 550.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/gorra-new-era-a6b8/400/300', 'gorra-new-era-a6b8', 'Cholula', 'ambos', 6, 105),

(gen_random_uuid(), v_ana, 'Huaraches artesanales', 'Huaraches de piel tejida hechos a mano por artesanos poblanos. Suela de llanta reciclada, súper resistentes. Tallas 22 a 28. Cómodos desde el primer uso.', 320.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/huaraches-artesanales-c7d9/400/300', 'huaraches-artesanales-c7d9', 'Cholula', 'ambos', 13, 148),

(gen_random_uuid(), v_ana, 'Pijama de algodón', 'Pijama de dos piezas en algodón 100%, pantalón largo y blusa manga larga. Estampado de estrellas en fondo azul marino. Suave y cómoda para noches frescas.', 280.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/pijama-algodon-e8f1/400/300', 'pijama-algodon-e8f1', 'Cholula', 'ambos', 7, 88),

(gen_random_uuid(), v_ana, 'Traje de baño dos piezas', 'Bikini de dos piezas con top triangular y braga de tiro alto. Tela con protección UV y secado rápido. Disponible en coral, azul y negro. Tallas S a L.', 350.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/traje-bano-dos-piezas-g9h2/400/300', 'traje-bano-dos-piezas-g9h2', 'Cholula', 'ambos', 5, 115),

(gen_random_uuid(), v_ana, 'Chaleco acolchado', 'Chaleco acolchado ligero con relleno sintético y cierre frontal. Color negro mate con bolsillos laterales. Ideal para capas en temporada de frío. Tallas M a XL.', 480.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/chaleco-acolchado-i1j3/400/300', 'chaleco-acolchado-i1j3', 'Cholula', 'ambos', 4, 78),

(gen_random_uuid(), v_ana, 'Botas vaqueras', 'Botas vaqueras de piel genuina con bordado tradicional. Punta semi-cuadrada y tacón de 4cm. Hechas en León, Guanajuato. Tallas 25 a 29 para hombre y mujer.', 1500.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/botas-vaqueras-k2l4/400/300', 'botas-vaqueras-k2l4', 'Cholula', 'ambos', 2, 95),

(gen_random_uuid(), v_ana, 'Bufanda tejida a mano', 'Bufanda tejida a mano en lana merino con diseño de trenzas. Mide 180cm de largo y 25cm de ancho. Colores disponibles: gris, vino y azul. Cálida y suave al tacto.', 220.00, 'producto', 'ropa', 'disponible', 'https://picsum.photos/seed/bufanda-tejida-mano-m3n5/400/300', 'bufanda-tejida-mano-m3n5', 'Cholula', 'ambos', 8, 100);

-- ===================== TECNOLOGÍA (Carlos) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_carlos, 'iPhone 13 usado', 'iPhone 13 de 128GB en excelente estado, batería al 87%. Color azul medianoche con cargador original incluido. Sin rayones en pantalla, con funda de regalo.', 8500.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/iphone-13-usado-n4o6/400/300', 'iphone-13-usado-n4o6', 'Centro Puebla', 'ambos', 3, 195),

(gen_random_uuid(), v_carlos, 'Audífonos Bluetooth', 'Audífonos inalámbricos Bluetooth 5.3 con cancelación de ruido activa. Batería de 30 horas y estuche de carga. Sonido envolvente con graves profundos.', 650.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/audifonos-bluetooth-p5q7/400/300', 'audifonos-bluetooth-p5q7', 'Centro Puebla', 'ambos', 15, 185),

(gen_random_uuid(), v_carlos, 'Cargador USB-C rápido', 'Cargador de pared USB-C de 30W con carga rápida PD 3.0. Compatible con iPhone, Samsung y laptops. Cable de 1.5m incluido. Certificación UL de seguridad.', 280.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/cargador-usbc-rapido-r6s8/400/300', 'cargador-usbc-rapido-r6s8', 'Centro Puebla', 'envio', 20, 170),

(gen_random_uuid(), v_carlos, 'Mouse gamer', 'Mouse gamer RGB con sensor óptico de 16,000 DPI y 7 botones programables. Diseño ergonómico para sesiones largas de juego. Cable trenzado de 1.8m.', 450.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/mouse-gamer-t7u9/400/300', 'mouse-gamer-t7u9', 'Centro Puebla', 'ambos', 12, 160),

(gen_random_uuid(), v_carlos, 'Teclado mecánico', 'Teclado mecánico compacto 65% con switches Cherry MX Blue. Retroiluminación RGB por tecla. Keycaps PBT doubleshot. Ideal para gaming y productividad.', 1200.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/teclado-mecanico-v8w1/400/300', 'teclado-mecanico-v8w1', 'Centro Puebla', 'ambos', 7, 140),

(gen_random_uuid(), v_carlos, 'Monitor 24"', 'Monitor LED de 24 pulgadas Full HD 1080p con panel IPS y 75Hz. Bordes ultra delgados y soporte ajustable. Puertos HDMI y VGA incluidos. Ideal para trabajo y entretenimiento.', 2800.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/monitor-24-pulgadas-x9y2/400/300', 'monitor-24-pulgadas-x9y2', 'Centro Puebla', 'pickup', 4, 130),

(gen_random_uuid(), v_carlos, 'Laptop Dell reacondicionada', 'Laptop Dell Latitude reacondicionada con Intel i5 10a gen, 8GB RAM, SSD 256GB. Windows 11 activado. Batería nueva y garantía de 3 meses. Perfecta para oficina.', 5500.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/laptop-dell-reacond-z1a3/400/300', 'laptop-dell-reacond-z1a3', 'Centro Puebla', 'ambos', 2, 175),

(gen_random_uuid(), v_carlos, 'Tablet Samsung', 'Tablet Samsung Galaxy Tab A8 de 10.5 pulgadas con 64GB de almacenamiento. Pantalla LCD TFT y batería de 7040mAh. Incluye funda protectora y cargador original.', 3200.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/tablet-samsung-b2c4/400/300', 'tablet-samsung-b2c4', 'Centro Puebla', 'ambos', 3, 150),

(gen_random_uuid(), v_carlos, 'Smartwatch Xiaomi', 'Smartwatch Xiaomi Mi Band 8 Pro con pantalla AMOLED de 1.74". Monitoreo de salud, GPS integrado y 150+ modos deportivos. Batería de hasta 14 días.', 1500.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/smartwatch-xiaomi-d3e5/400/300', 'smartwatch-xiaomi-d3e5', 'Centro Puebla', 'ambos', 8, 165),

(gen_random_uuid(), v_carlos, 'Bocina portátil JBL', 'Bocina Bluetooth JBL Flip 6 resistente al agua IP67. Sonido potente con graves profundos y 12 horas de batería. Ideal para llevar a cualquier lado.', 1800.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/bocina-portatil-jbl-f4g6/400/300', 'bocina-portatil-jbl-f4g6', 'Centro Puebla', 'ambos', 6, 142),

(gen_random_uuid(), v_carlos, 'Cable HDMI 2m', 'Cable HDMI 2.1 de 2 metros con soporte 4K a 120Hz y 8K a 60Hz. Conectores chapados en oro y cable trenzado resistente. Compatible con PS5, Xbox y PCs.', 180.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/cable-hdmi-2m-h5i7/400/300', 'cable-hdmi-2m-h5i7', 'Centro Puebla', 'envio', 18, 88),

(gen_random_uuid(), v_carlos, 'Power bank 20000mAh', 'Power bank de 20,000mAh con carga rápida PD 20W y dos puertos USB. Pantalla LED indicadora de batería. Carga hasta 4 veces un iPhone 14. Compacto y ligero.', 550.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/power-bank-20000-j6k8/400/300', 'power-bank-20000-j6k8', 'Centro Puebla', 'ambos', 14, 155),

(gen_random_uuid(), v_carlos, 'Webcam HD', 'Webcam Full HD 1080p con micrófono integrado y corrección de luz automática. Clip universal para monitor y trípode. Plug and play, sin drivers necesarios.', 480.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/webcam-hd-l7m9/400/300', 'webcam-hd-l7m9', 'Centro Puebla', 'ambos', 5, 98),

(gen_random_uuid(), v_carlos, 'Hub USB 7 puertos', 'Hub USB 3.0 de 7 puertos con adaptador de corriente incluido. Transferencia de hasta 5Gbps. Carcasa de aluminio con LED indicador. Compatible con Mac y Windows.', 350.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/hub-usb-7-puertos-n8o1/400/300', 'hub-usb-7-puertos-n8o1', 'Centro Puebla', 'envio', 9, 76),

(gen_random_uuid(), v_carlos, 'Funda para iPhone 15', 'Funda protectora para iPhone 15 con diseño transparente y bordes reforzados. Material TPU flexible anti-amarillamiento. Protección contra caídas de hasta 1.5m.', 150.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/funda-iphone-15-p9q2/400/300', 'funda-iphone-15-p9q2', 'Centro Puebla', 'envio', 20, 120),

(gen_random_uuid(), v_carlos, 'Protector de pantalla', 'Protector de pantalla de vidrio templado 9H para diversos modelos de celular. Incluye kit de instalación y paño de limpieza. Transparencia del 99%.', 80.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/protector-pantalla-r1s3/400/300', 'protector-pantalla-r1s3', 'Centro Puebla', 'envio', 20, 110),

(gen_random_uuid(), v_carlos, 'Memoria USB 64GB', 'Memoria USB 3.0 de 64GB con velocidad de lectura de hasta 150MB/s. Diseño compacto metálico con argolla para llavero. Compatible con todos los sistemas operativos.', 120.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/memoria-usb-64gb-t2u4/400/300', 'memoria-usb-64gb-t2u4', 'Centro Puebla', 'envio', 16, 95),

(gen_random_uuid(), v_carlos, 'Disco duro externo 1TB', 'Disco duro externo de 1TB USB 3.0 con diseño compacto y resistente a golpes. Compatible con Mac y PC. Perfecto para respaldos y almacenamiento portátil.', 950.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/disco-duro-1tb-v3w5/400/300', 'disco-duro-1tb-v3w5', 'Centro Puebla', 'ambos', 7, 125),

(gen_random_uuid(), v_carlos, 'Router WiFi 6', 'Router WiFi 6 de doble banda con velocidades de hasta 1800Mbps. Cobertura para casas de hasta 120m². 4 antenas externas y control parental integrado.', 1200.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/router-wifi-6-x4y6/400/300', 'router-wifi-6-x4y6', 'Centro Puebla', 'ambos', 4, 108),

(gen_random_uuid(), v_carlos, 'Impresora HP', 'Impresora multifuncional HP DeskJet con WiFi, escáner y copiadora. Impresión a color y blanco/negro. Incluye cartuchos de tinta de inicio. Fácil configuración.', 1800.00, 'producto', 'tecnologia', 'disponible', 'https://picsum.photos/seed/impresora-hp-z5a7/400/300', 'impresora-hp-z5a7', 'Centro Puebla', 'pickup', 3, 115);

-- ===================== HOGAR (Sofía) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_sofia, 'Juego de sábanas queen', 'Juego de sábanas tamaño queen de microfibra premium en color gris perla. Incluye sábana ajustable, plana y dos fundas. Suaves, frescas y resistentes a arrugas.', 450.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/sabanas-queen-b6c8/400/300', 'sabanas-queen-b6c8', 'San Andrés Cholula', 'ambos', 8, 120),

(gen_random_uuid(), v_sofia, 'Almohada memory foam', 'Almohada de espuma viscoelástica con funda de bambú hipoalergénica. Se adapta al contorno de la cabeza y cuello. Ideal para dormir de lado o boca arriba.', 380.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/almohada-memory-foam-d7e9/400/300', 'almohada-memory-foam-d7e9', 'San Andrés Cholula', 'ambos', 10, 135),

(gen_random_uuid(), v_sofia, 'Organizador de zapatos', 'Organizador de zapatos para puerta con 24 compartimentos transparentes. Fácil instalación sin herramientas. Mantiene tu closet ordenado y tus zapatos visibles.', 180.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/organizador-zapatos-f8g1/400/300', 'organizador-zapatos-f8g1', 'San Andrés Cholula', 'ambos', 12, 100),

(gen_random_uuid(), v_sofia, 'Lámpara LED escritorio', 'Lámpara de escritorio LED con 5 niveles de brillo y 3 temperaturas de color. Brazo flexible y base con cargador inalámbrico. Perfecta para estudiar o trabajar.', 350.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/lampara-led-escritorio-h9i2/400/300', 'lampara-led-escritorio-h9i2', 'San Andrés Cholula', 'ambos', 6, 115),

(gen_random_uuid(), v_sofia, 'Cortinas blackout', 'Par de cortinas blackout de 2.5m de alto en color azul marino. Bloquean el 99% de la luz y reducen el ruido exterior. Incluyen ganchos y anillos de instalación.', 550.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/cortinas-blackout-j1k3/400/300', 'cortinas-blackout-j1k3', 'San Andrés Cholula', 'ambos', 5, 95),

(gen_random_uuid(), v_sofia, 'Tapete decorativo', 'Tapete decorativo de 120x170cm con patrón geométrico en tonos neutros. Material suave de polipropileno resistente a manchas. Ideal para sala o recámara.', 480.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/tapete-decorativo-l2m4/400/300', 'tapete-decorativo-l2m4', 'San Andrés Cholula', 'pickup', 4, 88),

(gen_random_uuid(), v_sofia, 'Reloj de pared moderno', 'Reloj de pared minimalista de 30cm con números grandes y mecanismo silencioso. Marco de metal negro con fondo blanco. Funciona con una pila AA incluida.', 250.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/reloj-pared-moderno-n3o5/400/300', 'reloj-pared-moderno-n3o5', 'San Andrés Cholula', 'ambos', 7, 105),

(gen_random_uuid(), v_sofia, 'Set de toallas', 'Set de 6 toallas de algodón egipcio en color blanco: 2 de baño, 2 de mano y 2 faciales. Alta absorción y suavidad duradera. Ideales para baño de invitados.', 420.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/set-toallas-p4q6/400/300', 'set-toallas-p4q6', 'San Andrés Cholula', 'ambos', 9, 112),

(gen_random_uuid(), v_sofia, 'Cojines decorativos (par)', 'Par de cojines decorativos de 45x45cm con funda de terciopelo y relleno de fibra siliconada. Diseño moderno en tonos terracota. Lavables a máquina.', 280.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/cojines-decorativos-par-r5s7/400/300', 'cojines-decorativos-par-r5s7', 'San Andrés Cholula', 'ambos', 11, 130),

(gen_random_uuid(), v_sofia, 'Plantas suculentas en maceta', 'Set de 3 suculentas variadas en macetas de cerámica con plato. Incluye echeveria, haworthia y sedum. Bajo mantenimiento y perfectas para decorar cualquier espacio.', 180.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/plantas-suculentas-maceta-t6u8/400/300', 'plantas-suculentas-maceta-t6u8', 'San Andrés Cholula', 'pickup', 15, 165),

(gen_random_uuid(), v_sofia, 'Espejo decorativo', 'Espejo redondo de 50cm de diámetro con marco de ratán natural. Estilo boho perfecto para recibidor o baño. Incluye gancho para colgar y soporta humedad.', 350.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/espejo-decorativo-v7w9/400/300', 'espejo-decorativo-v7w9', 'San Andrés Cholula', 'pickup', 3, 78),

(gen_random_uuid(), v_sofia, 'Velas aromáticas set', 'Set de 4 velas aromáticas de cera de soya en frascos de vidrio. Aromas: lavanda, vainilla, jazmín y canela. 30 horas de duración cada una. Mecha de algodón.', 220.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/velas-aromaticas-set-x8y1/400/300', 'velas-aromaticas-set-x8y1', 'San Andrés Cholula', 'ambos', 13, 145),

(gen_random_uuid(), v_sofia, 'Portarretratos 4 fotos', 'Portarretratos múltiple para 4 fotos de 10x15cm en marco de madera natural. Diseño collage moderno con vidrio protector. Ideal para regalar o decorar tu sala.', 180.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/portarretratos-4fotos-z9a2/400/300', 'portarretratos-4fotos-z9a2', 'San Andrés Cholula', 'ambos', 6, 72),

(gen_random_uuid(), v_sofia, 'Mesa auxiliar plegable', 'Mesa auxiliar plegable de madera de pino con acabado natural. Medidas: 50x40x60cm. Perfecta como buró, mesa de café o mesa para laptop. Fácil de guardar.', 380.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/mesa-auxiliar-plegable-b1c3/400/300', 'mesa-auxiliar-plegable-b1c3', 'San Andrés Cholula', 'pickup', 2, 65),

(gen_random_uuid(), v_sofia, 'Perchero de pared', 'Perchero de pared de madera con 5 ganchos metálicos dorados. Diseño minimalista nórdico. Incluye tornillos y taquetes para instalación. Largo: 60cm.', 220.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/perchero-pared-d2e4/400/300', 'perchero-pared-d2e4', 'San Andrés Cholula', 'ambos', 5, 80),

(gen_random_uuid(), v_sofia, 'Organizador de cocina', 'Organizador de cocina giratorio de 2 niveles en acero inoxidable. Perfecto para especias, aceites y condimentos. Base antideslizante y fácil de limpiar.', 280.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/organizador-cocina-f3g5/400/300', 'organizador-cocina-f3g5', 'San Andrés Cholula', 'ambos', 8, 98),

(gen_random_uuid(), v_sofia, 'Contenedores herméticos (set 5)', 'Set de 5 contenedores herméticos de diferentes tamaños con tapas de cierre snap. Libres de BPA, aptos para microondas y lavavajillas. Transparentes y apilables.', 250.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/contenedores-hermeticos-set5-h4i6/400/300', 'contenedores-hermeticos-set5-h4i6', 'San Andrés Cholula', 'ambos', 14, 140),

(gen_random_uuid(), v_sofia, 'Tabla de cortar bambú', 'Tabla de cortar de bambú orgánico de 40x30cm con ranura para jugos. Resistente a bacterias y amigable con los cuchillos. Incluye soporte vertical para almacenar.', 180.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/tabla-cortar-bambu-j5k7/400/300', 'tabla-cortar-bambu-j5k7', 'San Andrés Cholula', 'ambos', 10, 108),

(gen_random_uuid(), v_sofia, 'Set de utensilios de cocina', 'Set de 10 utensilios de cocina de silicona con mango de madera. Incluye espátula, cuchara, tenedor, batidor y más. Resistentes al calor hasta 230°C.', 350.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/set-utensilios-cocina-l6m8/400/300', 'set-utensilios-cocina-l6m8', 'San Andrés Cholula', 'ambos', 7, 92),

(gen_random_uuid(), v_sofia, 'Florero de cerámica', 'Florero de cerámica artesanal con acabado mate en color blanco hueso. Altura de 25cm con boca ancha. Perfecto para flores secas o frescas. Hecho en Puebla.', 220.00, 'producto', 'hogar', 'disponible', 'https://picsum.photos/seed/florero-ceramica-n7o9/400/300', 'florero-ceramica-n7o9', 'San Andrés Cholula', 'pickup', 4, 70);

-- ===================== BELLEZA (Ana) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_ana, 'Kit de maquillaje completo', 'Kit profesional de maquillaje con 42 piezas incluyendo sombras, labiales, bases y brochas. Colores versátiles para cualquier tono de piel. Estuche organizador incluido.', 850.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/kit-maquillaje-completo-p8q1/400/300', 'kit-maquillaje-completo-p8q1', 'Cholula', 'ambos', 9, 175),

(gen_random_uuid(), v_ana, 'Paleta de sombras 18 tonos', 'Paleta de sombras con 18 tonos en acabados mate, shimmer y glitter. Alta pigmentación y larga duración. Incluye espejo y aplicador doble punta.', 350.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/paleta-sombras-18tonos-r9s2/400/300', 'paleta-sombras-18tonos-r9s2', 'Cholula', 'ambos', 14, 165),

(gen_random_uuid(), v_ana, 'Rizador de cabello', 'Rizador de cabello cerámico con barrel de 25mm y temperatura ajustable hasta 230°C. Cable giratorio 360° y punta fría de seguridad. Crea rizos definidos en segundos.', 480.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/rizador-cabello-t1u3/400/300', 'rizador-cabello-t1u3', 'Cholula', 'ambos', 7, 120),

(gen_random_uuid(), v_ana, 'Secadora profesional', 'Secadora de cabello profesional de 2200W con motor AC. 3 niveles de calor y 2 de velocidad. Incluye difusor y boquilla concentradora. Tecnología iónica anti-frizz.', 650.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/secadora-profesional-v2w4/400/300', 'secadora-profesional-v2w4', 'Cholula', 'ambos', 5, 105),

(gen_random_uuid(), v_ana, 'Crema hidratante facial', 'Crema hidratante facial con ácido hialurónico y vitamina E. Para todo tipo de piel, absorción rápida y sin sensación grasosa. Presentación de 50ml con SPF 15.', 280.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/crema-hidratante-facial-x3y5/400/300', 'crema-hidratante-facial-x3y5', 'Cholula', 'ambos', 18, 190),

(gen_random_uuid(), v_ana, 'Sérum vitamina C', 'Sérum facial de vitamina C al 20% con ácido ferúlico y vitamina E. Aclara manchas, unifica el tono y aporta luminosidad. Presentación de 30ml con gotero.', 320.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/serum-vitamina-c-z4a6/400/300', 'serum-vitamina-c-z4a6', 'Cholula', 'ambos', 15, 178),

(gen_random_uuid(), v_ana, 'Kit de brochas (12 pzas)', 'Set de 12 brochas de maquillaje profesionales con cerda sintética suave. Incluye brochas para base, polvo, contorno, sombras y labios. Estuche de viaje incluido.', 420.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/kit-brochas-12pzas-b5c7/400/300', 'kit-brochas-12pzas-b5c7', 'Cholula', 'ambos', 11, 145),

(gen_random_uuid(), v_ana, 'Labiales mate (set 6)', 'Set de 6 labiales mate de larga duración en tonos: rojo clásico, nude, rosa, coral, vino y terracota. No transfieren y no resecan los labios. Fórmula vegana.', 350.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/labiales-mate-set6-d6e8/400/300', 'labiales-mate-set6-d6e8', 'Cholula', 'ambos', 16, 185),

(gen_random_uuid(), v_ana, 'Base de maquillaje', 'Base de maquillaje líquida de cobertura media a alta con acabado natural. Disponible en 12 tonos. Fórmula hidratante con SPF 20. Duración de hasta 12 horas.', 280.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/base-maquillaje-f7g9/400/300', 'base-maquillaje-f7g9', 'Cholula', 'ambos', 13, 158),

(gen_random_uuid(), v_ana, 'Perfume mujer 100ml', 'Perfume floral frutal de 100ml con notas de pera, peonía y almizcle blanco. Larga duración de hasta 8 horas. Presentación en frasco elegante ideal para regalo.', 550.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/perfume-mujer-100ml-h8i1/400/300', 'perfume-mujer-100ml-h8i1', 'Cholula', 'ambos', 8, 140),

(gen_random_uuid(), v_ana, 'Shampoo sin sulfatos', 'Shampoo libre de sulfatos y parabenos de 500ml con aceite de argán y keratina. Ideal para cabello teñido o tratado. Limpieza suave que no elimina los aceites naturales.', 180.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/shampoo-sin-sulfatos-j9k2/400/300', 'shampoo-sin-sulfatos-j9k2', 'Cholula', 'ambos', 20, 170),

(gen_random_uuid(), v_ana, 'Mascarilla capilar', 'Mascarilla capilar reparadora de 300ml con colágeno y aceite de coco. Hidratación profunda para cabello dañado o seco. Aplicar 10 minutos y lavar. Resultados desde la primera aplicación.', 220.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/mascarilla-capilar-l1m3/400/300', 'mascarilla-capilar-l1m3', 'Cholula', 'ambos', 12, 132),

(gen_random_uuid(), v_ana, 'Kit manicure gelish', 'Kit completo para manicure en gel: lámpara UV/LED, 6 colores gelish, base, top coat, removedor y accesorios. Todo lo necesario para uñas profesionales en casa.', 750.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/kit-manicure-gelish-n2o4/400/300', 'kit-manicure-gelish-n2o4', 'Cholula', 'ambos', 6, 115),

(gen_random_uuid(), v_ana, 'Estuche de viaje cosméticos', 'Estuche organizador de cosméticos para viaje con compartimentos ajustables y espejo incorporado. Material impermeable en color rosa gold. Cierre de cremallera doble.', 280.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/estuche-viaje-cosmeticos-p3q5/400/300', 'estuche-viaje-cosmeticos-p3q5', 'Cholula', 'ambos', 10, 125),

(gen_random_uuid(), v_ana, 'Exfoliante corporal', 'Exfoliante corporal de sal del Himalaya con aceite de almendras y lavanda. Elimina células muertas y suaviza la piel. Presentación de 300g en frasco de vidrio.', 200.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/exfoliante-corporal-r4s6/400/300', 'exfoliante-corporal-r4s6', 'Cholula', 'ambos', 9, 108),

(gen_random_uuid(), v_ana, 'Aceite de argán', 'Aceite de argán puro 100% prensado en frío de 50ml. Multiusos: cabello, rostro y uñas. Hidrata, nutre y da brillo. Presentación con gotero para aplicación precisa.', 250.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/aceite-argan-t5u7/400/300', 'aceite-argan-t5u7', 'Cholula', 'ambos', 11, 138),

(gen_random_uuid(), v_ana, 'Contorno de ojos', 'Crema contorno de ojos con retinol y cafeína de 15ml. Reduce ojeras, bolsas y líneas finas. Aplicar mañana y noche con suaves toques. Resultados visibles en 2 semanas.', 300.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/contorno-ojos-v6w8/400/300', 'contorno-ojos-v6w8', 'Cholula', 'ambos', 7, 95),

(gen_random_uuid(), v_ana, 'Protector solar facial SPF50', 'Protector solar facial SPF50 de 60ml con textura ligera y acabado mate. No deja residuo blanco y funciona como primer de maquillaje. Resistente al agua y sudor.', 250.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/protector-solar-spf50-x7y9/400/300', 'protector-solar-spf50-x7y9', 'Cholula', 'ambos', 19, 195),

(gen_random_uuid(), v_ana, 'Kit cejas (cera + pinzas)', 'Kit completo para cejas con cera moldeadora, pinzas de precisión, tijeras, cepillo y lápiz. Todo lo necesario para cejas perfectas en casa. Incluye instructivo.', 180.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/kit-cejas-cera-pinzas-z8a1/400/300', 'kit-cejas-cera-pinzas-z8a1', 'Cholula', 'ambos', 8, 102),

(gen_random_uuid(), v_ana, 'Delineador waterproof', 'Delineador líquido waterproof de punta ultra fina en color negro intenso. No se corre ni se transfiere. Duración de hasta 24 horas. Fórmula de secado rápido.', 150.00, 'producto', 'belleza', 'disponible', 'https://picsum.photos/seed/delineador-waterproof-b9c2/400/300', 'delineador-waterproof-b9c2', 'Cholula', 'ambos', 17, 160);

-- ===================== SALUD (Sofía + Jorge) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_sofia, 'Tapete de yoga', 'Tapete de yoga antideslizante de 6mm en color morado con líneas de alineación. Material TPE ecológico libre de tóxicos. Incluye correa para transporte.', 350.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/tapete-yoga-d1e3/400/300', 'tapete-yoga-d1e3', 'San Andrés Cholula', 'ambos', 10, 135),

(gen_random_uuid(), v_sofia, 'Banda de resistencia (set 5)', 'Set de 5 bandas de resistencia de diferentes niveles: extra ligera a extra fuerte. Látex natural resistente con bolsa de transporte. Ideales para gym en casa.', 220.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/banda-resistencia-set5-f2g4/400/300', 'banda-resistencia-set5-f2g4', 'San Andrés Cholula', 'ambos', 15, 155),

(gen_random_uuid(), v_sofia, 'Mancuernas 5kg (par)', 'Par de mancuernas de 5kg con recubrimiento de neopreno antideslizante. Forma hexagonal para evitar que rueden. Ideales para ejercicios en casa y tonificación.', 380.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/mancuernas-5kg-par-h3i5/400/300', 'mancuernas-5kg-par-h3i5', 'San Andrés Cholula', 'pickup', 8, 110),

(gen_random_uuid(), v_sofia, 'Cuerda para saltar', 'Cuerda para saltar con cable de acero recubierto y mangos ergonómicos con rodamiento. Ajustable hasta 3m. Perfecta para cardio intenso y entrenamiento HIIT.', 150.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/cuerda-saltar-j4k6/400/300', 'cuerda-saltar-j4k6', 'San Andrés Cholula', 'ambos', 12, 98),

(gen_random_uuid(), v_sofia, 'Proteína whey 2lb', 'Proteína whey isolate de 2 libras sabor chocolate. 25g de proteína por scoop con bajo contenido de grasa y azúcar. Ideal post-entrenamiento para recuperación muscular.', 650.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/proteina-whey-2lb-l5m7/400/300', 'proteina-whey-2lb-l5m7', 'San Andrés Cholula', 'ambos', 14, 175),

(gen_random_uuid(), v_sofia, 'Termo deportivo 1L', 'Termo de acero inoxidable de 1 litro con doble pared al vacío. Mantiene bebidas frías 24h y calientes 12h. Tapa a prueba de derrames y libre de BPA.', 280.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/termo-deportivo-1l-n6o8/400/300', 'termo-deportivo-1l-n6o8', 'San Andrés Cholula', 'ambos', 18, 160),

(gen_random_uuid(), v_jorge, 'Vendas elásticas', 'Paquete de 4 vendas elásticas de diferentes tamaños con clips de sujeción. Ideales para soporte de articulaciones y compresión. Material transpirable y reutilizable.', 120.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/vendas-elasticas-p7q9/400/300', 'vendas-elasticas-p7q9', 'Atlixco', 'ambos', 6, 65),

(gen_random_uuid(), v_jorge, 'Báscula digital', 'Báscula digital de baño con pantalla LCD retroiluminada y capacidad de 180kg. Medición de peso, IMC, grasa corporal y masa muscular. Conecta vía Bluetooth a app.', 450.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/bascula-digital-r8s1/400/300', 'bascula-digital-r8s1', 'Atlixco', 'ambos', 5, 120),

(gen_random_uuid(), v_jorge, 'Termómetro digital', 'Termómetro digital infrarrojo sin contacto con lectura en 1 segundo. Pantalla LCD a color con alerta de fiebre. Memoria de 32 lecturas. Apto para toda la familia.', 280.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/termometro-digital-t9u2/400/300', 'termometro-digital-t9u2', 'Atlixco', 'ambos', 7, 88),

(gen_random_uuid(), v_jorge, 'Tensiómetro de brazo', 'Tensiómetro digital de brazo con manguito ajustable y pantalla grande. Detecta arritmias y almacena 120 lecturas para 2 usuarios. Certificado médicamente.', 550.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/tensiometro-brazo-v1w3/400/300', 'tensiometro-brazo-v1w3', 'Atlixco', 'ambos', 3, 75),

(gen_random_uuid(), v_jorge, 'Oxímetro de pulso', 'Oxímetro de pulso de dedo con pantalla OLED que muestra SpO2 y frecuencia cardíaca. Lectura precisa en 10 segundos. Incluye cordón y 2 pilas AAA. Ligero y portátil.', 250.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/oximetro-pulso-x2y4/400/300', 'oximetro-pulso-x2y4', 'Atlixco', 'ambos', 9, 95),

(gen_random_uuid(), v_sofia, 'Vitaminas multivitamínico 90 caps', 'Multivitamínico con 23 vitaminas y minerales esenciales. 90 cápsulas para 3 meses. Fórmula para adultos que apoya energía, inmunidad y bienestar general.', 280.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/vitaminas-multi-90caps-z3a5/400/300', 'vitaminas-multi-90caps-z3a5', 'San Andrés Cholula', 'ambos', 16, 145),

(gen_random_uuid(), v_sofia, 'Colágeno hidrolizado 500g', 'Colágeno hidrolizado en polvo de 500g sabor neutro. Aporta 10g de proteína por porción. Beneficia piel, cabello, uñas y articulaciones. Disolver en agua o jugo.', 350.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/colageno-hidrolizado-500g-b4c6/400/300', 'colageno-hidrolizado-500g-b4c6', 'San Andrés Cholula', 'ambos', 13, 158),

(gen_random_uuid(), v_jorge, 'Aceite de CBD', 'Aceite de CBD de espectro completo de 30ml con gotero graduado. Concentración de 1000mg. Ayuda con ansiedad, dolor e insomnio. Producto legal con certificado de laboratorio.', 650.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/aceite-cbd-d5e7/400/300', 'aceite-cbd-d5e7', 'Atlixco', 'ambos', 4, 110),

(gen_random_uuid(), v_jorge, 'Masajeador eléctrico', 'Masajeador eléctrico de percusión con 6 cabezales intercambiables y 5 velocidades. Batería recargable de 4 horas. Alivia tensión muscular y mejora circulación.', 850.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/masajeador-electrico-f6g8/400/300', 'masajeador-electrico-f6g8', 'Atlixco', 'ambos', 6, 130),

(gen_random_uuid(), v_sofia, 'Faja deportiva', 'Faja deportiva de neopreno con cierre de velcro y doble ajuste. Soporte lumbar y efecto térmico para mayor sudoración. Tallas S a XXL. Ideal para ejercicio.', 250.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/faja-deportiva-h7i9/400/300', 'faja-deportiva-h7i9', 'San Andrés Cholula', 'ambos', 11, 125),

(gen_random_uuid(), v_sofia, 'Rodillera deportiva (par)', 'Par de rodilleras deportivas de compresión con soporte lateral de resorte. Tela transpirable antideslizante. Ideales para running, crossfit y voleibol. Tallas S a XL.', 280.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/rodillera-deportiva-par-j8k1/400/300', 'rodillera-deportiva-par-j8k1', 'San Andrés Cholula', 'ambos', 7, 92),

(gen_random_uuid(), v_sofia, 'Guantes de gimnasio', 'Guantes para gimnasio con palma acolchada de gel y muñequera con velcro. Material transpirable y antideslizante. Protegen tus manos en peso muerto y press de banca.', 180.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/guantes-gimnasio-l9m2/400/300', 'guantes-gimnasio-l9m2', 'San Andrés Cholula', 'ambos', 9, 105),

(gen_random_uuid(), v_sofia, 'Foam roller', 'Foam roller de alta densidad de 45cm con superficie texturizada para liberación miofascial. Alivia dolor muscular y mejora flexibilidad. Ideal para recuperación post-entreno.', 280.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/foam-roller-n1o3/400/300', 'foam-roller-n1o3', 'San Andrés Cholula', 'ambos', 8, 98),

(gen_random_uuid(), v_sofia, 'Suplemento omega 3', 'Omega 3 de aceite de pescado con 1000mg EPA y DHA por porción. 120 cápsulas blandas para 2 meses. Apoya salud cardiovascular, cerebral y articular. Sin regusto a pescado.', 320.00, 'producto', 'salud', 'disponible', 'https://picsum.photos/seed/suplemento-omega3-p2q4/400/300', 'suplemento-omega3-p2q4', 'San Andrés Cholula', 'ambos', 10, 115);

-- ===================== EDUCACIÓN (Jorge + Carlos) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_carlos, 'Curso de inglés online (3 meses)', 'Curso de inglés en línea con acceso por 3 meses. Incluye 36 lecciones en video, ejercicios interactivos y certificado. Niveles básico a intermedio. Aprende a tu ritmo.', 1200.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-ingles-online-3m-r3s5/400/300', 'curso-ingles-online-3m-r3s5', 'Centro Puebla', 'envio', 8, 145),

(gen_random_uuid(), v_jorge, 'Clases de guitarra (4 sesiones)', 'Paquete de 4 clases individuales de guitarra acústica de 1 hora cada una. Para principiantes y nivel intermedio. Incluye material didáctico digital. En domicilio o estudio.', 800.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/clases-guitarra-4sesiones-t4u6/400/300', 'clases-guitarra-4sesiones-t4u6', 'Atlixco', 'pickup', 5, 88),

(gen_random_uuid(), v_carlos, 'Tutoría matemáticas prepa', 'Tutorías personalizadas de matemáticas nivel preparatoria. Álgebra, trigonometría y cálculo. Sesiones de 1.5 horas presencial o en línea. Material de apoyo incluido.', 250.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/tutoria-matematicas-prepa-v5w7/400/300', 'tutoria-matematicas-prepa-v5w7', 'Centro Puebla', 'pickup', 12, 130),

(gen_random_uuid(), v_carlos, 'Curso de Excel avanzado', 'Curso de Excel avanzado con macros, tablas dinámicas, Power Query y dashboards. 8 sesiones de 2 horas en línea con grabaciones. Incluye ejercicios prácticos y certificado.', 1500.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-excel-avanzado-x6y8/400/300', 'curso-excel-avanzado-x6y8', 'Centro Puebla', 'envio', 6, 110),

(gen_random_uuid(), v_maria, 'Clases de cocina italiana', 'Taller presencial de cocina italiana: pasta fresca, risotto y tiramisú. 3 horas con todos los ingredientes incluidos. Máximo 8 personas por grupo. Te llevas lo que cocines.', 450.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/clases-cocina-italiana-z7a9/400/300', 'clases-cocina-italiana-z7a9', 'Angelópolis', 'pickup', 10, 155),

(gen_random_uuid(), v_carlos, 'Asesoría tesis universitaria', 'Asesoría profesional para tesis de licenciatura o maestría. Incluye revisión de marco teórico, metodología y análisis de datos. Sesiones de 1 hora por videollamada.', 350.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/asesoria-tesis-univ-b8c1/400/300', 'asesoria-tesis-univ-b8c1', 'Centro Puebla', 'envio', 4, 95),

(gen_random_uuid(), v_jorge, 'Curso de fotografía básica', 'Curso presencial de fotografía básica en 4 sesiones de 3 horas. Aprende composición, iluminación y edición. Trae tu cámara o celular. Incluye salida fotográfica por el centro.', 900.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-fotografia-basica-d9e2/400/300', 'curso-fotografia-basica-d9e2', 'Atlixco', 'pickup', 7, 120),

(gen_random_uuid(), v_jorge, 'Clases de piano (mensual)', 'Paquete mensual de 4 clases individuales de piano de 1 hora. Para niños y adultos, todos los niveles. Método Suzuki y repertorio clásico/pop. Instrumento disponible en clase.', 1200.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/clases-piano-mensual-f1g3/400/300', 'clases-piano-mensual-f1g3', 'Atlixco', 'pickup', 3, 75),

(gen_random_uuid(), v_ana, 'Taller de pintura al óleo', 'Taller de pintura al óleo para principiantes en 6 sesiones de 2 horas. Materiales incluidos: lienzo, pinturas, pinceles y paleta. Al final tendrás 2 cuadros terminados.', 1500.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/taller-pintura-oleo-h2i4/400/300', 'taller-pintura-oleo-h2i4', 'Cholula', 'pickup', 5, 100),

(gen_random_uuid(), v_carlos, 'Curso de marketing digital', 'Curso completo de marketing digital: redes sociales, Google Ads, email marketing y analytics. 12 sesiones online con proyecto final. Incluye plantillas y herramientas.', 2500.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-marketing-digital-j3k5/400/300', 'curso-marketing-digital-j3k5', 'Centro Puebla', 'envio', 9, 168),

(gen_random_uuid(), v_sofia, 'Clases de yoga (8 sesiones)', 'Paquete de 8 clases de yoga vinyasa de 1 hora. Grupos reducidos de máximo 10 personas. Incluye tapete y props. Mejora flexibilidad, fuerza y bienestar mental.', 800.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/clases-yoga-8sesiones-l4m6/400/300', 'clases-yoga-8sesiones-l4m6', 'San Andrés Cholula', 'pickup', 11, 140),

(gen_random_uuid(), v_carlos, 'Tutoría programación Python', 'Tutorías individuales de programación en Python. Desde lo básico hasta análisis de datos y automatización. Sesiones de 1.5 horas por Zoom con ejercicios prácticos.', 300.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/tutoria-programacion-python-n5o7/400/300', 'tutoria-programacion-python-n5o7', 'Centro Puebla', 'envio', 7, 115),

(gen_random_uuid(), v_maria, 'Curso de repostería', 'Curso presencial de repostería artesanal en 4 sesiones: galletas, cupcakes, pay y pastel fondant. Ingredientes incluidos y recetario digital. Grupos reducidos de 6 personas.', 1200.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-reposteria-p6q8/400/300', 'curso-reposteria-p6q8', 'Angelópolis', 'pickup', 8, 125),

(gen_random_uuid(), v_sofia, 'Clases de natación (mensual)', 'Paquete mensual de clases de natación, 3 veces por semana. Para niños desde 4 años y adultos. Instructores certificados por la FMN. Alberca climatizada.', 900.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/clases-natacion-mensual-r7s9/400/300', 'clases-natacion-mensual-r7s9', 'San Andrés Cholula', 'pickup', 6, 105),

(gen_random_uuid(), v_jorge, 'Asesoría fiscal personal', 'Asesoría fiscal personalizada para declaración anual, devolución de impuestos y optimización fiscal. Sesión de 1.5 horas con contador certificado. Incluye seguimiento.', 500.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/asesoria-fiscal-personal-t8u1/400/300', 'asesoria-fiscal-personal-t8u1', 'Atlixco', 'envio', 4, 80),

(gen_random_uuid(), v_carlos, 'Curso de diseño gráfico', 'Curso de diseño gráfico con Canva y Adobe Illustrator en 8 sesiones online. Aprende a crear logos, posts para redes y materiales impresos. Incluye recursos descargables.', 1800.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-diseno-grafico-v9w2/400/300', 'curso-diseno-grafico-v9w2', 'Centro Puebla', 'envio', 5, 98),

(gen_random_uuid(), v_ana, 'Clases de baile salsa (8 sesiones)', 'Paquete de 8 clases de salsa cubana y bachata. Para parejas o individuales. Incluye práctica libre los viernes. Aprende los pasos básicos y figuras intermedias.', 700.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/clases-baile-salsa-8ses-x1y3/400/300', 'clases-baile-salsa-8ses-x1y3', 'Cholula', 'pickup', 13, 150),

(gen_random_uuid(), v_carlos, 'Preparación TOEFL', 'Curso de preparación para examen TOEFL en 20 sesiones intensivas. Cubre las 4 secciones: reading, listening, speaking y writing. Simulacros incluidos y tips de examen.', 3500.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/preparacion-toefl-z2a4/400/300', 'preparacion-toefl-z2a4', 'Centro Puebla', 'envio', 3, 135),

(gen_random_uuid(), v_jorge, 'Curso de primeros auxilios', 'Curso certificado de primeros auxilios y RCP de 8 horas. Teoría y práctica con maniquíes. Incluye certificado con validez oficial. Grupos de máximo 15 personas.', 600.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/curso-primeros-auxilios-b3c5/400/300', 'curso-primeros-auxilios-b3c5', 'Atlixco', 'pickup', 6, 90),

(gen_random_uuid(), v_ana, 'Taller de escritura creativa', 'Taller de escritura creativa en 6 sesiones de 2 horas. Géneros: cuento, poesía y crónica. Retroalimentación grupal e individual. Lectura final de textos producidos.', 900.00, 'servicio', 'educacion', 'disponible', 'https://picsum.photos/seed/taller-escritura-creativa-d4e6/400/300', 'taller-escritura-creativa-d4e6', 'Cholula', 'pickup', 4, 72);

-- ===================== TRANSPORTE (Carlos + Jorge) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_carlos, 'Bicicleta rodada 26', 'Bicicleta de montaña rodada 26 con marco de aluminio y 21 velocidades Shimano. Frenos de disco y suspensión delantera. Color negro mate. Ideal para paseos y ejercicio.', 3500.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/bicicleta-rodada-26-f5g7/400/300', 'bicicleta-rodada-26-f5g7', 'Centro Puebla', 'pickup', 2, 130),

(gen_random_uuid(), v_carlos, 'Scooter eléctrico', 'Scooter eléctrico plegable con motor de 350W y autonomía de 25km. Velocidad máxima de 25km/h. Pantalla LED con indicadores. Llantas de 8.5 pulgadas antipinchazos.', 5500.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/scooter-electrico-h6i8/400/300', 'scooter-electrico-h6i8', 'Centro Puebla', 'pickup', 1, 175),

(gen_random_uuid(), v_carlos, 'Casco de ciclismo', 'Casco de ciclismo con certificación CE y ventilación de 18 orificios. Ajuste dial trasero y correas acolchadas. Tallas M y L disponibles. Ligero y cómodo para rutas largas.', 450.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/casco-ciclismo-j7k9/400/300', 'casco-ciclismo-j7k9', 'Centro Puebla', 'ambos', 5, 88),

(gen_random_uuid(), v_carlos, 'Candado para bici', 'Candado tipo U para bicicleta de acero endurecido con cable de 1.2m y 2 llaves. Resistente a corte con sierra y palanca. Soporte de montaje para cuadro incluido.', 350.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/candado-bici-l8m1/400/300', 'candado-bici-l8m1', 'Centro Puebla', 'ambos', 8, 75),

(gen_random_uuid(), v_jorge, 'Llanta para auto R15', 'Llanta nueva para auto medida 195/65 R15 con buen agarre en mojado y seco. Marca nacional de calidad. Precio por llanta individual. Instalación no incluida.', 850.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/llanta-auto-r15-n9o2/400/300', 'llanta-auto-r15-n9o2', 'Atlixco', 'pickup', 4, 95),

(gen_random_uuid(), v_carlos, 'Autoestereo Bluetooth', 'Autoestéreo con Bluetooth, USB, AUX y radio FM/AM. Pantalla LCD con ecualizador. Potencia de 50W x 4. Compatible con control al volante. Fácil instalación.', 950.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/autoestereo-bluetooth-p1q3/400/300', 'autoestereo-bluetooth-p1q3', 'Centro Puebla', 'ambos', 6, 108),

(gen_random_uuid(), v_sofia, 'Organizador para carro', 'Organizador de asiento trasero para carro con múltiples bolsillos y porta tablet. Material impermeable y fácil de limpiar. Mantiene todo ordenado en viajes largos.', 180.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/organizador-carro-r2s4/400/300', 'organizador-carro-r2s4', 'San Andrés Cholula', 'ambos', 10, 85),

(gen_random_uuid(), v_carlos, 'Cargador de auto dual USB', 'Cargador de auto con 2 puertos USB y 1 USB-C con carga rápida de 36W. Compatible con todos los celulares y tablets. LED indicador y diseño compacto que no estorba.', 150.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/cargador-auto-dual-usb-t3u5/400/300', 'cargador-auto-dual-usb-t3u5', 'Centro Puebla', 'envio', 15, 120),

(gen_random_uuid(), v_carlos, 'Soporte celular para auto', 'Soporte magnético para celular con montaje en rejilla de ventilación. Rotación 360° y agarre seguro. Compatible con todos los celulares con o sin funda. Instalación en segundos.', 120.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/soporte-celular-auto-v4w6/400/300', 'soporte-celular-auto-v4w6', 'Centro Puebla', 'envio', 18, 135),

(gen_random_uuid(), v_jorge, 'Tapetes para auto (set 4)', 'Set de 4 tapetes universales de hule para auto. Resistentes al agua, lodo y desgaste. Con bordes elevados para retener líquidos. Fáciles de lavar con manguera.', 350.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/tapetes-auto-set4-x5y7/400/300', 'tapetes-auto-set4-x5y7', 'Atlixco', 'ambos', 7, 92),

(gen_random_uuid(), v_jorge, 'Limpiador de interiores', 'Kit de limpieza de interiores para auto: limpiador multiusos, protector de vinil, limpiavidrios y 3 microfibras. Deja tu auto como nuevo sin ir al car wash.', 280.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/limpiador-interiores-z6a8/400/300', 'limpiador-interiores-z6a8', 'Atlixco', 'ambos', 9, 78),

(gen_random_uuid(), v_jorge, 'Inflador portátil', 'Compresor de aire portátil recargable con pantalla digital y luz LED. Infla llantas de auto, bici y balones. Presión máxima de 150 PSI. Carga por USB-C.', 550.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/inflador-portatil-b7c9/400/300', 'inflador-portatil-b7c9', 'Atlixco', 'ambos', 5, 105),

(gen_random_uuid(), v_jorge, 'Kit de herramientas para auto', 'Kit de emergencia para auto con 40 piezas: llaves, desarmadores, pinzas, cinta, cables pasa corriente y triángulo reflejante. Estuche organizado para cajuela.', 650.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/kit-herramientas-auto-d8e1/400/300', 'kit-herramientas-auto-d8e1', 'Atlixco', 'ambos', 3, 88),

(gen_random_uuid(), v_sofia, 'Funda para volante', 'Funda para volante de piel sintética con costura deportiva en rojo. Diámetro universal de 37-38cm. Mejora el agarre y protege el volante del desgaste. Fácil de instalar.', 180.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/funda-volante-f9g2/400/300', 'funda-volante-f9g2', 'San Andrés Cholula', 'ambos', 6, 70),

(gen_random_uuid(), v_sofia, 'Parasol para parabrisas', 'Parasol retráctil para parabrisas delantero con protección UV. Se pliega como abanico para fácil almacenamiento. Universal para autos y camionetas. Reduce hasta 40°C el calor interior.', 150.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/parasol-parabrisas-h1i3/400/300', 'parasol-parabrisas-h1i3', 'San Andrés Cholula', 'ambos', 12, 110),

(gen_random_uuid(), v_sofia, 'Aromatizante para auto', 'Set de 3 aromatizantes para auto de larga duración: pino, vainilla y auto nuevo. Duran hasta 45 días cada uno. Diseño elegante que se coloca en la rejilla de ventilación.', 120.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/aromatizante-auto-j2k4/400/300', 'aromatizante-auto-j2k4', 'San Andrés Cholula', 'envio', 20, 98),

(gen_random_uuid(), v_carlos, 'Cámara de reversa', 'Cámara de reversa HD con visión nocturna y ángulo de 170°. Resistente al agua IP68. Incluye cable y líneas guía ajustables. Compatible con cualquier autoestéreo con pantalla.', 450.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/camara-reversa-l3m5/400/300', 'camara-reversa-l3m5', 'Centro Puebla', 'ambos', 4, 115),

(gen_random_uuid(), v_carlos, 'Bocinas para auto 6.5"', 'Par de bocinas coaxiales de 6.5 pulgadas con potencia de 400W pico. Tweeter integrado y woofer de polipropileno. Sonido claro y graves potentes. Incluyen rejillas.', 650.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/bocinas-auto-65-n4o6/400/300', 'bocinas-auto-65-n4o6', 'Centro Puebla', 'ambos', 5, 95),

(gen_random_uuid(), v_jorge, 'Portaequipaje de techo', 'Portaequipaje universal para techo de auto con barras de aluminio ajustables. Capacidad de 75kg. Compatible con la mayoría de autos con rieles. Incluye candados.', 1200.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/portaequipaje-techo-p5q7/400/300', 'portaequipaje-techo-p5q7', 'Atlixco', 'pickup', 1, 65),

(gen_random_uuid(), v_jorge, 'Cadenas para nieve', 'Cadenas para nieve talla universal R14-R17. Fácil instalación sin mover el auto. Acero galvanizado resistente a corrosión. Incluye guantes y bolsa de transporte.', 550.00, 'producto', 'transporte', 'disponible', 'https://picsum.photos/seed/cadenas-nieve-r6s8/400/300', 'cadenas-nieve-r6s8', 'Atlixco', 'ambos', 2, 55);

-- ===================== EVENTOS (María + Ana + Jorge) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_jorge, 'DJ para fiesta (4 hrs)', 'Servicio de DJ profesional para fiesta por 4 horas. Incluye equipo de sonido, luces LED y micrófono inalámbrico. Repertorio variado: pop, reggaetón, cumbia y más. Cobertura en Puebla.', 3500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/dj-fiesta-4hrs-t7u9/400/300', 'dj-fiesta-4hrs-t7u9', 'Atlixco', 'pickup', 8, 145),

(gen_random_uuid(), v_jorge, 'Fotografía para boda (8 hrs)', 'Servicio de fotografía profesional para boda con cobertura de 8 horas. Incluye 300+ fotos editadas en alta resolución, galería digital y álbum impreso de 30 páginas.', 8500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/fotografia-boda-8hrs-v8w1/400/300', 'fotografia-boda-8hrs-v8w1', 'Atlixco', 'pickup', 3, 175),

(gen_random_uuid(), v_jorge, 'Renta de sillas y mesas (50 pzas)', 'Renta de 50 sillas plegables y 6 mesas rectangulares para 8 personas. Incluye mantelería blanca y entrega en zona Puebla. Mínimo 2 días de anticipación.', 2500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/renta-sillas-mesas-50-x9y2/400/300', 'renta-sillas-mesas-50-x9y2', 'Atlixco', 'pickup', 6, 110),

(gen_random_uuid(), v_ana, 'Decoración con globos', 'Decoración con arco de globos personalizado para fiestas. Incluye diseño, armado e instalación. Colores a elegir. Tamaño estándar de 3 metros. Entrega en zona Puebla.', 1200.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/decoracion-globos-z1a3/400/300', 'decoracion-globos-z1a3', 'Cholula', 'pickup', 12, 165),

(gen_random_uuid(), v_maria, 'Pastel personalizado 3 pisos', 'Pastel de 3 pisos decorado con fondant y tema personalizado. Rinde para 80-100 personas. Sabores: vainilla, chocolate o red velvet. Requiere 5 días de anticipación.', 2800.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/pastel-personalizado-3pisos-b2c4/400/300', 'pastel-personalizado-3pisos-b2c4', 'Angelópolis', 'pickup', 7, 140),

(gen_random_uuid(), v_jorge, 'Renta de inflables', 'Renta de inflable grande de 4x4m con tobogán. Incluye motor, instalación y desinstalación. Servicio por 6 horas. Ideal para fiestas infantiles al aire libre.', 1500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/renta-inflables-d3e5/400/300', 'renta-inflables-d3e5', 'Atlixco', 'pickup', 9, 125),

(gen_random_uuid(), v_ana, 'Animación infantil (3 hrs)', 'Show de animación para fiestas infantiles con payaso, juegos, concursos y piñata. 3 horas de diversión garantizada. Incluye material para actividades y música.', 2000.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/animacion-infantil-3hrs-f4g6/400/300', 'animacion-infantil-3hrs-f4g6', 'Cholula', 'pickup', 11, 138),

(gen_random_uuid(), v_jorge, 'Sonido profesional evento', 'Renta de equipo de sonido profesional para evento mediano (hasta 200 personas). Incluye bocinas, subwoofer, mezcladora, 2 micrófonos y técnico de audio por 6 horas.', 4500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/sonido-profesional-evento-h5i7/400/300', 'sonido-profesional-evento-h5i7', 'Atlixco', 'pickup', 5, 100),

(gen_random_uuid(), v_jorge, 'Renta de carpa 6x6', 'Renta de carpa tipo araña de 6x6 metros con estructura metálica y lona blanca impermeable. Incluye montaje y desmontaje. Ideal para eventos al aire libre en jardín.', 3000.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/renta-carpa-6x6-j6k8/400/300', 'renta-carpa-6x6-j6k8', 'Atlixco', 'pickup', 4, 85),

(gen_random_uuid(), v_ana, 'Invitaciones digitales personalizadas', 'Diseño de invitación digital animada para evento con confirmación de asistencia integrada. Formato MP4 para WhatsApp y JPG para redes. Entrega en 48 horas.', 350.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/invitaciones-digitales-pers-l7m9/400/300', 'invitaciones-digitales-pers-l7m9', 'Cholula', 'envio', 15, 155),

(gen_random_uuid(), v_ana, 'Arreglos florales (centro de mesa)', 'Arreglo floral como centro de mesa con flores frescas de temporada. Incluye base decorativa y follaje verde. Precio por pieza. Mínimo 5 unidades. Entrega en Puebla.', 280.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/arreglos-florales-centromesa-n8o1/400/300', 'arreglos-florales-centromesa-n8o1', 'Cholula', 'pickup', 10, 120),

(gen_random_uuid(), v_jorge, 'Servicio de meseros (5 personas)', 'Servicio de 5 meseros profesionales uniformados para evento por 6 horas. Incluyen montaje de mesas y servicio de alimentos y bebidas. Cobertura en zona metropolitana.', 3500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/servicio-meseros-5pers-p9q2/400/300', 'servicio-meseros-5pers-p9q2', 'Atlixco', 'pickup', 4, 78),

(gen_random_uuid(), v_maria, 'Piñata personalizada', 'Piñata personalizada en el tema que elijas: personajes, números o formas. Tamaño grande con capacidad para 3kg de dulces. Elaborada con cartón y papel crepé de colores.', 350.00, 'producto', 'eventos', 'disponible', 'https://picsum.photos/seed/pinata-personalizada-r1s3/400/300', 'pinata-personalizada-r1s3', 'Angelópolis', 'pickup', 14, 160),

(gen_random_uuid(), v_maria, 'Candy bar completo', 'Servicio de candy bar completo para 50 personas. Incluye mesa decorada, 8 tipos de dulces, palomitas, algodón de azúcar y bolsitas para llevar. Tema a elegir.', 2500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/candy-bar-completo-t2u4/400/300', 'candy-bar-completo-t2u4', 'Angelópolis', 'pickup', 6, 115),

(gen_random_uuid(), v_jorge, 'Video para evento (4 hrs)', 'Servicio de videografía profesional para evento por 4 horas. Incluye video editado de 5-8 minutos con música, títulos y momentos destacados. Entrega en USB y digital.', 5000.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/video-evento-4hrs-v3w5/400/300', 'video-evento-4hrs-v3w5', 'Atlixco', 'pickup', 3, 95),

(gen_random_uuid(), v_jorge, 'Renta de karaoke', 'Renta de equipo de karaoke profesional con pantalla, 2 micrófonos inalámbricos y catálogo de 10,000+ canciones. Incluye bocina y entrega en zona Puebla. Servicio por 5 horas.', 1500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/renta-karaoke-x4y6/400/300', 'renta-karaoke-x4y6', 'Atlixco', 'pickup', 7, 105),

(gen_random_uuid(), v_jorge, 'Iluminación LED para evento', 'Servicio de iluminación LED ambiental para evento con luces de colores programables. Incluye 10 reflectores LED, bola disco y máquina de humo. Montaje y operación incluidos.', 2500.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/iluminacion-led-evento-z5a7/400/300', 'iluminacion-led-evento-z5a7', 'Atlixco', 'pickup', 5, 88),

(gen_random_uuid(), v_jorge, 'Maestro de ceremonias', 'Servicio de maestro de ceremonias profesional para bodas, XV años o eventos corporativos. Cobertura de hasta 5 horas. Incluye coordinación con DJ y proveedores.', 3000.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/maestro-ceremonias-b6c8/400/300', 'maestro-ceremonias-b6c8', 'Atlixco', 'pickup', 2, 72),

(gen_random_uuid(), v_jorge, 'Mariachi (2 hrs)', 'Servicio de mariachi profesional de 7 elementos por 2 horas. Repertorio completo: rancheras, boleros, sones y cumbias. Incluye serenata o amenización de evento.', 4000.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/mariachi-2hrs-d7e9/400/300', 'mariachi-2hrs-d7e9', 'Atlixco', 'pickup', 6, 135),

(gen_random_uuid(), v_maria, 'Food truck para evento', 'Servicio de food truck para evento (mínimo 50 personas). Menú de tacos al pastor, gringas, volcanes y quesadillas. Incluye guarniciones, salsas y bebidas de agua fresca.', 5000.00, 'servicio', 'eventos', 'disponible', 'https://picsum.photos/seed/food-truck-evento-f8g1/400/300', 'food-truck-evento-f8g1', 'Angelópolis', 'pickup', 4, 110);

-- ===================== MASCOTAS (Sofía) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_sofia, 'Croquetas premium perro 15kg', 'Croquetas premium para perro adulto de 15kg con proteína de pollo y arroz. Fórmula balanceada con omega 3 y 6 para pelo brillante. Sin colorantes artificiales.', 850.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/croquetas-premium-perro-15kg-h9i2/400/300', 'croquetas-premium-perro-15kg-h9i2', 'San Andrés Cholula', 'ambos', 12, 145),

(gen_random_uuid(), v_sofia, 'Cama para perro grande', 'Cama ortopédica para perro grande de 90x70cm con relleno de espuma viscoelástica. Funda removible y lavable en color gris. Base antideslizante para pisos lisos.', 550.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/cama-perro-grande-j1k3/400/300', 'cama-perro-grande-j1k3', 'San Andrés Cholula', 'ambos', 6, 110),

(gen_random_uuid(), v_sofia, 'Arnés anti-tirón talla M', 'Arnés anti-tirón para perro talla M (pecho 50-65cm) con enganche frontal y trasero. Acolchado reflectante para paseos nocturnos seguros. Ajuste en 4 puntos.', 280.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/arnes-antitiron-m-l2m4/400/300', 'arnes-antitiron-m-l2m4', 'San Andrés Cholula', 'ambos', 9, 95),

(gen_random_uuid(), v_sofia, 'Juguete Kong original', 'Juguete Kong Classic rojo talla L para perro. Hule natural resistente a mordidas. Se puede rellenar con premios o mantequilla de maní. Entretiene por horas.', 350.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/juguete-kong-original-n3o5/400/300', 'juguete-kong-original-n3o5', 'San Andrés Cholula', 'ambos', 14, 130),

(gen_random_uuid(), v_sofia, 'Transportadora para gato', 'Transportadora rígida para gato con puerta de rejilla metálica y ventilación lateral. Medidas: 48x32x30cm. Aprobada para viajes en avión. Fácil de armar y limpiar.', 420.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/transportadora-gato-p4q6/400/300', 'transportadora-gato-p4q6', 'San Andrés Cholula', 'ambos', 5, 85),

(gen_random_uuid(), v_sofia, 'Arena aglomerante 10kg', 'Arena aglomerante para gato de 10kg con control de olores y aroma a lavanda. Forma grumos sólidos fáciles de retirar. Polvo mínimo y alto rendimiento.', 180.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/arena-aglomerante-10kg-r5s7/400/300', 'arena-aglomerante-10kg-r5s7', 'San Andrés Cholula', 'ambos', 18, 155),

(gen_random_uuid(), v_sofia, 'Plato elevado doble', 'Comedero doble elevado de acero inoxidable con base de bambú. Altura ajustable para perros medianos y grandes. Antideslizante y fácil de limpiar. Capacidad de 750ml por plato.', 320.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/plato-elevado-doble-t6u8/400/300', 'plato-elevado-doble-t6u8', 'San Andrés Cholula', 'ambos', 7, 78),

(gen_random_uuid(), v_sofia, 'Collar GPS para mascota', 'Collar con rastreador GPS para perro o gato con app para celular. Geo-cerca, historial de rutas y alerta de escape. Batería de 5 días. Resistente al agua IP67.', 950.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/collar-gps-mascota-v7w9/400/300', 'collar-gps-mascota-v7w9', 'San Andrés Cholula', 'ambos', 4, 140),

(gen_random_uuid(), v_sofia, 'Servicio de baño para perro', 'Servicio de baño completo para perro mediano o grande. Incluye shampoo especializado, secado, limpieza de oídos y corte de uñas. A domicilio o en nuestro local.', 250.00, 'servicio', 'mascotas', 'disponible', 'https://picsum.photos/seed/servicio-bano-perro-x8y1/400/300', 'servicio-bano-perro-x8y1', 'San Andrés Cholula', 'pickup', 15, 165),

(gen_random_uuid(), v_sofia, 'Corte de pelo canino', 'Servicio de corte de pelo y estética canina profesional. Incluye baño, secado, corte a tijera o máquina según la raza. Para perros de todas las tallas. Cita previa.', 350.00, 'servicio', 'mascotas', 'disponible', 'https://picsum.photos/seed/corte-pelo-canino-z9a2/400/300', 'corte-pelo-canino-z9a2', 'San Andrés Cholula', 'pickup', 11, 130),

(gen_random_uuid(), v_sofia, 'Hotel para mascotas (por noche)', 'Hospedaje para perro o gato por noche con área de juego, paseos diarios y alimentación. Espacio techado y seguro. Vigilancia 24/7. Fotos y videos diarios al dueño.', 200.00, 'servicio', 'mascotas', 'disponible', 'https://picsum.photos/seed/hotel-mascotas-noche-b1c3/400/300', 'hotel-mascotas-noche-b1c3', 'San Andrés Cholula', 'pickup', 8, 115),

(gen_random_uuid(), v_sofia, 'Paseo de perros (5 días)', 'Servicio de paseo de perros por 5 días (lunes a viernes), 45 minutos diarios. Grupos pequeños de máximo 4 perros. Incluye fotos del paseo y reporte de comportamiento.', 400.00, 'servicio', 'mascotas', 'disponible', 'https://picsum.photos/seed/paseo-perros-5dias-d2e4/400/300', 'paseo-perros-5dias-d2e4', 'San Andrés Cholula', 'pickup', 10, 100),

(gen_random_uuid(), v_sofia, 'Vacunas básicas cachorro', 'Paquete de vacunación básica para cachorro: parvovirus, moquillo, hepatitis y rabia. Aplicadas por veterinario certificado. Incluye carnet de vacunación y desparasitación.', 450.00, 'servicio', 'mascotas', 'disponible', 'https://picsum.photos/seed/vacunas-basicas-cachorro-f3g5/400/300', 'vacunas-basicas-cachorro-f3g5', 'San Andrés Cholula', 'pickup', 13, 145),

(gen_random_uuid(), v_sofia, 'Desparasitación interna', 'Servicio de desparasitación interna para perro o gato con medicamento de amplio espectro. Aplicación por veterinario. Se recomienda cada 3-4 meses. Incluye valoración.', 150.00, 'servicio', 'mascotas', 'disponible', 'https://picsum.photos/seed/desparasitacion-interna-h4i6/400/300', 'desparasitacion-interna-h4i6', 'San Andrés Cholula', 'pickup', 16, 120),

(gen_random_uuid(), v_sofia, 'Rascador para gato', 'Rascador para gato tipo torre de 3 niveles con plataformas y casita. Altura de 90cm con postes de sisal natural. Base estable de 40x40cm. Incluye ratón de juguete.', 650.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/rascador-gato-j5k7/400/300', 'rascador-gato-j5k7', 'San Andrés Cholula', 'pickup', 5, 105),

(gen_random_uuid(), v_sofia, 'Pecera 40L equipada', 'Pecera de cristal de 40 litros con filtro, calentador, luz LED y termómetro incluidos. Lista para montar tu acuario. Incluye grava decorativa y plantas artificiales.', 750.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/pecera-40l-equipada-l6m8/400/300', 'pecera-40l-equipada-l6m8', 'San Andrés Cholula', 'pickup', 3, 88),

(gen_random_uuid(), v_sofia, 'Alimento para peces 100g', 'Alimento en hojuelas para peces tropicales de 100g con vitaminas y minerales. Fórmula que no enturbia el agua. Alimentar 2-3 veces al día la cantidad que consuman en 2 minutos.', 80.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/alimento-peces-100g-n7o9/400/300', 'alimento-peces-100g-n7o9', 'San Andrés Cholula', 'envio', 20, 75),

(gen_random_uuid(), v_sofia, 'Jaula para hámster completa', 'Jaula para hámster de 47x30x27cm con rueda de ejercicio, bebedero, comedero y casita. Barrotes de metal con base de plástico desmontable. Fácil de limpiar.', 450.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/jaula-hamster-completa-p8q1/400/300', 'jaula-hamster-completa-p8q1', 'San Andrés Cholula', 'pickup', 4, 70),

(gen_random_uuid(), v_sofia, 'Shampoo antipulgas', 'Shampoo antipulgas y garrapatas para perro de 500ml con extractos naturales de neem y citronela. Limpia, desparasita y deja el pelo suave y brillante. Apto para cachorros desde 3 meses.', 120.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/shampoo-antipulgas-r9s2/400/300', 'shampoo-antipulgas-r9s2', 'San Andrés Cholula', 'ambos', 17, 138),

(gen_random_uuid(), v_sofia, 'Snacks dentales para perro (pack 30)', 'Pack de 30 snacks dentales para perro que limpian los dientes y refrescan el aliento. Forma de hueso fácil de masticar. Sin colorantes ni saborizantes artificiales.', 220.00, 'producto', 'mascotas', 'disponible', 'https://picsum.photos/seed/snacks-dentales-perro-30-t1u3/400/300', 'snacks-dentales-perro-30-t1u3', 'San Andrés Cholula', 'ambos', 13, 108);

-- ===================== SERVICIOS PROFESIONALES (Jorge) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_jorge, 'Plomero a domicilio', 'Servicio de plomería a domicilio para reparación de fugas, destape de drenajes, instalación de llaves y boiler. Diagnóstico gratuito. Herramienta y materiales básicos incluidos.', 350.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/plomero-domicilio-v2w4/400/300', 'plomero-domicilio-v2w4', 'Atlixco', 'pickup', 5, 95),

(gen_random_uuid(), v_jorge, 'Electricista certificado', 'Electricista con cédula profesional para instalaciones, reparaciones y cortos circuitos. Trabajo con garantía de 6 meses. Cobertura en Puebla y zona metropolitana.', 400.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/electricista-certificado-x3y5/400/300', 'electricista-certificado-x3y5', 'Atlixco', 'pickup', 4, 82),

(gen_random_uuid(), v_carlos, 'Diseño de logo profesional', 'Diseño de logotipo profesional con 3 propuestas y 2 rondas de revisión. Incluye archivos en formato vectorial (AI, SVG), PNG y PDF. Manual de uso básico del logo.', 1500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/diseno-logo-profesional-z4a6/400/300', 'diseno-logo-profesional-z4a6', 'Centro Puebla', 'envio', 8, 145),

(gen_random_uuid(), v_carlos, 'Desarrollo de página web', 'Desarrollo de sitio web profesional con diseño responsivo, hasta 5 páginas, formulario de contacto y SEO básico. Incluye dominio .com por 1 año y hosting. Entrega en 2 semanas.', 5000.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/desarrollo-pagina-web-b5c7/400/300', 'desarrollo-pagina-web-b5c7', 'Centro Puebla', 'envio', 5, 165),

(gen_random_uuid(), v_jorge, 'Mudanza local (camioneta)', 'Servicio de mudanza local con camioneta de 3.5 toneladas y 2 ayudantes. Carga, traslado y descarga en zona metropolitana de Puebla. Cobijas y cinchos incluidos.', 1800.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/mudanza-local-camioneta-d6e8/400/300', 'mudanza-local-camioneta-d6e8', 'Atlixco', 'pickup', 3, 75),

(gen_random_uuid(), v_jorge, 'Carpintería a medida', 'Servicio de carpintería para muebles a medida: closets, libreros, repisas y cocinas integrales. Madera de pino o MDF. Incluye diseño 3D previo y garantía de 1 año.', 2500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/carpinteria-medida-f7g9/400/300', 'carpinteria-medida-f7g9', 'Atlixco', 'pickup', 2, 90),

(gen_random_uuid(), v_jorge, 'Pintura de interiores (habitación)', 'Servicio de pintura de interiores por habitación (hasta 16m²). Incluye preparación de muros, 2 manos de pintura vinílica y limpieza. Colores a elegir. Pintura incluida.', 1200.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/pintura-interiores-hab-h8i1/400/300', 'pintura-interiores-hab-h8i1', 'Atlixco', 'pickup', 4, 68),

(gen_random_uuid(), v_jorge, 'Limpieza profunda de hogar', 'Servicio de limpieza profunda para casa completa (hasta 150m²). Incluye cocina, baños, recámaras, sala y comedor. 2 personas por 5 horas. Productos de limpieza incluidos.', 1500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/limpieza-profunda-hogar-j9k2/400/300', 'limpieza-profunda-hogar-j9k2', 'Atlixco', 'pickup', 6, 105),

(gen_random_uuid(), v_jorge, 'Fumigación residencial', 'Servicio de fumigación residencial contra cucarachas, hormigas y arañas. Productos seguros para mascotas y niños. Garantía de 3 meses. Cobertura en Puebla y alrededores.', 800.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/fumigacion-residencial-l1m3/400/300', 'fumigacion-residencial-l1m3', 'Atlixco', 'pickup', 5, 88),

(gen_random_uuid(), v_jorge, 'Instalación de cámaras CCTV', 'Instalación de sistema de 4 cámaras CCTV HD con DVR y monitoreo desde celular. Incluye cableado, configuración y 1 mes de soporte técnico. Cámaras con visión nocturna.', 4500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/instalacion-camaras-cctv-n2o4/400/300', 'instalacion-camaras-cctv-n2o4', 'Atlixco', 'pickup', 3, 120),

(gen_random_uuid(), v_carlos, 'Reparación de celulares', 'Reparación de celulares: cambio de pantalla, batería, puerto de carga y botones. iPhone y Android. Diagnóstico gratuito y garantía de 30 días en refacciones.', 350.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/reparacion-celulares-p3q5/400/300', 'reparacion-celulares-p3q5', 'Centro Puebla', 'pickup', 12, 155),

(gen_random_uuid(), v_jorge, 'Cerrajería 24 hrs', 'Servicio de cerrajería de emergencia las 24 horas. Apertura de puertas, cambio de chapas, duplicado de llaves y cajas fuertes. Llegamos en 30 minutos o menos en zona Puebla.', 300.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/cerrajeria-24hrs-r4s6/400/300', 'cerrajeria-24hrs-r4s6', 'Atlixco', 'pickup', 7, 92),

(gen_random_uuid(), v_jorge, 'Servicio de contabilidad mensual', 'Servicio de contabilidad mensual para personas físicas con actividad empresarial. Incluye declaraciones mensuales, facturación y asesoría fiscal. Contador certificado por el IMCP.', 1500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/contabilidad-mensual-t5u7/400/300', 'contabilidad-mensual-t5u7', 'Atlixco', 'envio', 4, 78),

(gen_random_uuid(), v_jorge, 'Clases de manejo', 'Paquete de 10 clases de manejo de 1 hora en auto estándar o automático. Incluye teoría y práctica en calle y estacionamiento. Instructor certificado y seguro incluido.', 2500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/clases-manejo-v6w8/400/300', 'clases-manejo-v6w8', 'Atlixco', 'pickup', 5, 110),

(gen_random_uuid(), v_carlos, 'Fotografía de producto (10 fotos)', 'Sesión de fotografía de producto con 10 fotos editadas en alta resolución. Fondo blanco o estilizado. Ideal para tiendas en línea y redes sociales. Entrega en 48 horas.', 800.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/fotografia-producto-10fotos-x7y9/400/300', 'fotografia-producto-10fotos-x7y9', 'Centro Puebla', 'envio', 6, 98),

(gen_random_uuid(), v_carlos, 'Edición de video (1 min)', 'Edición profesional de video de hasta 1 minuto para redes sociales. Incluye cortes, transiciones, texto animado, música y color grading. Formato vertical u horizontal.', 500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/edicion-video-1min-z8a1/400/300', 'edicion-video-1min-z8a1', 'Centro Puebla', 'envio', 9, 130),

(gen_random_uuid(), v_carlos, 'Community manager (mensual)', 'Servicio de community manager por 1 mes para 2 redes sociales. Incluye 20 publicaciones, diseño de contenido, programación y reporte de métricas. Estrategia incluida.', 3500.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/community-manager-mensual-b9c2/400/300', 'community-manager-mensual-b9c2', 'Centro Puebla', 'envio', 4, 115),

(gen_random_uuid(), v_jorge, 'Servicio de jardinería', 'Servicio de jardinería para mantenimiento de jardín: poda, siembra, fertilización y riego. Incluye herramientas. Visita semanal de 3 horas. Plantas y tierra adicionales con costo extra.', 600.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/servicio-jardineria-d1e3/400/300', 'servicio-jardineria-d1e3', 'Atlixco', 'pickup', 6, 85),

(gen_random_uuid(), v_jorge, 'Reparación de electrodomésticos', 'Reparación de lavadoras, refrigeradores, secadoras y estufas a domicilio. Diagnóstico in situ y presupuesto sin compromiso. Refacciones originales con garantía de 3 meses.', 350.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/reparacion-electrodomesticos-f2g4/400/300', 'reparacion-electrodomesticos-f2g4', 'Atlixco', 'pickup', 5, 92),

(gen_random_uuid(), v_jorge, 'Impermeabilización de techo', 'Servicio de impermeabilización de techo con membrana acrílica de 5 años de garantía. Incluye limpieza, sellado de grietas y 2 capas de impermeabilizante. Precio por m² (mínimo 20m²).', 80.00, 'servicio', 'servicios-profesionales', 'disponible', 'https://picsum.photos/seed/impermeabilizacion-techo-h3i5/400/300', 'impermeabilizacion-techo-h3i5', 'Atlixco', 'pickup', 3, 70);

-- ===================== OTROS (Carlos + Sofía + Jorge) =====================
INSERT INTO products_services (id, creador_id, titulo, descripcion, precio, tipo, categoria, estatus, imagen_principal, slug, ubicacion, tipo_entrega, ventas_count, vistas_count)
VALUES
(gen_random_uuid(), v_carlos, 'Boletos para concierto', 'Par de boletos para concierto en el Auditorio Metropolitano de Puebla. Zona General. Fecha y artista según disponibilidad. Entrega digital inmediata por WhatsApp.', 1200.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/boletos-concierto-j4k6/400/300', 'boletos-concierto-j4k6', 'Centro Puebla', 'envio', 3, 135),

(gen_random_uuid(), v_carlos, 'Colección de comics Marvel', 'Colección de 25 comics Marvel en español: Avengers, Spider-Man y X-Men. Estado de conservación bueno a excelente. Ediciones de los años 2015-2020. Ideales para coleccionistas.', 800.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/coleccion-comics-marvel-l5m7/400/300', 'coleccion-comics-marvel-l5m7', 'Centro Puebla', 'ambos', 1, 88),

(gen_random_uuid(), v_jorge, 'Guitarra acústica', 'Guitarra acústica tipo folk con tapa de abeto y aros de caoba. Cuerdas de acero con clavijas cromadas. Sonido cálido y resonante. Incluye funda acolchada y púas.', 1800.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/guitarra-acustica-n6o8/400/300', 'guitarra-acustica-n6o8', 'Atlixco', 'pickup', 2, 105),

(gen_random_uuid(), v_sofia, 'Patines en línea talla 8', 'Patines en línea talla 8 (US) con bota acolchada y ruedas de poliuretano 82A. Freno de talón y cierre de hebilla rápida. Ideal para recreación y fitness al aire libre.', 950.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/patines-linea-talla8-p7q9/400/300', 'patines-linea-talla8-p7q9', 'San Andrés Cholula', 'pickup', 3, 78),

(gen_random_uuid(), v_sofia, 'Tienda de campaña 4 personas', 'Tienda de campaña para 4 personas tipo domo con doble capa impermeable. Montaje en 10 minutos con varillas de fibra de vidrio. Incluye bolsa de transporte y estacas.', 1200.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/tienda-campana-4personas-r8s1/400/300', 'tienda-campana-4personas-r8s1', 'San Andrés Cholula', 'ambos', 4, 115),

(gen_random_uuid(), v_sofia, 'Sleeping bag', 'Sleeping bag para temperatura de 5°C a 15°C con relleno sintético. Medidas: 220x75cm. Incluye bolsa de compresión para fácil transporte. Cierre bidireccional.', 550.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/sleeping-bag-t9u2/400/300', 'sleeping-bag-t9u2', 'San Andrés Cholula', 'ambos', 5, 92),

(gen_random_uuid(), v_sofia, 'Hamaca doble', 'Hamaca doble de algodón trenzado con capacidad para 200kg. Multicolor estilo mexicano con barras de madera. Mide 3.2m de largo. Perfecta para jardín, terraza o interior.', 450.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/hamaca-doble-v1w3/400/300', 'hamaca-doble-v1w3', 'San Andrés Cholula', 'pickup', 6, 100),

(gen_random_uuid(), v_carlos, 'Binoculares 10x50', 'Binoculares 10x50 con óptica multicapa y prisma BAK4. Visión clara y nítida con amplio campo visual. Incluyen estuche, correa y paño de limpieza. Ideales para observación de aves.', 650.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/binoculares-10x50-x2y4/400/300', 'binoculares-10x50-x2y4', 'Centro Puebla', 'ambos', 2, 65),

(gen_random_uuid(), v_sofia, 'Mochila de viaje 60L', 'Mochila de viaje de 60 litros con sistema de carga ajustable y cinturón lumbar acolchado. Múltiples compartimentos, cubierta impermeable y silbato de emergencia. Ideal para camping y trekking.', 850.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/mochila-viaje-60l-z3a5/400/300', 'mochila-viaje-60l-z3a5', 'San Andrés Cholula', 'ambos', 3, 110),

(gen_random_uuid(), v_sofia, 'Maleta de cabina', 'Maleta de cabina de 20 pulgadas con 4 ruedas giratorias 360° y candado TSA integrado. Material ABS resistente a impactos. Compartimento expandible. Cumple medidas de aerolíneas.', 1200.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/maleta-cabina-b4c6/400/300', 'maleta-cabina-b4c6', 'San Andrés Cholula', 'ambos', 4, 125),

(gen_random_uuid(), v_jorge, 'Set de pesca completo', 'Set de pesca con caña telescópica de 2.1m, carrete con línea, anzuelos, plomos, flotadores y bolsa organizadora. Ideal para principiantes. Listo para usar desde la compra.', 550.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/set-pesca-completo-d5e7/400/300', 'set-pesca-completo-d5e7', 'Atlixco', 'ambos', 5, 85),

(gen_random_uuid(), v_carlos, 'Patineta longboard', 'Patineta longboard de 42 pulgadas con deck de maple 8 capas y trucks de aluminio. Ruedas de 70mm para cruising suave. Diseño gráfico en la parte inferior. Para todas las edades.', 1500.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/patineta-longboard-f6g8/400/300', 'patineta-longboard-f6g8', 'Centro Puebla', 'pickup', 2, 95),

(gen_random_uuid(), v_sofia, 'Balón de fútbol Nike', 'Balón de fútbol Nike Flight talla 5 con tecnología Aerowsculpt. Construcción de 4 paneles para vuelo estable. Aprobado por FIFA Quality Pro. Ideal para cancha natural y sintética.', 450.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/balon-futbol-nike-h7i9/400/300', 'balon-futbol-nike-h7i9', 'San Andrés Cholula', 'ambos', 8, 130),

(gen_random_uuid(), v_sofia, 'Guantes de box 12oz', 'Guantes de box de 12oz en piel sintética con relleno de espuma de alta densidad. Cierre de velcro para fácil colocación. Ideales para entrenamiento en saco y sparring ligero.', 350.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/guantes-box-12oz-j8k1/400/300', 'guantes-box-12oz-j8k1', 'San Andrés Cholula', 'ambos', 6, 88),

(gen_random_uuid(), v_sofia, 'Raqueta de tenis', 'Raqueta de tenis de grafito con cabeza de 100 pulgadas cuadradas y peso de 280g. Encordada con tensión media. Incluye funda protectora. Para jugadores intermedios.', 750.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/raqueta-tenis-l9m2/400/300', 'raqueta-tenis-l9m2', 'San Andrés Cholula', 'ambos', 2, 72),

(gen_random_uuid(), v_sofia, 'Set de ping pong', 'Set de ping pong con 2 raquetas, 3 pelotas y red con soportes adaptables a cualquier mesa. Raquetas con goma de 5 estrellas para efecto y control. Diversión para toda la familia.', 280.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/set-ping-pong-n1o3/400/300', 'set-ping-pong-n1o3', 'San Andrés Cholula', 'ambos', 7, 82),

(gen_random_uuid(), v_carlos, 'Juego de mesa Catan', 'Juego de mesa Catan edición en español para 3-4 jugadores (expandible a 6). El clásico juego de estrategia, comercio y construcción. Componentes de alta calidad. Sellado nuevo.', 650.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/juego-mesa-catan-p2q4/400/300', 'juego-mesa-catan-p2q4', 'Centro Puebla', 'ambos', 4, 105),

(gen_random_uuid(), v_carlos, 'Consola PS4 usada', 'PlayStation 4 Slim de 1TB en excelente estado con un control original. Incluye cables de alimentación y HDMI. Firmware actualizado. Sin juegos físicos, ideal para juegos digitales.', 4500.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/consola-ps4-usada-r3s5/400/300', 'consola-ps4-usada-r3s5', 'Centro Puebla', 'ambos', 1, 175),

(gen_random_uuid(), v_carlos, 'Control extra PS4', 'Control DualShock 4 original para PS4 en color negro. Usado en buen estado con batería funcional. Compatible con PS4 y PC vía Bluetooth. Incluye cable micro USB de carga.', 650.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/control-extra-ps4-t4u6/400/300', 'control-extra-ps4-t4u6', 'Centro Puebla', 'ambos', 3, 95),

(gen_random_uuid(), v_carlos, 'Legos Star Wars 500 pzas', 'Set de Legos Star Wars de 500 piezas: Halcón Milenario versión mini. Nuevo en caja sellada con instructivo. Para mayores de 10 años. Coleccionable y para armar en familia.', 1200.00, 'producto', 'otros', 'disponible', 'https://picsum.photos/seed/legos-star-wars-500-v5w7/400/300', 'legos-star-wars-500-v5w7', 'Centro Puebla', 'ambos', 2, 140);


-- =============================================================================
-- 3. SALE CONFIRMATIONS (30)
-- =============================================================================

-- Necesitamos IDs de productos para las ventas. Usamos sub-selects.
-- Creamos las sale_confirmations con productos seleccionados al azar de cada vendedor.

-- Ventas de María (comida) - 10 ventas
INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_carlos, v_maria, p.precio, 1, 'completed', v_carlos, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_maria ORDER BY random() LIMIT 5;

INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_sofia, v_maria, p.precio, 1, 'completed', v_sofia, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_maria ORDER BY random() LIMIT 5;

-- Ventas de Carlos (tech) - 5 ventas
INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_ana, v_carlos, p.precio, 1, 'completed', v_ana, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_carlos AND p.categoria = 'tecnologia' ORDER BY random() LIMIT 5;

-- Ventas de Ana (ropa/belleza) - 5 ventas
INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_maria, v_ana, p.precio, 1, 'completed', v_maria, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_ana ORDER BY random() LIMIT 5;

-- Ventas de Sofía (hogar/mascotas) - 3 ventas
INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_jorge, v_sofia, p.precio, 1, 'completed', v_jorge, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_sofia ORDER BY random() LIMIT 3;

-- Ventas de Jorge (servicios) - 2 ventas
INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_maria, v_jorge, p.precio, 1, 'completed', v_maria, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_jorge ORDER BY random() LIMIT 2;

-- Ventas cruzadas adicionales para llegar a 30
INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_jorge, v_carlos, p.precio, 1, 'completed', v_jorge, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_carlos ORDER BY random() LIMIT 3;

INSERT INTO sale_confirmations (id, product_id, buyer_id, seller_id, precio_acordado, cantidad, status, initiated_by, buyer_confirmed, seller_confirmed, completed_at)
SELECT gen_random_uuid(), p.id, v_carlos, v_sofia, p.precio, 1, 'completed', v_carlos, true, true, NOW() - (floor(random()*60) || ' days')::interval
FROM products_services p WHERE p.creador_id = v_sofia ORDER BY random() LIMIT 2;

-- =============================================================================
-- 4. REVIEWS (50)
-- =============================================================================

-- buyer_to_seller reviews (35)
INSERT INTO reviews (id, sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, visible)
SELECT
  gen_random_uuid(),
  sc.id,
  sc.product_id,
  sc.buyer_id,
  sc.seller_id,
  'buyer_to_seller',
  CASE (row_number() OVER (ORDER BY random())) % 10
    WHEN 0 THEN 3
    WHEN 1 THEN 4
    WHEN 2 THEN 5
    WHEN 3 THEN 5
    WHEN 4 THEN 4
    WHEN 5 THEN 5
    WHEN 6 THEN 5
    WHEN 7 THEN 4
    WHEN 8 THEN 5
    WHEN 9 THEN 5
  END,
  CASE (row_number() OVER (ORDER BY random())) % 25
    WHEN 0 THEN 'Excelente producto, tal cual la descripción. Muy satisfecho con mi compra.'
    WHEN 1 THEN 'Muy buena atención, recomendado al 100%. Volveré a comprar sin duda.'
    WHEN 2 THEN 'Entrega rápida y producto en perfectas condiciones. Todo excelente.'
    WHEN 3 THEN 'Buena comunicación, todo bien. El vendedor fue muy amable y atento.'
    WHEN 4 THEN 'El producto llegó bien empacado y en el tiempo acordado. Recomendable.'
    WHEN 5 THEN 'Súper recomendable, volveré a comprar. La calidad superó mis expectativas.'
    WHEN 6 THEN 'Muy amable el vendedor, gracias por todo. Excelente experiencia de compra.'
    WHEN 7 THEN 'Todo perfecto, exactamente lo que esperaba. No le cambiaría nada.'
    WHEN 8 THEN 'Buen precio y calidad. Definitivamente una compra inteligente.'
    WHEN 9 THEN 'La entrega fue puntual y el producto excelente. Muy profesional.'
    WHEN 10 THEN 'Me encantó, justo lo que necesitaba. La descripción es muy precisa.'
    WHEN 11 THEN 'Vendedor confiable y honesto. Producto tal cual las fotos.'
    WHEN 12 THEN 'Increíble relación calidad-precio. Mejor de lo que esperaba.'
    WHEN 13 THEN 'Producto en excelente estado, muy contento con la compra.'
    WHEN 14 THEN 'Rápido y sin problemas. Así deberían ser todas las compras.'
    WHEN 15 THEN 'Bueno, pero tardó un poco más de lo esperado. El producto sí es bueno.'
    WHEN 16 THEN 'Muy recomendable, la atención al cliente es de primera.'
    WHEN 17 THEN 'El producto es de muy buena calidad y el precio es justo.'
    WHEN 18 THEN 'Excelente compra, me llegó antes de lo esperado. Gracias!'
    WHEN 19 THEN 'Todo genial, empaque cuidadoso y bonita presentación.'
    WHEN 20 THEN 'El vendedor resolvió todas mis dudas antes de comprar. Muy profesional.'
    WHEN 21 THEN 'Quedé muy satisfecha, el producto es tal cual se describe.'
    WHEN 22 THEN 'Lo recomiendo ampliamente, es justo lo que buscaba.'
    WHEN 23 THEN 'Perfecto para lo que lo necesitaba. Buena compra y buen vendedor.'
    WHEN 24 THEN 'La verdad superó mis expectativas. Gracias por la atención.'
  END,
  true
FROM sale_confirmations sc
ORDER BY random()
LIMIT 35;

-- seller_to_buyer reviews (15)
INSERT INTO reviews (id, sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, visible)
SELECT
  gen_random_uuid(),
  sc.id,
  sc.product_id,
  sc.seller_id,
  sc.buyer_id,
  'seller_to_buyer',
  CASE (row_number() OVER (ORDER BY random())) % 5
    WHEN 0 THEN 5
    WHEN 1 THEN 5
    WHEN 2 THEN 4
    WHEN 3 THEN 5
    WHEN 4 THEN 4
  END,
  CASE (row_number() OVER (ORDER BY random())) % 15
    WHEN 0 THEN 'Excelente comprador, pago puntual y buena comunicación.'
    WHEN 1 THEN 'Muy amable y respetuoso. Fue un gusto hacer negocio.'
    WHEN 2 THEN 'Comprador serio y cumplido. Recomendado para cualquier vendedor.'
    WHEN 3 THEN 'Todo perfecto, llegó puntual a recoger y fue muy atento.'
    WHEN 4 THEN 'Buena experiencia, comprador confiable y de trato fácil.'
    WHEN 5 THEN 'Pago inmediato y buena comunicación durante todo el proceso.'
    WHEN 6 THEN 'Excelente trato, comprador muy educado y cumplido.'
    WHEN 7 THEN 'Persona seria y respetuosa. Transacción sin ningún problema.'
    WHEN 8 THEN 'Muy buen comprador, espero que regrese pronto.'
    WHEN 9 THEN 'Todo fluyó muy bien, comprador recomendado al 100%.'
    WHEN 10 THEN 'Comprador amable y con buena disposición. Gracias.'
    WHEN 11 THEN 'Trato excelente, se nota que es persona de confianza.'
    WHEN 12 THEN 'Sin problemas, transacción rápida y segura. Recomendado.'
    WHEN 13 THEN 'Muy puntual y respetuoso con los acuerdos. Gracias.'
    WHEN 14 THEN 'Buen comprador, ojalá todos fueran así. Recomendado.'
  END,
  true
FROM sale_confirmations sc
ORDER BY random()
LIMIT 15;

END $$;

-- =============================================================================
-- 5. Re-habilitar triggers
-- =============================================================================
ALTER TABLE reviews ENABLE TRIGGER USER;
ALTER TABLE sale_confirmations ENABLE TRIGGER USER;
ALTER TABLE products_services ENABLE TRIGGER USER;
ALTER TABLE profiles ENABLE TRIGGER USER;

-- Verificar conteos
SELECT 'profiles' AS tabla, COUNT(*) AS total FROM profiles WHERE email LIKE '%@demo.vicino.mx'
UNION ALL
SELECT 'products_services', COUNT(*) FROM products_services
UNION ALL
SELECT 'sale_confirmations', COUNT(*) FROM sale_confirmations
UNION ALL
SELECT 'reviews', COUNT(*) FROM reviews;
