-- =============================================================================
-- VICINO Marketplace — Seed v2 (demo MVP realista para Puebla, MX)
-- =============================================================================
-- 30 vendedores con nombres de negocio reales (taquerías, plomeros, estéticas,
-- contadores, etc.) + 15 compradores + ~240 productos/servicios distribuidos
-- en las 14 categorías que cubrimos + ~120 ventas confirmadas + ~80 reviews +
-- ~50 favorites. Coordenadas distribuidas en colonias reales de Puebla.
--
-- Prerrequisito: correr cleanup.sql antes para dejar la BD limpia preservando
-- admins/moderators (ver supabase/cleanup.sql).
--
-- Imágenes: URLs de loremflickr con tags temáticos (taquería, mexicano, etc.)
-- y avatars de pravatar.cc. No se sube nada al bucket product-media — los URLs
-- son externos. Si loremflickr falla a futuro, swap a picsum.photos/seed/X.
--
-- Login fake: cualquier email @demo.vicino.mx con password "demo12345".
-- =============================================================================

BEGIN;

-- =============================================================================
-- DESACTIVAR TRIGGERS — evitar side-effects durante el bulk insert
-- =============================================================================
ALTER TABLE products_services DISABLE TRIGGER USER;
ALTER TABLE sale_confirmations DISABLE TRIGGER USER;
ALTER TABLE reviews DISABLE TRIGGER USER;

-- =============================================================================
-- 1. TEMP TABLES (auto-drop al COMMIT)
-- =============================================================================
CREATE TEMP TABLE _seed_vendors (
  email                TEXT PRIMARY KEY,
  uuid                 UUID NOT NULL DEFAULT gen_random_uuid(),
  nombre               TEXT NOT NULL,
  nombre_negocio       TEXT NOT NULL,
  descripcion_negocio  TEXT NOT NULL,
  bio                  TEXT NOT NULL,
  categoria_negocio    TEXT NOT NULL,
  trust_level          trust_level NOT NULL,
  trust_points         INTEGER NOT NULL,
  ubicacion            TEXT NOT NULL,
  lat                  DOUBLE PRECISION NOT NULL,
  lng                  DOUBLE PRECISION NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _seed_buyers (
  email     TEXT PRIMARY KEY,
  uuid      UUID NOT NULL DEFAULT gen_random_uuid(),
  nombre    TEXT NOT NULL,
  ubicacion TEXT NOT NULL,
  lat       DOUBLE PRECISION NOT NULL,
  lng       DOUBLE PRECISION NOT NULL
) ON COMMIT DROP;

CREATE TEMP TABLE _seed_products (
  vendor_email   TEXT NOT NULL,
  titulo         TEXT NOT NULL,
  descripcion    TEXT NOT NULL,
  precio         DECIMAL(10,2) NOT NULL,
  tipo           listing_type NOT NULL,
  categoria      TEXT NOT NULL,
  img_tags       TEXT NOT NULL,
  tipo_entrega   TEXT NOT NULL,
  uuid           UUID NOT NULL DEFAULT gen_random_uuid(),
  ord            INTEGER NOT NULL GENERATED ALWAYS AS IDENTITY
) ON COMMIT DROP;

-- =============================================================================
-- 2. VENDEDORES (30)
-- =============================================================================
INSERT INTO _seed_vendors (email, nombre, nombre_negocio, descripcion_negocio, bio, categoria_negocio, trust_level, trust_points, ubicacion, lat, lng) VALUES
-- Comida (5)
('taqueria-dona-mari@demo.vicino.mx', 'María García', 'Taquería Doña Mari', 'Tacos al pastor, suadero y campechanos al carbón con receta familiar.', 'Doña Mari, 25 años haciendo los mejores tacos del barrio. Atendemos pedidos para fiestas.', 'comida', 'estrella', 520, 'La Paz', 19.0432, -98.1980),
('tortilleria-el-sol@demo.vicino.mx', 'José Ramírez', 'Tortillería El Sol', 'Tortillas de maíz nixtamalizado hechas a diario en comal con maíz criollo.', 'Tercera generación de tortilleros. Maíz directo del productor en Atlixco.', 'comida', 'confiable', 280, 'Centro Histórico', 19.0510, -98.2070),
('antojitos-la-esquina@demo.vicino.mx', 'Lucía Hernández', 'Antojitos La Esquina', 'Cemitas, chalupas y molotes recién hechos. Receta poblana original.', 'Negocio familiar desde 1992. Atendemos en local y a domicilio en zona centro.', 'comida', 'verificado', 150, 'Centro Histórico', 19.0388, -98.2018),
('cafe-mestizo@demo.vicino.mx', 'Pablo Sánchez', 'Café Mestizo', 'Café de altura de Veracruz tostado en casa, pastelería artesanal y desayunos.', 'Tostador certificado SCA. El café que servimos lo tostamos cada semana.', 'comida', 'elite', 880, 'Angelópolis', 19.0492, -98.2275),
('panaderia-la-espiga@demo.vicino.mx', 'Carmen Vázquez', 'Panadería La Espiga', 'Pan dulce mexicano horneado en horno de leña, bollería y pasteles.', 'Maestra panadera con 30 años en el oficio. Conchas y cuernos como los de la abuela.', 'comida', 'estrella', 460, 'La Libertad', 19.0561, -98.1893),
-- Ropa (3)
('boutique-mestiza@demo.vicino.mx', 'Daniela Torres', 'Boutique Mestiza', 'Ropa contemporánea con bordados artesanales hecha en México por mujeres.', 'Curamos diseñadoras mexicanas independientes. Tallas inclusivas y comercio justo.', 'ropa', 'confiable', 310, 'El Carmen', 19.0467, -98.2210),
('sastreria-don-pedro@demo.vicino.mx', 'Pedro Aguilar', 'Sastrería Don Pedro', 'Trajes a la medida y arreglos de ropa. 40 años de oficio en el centro.', 'Sastre tradicional. Hago trajes de novio, graduación y ejecutivos.', 'ropa', 'estrella', 590, 'Centro Histórico', 19.0426, -98.2003),
('bordados-atlixco@demo.vicino.mx', 'Rosa Martínez', 'Bordados Atlixco', 'Blusas y vestidos bordados a mano por artesanas de Atlixco. Diseños únicos.', 'Cooperativa de 12 bordadoras de Atlixco. Comercio justo y trabajo digno.', 'ropa', 'confiable', 270, 'Reforma', 19.0590, -98.2390),
-- Tecnología (2)
('tecnopuebla-reparaciones@demo.vicino.mx', 'Ricardo Mendoza', 'TecnoPuebla Reparaciones', 'Reparación de celulares, laptops y consolas con refacciones originales.', 'Técnico certificado Samsung y Apple. Garantía de 90 días en todas las reparaciones.', 'tecnologia', 'estrella', 450, 'Centro Histórico', 19.0410, -98.1985),
('cell-fix-express@demo.vicino.mx', 'Andrea Reyes', 'Cell-Fix Express', 'Cambio de pantallas y baterías en 30 minutos. Diagnóstico gratis.', 'Servicio express en plaza comercial. Pantallas con garantía de 6 meses.', 'tecnologia', 'confiable', 230, 'Angelópolis', 19.0488, -98.2155),
-- Muebles (1)
('carpinteria-hermanos-perez@demo.vicino.mx', 'Roberto Pérez', 'Carpintería Hermanos Pérez', 'Muebles a la medida en madera de cedro y pino, restauración de antigüedades.', 'Taller familiar de tres hermanos. Trabajamos cedro, parota, encino y pino.', 'muebles', 'estrella', 610, 'La Libertad', 19.0625, -98.1980),
-- Hogar (2)
('decoracion-aurora@demo.vicino.mx', 'Aurora Domínguez', 'Decoración Aurora', 'Detalles decorativos para casa: cojines, cuadros y lámparas con estilo cálido.', 'Interiorista. Selecciono piezas únicas de artesanos locales y hago entregas con instalación.', 'hogar', 'confiable', 195, 'Angelópolis', 19.0395, -98.2245),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Isabel Cruz', 'Plantas y Jardín El Edén', 'Plantas de interior y exterior, macetas, sustratos. Asesoría gratuita.', 'Bióloga apasionada por las plantas. Te ayudo a elegir la planta correcta para tu espacio.', 'hogar', 'verificado', 135, 'Reforma', 19.0680, -98.2030),
-- Belleza (3)
('estetica-glow@demo.vicino.mx', 'Mariana Salas', 'Estética Glow', 'Corte, color y peinados para mujer con productos profesionales.', 'Colorista certificada Wella. 12 años transformando cabello en Puebla.', 'belleza', 'elite', 940, 'Angelópolis', 19.0455, -98.2110),
('barberia-cholula@demo.vicino.mx', 'Iván Ruiz', 'Barbería Cholula', 'Cortes clásicos y modernos para caballero, afeitado con navaja.', 'Barbero tradicional formado en CDMX. Ambiente relajado y café gratis.', 'belleza', 'estrella', 520, 'Cholula', 19.0625, -98.2980),
('unas-by-sofi@demo.vicino.mx', 'Sofía Jiménez', 'Uñas by Sofi', 'Manicure, pedicure y uñas acrílicas con diseños personalizados.', 'Nail artist. Atiendo en mi estudio o a domicilio. Diseños desde clásicos hasta nail art.', 'belleza', 'confiable', 285, 'La Paz', 19.0530, -98.2065),
-- Salud (1)
('consultorio-dental-mendez@demo.vicino.mx', 'Patricia Méndez', 'Consultorio Dental Dra. Méndez', 'Odontología general y estética: limpiezas, blanqueamientos, ortodoncia.', 'Cirujana dentista (UPAEP). Atención en consultorio con todas las medidas de higiene.', 'salud', 'verificado', 180, 'El Carmen', 19.0440, -98.2150),
-- Mascotas (2)
('vet-patitas-felices@demo.vicino.mx', 'Lorena Acosta', 'Veterinaria Patitas Felices', 'Consultas, vacunas, cirugías y estética canina. Servicio a domicilio.', 'MVZ con especialidad en pequeñas especies. Atención de emergencia 24h.', 'mascotas', 'estrella', 640, 'La Paz', 19.0510, -98.1932),
('estetica-canina-cholula@demo.vicino.mx', 'Marisol Pacheco', 'Estética Canina Cholula', 'Baño, corte y spa para perros y gatos de todas las razas.', 'Estilista canina certificada. Productos hipoalergénicos y trato amoroso.', 'mascotas', 'confiable', 310, 'Cholula', 19.0640, -98.3010),
-- Servicios del hogar (3)
('cerrajeria-24h-puebla@demo.vicino.mx', 'Ernesto Salinas', 'Cerrajería 24h Puebla', 'Apertura de cerraduras, copias de llaves, instalación. Servicio nocturno.', 'Cerrajero certificado con 18 años de experiencia. Atendemos emergencias 24/7.', 'servicios-hogar', 'estrella', 490, 'Centro Histórico', 19.0470, -98.2080),
('plomeria-don-beto@demo.vicino.mx', 'Alberto Castillo', 'Plomería Don Beto', 'Reparación de fugas, drenajes y calentadores. Cotización sin compromiso.', 'Plomero con 22 años de experiencia. Atiendo emergencias el mismo día.', 'servicios-hogar', 'confiable', 265, 'La Paz', 19.0395, -98.1948),
('electricidad-don-tono@demo.vicino.mx', 'Antonio Méndez', 'Electricidad Don Toño', 'Instalaciones eléctricas, fallas y paneles solares. Electricista certificado.', 'Técnico electricista (CFE). Hago instalaciones residenciales y comerciales.', 'servicios-hogar', 'verificado', 155, 'El Carmen', 19.0550, -98.2200),
-- Educación (2)
('ingles-profe-karla@demo.vicino.mx', 'Karla Estrada', 'Inglés con Profe Karla', 'Clases particulares y grupales de inglés, todos los niveles, online y presencial.', 'Profesora certificada TOEFL/IELTS. 8 años enseñando a jóvenes y adultos.', 'educacion', 'confiable', 290, 'Angelópolis', 19.0438, -98.2180),
('tutorias-matematicas-puebla@demo.vicino.mx', 'Hugo Romero', 'Tutorías Matemáticas Puebla', 'Asesoría en matemáticas, física y química, secundaria a universidad.', 'Maestro en física (BUAP). Preparo alumnos para exámenes de admisión.', 'educacion', 'verificado', 175, 'La Libertad', 19.0510, -98.2245),
-- Eventos (2)
('banquetes-la-reyna@demo.vicino.mx', 'Yolanda Pacheco', 'Banquetes La Reyna', 'Banquetes para bodas, XV años y eventos corporativos. Mínimo 50 personas.', 'Chef y catering con 15 años de experiencia. Menús personalizados con productos locales.', 'eventos', 'estrella', 570, 'Reforma', 19.0570, -98.2350),
('dj-tornamesa@demo.vicino.mx', 'Marco Quintero', 'DJ Tornamesa', 'Animación musical para fiestas, bodas y eventos con equipo profesional propio.', 'DJ con 10 años amenizando eventos. Repertorio amplio: cumbia, pop, electrónica.', 'eventos', 'confiable', 310, 'Centro Histórico', 19.0420, -98.2110),
-- Transporte (1)
('mudanzas-express-puebla@demo.vicino.mx', 'Sergio Lara', 'Mudanzas Express Puebla', 'Mudanzas locales y foráneas con camionetas 3.5 ton y cargadores capacitados.', 'Empresa familiar de mudanzas. Embalamos, transportamos y armamos en destino.', 'transporte', 'confiable', 245, 'La Libertad', 19.0680, -98.1850),
-- Empleos/profesionales (2)
('contador-vazquez@demo.vicino.mx', 'Fernando Vázquez', 'Contador Público Lic. Vázquez', 'Contabilidad, declaraciones, asesoría fiscal y nómina para PYMEs.', 'Contador Público (BUAP). Asesoría fiscal para emprendedores y micronegocios.', 'empleos', 'estrella', 520, 'Angelópolis', 19.0445, -98.2055),
('asesoria-legal-sanchez@demo.vicino.mx', 'Beatriz Sánchez', 'Asesoría Legal Sánchez', 'Derecho civil, familiar y laboral. Consulta inicial gratuita.', 'Abogada (BUAP) especialista en derecho familiar. Trato cercano y honorarios justos.', 'empleos', 'confiable', 285, 'El Carmen', 19.0480, -98.2095),
-- Otros (1)
('servicios-varios-don-juan@demo.vicino.mx', 'Juan Pedro Mora', 'Servicios Varios Don Juan', 'Pintura, albañilería, jardinería y podas. Para tu casa o negocio.', 'Mil oficios desde hace 20 años. Lo que necesites en casa, yo te lo arreglo.', 'otros', 'verificado', 125, 'La Libertad', 19.0625, -98.1815);

-- =============================================================================
-- 3. COMPRADORES (15)
-- =============================================================================
INSERT INTO _seed_buyers (email, nombre, ubicacion, lat, lng) VALUES
('alejandro.gomez@demo.vicino.mx', 'Alejandro Gómez', 'La Paz', 19.0450, -98.1995),
('valentina.cruz@demo.vicino.mx', 'Valentina Cruz', 'Angelópolis', 19.0470, -98.2200),
('mateo.hernandez@demo.vicino.mx', 'Mateo Hernández', 'Centro Histórico', 19.0420, -98.2020),
('camila.ortega@demo.vicino.mx', 'Camila Ortega', 'Cholula', 19.0630, -98.2990),
('diego.ramos@demo.vicino.mx', 'Diego Ramos', 'El Carmen', 19.0460, -98.2140),
('natalia.flores@demo.vicino.mx', 'Natalia Flores', 'La Libertad', 19.0570, -98.1900),
('adrian.vega@demo.vicino.mx', 'Adrián Vega', 'Reforma', 19.0580, -98.2370),
('renata.castro@demo.vicino.mx', 'Renata Castro', 'Angelópolis', 19.0490, -98.2180),
('sebastian.nunez@demo.vicino.mx', 'Sebastián Núñez', 'La Paz', 19.0440, -98.1970),
('luna.aguirre@demo.vicino.mx', 'Luna Aguirre', 'Centro Histórico', 19.0400, -98.2010),
('tomas.cabrera@demo.vicino.mx', 'Tomás Cabrera', 'Cholula', 19.0640, -98.3000),
('emilia.solis@demo.vicino.mx', 'Emilia Solís', 'El Carmen', 19.0455, -98.2130),
('bruno.espinoza@demo.vicino.mx', 'Bruno Espinoza', 'La Libertad', 19.0590, -98.1910),
('regina.soto@demo.vicino.mx', 'Regina Soto', 'Reforma', 19.0600, -98.2380),
('maximiliano.vargas@demo.vicino.mx', 'Maximiliano Vargas', 'Angelópolis', 19.0500, -98.2220);

-- =============================================================================
-- 4. CREAR auth.users (trigger handle_new_user auto-crea profiles vacíos)
-- =============================================================================
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, raw_app_meta_data, raw_user_meta_data)
SELECT
  uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  email,
  crypt('demo12345', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', nombre)
FROM _seed_vendors;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, raw_app_meta_data, raw_user_meta_data)
SELECT
  uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  email,
  crypt('demo12345', gen_salt('bf')),
  NOW(),
  NOW(),
  NOW(),
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', nombre)
FROM _seed_buyers;

