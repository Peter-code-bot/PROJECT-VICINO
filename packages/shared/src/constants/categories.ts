/**
 * `ejemplos` es la palabra del vendedor, no la del catalogo.
 *
 * Existe por un caso real: alguien que vende gomitas no encontro donde
 * publicar y acabo en "Comida y Bebidas", mientras "Postres y Reposteria"
 * estaba vacia al lado. El problema no era que faltara un cajon —hay 42
 * categorias para 14 publicaciones— sino que el cajon correcto no decia su
 * palabra. Por eso esa categoria pasa a llamarse "Dulces y Postres" y cada
 * opcion del selector muestra debajo de que se trata.
 *
 * El slug NO cambia al renombrar: es lo que casa con la tabla categories,
 * con el pivote product_categories y con las URLs /[categoria]/[slug] ya
 * compartidas. Cambiarlo romperia enlaces existentes.
 */
export const CATEGORIES = [
  // Productos
  { id: "comida", name: "Comida y Bebidas", slug: "comida", icon: "UtensilsCrossed", type: "producto", hidden_in_form: false, ejemplos: "comida corrida, antojitos, tortas, jugos, café" },
  { id: "postres", name: "Dulces y Postres", slug: "postres", icon: "Cake", type: "producto", hidden_in_form: false, ejemplos: "gomitas, dulces típicos, pasteles, gelatinas, chocolates" },
  { id: "ropa", name: "Ropa y Accesorios", slug: "ropa", icon: "Shirt", type: "producto", hidden_in_form: false, ejemplos: "playeras, vestidos, tenis, bolsas, ropa de segunda mano" },
  { id: "joyeria", name: "Joyería", slug: "joyeria", icon: "Gem", type: "producto", hidden_in_form: false, ejemplos: "aretes, pulseras, anillos, plata, bisutería" },
  { id: "tecnologia", name: "Tecnología", slug: "tecnologia", icon: "Smartphone", type: "producto", hidden_in_form: false, ejemplos: "celulares, laptops, audífonos, consolas, accesorios" },
  { id: "hogar", name: "Hogar y Jardín", slug: "hogar", icon: "Home", type: "producto", hidden_in_form: false, ejemplos: "decoración, plantas, macetas, cortinas, blancos" },
  { id: "electrodomesticos", name: "Electrodomésticos", slug: "electrodomesticos", icon: "Refrigerator", type: "producto", hidden_in_form: false, ejemplos: "licuadoras, microondas, refrigeradores, lavadoras" },
  { id: "belleza", name: "Belleza", slug: "belleza", icon: "Sparkles", type: "producto", hidden_in_form: false, ejemplos: "maquillaje, cremas, perfumes, uñas, cuidado del cabello" },
  { id: "salud", name: "Salud y Bienestar", slug: "salud", icon: "HeartPulse", type: "producto", hidden_in_form: false, ejemplos: "suplementos, vitaminas, productos naturistas, ortopedia" },
  { id: "deportes", name: "Artículos Deportivos", slug: "deportes", icon: "Dumbbell", type: "producto", hidden_in_form: false, ejemplos: "bicicletas, pesas, balones, ropa deportiva, patines" },
  { id: "mascotas", name: "Mascotas", slug: "mascotas", icon: "PawPrint", type: "producto", hidden_in_form: false, ejemplos: "croquetas, juguetes, camas, collares, accesorios" },
  { id: "bebes", name: "Bebés y Niños", slug: "bebes", icon: "Baby", type: "producto", hidden_in_form: false, ejemplos: "carriolas, ropa de bebé, pañales, cunas, juguetes" },
  { id: "vehiculos", name: "Vehículos", slug: "vehiculos", icon: "Car", type: "producto", hidden_in_form: false, ejemplos: "autos, motos, refacciones, llantas, accesorios" },
  { id: "libros", name: "Libros y Papelería", slug: "libros", icon: "BookOpen", type: "producto", hidden_in_form: false, ejemplos: "libros, cuadernos, plumas, mochilas, material escolar" },
  { id: "juguetes", name: "Juguetes y Juegos", slug: "juguetes", icon: "Gamepad2", type: "producto", hidden_in_form: false, ejemplos: "juguetes, juegos de mesa, peluches, figuras, videojuegos" },
  { id: "arte", name: "Arte y Manualidades", slug: "arte", icon: "Palette", type: "producto", hidden_in_form: false, ejemplos: "cuadros, artesanías, resina, material para manualidades" },
  { id: "regalos", name: "Regalos y Detalles", slug: "regalos", icon: "Gift", type: "producto", hidden_in_form: false, ejemplos: "arreglos, globos, canastas, souvenirs, detalles personalizados" },
  { id: "muebles", name: "Muebles", slug: "muebles", icon: "Armchair", type: "producto", hidden_in_form: false, ejemplos: "sillas, mesas, sillones, closets, muebles a medida" },
  { id: "herramientas", name: "Herramientas", slug: "herramientas", icon: "Hammer", type: "producto", hidden_in_form: false, ejemplos: "taladros, juegos de llaves, escaleras, equipo de jardín" },
  // Servicios
  { id: "servicios-hogar", name: "Servicios del Hogar", slug: "servicios-hogar", icon: "Wrench", type: "servicio", hidden_in_form: false, ejemplos: "plomería, electricidad, limpieza, pintura, jardinería" },
  { id: "educacion", name: "Educación y Clases", slug: "educacion", icon: "GraduationCap", type: "servicio", hidden_in_form: false, ejemplos: "clases particulares, regularización, idiomas, música, tutorías" },
  { id: "deportes-aventura", name: "Deportes y Aventura", slug: "deportes-aventura", icon: "Mountain", type: "servicio", hidden_in_form: false, ejemplos: "senderismo, escalada, ciclismo, tours, campamentos" },
  { id: "eventos", name: "Eventos", slug: "eventos", icon: "PartyPopper", type: "servicio", hidden_in_form: false, ejemplos: "banquetes, DJ, mobiliario, salones, meseros" },
  { id: "entretenimiento", name: "Entretenimiento", slug: "entretenimiento", icon: "Ticket", type: "servicio", hidden_in_form: false, ejemplos: "shows, música en vivo, animación, botargas, karaoke" },
  { id: "transporte", name: "Transporte y Mudanzas", slug: "transporte", icon: "Truck", type: "servicio", hidden_in_form: false, ejemplos: "mudanzas, fletes, paquetería, viajes, grúas" },
  { id: "diseno-tech", name: "Diseño y Tech", slug: "diseno-tech", icon: "Code", type: "servicio", hidden_in_form: false, ejemplos: "páginas web, logotipos, redes sociales, reparación de equipos" },
  { id: "salud-terapias", name: "Salud y Terapias", slug: "salud-terapias", icon: "Stethoscope", type: "servicio", hidden_in_form: false, ejemplos: "masajes, fisioterapia, nutrición, psicología, dentista" },
  { id: "fotografia", name: "Fotografía y Video", slug: "fotografia", icon: "Camera", type: "servicio", hidden_in_form: false, ejemplos: "sesiones, bodas, XV años, video, edición" },
  { id: "inmuebles", name: "Inmuebles", slug: "inmuebles", icon: "Building", type: "servicio", hidden_in_form: false, ejemplos: "renta de casa, cuartos, locales, terrenos, oficinas" },
  // Mayoreo
  { id: "proveedores-mayoreo", name: "Proveedores y Mayoreo", slug: "proveedores-mayoreo", icon: "Warehouse", type: "producto", hidden_in_form: false, ejemplos: "venta al mayoreo, medio mayoreo, insumos a granel" },
  // Subcategorias de Proveedores y Mayoreo (parent_id = proveedores-mayoreo en DB).
  // Existen en la tabla `categories` desde la migration 20260411000005 pero no se
  // ofrecen en el form de alta (hidden_in_form: true). Se incluyen aqui para que
  // el zod enum las acepte cuando lleguen por rutas alternativas (admin, RPC,
  // futuro flujo de mayoreo) sin que el server las rechace por desconocidas.
  { id: "alimentos-mayoreo", name: "Alimentos al mayoreo", slug: "alimentos-mayoreo", icon: "UtensilsCrossed", type: "producto", hidden_in_form: true, ejemplos: "abarrotes, granos, botanas por caja" },
  { id: "ropa-mayoreo", name: "Ropa y Textiles al mayoreo", slug: "ropa-mayoreo", icon: "Shirt", type: "producto", hidden_in_form: true, ejemplos: "playeras por docena, telas, uniformes" },
  { id: "tecnologia-mayoreo", name: "Tecnología al mayoreo", slug: "tecnologia-mayoreo", icon: "Smartphone", type: "producto", hidden_in_form: true, ejemplos: "accesorios por lote, refacciones" },
  { id: "materiales-construccion", name: "Materiales de construcción", slug: "materiales-construccion", icon: "Hammer", type: "producto", hidden_in_form: true, ejemplos: "cemento, varilla, blocks, pintura" },
  { id: "limpieza-mayoreo", name: "Limpieza al mayoreo", slug: "limpieza-mayoreo", icon: "Sparkles", type: "producto", hidden_in_form: true, ejemplos: "cloro, jabón, desechables" },
  { id: "papeleria-mayoreo", name: "Papelería al mayoreo", slug: "papeleria-mayoreo", icon: "BookOpen", type: "producto", hidden_in_form: true, ejemplos: "cuadernos por caja, hojas, plumas" },
  { id: "cosmeticos-mayoreo", name: "Cosméticos al mayoreo", slug: "cosmeticos-mayoreo", icon: "Palette", type: "producto", hidden_in_form: true, ejemplos: "maquillaje por lote, cremas, esmaltes" },
  { id: "insumos-restaurantes", name: "Insumos para restaurantes", slug: "insumos-restaurantes", icon: "UtensilsCrossed", type: "producto", hidden_in_form: true, ejemplos: "desechables, servilletas, aceite, especias" },
  { id: "materias-primas", name: "Materias primas", slug: "materias-primas", icon: "Package", type: "producto", hidden_in_form: true, ejemplos: "harinas, azúcar, resinas, pigmentos" },
  { id: "otros-mayoreo", name: "Otros mayoreo", slug: "otros-mayoreo", icon: "MoreHorizontal", type: "producto", hidden_in_form: true, ejemplos: "lo que no encaja en las anteriores" },
  // Otros
  { id: "empleos", name: "Empleos", slug: "empleos", icon: "Briefcase", type: "otro", hidden_in_form: false, ejemplos: "vacantes, se solicita, trabajo por horas" },
  { id: "otros", name: "Otros", slug: "otros", icon: "MoreHorizontal", type: "otro", hidden_in_form: false, ejemplos: "lo que no encaja en ninguna otra" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