-- =============================================================================
-- 5. POBLAR PROFILES (handle_new_user trigger ya creó las filas básicas)
-- =============================================================================
UPDATE profiles p SET
  foto = 'https://i.pravatar.cc/300?u=' || sv.email,
  bio = sv.bio,
  es_vendedor = TRUE,
  nombre_negocio = sv.nombre_negocio,
  descripcion_negocio = sv.descripcion_negocio,
  categoria_negocio = sv.categoria_negocio,
  metodos_pago_aceptados = 'Efectivo, Transferencia',
  trust_level = sv.trust_level,
  trust_points = sv.trust_points,
  is_verified = TRUE,
  verified_at = NOW() - (floor(random()*180) || ' days')::interval,
  ubicacion = sv.ubicacion,
  ubicacion_lat = sv.lat,
  ubicacion_lng = sv.lng,
  telefono = '222' || lpad(floor(random() * 10000000)::text, 7, '0')
FROM _seed_vendors sv
WHERE p.id = sv.uuid;

UPDATE profiles p SET
  foto = 'https://i.pravatar.cc/300?u=' || sb.email,
  es_vendedor = FALSE,
  ubicacion = sb.ubicacion,
  ubicacion_lat = sb.lat,
  ubicacion_lng = sb.lng,
  telefono = '222' || lpad(floor(random() * 10000000)::text, 7, '0')
FROM _seed_buyers sb
WHERE p.id = sb.uuid;

-- =============================================================================
-- 6. PRODUCTOS Y SERVICIOS (~240)
-- =============================================================================
INSERT INTO _seed_products (vendor_email, titulo, descripcion, precio, tipo, categoria, img_tags, tipo_entrega) VALUES
-- ===== Taquería Doña Mari (comida) =====
('taqueria-dona-mari@demo.vicino.mx', 'Orden de 10 tacos al pastor', 'Tacos al pastor con piña, cilantro y cebolla. Tortilla hecha a mano. Marinado de 24 horas.', 130.00, 'producto', 'comida', 'tacos,pastor,mexicano', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Quesadilla de flor de calabaza', 'Quesadilla grande con flor de calabaza fresca, queso Oaxaca y epazote. Tortilla azul.', 55.00, 'producto', 'comida', 'quesadilla,mexicano,comida', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Suadero por kilo', 'Kilo de suadero al carbón. Incluye tortillas, salsas, cebolla y cilantro para 6 personas.', 320.00, 'producto', 'comida', 'suadero,carne,mexicano', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Campechano (orden de 6)', '6 tacos campechanos de pastor + suadero. Receta de la casa con chicharrón crujiente.', 90.00, 'producto', 'comida', 'tacos,campechano,mexicano', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Gringa de pastor', 'Gringa de pastor con queso gratinado entre dos tortillas de harina. Piña al gusto.', 75.00, 'producto', 'comida', 'gringa,pastor,quesadilla', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Cecina enchilada (200g)', 'Cecina enchilada con chile pasilla y especias. Lista para freír. Incluye salsa borracha.', 95.00, 'producto', 'comida', 'cecina,mexicano,carne', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Salsa verde casera (250ml)', 'Salsa verde de tomatillo asado con chile serrano y cilantro. Receta de Doña Mari.', 35.00, 'producto', 'comida', 'salsa,mexicano,picante', 'punto_encuentro'),
('taqueria-dona-mari@demo.vicino.mx', 'Combo familiar para 6', '20 tacos surtidos, 1L de agua de jamaica, salsas y guacamole. Perfecto para reunión.', 350.00, 'producto', 'comida', 'tacos,combo,mexicano', 'punto_encuentro'),
-- ===== Tortillería El Sol (comida) =====
('tortilleria-el-sol@demo.vicino.mx', 'Kilo de tortillas de maíz', 'Tortillas recién hechas de maíz nixtamalizado. Calientes y aromáticas.', 28.00, 'producto', 'comida', 'tortillas,maiz,mexicano', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Tlayuda oaxaqueña', 'Tlayuda grande de 30cm. Lista para asar con tasajo, frijol y queso quesillo.', 45.00, 'producto', 'comida', 'tlayuda,oaxaca,mexicano', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Memelas (3 piezas)', 'Memelas hechas a mano con manteca y frijol refrito. Ideales para desayuno.', 30.00, 'producto', 'comida', 'memela,mexicano,desayuno', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Totopos artesanales (500g)', 'Totopos crujientes hechos con tortillas de maíz horneadas. Sin conservadores.', 65.00, 'producto', 'comida', 'totopos,maiz,mexicano', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Masa para tamales (1kg)', 'Masa fresca lista para hacer tamales. Mezclada con manteca y caldo. Receta tradicional.', 50.00, 'producto', 'comida', 'masa,tamales,mexicano', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Tortillas azules de maíz', 'Tortillas de maíz azul criollo. Mas ricas en antioxidantes. Kilo.', 45.00, 'producto', 'comida', 'tortillas,maiz,azul', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Sopes crudos (10 piezas)', 'Sopes de masa listos para freír. Solo necesitas agregar frijol, salsa y queso.', 40.00, 'producto', 'comida', 'sopes,mexicano,masa', 'punto_encuentro'),
('tortilleria-el-sol@demo.vicino.mx', 'Atole de maíz nuevo (1L)', 'Atole tradicional de maíz nuevo con canela. Caliente, recién hecho.', 45.00, 'producto', 'comida', 'atole,maiz,mexicano', 'punto_encuentro'),
-- ===== Antojitos La Esquina (comida) =====
('antojitos-la-esquina@demo.vicino.mx', 'Cemita poblana de milanesa', 'Cemita tradicional con milanesa, papalo, aguacate, quesillo, jamón y chipotle.', 75.00, 'producto', 'comida', 'cemita,poblano,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Cemita de pollo', 'Cemita con pollo deshebrado, frijol, aguacate, papalo y queso. Receta de la casa.', 70.00, 'producto', 'comida', 'cemita,pollo,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Chalupas (4 piezas)', '4 chalupas tradicionales con salsa verde y roja, carne deshebrada y cebolla.', 80.00, 'producto', 'comida', 'chalupa,poblano,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Molotes de tinga (5pz)', '5 molotes rellenos de tinga de pollo. Tortilla doblada y frita, super crujientes.', 90.00, 'producto', 'comida', 'molote,tinga,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Pelona poblana', 'Pelona crujiente con pierna deshebrada, lechuga, crema y queso fresco.', 85.00, 'producto', 'comida', 'pelona,poblano,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Tacos placeros surtidos (6pz)', '6 tacos surtidos: bistec, longaniza, cecina y pollo. Tortilla hecha a mano.', 95.00, 'producto', 'comida', 'tacos,placero,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Quesadilla de huitlacoche', 'Quesadilla grande de huitlacoche con queso Oaxaca y epazote. Manjar mexicano.', 55.00, 'producto', 'comida', 'quesadilla,huitlacoche,mexicano', 'punto_encuentro'),
('antojitos-la-esquina@demo.vicino.mx', 'Caldo tlalpeño', 'Caldo tlalpeño con pollo, garbanzo, aguacate y chipotle. Para 1 persona.', 95.00, 'producto', 'comida', 'sopa,caldo,mexicano', 'punto_encuentro'),
-- ===== Café Mestizo (comida) =====
('cafe-mestizo@demo.vicino.mx', 'Café americano grande', 'Café americano (350ml) de grano de Veracruz tostado en casa.', 45.00, 'producto', 'comida', 'cafe,americano,bebida', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Latte de vainilla', 'Latte con espresso doble, leche entera vaporizada y jarabe de vainilla.', 60.00, 'producto', 'comida', 'latte,cafe,bebida', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Cappuccino artesanal', 'Cappuccino con espuma firme y arte latte. Servido en taza de cerámica.', 55.00, 'producto', 'comida', 'cappuccino,cafe,bebida', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Pan francés con frutas', 'Pan francés con plátano, fresa, miel de maple y crema. Desayuno completo.', 110.00, 'producto', 'comida', 'desayuno,pan,frutas', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Chilaquiles verdes con pollo', 'Chilaquiles verdes con pollo deshebrado, crema, queso fresco y cebolla.', 110.00, 'producto', 'comida', 'chilaquiles,mexicano,desayuno', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Concha rellena de nata', 'Concha esponjosa rellena de nata fresca. Tradición mexicana modernizada.', 35.00, 'producto', 'comida', 'concha,pan,mexicano', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Brownie de chocolate', 'Brownie casero con chocolate belga y nuez. Textura suave por dentro.', 50.00, 'producto', 'comida', 'brownie,postre,chocolate', 'punto_encuentro'),
('cafe-mestizo@demo.vicino.mx', 'Bolsa de café molido 250g', 'Café 100% arábica de Veracruz molido para cafetera. Tueste medio.', 180.00, 'producto', 'comida', 'cafe,grano,bebida', 'punto_encuentro'),
-- ===== Panadería La Espiga (comida) =====
('panaderia-la-espiga@demo.vicino.mx', 'Concha grande', 'Concha grande tradicional con cubierta de vainilla o chocolate.', 18.00, 'producto', 'comida', 'concha,pan,mexicano', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Cuerno con crema', 'Cuerno horneado relleno de crema pastelera fresca. Endulzado con azúcar.', 28.00, 'producto', 'comida', 'cuerno,pan,postre', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Bolillos (5 piezas)', 'Bolillos recién horneados con corteza crujiente y migaña suave.', 25.00, 'producto', 'comida', 'bolillo,pan,mexicano', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Pan dulce surtido (12pz)', '12 piezas variadas: conchas, orejas, polvorones, cocoles y empanadas.', 120.00, 'producto', 'comida', 'pan,dulce,mexicano', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Rosca de reyes mediana', 'Rosca tradicional para 8 personas con figuras de niño Dios incluidas.', 240.00, 'producto', 'comida', 'rosca,reyes,pan', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Pastel para 12 personas', 'Pastel de 3 leches o chocolate. Decorado al gusto. Encarga con 24h.', 480.00, 'producto', 'comida', 'pastel,cumpleanos,postre', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Galletas de mantequilla (250g)', 'Galletas caseras de mantequilla. Crujientes y aromáticas. Para regalo o consumo.', 85.00, 'producto', 'comida', 'galletas,postre,mantequilla', 'punto_encuentro'),
('panaderia-la-espiga@demo.vicino.mx', 'Empanada de piña (6pz)', '6 empanadas de hojaldre rellenas de piña con canela. Recién horneadas.', 75.00, 'producto', 'comida', 'empanada,pan,postre', 'punto_encuentro'),
-- ===== Boutique Mestiza (ropa) =====
('boutique-mestiza@demo.vicino.mx', 'Blusa bordada Tehuacán', 'Blusa de manta con bordado de pájaros y flores hecho por artesanas tehuacaneras.', 480.00, 'producto', 'ropa', 'blusa,bordado,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Falda de manta con bordado', 'Falda larga de manta blanca con grecas bordadas en hilo de algodón.', 580.00, 'producto', 'ropa', 'falda,bordado,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Rebozo de seda', 'Rebozo tradicional de seda con flecos. Colores tinta, vino y mostaza.', 750.00, 'producto', 'ropa', 'rebozo,seda,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Vestido boho mexicano', 'Vestido midi con bordado en escote y mangas anchas. Tallas S a XL.', 720.00, 'producto', 'ropa', 'vestido,boho,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Bolsa tejida palma', 'Bolsa tejida a mano en palma con asas de cuero. Capacidad para diario.', 380.00, 'producto', 'ropa', 'bolsa,palma,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Huaraches piteados', 'Huaraches de piel pita con suela de hule reciclado. Tallas 22-27.', 450.00, 'producto', 'ropa', 'huaraches,piel,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Aretes filigrana plata', 'Aretes de plata 925 con técnica de filigrana de Yalalag, Oaxaca.', 290.00, 'producto', 'ropa', 'aretes,plata,artesanal', 'punto_encuentro'),
('boutique-mestiza@demo.vicino.mx', 'Chal de lana telar', 'Chal de lana virgen tejido en telar de cintura. Diseño zapoteca.', 850.00, 'producto', 'ropa', 'chal,lana,artesanal', 'punto_encuentro'),
-- ===== Sastrería Don Pedro (ropa) =====
('sastreria-don-pedro@demo.vicino.mx', 'Traje a la medida (casimir)', 'Traje completo dos piezas en casimir italiano. Saco y pantalón a la medida.', 6500.00, 'servicio', 'ropa', 'traje,sastre,formal', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Camisa de vestir a la medida', 'Camisa de algodón egipcio a la medida. Cuello, puños y largo personalizados.', 950.00, 'servicio', 'ropa', 'camisa,sastre,formal', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Arreglo de pantalón', 'Ajuste de largo, cintura o tiro. Incluye basta nueva en menos de 48 horas.', 120.00, 'servicio', 'ropa', 'arreglo,sastre,pantalon', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Reparación de cierre', 'Cambio de cierre en pantalón, chamarra o falda. Garantía de 3 meses.', 180.00, 'servicio', 'ropa', 'arreglo,sastre,cierre', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Chaleco formal a la medida', 'Chaleco para complemento de traje. Tela y forro a elegir.', 1200.00, 'servicio', 'ropa', 'chaleco,sastre,formal', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Pantalón de vestir', 'Pantalón corte clásico en tela tropical. Tallas y largo a la medida.', 1400.00, 'servicio', 'ropa', 'pantalon,sastre,formal', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Saco sport a la medida', 'Saco sport en lino o casimir ligero. Forrado, con bolsillos a la medida.', 3800.00, 'servicio', 'ropa', 'saco,sastre,formal', 'punto_encuentro'),
('sastreria-don-pedro@demo.vicino.mx', 'Modificación de saco', 'Ajuste de talla en saco existente. Hombros, mangas o cintura.', 350.00, 'servicio', 'ropa', 'arreglo,sastre,saco', 'punto_encuentro'),
-- ===== Bordados Atlixco (ropa) =====
('bordados-atlixco@demo.vicino.mx', 'Blusa bordada flores grandes', 'Blusa de manta blanca con bordado floral en pecho. Bordado a mano.', 520.00, 'producto', 'ropa', 'blusa,bordado,atlixco', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Vestido bordado largo', 'Vestido largo blanco con bordado de aves en pecho y bordes.', 980.00, 'producto', 'ropa', 'vestido,bordado,atlixco', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Mantel bordado 8 personas', 'Mantel rectangular para 8 personas con bordado de flores en esquinas.', 1200.00, 'producto', 'hogar', 'mantel,bordado,atlixco', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Servilletas bordadas (6pz)', 'Set de 6 servilletas blancas con bordado individual de flores.', 450.00, 'producto', 'hogar', 'servilletas,bordado,atlixco', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Camino de mesa bordado', 'Camino de mesa 2m con bordado de greca tradicional poblana.', 380.00, 'producto', 'hogar', 'mantel,bordado,atlixco', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Vestido niña bordado', 'Vestido para niña 4-8 años con bordado de mariposas. Manta blanca.', 380.00, 'producto', 'ropa', 'vestido,nina,bordado', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Bolsa bordada playera', 'Bolsa de manta con bordado floral. Tamaño grande con asas.', 320.00, 'producto', 'ropa', 'bolsa,bordado,artesanal', 'punto_encuentro'),
('bordados-atlixco@demo.vicino.mx', 'Funda cojín bordada (par)', 'Par de fundas para cojín 45x45 con bordado de flores en relieve.', 420.00, 'producto', 'hogar', 'cojin,bordado,artesanal', 'punto_encuentro'),
-- ===== TecnoPuebla Reparaciones (tecnologia) =====
('tecnopuebla-reparaciones@demo.vicino.mx', 'Cambio pantalla iPhone 13', 'Reemplazo de pantalla iPhone 13 con OLED original. Mano de obra y garantía 90 días.', 2800.00, 'servicio', 'tecnologia', 'iphone,reparacion,celular', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Cambio batería iPhone', 'Cambio de batería iPhone 11/12/13/14. Batería original con sello.', 1200.00, 'servicio', 'tecnologia', 'iphone,bateria,celular', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Reparación Samsung Galaxy', 'Cambio de pantalla Samsung Galaxy S20/S21/S22. Refacciones originales.', 2500.00, 'servicio', 'tecnologia', 'samsung,reparacion,celular', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Diagnóstico de laptop', 'Diagnóstico completo de hardware y software. Reporte detallado en 24h.', 350.00, 'servicio', 'tecnologia', 'laptop,reparacion,diagnostico', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Formateo + Windows 11', 'Formateo, instalación de Windows 11 con licencia y programas básicos.', 800.00, 'servicio', 'tecnologia', 'laptop,windows,formateo', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Reparación PS5', 'Reparación de PlayStation 5: HDMI, ventiladores, lectura de disco.', 1800.00, 'servicio', 'tecnologia', 'ps5,reparacion,consola', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Cambio de SSD a laptop', 'Upgrade de disco a SSD 480GB con clonado de Windows. Mejora velocidad x5.', 1500.00, 'servicio', 'tecnologia', 'laptop,ssd,upgrade', 'punto_encuentro'),
('tecnopuebla-reparaciones@demo.vicino.mx', 'Recuperación de datos', 'Recuperación de archivos en discos dañados. Cotización por GB.', 1200.00, 'servicio', 'tecnologia', 'recuperacion,datos,laptop', 'punto_encuentro'),
-- ===== Cell-Fix Express (tecnologia) =====
('cell-fix-express@demo.vicino.mx', 'Pantalla iPhone XR/11', 'Cambio express de pantalla iPhone XR o 11. Listo en 30 minutos. Garantía 6 meses.', 1800.00, 'servicio', 'tecnologia', 'iphone,reparacion,celular', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Mica de cristal templado', 'Mica de cristal 9H instalada. Compatible con iPhone, Samsung, Xiaomi.', 150.00, 'producto', 'tecnologia', 'mica,proteccion,celular', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Funda silicone iPhone 14', 'Funda silicone Pro para iPhone 14. Colores: negro, rojo, azul, lavanda.', 220.00, 'producto', 'tecnologia', 'funda,iphone,accesorio', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Cargador rápido 20W USB-C', 'Cargador rápido PD 20W. Cable USB-C a Lightning incluido. Carga al 50% en 30min.', 280.00, 'producto', 'tecnologia', 'cargador,celular,accesorio', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Audífonos bluetooth TWS', 'Audífonos bluetooth 5.3 con estuche de carga. 30 horas de batería total.', 450.00, 'producto', 'tecnologia', 'audifonos,bluetooth,celular', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Power bank 10000mAh', 'Power bank con dos puertos USB y entrada USB-C. Carga rápida 18W.', 380.00, 'producto', 'tecnologia', 'powerbank,bateria,celular', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Cable lightning original', 'Cable certificado MFI para iPhone. 1 metro de longitud, garantía 1 año.', 220.00, 'producto', 'tecnologia', 'cable,lightning,iphone', 'punto_encuentro'),
('cell-fix-express@demo.vicino.mx', 'Cambio bocina iPhone', 'Reparación de bocina de llamada o auricular iPhone. Listo el mismo día.', 650.00, 'servicio', 'tecnologia', 'iphone,bocina,reparacion', 'punto_encuentro'),
-- ===== Carpintería Hermanos Pérez (muebles) =====
('carpinteria-hermanos-perez@demo.vicino.mx', 'Mesa comedor cedro 6 personas', 'Mesa rectangular de cedro 180x90cm. Acabado natural. Cabe holgada para 6.', 8500.00, 'producto', 'muebles', 'mesa,madera,muebles', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Sillas comedor (4 piezas)', '4 sillas de pino tradicional con respaldo tallado y asiento acolchado.', 4800.00, 'producto', 'muebles', 'sillas,madera,muebles', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Cabecera matrimonial', 'Cabecera de cama matrimonial en cedro. Diseño contemporáneo o tradicional.', 3800.00, 'producto', 'muebles', 'cabecera,cama,madera', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Librero de 5 entrepaños', 'Librero modular de pino con 5 niveles y puerta inferior. 180cm de alto.', 4500.00, 'producto', 'muebles', 'librero,madera,muebles', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Escritorio para oficina', 'Escritorio L de cedro con cajones laterales. Acabado lustrado, color nogal.', 5800.00, 'producto', 'muebles', 'escritorio,madera,oficina', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Banca corredor', 'Banca larga de cedro 150cm con respaldo bajo. Ideal para entrada o jardín.', 3200.00, 'producto', 'muebles', 'banca,madera,muebles', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Buró con cajón', 'Buró de pino con un cajón y un entrepaño. Combina con cabeceras.', 1800.00, 'producto', 'muebles', 'buro,madera,muebles', 'punto_encuentro'),
('carpinteria-hermanos-perez@demo.vicino.mx', 'Restauración de muebles', 'Lijado, restauración y barnizado de muebles antiguos. Cotización en sitio.', 2500.00, 'servicio', 'muebles', 'restauracion,madera,muebles', 'punto_encuentro'),
-- ===== Decoración Aurora (hogar) =====
('decoracion-aurora@demo.vicino.mx', 'Set 4 cojines decorativos', '4 cojines 45x45 con telas mexicanas contemporáneas. Mix de patrones.', 680.00, 'producto', 'hogar', 'cojin,decoracion,hogar', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Cuadro abstracto 60x80', 'Cuadro pintado a mano sobre lienzo con paleta tierra. Listo para colgar.', 1200.00, 'producto', 'hogar', 'cuadro,arte,decoracion', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Lámpara mesa cerámica', 'Lámpara de mesa con base de cerámica artesanal y pantalla de lino.', 850.00, 'producto', 'hogar', 'lampara,decoracion,hogar', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Espejo redondo dorado', 'Espejo redondo 60cm con marco dorado mate. Estilo minimalista.', 580.00, 'producto', 'hogar', 'espejo,decoracion,hogar', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Tapete viscosa 160x230', 'Tapete grande color crema con textura suave. Antiderrapante.', 1450.00, 'producto', 'hogar', 'tapete,decoracion,hogar', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Set vasijas terracota (3)', '3 vasijas decorativas de barro pintado a mano. Diferentes tamaños.', 480.00, 'producto', 'hogar', 'vasija,decoracion,artesanal', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Reloj pared moderno', 'Reloj minimalista 40cm en madera natural con números arábigos.', 320.00, 'producto', 'hogar', 'reloj,decoracion,hogar', 'punto_encuentro'),
('decoracion-aurora@demo.vicino.mx', 'Asesoría decoración casa', 'Visita a sala/recámara/cocina con propuesta de mejora y moodboard.', 1500.00, 'servicio', 'hogar', 'asesoria,decoracion,interiorismo', 'punto_encuentro'),
-- ===== Plantas y Jardín El Edén (hogar) =====
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Monstera deliciosa grande', 'Monstera 80cm en maceta de barro. Una de las plantas más populares.', 580.00, 'producto', 'hogar', 'planta,monstera,jardin', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Pothos colgante', 'Pothos con guía. Maceta colgante incluida. Mantenimiento bajo.', 280.00, 'producto', 'hogar', 'planta,pothos,jardin', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Set suculentas (6 macetas)', 'Set 6 suculentas variadas en macetas de barro 8cm. Ideal escritorio.', 380.00, 'producto', 'hogar', 'suculenta,planta,jardin', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Lavanda en maceta', 'Lavanda aromática. Aleja mosquitos y perfuma la casa. Maceta 20cm.', 220.00, 'producto', 'hogar', 'lavanda,planta,jardin', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Sustrato premium 5kg', 'Sustrato mejorado con humus, fibra de coco y agrolita. Para interior.', 180.00, 'producto', 'hogar', 'sustrato,jardineria,planta', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Maceta cerámica 25cm', 'Maceta blanca mate de 25cm de diámetro con plato. Para plantas medianas.', 280.00, 'producto', 'hogar', 'maceta,jardineria,decoracion', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Bonsái junípero 4 años', 'Bonsái de junípero de 4 años, 30cm de alto. Con instrucciones de cuidado.', 1200.00, 'producto', 'hogar', 'bonsai,planta,jardin', 'punto_encuentro'),
('plantas-y-jardin-el-eden@demo.vicino.mx', 'Asesoría jardín en casa', 'Visita para diseño de jardín o pared verde. Cotización de implementación.', 800.00, 'servicio', 'hogar', 'asesoria,jardineria,jardin', 'punto_encuentro'),
-- ===== Estética Glow (belleza) =====
('estetica-glow@demo.vicino.mx', 'Corte de cabello dama', 'Corte para mujer con lavado, secado y peinado básico. 1 hora.', 250.00, 'servicio', 'belleza', 'corte,cabello,estetica', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Tinte completo', 'Tinte profesional Wella, tono a elegir. Incluye lavado y peinado. 2.5h.', 980.00, 'servicio', 'belleza', 'tinte,cabello,estetica', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Mechas balayage', 'Balayage con tonos personalizados. Resultado natural y duradero. 3-4h.', 1450.00, 'servicio', 'belleza', 'balayage,cabello,estetica', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Tratamiento botox capilar', 'Tratamiento intensivo para cabello dañado. Hidratación profunda. 1.5h.', 750.00, 'servicio', 'belleza', 'tratamiento,cabello,estetica', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Peinado de gala', 'Peinado para evento, boda o XV años. Recogido o suelto con ondas.', 580.00, 'servicio', 'belleza', 'peinado,cabello,gala', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Alaciado permanente', 'Alaciado con keratina. Resultado de 4-6 meses. 4 horas en salón.', 1850.00, 'servicio', 'belleza', 'alaciado,cabello,estetica', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Manicure spa', 'Manicure con exfoliación, hidratación y esmaltado tradicional o gel.', 280.00, 'servicio', 'belleza', 'manicure,unas,belleza', 'punto_encuentro'),
('estetica-glow@demo.vicino.mx', 'Maquillaje profesional', 'Maquillaje para evento o sesión de foto. Duración garantizada 12h.', 850.00, 'servicio', 'belleza', 'maquillaje,belleza,evento', 'punto_encuentro'),
-- ===== Barbería Cholula (belleza) =====
('barberia-cholula@demo.vicino.mx', 'Corte clásico caballero', 'Corte tradicional para hombre con tijera y máquina. Incluye lavado.', 180.00, 'servicio', 'belleza', 'corte,cabello,barberia', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Corte + barba', 'Corte de cabello + perfilado de barba con navaja. 45 minutos.', 280.00, 'servicio', 'belleza', 'corte,barba,barberia', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Afeitado con navaja', 'Afeitado tradicional con toallas calientes y navaja. Servicio premium.', 220.00, 'servicio', 'belleza', 'afeitado,navaja,barberia', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Corte niño', 'Corte para niño hasta 12 años. Ambiente amigable y rápido.', 150.00, 'servicio', 'belleza', 'corte,nino,barberia', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Tinte de barba', 'Aplicación de tinte de barba para cubrir canas. 30 minutos.', 200.00, 'servicio', 'belleza', 'barba,tinte,barberia', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Mascarilla carbón', 'Limpieza facial con mascarilla de carbón. Elimina puntos negros.', 250.00, 'servicio', 'belleza', 'facial,limpieza,barberia', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Combo paquete completo', 'Corte + barba + facial + masaje craneal. Servicio premium 90 min.', 480.00, 'servicio', 'belleza', 'paquete,barberia,combo', 'punto_encuentro'),
('barberia-cholula@demo.vicino.mx', 'Membresía mensual', '4 cortes al mes + 1 afeitado. Ahorro de hasta 30%.', 650.00, 'servicio', 'belleza', 'membresia,barberia,corte', 'punto_encuentro'),
-- ===== Uñas by Sofi (belleza) =====
('unas-by-sofi@demo.vicino.mx', 'Acrílicas básicas', 'Aplicación de uñas acrílicas con esmaltado tradicional. 1.5 horas.', 350.00, 'servicio', 'belleza', 'unas,acrilico,manicure', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Acrílicas con diseño', 'Acrílicas con diseño personalizado: francesa decorada, glitter, nail art.', 480.00, 'servicio', 'belleza', 'unas,acrilico,nailart', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Manicure tradicional', 'Manicure con esmaltado regular. Limado, cutícula y diseño básico.', 180.00, 'servicio', 'belleza', 'manicure,unas,belleza', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Pedicure spa', 'Pedicure completo con exfoliación, hidratación y esmaltado.', 280.00, 'servicio', 'belleza', 'pedicure,pies,belleza', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Gelish manos', 'Esmaltado en gel UV. Duración 3-4 semanas sin descascarar.', 250.00, 'servicio', 'belleza', 'gelish,unas,manicure', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Mantenimiento acrílicas', 'Relleno y reesmaltado de uñas acrílicas existentes. Cada 3-4 semanas.', 280.00, 'servicio', 'belleza', 'unas,acrilico,mantenimiento', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Retiro acrílicas', 'Retiro seguro de uñas acrílicas o gelish. Sin dañar la uña natural.', 120.00, 'servicio', 'belleza', 'unas,retiro,belleza', 'punto_encuentro'),
('unas-by-sofi@demo.vicino.mx', 'Set acrílicas + pedicure', 'Paquete acrílicas con diseño + pedicure spa. Combo completo de 2 horas.', 580.00, 'servicio', 'belleza', 'unas,paquete,belleza', 'punto_encuentro'),
-- ===== Consultorio Dental Méndez (salud) =====
('consultorio-dental-mendez@demo.vicino.mx', 'Consulta + diagnóstico', 'Revisión dental completa con radiografías y plan de tratamiento.', 350.00, 'servicio', 'salud', 'dental,consulta,salud', 'punto_encuentro'),
('consultorio-dental-mendez@demo.vicino.mx', 'Limpieza dental', 'Profilaxis dental con ultrasonido. Eliminación de sarro y pulido.', 600.00, 'servicio', 'salud', 'dental,limpieza,salud', 'punto_encuentro'),
('consultorio-dental-mendez@demo.vicino.mx', 'Blanqueamiento láser', 'Blanqueamiento dental con láser en una sesión. 4-6 tonos más claros.', 2800.00, 'servicio', 'salud', 'dental,blanqueamiento,salud', 'punto_encuentro'),
('consultorio-dental-mendez@demo.vicino.mx', 'Resina por pieza', 'Aplicación de resina blanca en caries. Color natural del diente.', 450.00, 'servicio', 'salud', 'dental,resina,salud', 'punto_encuentro'),
('consultorio-dental-mendez@demo.vicino.mx', 'Endodoncia', 'Tratamiento de conducto. Incluye anestesia y radiografías.', 2200.00, 'servicio', 'salud', 'dental,endodoncia,salud', 'punto_encuentro'),
('consultorio-dental-mendez@demo.vicino.mx', 'Brackets metálicos', 'Tratamiento de ortodoncia con brackets metálicos. Mensualidad.', 850.00, 'servicio', 'salud', 'dental,ortodoncia,salud', 'punto_encuentro'),
('consultorio-dental-mendez@demo.vicino.mx', 'Extracción molar', 'Extracción de molar permanente con anestesia local.', 750.00, 'servicio', 'salud', 'dental,extraccion,salud', 'punto_encuentro'),
-- ===== Vet Patitas Felices (mascotas) =====
('vet-patitas-felices@demo.vicino.mx', 'Consulta veterinaria', 'Consulta general para perro o gato. Revisión completa y diagnóstico.', 350.00, 'servicio', 'mascotas', 'veterinario,mascota,salud', 'punto_encuentro'),
('vet-patitas-felices@demo.vicino.mx', 'Vacuna múltiple perro', 'Vacuna óctuple para perro. Incluye certificado y carnet de vacunación.', 280.00, 'servicio', 'mascotas', 'vacuna,perro,veterinario', 'punto_encuentro'),
('vet-patitas-felices@demo.vicino.mx', 'Vacuna triple gato', 'Vacuna triple felina con leucemia. Aplicación y carnet.', 320.00, 'servicio', 'mascotas', 'vacuna,gato,veterinario', 'punto_encuentro'),
('vet-patitas-felices@demo.vicino.mx', 'Esterilización perra', 'Cirugía de esterilización perra. Incluye anestesia y recuperación.', 1800.00, 'servicio', 'mascotas', 'esterilizacion,perro,veterinario', 'punto_encuentro'),
('vet-patitas-felices@demo.vicino.mx', 'Castración gato', 'Cirugía de castración para gato macho. Procedimiento ambulatorio.', 950.00, 'servicio', 'mascotas', 'castracion,gato,veterinario', 'punto_encuentro'),
('vet-patitas-felices@demo.vicino.mx', 'Servicio emergencia 24h', 'Atención de emergencia veterinaria a domicilio. Tarifa por visita.', 1200.00, 'servicio', 'mascotas', 'emergencia,veterinario,mascota', 'punto_encuentro'),
('vet-patitas-felices@demo.vicino.mx', 'Limpieza dental canina', 'Limpieza dental con anestesia. Eliminación de sarro y pulido.', 1500.00, 'servicio', 'mascotas', 'dental,perro,veterinario', 'punto_encuentro'),
-- ===== Estética Canina Cholula (mascotas) =====
('estetica-canina-cholula@demo.vicino.mx', 'Baño básico perro chico', 'Baño con shampoo hipoalergénico, secado y perfume. Hasta 10kg.', 250.00, 'servicio', 'mascotas', 'bano,perro,estetica', 'punto_encuentro'),
('estetica-canina-cholula@demo.vicino.mx', 'Baño + corte raza', 'Baño completo y corte de raza específica. Cuidamos cada detalle.', 480.00, 'servicio', 'mascotas', 'corte,perro,estetica', 'punto_encuentro'),
('estetica-canina-cholula@demo.vicino.mx', 'Baño perro grande', 'Baño completo perro grande hasta 30kg. Incluye corte de uñas.', 380.00, 'servicio', 'mascotas', 'bano,perro,estetica', 'punto_encuentro'),
('estetica-canina-cholula@demo.vicino.mx', 'Spa canino premium', 'Baño con aromaterapia, masaje, hidratación de almohadillas y limpieza dental.', 650.00, 'servicio', 'mascotas', 'spa,perro,estetica', 'punto_encuentro'),
('estetica-canina-cholula@demo.vicino.mx', 'Corte de uñas', 'Corte de uñas seguro con limado. Para perros y gatos.', 80.00, 'servicio', 'mascotas', 'unas,perro,estetica', 'punto_encuentro'),
('estetica-canina-cholula@demo.vicino.mx', 'Baño gato', 'Baño para gato con manejo especializado. Shampoo hipoalergénico.', 350.00, 'servicio', 'mascotas', 'bano,gato,estetica', 'punto_encuentro'),
('estetica-canina-cholula@demo.vicino.mx', 'Cepillado profundo', 'Cepillado intensivo para perros de pelo largo. Elimina nudos.', 280.00, 'servicio', 'mascotas', 'cepillado,perro,estetica', 'punto_encuentro'),
-- ===== Cerrajería 24h Puebla (servicios-hogar) =====
('cerrajeria-24h-puebla@demo.vicino.mx', 'Apertura puerta sin daño', 'Apertura de puerta de casa o auto sin daño. Servicio en 30 minutos.', 450.00, 'servicio', 'servicios-hogar', 'cerrajero,puerta,emergencia', 'punto_encuentro'),
('cerrajeria-24h-puebla@demo.vicino.mx', 'Copia de llave estándar', 'Copia de llaves comunes en 10 minutos. Garantía de funcionamiento.', 60.00, 'servicio', 'servicios-hogar', 'llaves,cerrajero,copia', 'punto_encuentro'),
('cerrajeria-24h-puebla@demo.vicino.mx', 'Cambio de cerradura', 'Cambio completo de cerradura de puerta. Mano de obra + cerradura nueva.', 850.00, 'servicio', 'servicios-hogar', 'cerradura,cerrajero,seguridad', 'punto_encuentro'),
('cerrajeria-24h-puebla@demo.vicino.mx', 'Instalación cerradura digital', 'Instalación de cerradura digital con código y huella. Garantía 1 año.', 2800.00, 'servicio', 'servicios-hogar', 'cerradura,digital,seguridad', 'punto_encuentro'),
('cerrajeria-24h-puebla@demo.vicino.mx', 'Copia llave de auto', 'Copia de llave de auto con chip. Compatible con todas las marcas.', 1200.00, 'servicio', 'servicios-hogar', 'llaves,auto,cerrajero', 'punto_encuentro'),
('cerrajeria-24h-puebla@demo.vicino.mx', 'Reparación cerradura', 'Reparación de cerradura atorada o dañada. Diagnóstico gratis.', 450.00, 'servicio', 'servicios-hogar', 'cerradura,reparacion,cerrajero', 'punto_encuentro'),
('cerrajeria-24h-puebla@demo.vicino.mx', 'Apertura caja fuerte', 'Apertura de caja fuerte sin combinación. Sin dañar contenido.', 1800.00, 'servicio', 'servicios-hogar', 'cajafuerte,cerrajero,seguridad', 'punto_encuentro'),
-- ===== Plomería Don Beto (servicios-hogar) =====
('plomeria-don-beto@demo.vicino.mx', 'Reparación de fuga', 'Detección y reparación de fugas de agua. Tarifa por visita base.', 450.00, 'servicio', 'servicios-hogar', 'plomero,fuga,reparacion', 'punto_encuentro'),
('plomeria-don-beto@demo.vicino.mx', 'Destape de drenaje', 'Destape de cocina, baño o regadera con equipo profesional.', 380.00, 'servicio', 'servicios-hogar', 'plomero,drenaje,destape', 'punto_encuentro'),
('plomeria-don-beto@demo.vicino.mx', 'Cambio de WC', 'Instalación de WC nuevo. Incluye desmontaje del viejo y conexiones.', 850.00, 'servicio', 'servicios-hogar', 'wc,plomero,bano', 'punto_encuentro'),
('plomeria-don-beto@demo.vicino.mx', 'Instalación calentador', 'Instalación de calentador de gas o eléctrico. Mano de obra y materiales.', 1200.00, 'servicio', 'servicios-hogar', 'calentador,plomero,instalacion', 'punto_encuentro'),
('plomeria-don-beto@demo.vicino.mx', 'Reparación bomba de agua', 'Diagnóstico y reparación de bomba hidroneumática.', 950.00, 'servicio', 'servicios-hogar', 'bomba,plomero,reparacion', 'punto_encuentro'),
('plomeria-don-beto@demo.vicino.mx', 'Mantenimiento cisterna', 'Limpieza y mantenimiento de cisterna. Incluye sellado de fugas.', 1500.00, 'servicio', 'servicios-hogar', 'cisterna,plomero,limpieza', 'punto_encuentro'),
('plomeria-don-beto@demo.vicino.mx', 'Cambio de llaves', 'Cambio de llaves de lavabo, fregadero o regadera. Por pieza.', 280.00, 'servicio', 'servicios-hogar', 'llaves,plomero,reparacion', 'punto_encuentro'),
-- ===== Electricidad Don Toño (servicios-hogar) =====
('electricidad-don-tono@demo.vicino.mx', 'Diagnóstico de falla', 'Visita y diagnóstico de falla eléctrica. Incluye reporte.', 350.00, 'servicio', 'servicios-hogar', 'electricista,diagnostico,casa', 'punto_encuentro'),
('electricidad-don-tono@demo.vicino.mx', 'Instalación contacto/apagador', 'Instalación o reemplazo de contacto, apagador o luminaria.', 220.00, 'servicio', 'servicios-hogar', 'electricista,contacto,instalacion', 'punto_encuentro'),
('electricidad-don-tono@demo.vicino.mx', 'Cableado punto nuevo', 'Cableado de punto eléctrico nuevo. Incluye instalación y prueba.', 580.00, 'servicio', 'servicios-hogar', 'electricista,cableado,casa', 'punto_encuentro'),
('electricidad-don-tono@demo.vicino.mx', 'Instalación lámpara techo', 'Montaje e instalación de lámpara o candil. Mano de obra.', 280.00, 'servicio', 'servicios-hogar', 'lampara,electricista,casa', 'punto_encuentro'),
('electricidad-don-tono@demo.vicino.mx', 'Revisión tablero eléctrico', 'Revisión completa de tablero, balanceo de cargas y diagnóstico.', 480.00, 'servicio', 'servicios-hogar', 'electricista,tablero,seguridad', 'punto_encuentro'),
('electricidad-don-tono@demo.vicino.mx', 'Instalación ventilador techo', 'Instalación de ventilador de techo con control. Mano de obra.', 380.00, 'servicio', 'servicios-hogar', 'ventilador,electricista,casa', 'punto_encuentro'),
('electricidad-don-tono@demo.vicino.mx', 'Asesoría panel solar', 'Visita para evaluación de panel solar residencial. Cuota simbólica acreditable contra instalación.', 250.00, 'servicio', 'servicios-hogar', 'solar,electricista,casa', 'punto_encuentro'),
-- ===== Inglés con Profe Karla (educacion) =====
('ingles-profe-karla@demo.vicino.mx', 'Clase particular 1h', 'Clase individual de inglés. Plan personalizado según tu nivel.', 350.00, 'servicio', 'educacion', 'ingles,clase,educacion', 'punto_encuentro'),
('ingles-profe-karla@demo.vicino.mx', 'Paquete 8 clases', '8 clases particulares al mes. Mejor precio por clase y plan estructurado.', 2400.00, 'servicio', 'educacion', 'ingles,paquete,educacion', 'punto_encuentro'),
('ingles-profe-karla@demo.vicino.mx', 'Conversación intermedio', 'Sesión de conversación para nivel B1-B2. Dinámica y enfocada en fluidez.', 280.00, 'servicio', 'educacion', 'ingles,conversacion,educacion', 'punto_encuentro'),
('ingles-profe-karla@demo.vicino.mx', 'Preparación TOEFL', 'Curso intensivo TOEFL de 20 horas. Material y prácticas incluidas.', 5800.00, 'servicio', 'educacion', 'toefl,ingles,examen', 'punto_encuentro'),
('ingles-profe-karla@demo.vicino.mx', 'Curso niños básico', 'Curso de inglés para niños 6-12 años. Grupos pequeños y dinámicos.', 1850.00, 'servicio', 'educacion', 'ingles,ninos,educacion', 'punto_encuentro'),
('ingles-profe-karla@demo.vicino.mx', 'Clase grupal online', 'Clase grupal por Zoom, hasta 4 personas. 1 hora.', 180.00, 'servicio', 'educacion', 'ingles,online,educacion', 'punto_encuentro'),
-- ===== Tutorías Matemáticas (educacion) =====
('tutorias-matematicas-puebla@demo.vicino.mx', 'Tutoría matemáticas secundaria', 'Asesoría en álgebra, geometría y aritmética nivel secundaria.', 250.00, 'servicio', 'educacion', 'matematicas,tutoria,educacion', 'punto_encuentro'),
('tutorias-matematicas-puebla@demo.vicino.mx', 'Tutoría matemáticas prepa', 'Cálculo diferencial, integral y álgebra preuniversitaria.', 320.00, 'servicio', 'educacion', 'matematicas,tutoria,educacion', 'punto_encuentro'),
('tutorias-matematicas-puebla@demo.vicino.mx', 'Preparación examen BUAP', 'Curso de preparación EXANI-II BUAP. Material y simulacros.', 3800.00, 'servicio', 'educacion', 'examen,buap,educacion', 'punto_encuentro'),
('tutorias-matematicas-puebla@demo.vicino.mx', 'Tutoría física prepa', 'Mecánica, electricidad y termodinámica nivel preparatoria.', 320.00, 'servicio', 'educacion', 'fisica,tutoria,educacion', 'punto_encuentro'),
('tutorias-matematicas-puebla@demo.vicino.mx', 'Tutoría química básica', 'Química inorgánica, orgánica y estequiometría nivel prepa.', 320.00, 'servicio', 'educacion', 'quimica,tutoria,educacion', 'punto_encuentro'),
('tutorias-matematicas-puebla@demo.vicino.mx', 'Paquete 10 sesiones', '10 tutorías al mes con descuento. Tema a elegir.', 2400.00, 'servicio', 'educacion', 'tutoria,paquete,educacion', 'punto_encuentro'),
-- ===== Banquetes La Reyna (eventos) =====
('banquetes-la-reyna@demo.vicino.mx', 'Banquete boda 80 personas', 'Menú de 3 tiempos, pasapalos y postre. Incluye servicio.', 38000.00, 'servicio', 'eventos', 'banquete,boda,eventos', 'punto_encuentro'),
('banquetes-la-reyna@demo.vicino.mx', 'Banquete XV años 100 personas', 'Menú gourmet para 100 invitados. Incluye personal de servicio.', 42000.00, 'servicio', 'eventos', 'banquete,xv,eventos', 'punto_encuentro'),
('banquetes-la-reyna@demo.vicino.mx', 'Coffee break empresarial', 'Coffee break para 30 personas. Café, té, galletas y fruta.', 1850.00, 'servicio', 'eventos', 'cafe,empresarial,eventos', 'punto_encuentro'),
('banquetes-la-reyna@demo.vicino.mx', 'Buffet familiar 30 personas', 'Buffet con 4 guisos, ensaladas y postre. Incluye loza y mantelería.', 8500.00, 'servicio', 'eventos', 'buffet,familiar,eventos', 'punto_encuentro'),
('banquetes-la-reyna@demo.vicino.mx', 'Cena maridaje 12 personas', 'Cena privada de 5 tiempos con maridaje. Chef en sitio.', 14000.00, 'servicio', 'eventos', 'cena,maridaje,gourmet', 'punto_encuentro'),
('banquetes-la-reyna@demo.vicino.mx', 'Mesa de postres', 'Mesa de 8 postres variados para 50 personas. Decoración incluida.', 4500.00, 'servicio', 'eventos', 'postres,mesa,eventos', 'punto_encuentro'),
('banquetes-la-reyna@demo.vicino.mx', 'Snacks coctel 50 personas', 'Pasapalos y snacks variados para coctel. 10 piezas por persona.', 4800.00, 'servicio', 'eventos', 'coctel,snacks,eventos', 'punto_encuentro'),
-- ===== DJ Tornamesa (eventos) =====
('dj-tornamesa@demo.vicino.mx', 'DJ fiesta 4 horas', 'Animación musical 4 horas. Equipo de sonido y luces básicas.', 4500.00, 'servicio', 'eventos', 'dj,fiesta,eventos', 'punto_encuentro'),
('dj-tornamesa@demo.vicino.mx', 'DJ boda 6 horas', 'Animación de boda completa: ceremonia, coctel y fiesta. Premium.', 8500.00, 'servicio', 'eventos', 'dj,boda,eventos', 'punto_encuentro'),
('dj-tornamesa@demo.vicino.mx', 'DJ XV años', 'Vals, sorpresas musicales y fiesta. Iluminación con luces robóticas.', 6800.00, 'servicio', 'eventos', 'dj,xv,eventos', 'punto_encuentro'),
('dj-tornamesa@demo.vicino.mx', 'Sonido para conferencia', 'Renta de equipo de sonido + operador para evento corporativo.', 2800.00, 'servicio', 'eventos', 'sonido,conferencia,eventos', 'punto_encuentro'),
('dj-tornamesa@demo.vicino.mx', 'Cabina humo + iluminación', 'Cabina de humo controlada y luces robóticas para eventos.', 1800.00, 'servicio', 'eventos', 'humo,iluminacion,eventos', 'punto_encuentro'),
('dj-tornamesa@demo.vicino.mx', 'MC bilingüe', 'Maestro de ceremonias en español e inglés. Bodas internacionales.', 3500.00, 'servicio', 'eventos', 'mc,boda,eventos', 'punto_encuentro'),
('dj-tornamesa@demo.vicino.mx', 'Renta máquina karaoke', 'Renta de equipo de karaoke con más de 30,000 canciones.', 1200.00, 'servicio', 'eventos', 'karaoke,fiesta,eventos', 'punto_encuentro'),
-- ===== Mudanzas Express Puebla (transporte) =====
('mudanzas-express-puebla@demo.vicino.mx', 'Mudanza casa pequeña', 'Mudanza local 1 recámara con camioneta y 2 cargadores. 4 horas.', 2800.00, 'servicio', 'transporte', 'mudanza,casa,transporte', 'punto_encuentro'),
('mudanzas-express-puebla@demo.vicino.mx', 'Mudanza casa 3 recámaras', 'Mudanza local 3 recámaras con camión y 3 cargadores. 8 horas.', 5500.00, 'servicio', 'transporte', 'mudanza,casa,transporte', 'punto_encuentro'),
('mudanzas-express-puebla@demo.vicino.mx', 'Mudanza foránea CDMX', 'Mudanza Puebla a CDMX. Incluye embalaje y armado en destino.', 8500.00, 'servicio', 'transporte', 'mudanza,foranea,transporte', 'punto_encuentro'),
('mudanzas-express-puebla@demo.vicino.mx', 'Acarreo de muebles', 'Acarreo dentro de la ciudad. Tarifa por hora con camioneta y 2 cargadores.', 1200.00, 'servicio', 'transporte', 'acarreo,mudanza,transporte', 'punto_encuentro'),
('mudanzas-express-puebla@demo.vicino.mx', 'Empaque profesional', 'Servicio de empaque con material profesional para tu mudanza.', 1800.00, 'servicio', 'transporte', 'empaque,mudanza,transporte', 'punto_encuentro'),
('mudanzas-express-puebla@demo.vicino.mx', 'Renta camioneta 3.5 ton', 'Renta de camioneta de carga sin chofer. Por hora o día.', 2500.00, 'servicio', 'transporte', 'renta,camioneta,transporte', 'punto_encuentro'),
-- ===== Contador Lic. Vázquez (empleos) =====
('contador-vazquez@demo.vicino.mx', 'Declaración anual persona física', 'Elaboración y presentación de declaración anual SAT.', 1500.00, 'servicio', 'empleos', 'contador,sat,impuestos', 'punto_encuentro'),
('contador-vazquez@demo.vicino.mx', 'Contabilidad mensual PYME', 'Contabilidad mensual para PYME. Incluye declaraciones provisionales.', 3500.00, 'servicio', 'empleos', 'contador,pyme,empresa', 'punto_encuentro'),
('contador-vazquez@demo.vicino.mx', 'Alta SAT (RFC nuevo)', 'Trámite de RFC nuevo persona física o moral. Incluye e.firma.', 1200.00, 'servicio', 'empleos', 'contador,sat,rfc', 'punto_encuentro'),
('contador-vazquez@demo.vicino.mx', 'Asesoría fiscal personal', 'Sesión de 1 hora de asesoría fiscal. Optimización tributaria.', 850.00, 'servicio', 'empleos', 'contador,asesoria,impuestos', 'punto_encuentro'),
('contador-vazquez@demo.vicino.mx', 'Nómina mensual hasta 10 empleados', 'Gestión completa de nómina hasta 10 empleados.', 2800.00, 'servicio', 'empleos', 'contador,nomina,empresa', 'punto_encuentro'),
('contador-vazquez@demo.vicino.mx', 'Devolución de impuestos', 'Gestión de saldo a favor. Cuota inicial acreditable contra el éxito del trámite.', 850.00, 'servicio', 'empleos', 'contador,devolucion,sat', 'punto_encuentro'),
-- ===== Asesoría Legal Sánchez (empleos) =====
('asesoria-legal-sanchez@demo.vicino.mx', 'Consulta legal inicial', 'Consulta de 1 hora para evaluación de caso. Acreditable contra honorarios si avanzas con el trámite.', 500.00, 'servicio', 'empleos', 'abogado,consulta,legal', 'punto_encuentro'),
('asesoria-legal-sanchez@demo.vicino.mx', 'Divorcio voluntario', 'Trámite completo de divorcio voluntario. Incluye honorarios y gastos.', 8500.00, 'servicio', 'empleos', 'abogado,divorcio,legal', 'punto_encuentro'),
('asesoria-legal-sanchez@demo.vicino.mx', 'Sucesión testamentaria', 'Asesoría y trámite de juicio sucesorio testamentario.', 12000.00, 'servicio', 'empleos', 'abogado,sucesion,legal', 'punto_encuentro'),
('asesoria-legal-sanchez@demo.vicino.mx', 'Contrato civil', 'Elaboración de contratos: arrendamiento, compraventa, prestación.', 1500.00, 'servicio', 'empleos', 'abogado,contrato,legal', 'punto_encuentro'),
('asesoria-legal-sanchez@demo.vicino.mx', 'Demanda laboral', 'Asesoría y representación en demanda laboral. Cuotas por etapa.', 6500.00, 'servicio', 'empleos', 'abogado,laboral,legal', 'punto_encuentro'),
('asesoria-legal-sanchez@demo.vicino.mx', 'Trámite pensión alimenticia', 'Trámite de pensión alimenticia. Defensa y acompañamiento.', 5500.00, 'servicio', 'empleos', 'abogado,pension,legal', 'punto_encuentro'),
-- ===== Servicios Varios Don Juan (otros) =====
('servicios-varios-don-juan@demo.vicino.mx', 'Pintura interior recámara', 'Pintura de recámara estándar. Mano de obra + materiales básicos.', 1800.00, 'servicio', 'otros', 'pintura,casa,servicios', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Pintura fachada casa', 'Pintura completa de fachada con pintura vinílica. Incluye andamio.', 5500.00, 'servicio', 'otros', 'pintura,fachada,casa', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Poda de árboles', 'Poda de árboles pequeños y medianos. Incluye limpieza.', 1200.00, 'servicio', 'otros', 'poda,jardin,servicios', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Limpieza de tinacos', 'Lavado y desinfección de tinaco 1100 litros.', 850.00, 'servicio', 'otros', 'tinaco,limpieza,servicios', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Albañilería básica', 'Reparación de muros, pisos o azulejos. Por jornada laboral.', 1500.00, 'servicio', 'otros', 'albañileria,casa,servicios', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Mantenimiento jardín', 'Corte de pasto, deshierbe y fertilización. Servicio mensual.', 1200.00, 'servicio', 'otros', 'jardineria,casa,servicios', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Instalación rejas', 'Instalación de rejas decorativas o de protección.', 2800.00, 'servicio', 'otros', 'rejas,casa,servicios', 'punto_encuentro'),
('servicios-varios-don-juan@demo.vicino.mx', 'Limpieza profunda casa', 'Limpieza profunda de casa hasta 120m2. 2 personas, 5 horas.', 1800.00, 'servicio', 'otros', 'limpieza,casa,servicios', 'punto_encuentro');

-- =============================================================================
-- 6.b. INSERTAR products_services desde el temp table
-- =============================================================================
INSERT INTO products_services (
  id, creador_id, titulo, descripcion, slug, precio, tipo, categoria,
  imagen_principal, galeria_imagenes, ubicacion, ubicacion_geo,
  tipo_entrega, estatus, ventas_count, vistas_count, created_at, updated_at
)
SELECT
  sp.uuid,
  sv.uuid AS creador_id,
  sp.titulo,
  sp.descripcion,
  trim(both '-' from regexp_replace(
    lower(regexp_replace(
      translate(sp.titulo, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN'),
      '[^a-zA-Z0-9]+', '-', 'g'
    )),
    '-+', '-', 'g'
  )) || '-' || substr(sp.uuid::text, 1, 6) AS slug,
  sp.precio,
  sp.tipo,
  sp.categoria,
  'https://loremflickr.com/600/450/' || sp.img_tags || '?lock=' || sp.ord,
  ARRAY[
    'https://loremflickr.com/600/450/' || sp.img_tags || '?lock=' || (sp.ord + 1000),
    'https://loremflickr.com/600/450/' || sp.img_tags || '?lock=' || (sp.ord + 2000),
    'https://loremflickr.com/600/450/' || sp.img_tags || '?lock=' || (sp.ord + 3000)
  ],
  sv.ubicacion,
  ST_SetSRID(ST_MakePoint(
    sv.lng + (random() - 0.5) * 0.003,
    sv.lat + (random() - 0.5) * 0.003
  ), 4326)::geography,
  sp.tipo_entrega,
  'disponible',
  0,  -- ventas_count se actualiza al final
  (floor(random() * 250))::int,
  NOW() - (floor(random() * 90) || ' days')::interval,
  NOW()
FROM _seed_products sp
JOIN _seed_vendors sv ON sv.email = sp.vendor_email;

-- =============================================================================
-- 7. SALE CONFIRMATIONS (~120)
-- =============================================================================
-- 7a. ~100 ventas entre vendedores fake y compradores fake
INSERT INTO sale_confirmations (
  id, product_id, buyer_id, seller_id, precio_acordado, cantidad,
  status, initiated_by, buyer_confirmed, buyer_confirmed_at,
  seller_confirmed, seller_confirmed_at, completed_at, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  pp.product_id,
  pp.buyer_id,
  pp.seller_id,
  pp.precio_acordado,
  pp.cantidad,
  'completed',
  pp.buyer_id,
  TRUE,
  pp.completed_at - interval '2 days',
  TRUE,
  pp.completed_at - interval '1 day',
  pp.completed_at,
  pp.completed_at - interval '3 days',
  pp.completed_at
FROM (
  SELECT
    p.id AS product_id,
    p.creador_id AS seller_id,
    b.uuid AS buyer_id,
    ROUND((p.precio * (1 + (random() - 0.5) * 0.10))::numeric, 2) AS precio_acordado,
    (1 + floor(random() * 3))::int AS cantidad,
    NOW() - (floor(random() * 60) || ' days')::interval AS completed_at,
    ROW_NUMBER() OVER (ORDER BY random()) AS rn
  FROM products_services p
  CROSS JOIN LATERAL (
    SELECT uuid FROM _seed_buyers ORDER BY random() LIMIT 1
  ) b
  WHERE p.creador_id IN (SELECT uuid FROM _seed_vendors)
    AND p.precio > 0
) pp
WHERE pp.rn <= 100
  AND pp.buyer_id != pp.seller_id;

-- 7b. ~20 ventas involucrando admins/moderators reales
-- Inserta solo si existen admins; si no, se omite silenciosamente.
INSERT INTO sale_confirmations (
  id, product_id, buyer_id, seller_id, precio_acordado, cantidad,
  status, initiated_by, buyer_confirmed, buyer_confirmed_at,
  seller_confirmed, seller_confirmed_at, completed_at, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  ap.product_id,
  ap.admin_id AS buyer_id,
  ap.seller_id,
  ap.precio_acordado,
  ap.cantidad,
  'completed',
  ap.admin_id,
  TRUE,
  ap.completed_at - interval '2 days',
  TRUE,
  ap.completed_at - interval '1 day',
  ap.completed_at,
  ap.completed_at - interval '3 days',
  ap.completed_at
FROM (
  SELECT
    p.id AS product_id,
    p.creador_id AS seller_id,
    a.user_id AS admin_id,
    ROUND((p.precio * (1 + (random() - 0.5) * 0.10))::numeric, 2) AS precio_acordado,
    (1 + floor(random() * 3))::int AS cantidad,
    NOW() - (floor(random() * 45) || ' days')::interval AS completed_at,
    ROW_NUMBER() OVER (ORDER BY random()) AS rn
  FROM products_services p
  CROSS JOIN LATERAL (
    SELECT user_id FROM user_roles WHERE role IN ('admin','moderator') ORDER BY random() LIMIT 1
  ) a
  WHERE p.creador_id IN (SELECT uuid FROM _seed_vendors)
    AND p.precio > 0
    AND p.creador_id != a.user_id
) ap
WHERE ap.rn <= 20;

-- =============================================================================
-- 8. REVIEWS (~80 buyer→seller + ~20 seller→buyer)
-- =============================================================================
INSERT INTO reviews (
  id, sale_confirmation_id, product_id, reviewer_id, reviewed_id,
  review_type, rating, comentario, visible, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  sc.id,
  sc.product_id,
  sc.buyer_id,
  sc.seller_id,
  'buyer_to_seller',
  -- Rating sesgado hacia positivo: 70% 5, 20% 4, 8% 3, 2% 2
  CASE
    WHEN random() < 0.70 THEN 5
    WHEN random() < 0.90 THEN 4
    WHEN random() < 0.98 THEN 3
    ELSE 2
  END AS rating,
  (ARRAY[
    'Excelente producto, tal cual la descripción. Muy satisfecho con mi compra.',
    'Muy buena atención, recomendado al 100%. Volveré a comprar sin duda.',
    'Entrega rápida y producto en perfectas condiciones. Todo excelente.',
    'Buena comunicación, todo bien. El vendedor fue muy amable y atento.',
    'El producto llegó bien empacado y en el tiempo acordado. Recomendable.',
    'Súper recomendable, volveré a comprar. La calidad superó mis expectativas.',
    'Muy amable el vendedor, gracias por todo. Excelente experiencia de compra.',
    'Todo perfecto, exactamente lo que esperaba. No le cambiaría nada.',
    'Buen precio y calidad. Definitivamente una compra inteligente.',
    'La entrega fue puntual y el producto excelente. Muy profesional.',
    'Me encantó, justo lo que necesitaba. La descripción es muy precisa.',
    'Vendedor confiable y honesto. Producto tal cual las fotos.',
    'Increíble relación calidad-precio. Mejor de lo que esperaba.',
    'Producto en excelente estado, muy contento con la compra.',
    'Rápido y sin problemas. Así deberían ser todas las compras.',
    'Muy recomendable, la atención al cliente es de primera.',
    'El producto es de muy buena calidad y el precio es justo.',
    'Excelente compra, me llegó antes de lo esperado. Gracias.',
    'Todo genial, empaque cuidadoso y bonita presentación.',
    'El vendedor resolvió todas mis dudas antes de comprar. Muy profesional.',
    'Quedé muy satisfecha, el producto es tal cual se describe.',
    'Lo recomiendo ampliamente, es justo lo que buscaba.',
    'Perfecto para lo que lo necesitaba. Buena compra y buen vendedor.',
    'La verdad superó mis expectativas. Gracias por la atención.',
    'Buen servicio, comunicación clara y producto de calidad.'
  ])[1 + floor(random() * 25)::int] AS comentario,
  TRUE,
  sc.completed_at + interval '3 days',
  sc.completed_at + interval '3 days'
FROM (
  SELECT id, product_id, buyer_id, seller_id, completed_at,
    ROW_NUMBER() OVER (ORDER BY random()) AS rn
  FROM sale_confirmations
  WHERE status = 'completed'
) sc
WHERE sc.rn <= 80;

-- 8b. seller_to_buyer reviews (~20)
INSERT INTO reviews (
  id, sale_confirmation_id, product_id, reviewer_id, reviewed_id,
  review_type, rating, comentario, visible, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  sc.id,
  sc.product_id,
  sc.seller_id,
  sc.buyer_id,
  'seller_to_buyer',
  CASE
    WHEN random() < 0.75 THEN 5
    WHEN random() < 0.95 THEN 4
    ELSE 3
  END AS rating,
  (ARRAY[
    'Excelente comprador, pago puntual y buena comunicación.',
    'Muy amable y respetuoso. Fue un gusto hacer negocio.',
    'Comprador serio y cumplido. Recomendado para cualquier vendedor.',
    'Todo perfecto, llegó puntual a recoger y fue muy atento.',
    'Buena experiencia, comprador confiable y de trato fácil.',
    'Pago inmediato y buena comunicación durante todo el proceso.',
    'Excelente trato, comprador muy educado y cumplido.',
    'Persona seria y respetuosa. Transacción sin ningún problema.',
    'Muy buen comprador, espero que regrese pronto.',
    'Todo fluyó muy bien, comprador recomendado al 100%.',
    'Comprador amable y con buena disposición. Gracias.',
    'Trato excelente, se nota que es persona de confianza.',
    'Sin problemas, transacción rápida y segura. Recomendado.',
    'Muy puntual y respetuoso con los acuerdos. Gracias.',
    'Buen comprador, ojalá todos fueran así. Recomendado.'
  ])[1 + floor(random() * 15)::int] AS comentario,
  TRUE,
  sc.completed_at + interval '4 days',
  sc.completed_at + interval '4 days'
FROM (
  SELECT id, product_id, buyer_id, seller_id, completed_at,
    ROW_NUMBER() OVER (ORDER BY random()) AS rn
  FROM sale_confirmations
  WHERE status = 'completed'
) sc
WHERE sc.rn <= 20;

-- =============================================================================
-- 9. FAVORITES (~50)
-- =============================================================================
INSERT INTO favorites (id, usuario_id, producto_id, created_at)
SELECT
  gen_random_uuid(),
  bpp.buyer_id,
  bpp.product_id,
  NOW() - (floor(random() * 30) || ' days')::interval
FROM (
  SELECT
    b.uuid AS buyer_id,
    p.id AS product_id,
    ROW_NUMBER() OVER (PARTITION BY b.uuid ORDER BY random()) AS rn
  FROM _seed_buyers b
  CROSS JOIN products_services p
  WHERE p.creador_id IN (SELECT uuid FROM _seed_vendors)
) bpp
WHERE bpp.rn <= 4
ON CONFLICT (usuario_id, producto_id) DO NOTHING;

-- =============================================================================
-- 10. RE-HABILITAR TRIGGERS
-- =============================================================================
ALTER TABLE products_services ENABLE TRIGGER USER;
ALTER TABLE sale_confirmations ENABLE TRIGGER USER;
ALTER TABLE reviews ENABLE TRIGGER USER;

-- =============================================================================
-- 11. RECALCULAR STATS DENORMALIZADOS (los triggers estaban OFF)
-- =============================================================================
-- 11.1. profiles.total_sales (ventas como seller completadas)
UPDATE profiles p SET total_sales = sub.cnt
FROM (
  SELECT seller_id, COUNT(*)::int AS cnt
  FROM sale_confirmations
  WHERE status = 'completed'
  GROUP BY seller_id
) sub
WHERE p.id = sub.seller_id;

-- 11.2. profiles.average_rating_as_seller + reviews_count_as_seller
UPDATE profiles p SET
  average_rating_as_seller = COALESCE(sub.avg_r, 0),
  reviews_count_as_seller = COALESCE(sub.cnt, 0)
FROM (
  SELECT reviewed_id, AVG(rating)::numeric(3,2) AS avg_r, COUNT(*)::int AS cnt
  FROM reviews
  WHERE review_type = 'buyer_to_seller' AND visible = TRUE
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;

-- 11.3. profiles.average_rating_as_buyer + reviews_count_as_buyer
UPDATE profiles p SET
  average_rating_as_buyer = COALESCE(sub.avg_r, 0),
  reviews_count_as_buyer = COALESCE(sub.cnt, 0)
FROM (
  SELECT reviewed_id, AVG(rating)::numeric(3,2) AS avg_r, COUNT(*)::int AS cnt
  FROM reviews
  WHERE review_type = 'seller_to_buyer' AND visible = TRUE
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;

-- 11.4. profiles.average_rating + reviews_count (combinado, usado en UI)
UPDATE profiles p SET
  average_rating = COALESCE(sub.avg_r, 0),
  reviews_count = COALESCE(sub.cnt, 0)
FROM (
  SELECT reviewed_id, AVG(rating)::numeric(3,2) AS avg_r, COUNT(*)::int AS cnt
  FROM reviews
  WHERE visible = TRUE
  GROUP BY reviewed_id
) sub
WHERE p.id = sub.reviewed_id;

-- 11.5. products_services.ventas_count
UPDATE products_services ps SET ventas_count = sub.cnt
FROM (
  SELECT product_id, SUM(cantidad)::int AS cnt
  FROM sale_confirmations
  WHERE status = 'completed'
  GROUP BY product_id
) sub
WHERE ps.id = sub.product_id;

-- 11.6. products_services.favoritos_count
UPDATE products_services ps SET favoritos_count = sub.cnt
FROM (
  SELECT producto_id, COUNT(*)::int AS cnt
  FROM favorites
  GROUP BY producto_id
) sub
WHERE ps.id = sub.producto_id;

COMMIT;

-- =============================================================================
-- 12. VERIFICACIÓN FINAL
-- =============================================================================
SELECT '== Estado post-seed ==' AS info;

SELECT 'profiles fake (@demo.vicino.mx)' AS tabla, COUNT(*) AS total FROM profiles WHERE email LIKE '%@demo.vicino.mx'
UNION ALL SELECT 'profiles vendedores', COUNT(*) FROM profiles WHERE es_vendedor = TRUE AND email LIKE '%@demo.vicino.mx'
UNION ALL SELECT 'profiles compradores fake', COUNT(*) FROM profiles WHERE es_vendedor = FALSE AND email LIKE '%@demo.vicino.mx'
UNION ALL SELECT 'products_services', COUNT(*) FROM products_services
UNION ALL SELECT 'productos con ubicacion_geo', COUNT(*) FROM products_services WHERE ubicacion_geo IS NOT NULL
UNION ALL SELECT 'sale_confirmations completadas', COUNT(*) FROM sale_confirmations WHERE status = 'completed'
UNION ALL SELECT 'sale_confirmations con admin', COUNT(*) FROM sale_confirmations sc
  WHERE EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id IN (sc.buyer_id, sc.seller_id) AND ur.role IN ('admin','moderator'))
UNION ALL SELECT 'reviews', COUNT(*) FROM reviews
UNION ALL SELECT 'favorites', COUNT(*) FROM favorites
ORDER BY tabla;

-- Spot check: un vendedor con su info completa
SELECT '== Spot check: Taquería Doña Mari ==' AS info;
SELECT p.email, p.nombre_negocio, p.trust_level, p.total_sales, p.average_rating_as_seller, p.reviews_count_as_seller
FROM profiles p
WHERE p.email = 'taqueria-dona-mari@demo.vicino.mx';

SELECT 'Productos de Taquería Doña Mari' AS info, COUNT(*) AS total
FROM products_services
WHERE creador_id = (SELECT id FROM profiles WHERE email = 'taqueria-dona-mari@demo.vicino.mx');
