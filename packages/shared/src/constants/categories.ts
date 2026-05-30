export const CATEGORIES = [
  // Productos
  { id: "comida", name: "Comida y Bebidas", slug: "comida", icon: "UtensilsCrossed", type: "producto", hidden_in_form: false },
  { id: "ropa", name: "Ropa y Accesorios", slug: "ropa", icon: "Shirt", type: "producto", hidden_in_form: false },
  { id: "tecnologia", name: "Tecnología", slug: "tecnologia", icon: "Smartphone", type: "producto", hidden_in_form: false },
  { id: "hogar", name: "Hogar y Jardín", slug: "hogar", icon: "Home", type: "producto", hidden_in_form: false },
  { id: "belleza", name: "Belleza", slug: "belleza", icon: "Sparkles", type: "producto", hidden_in_form: false },
  { id: "salud", name: "Salud y Bienestar", slug: "salud", icon: "HeartPulse", type: "producto", hidden_in_form: false },
  { id: "deportes", name: "Deportes y Fitness", slug: "deportes", icon: "Dumbbell", type: "producto", hidden_in_form: false },
  { id: "mascotas", name: "Mascotas", slug: "mascotas", icon: "PawPrint", type: "producto", hidden_in_form: false },
  { id: "bebes", name: "Bebés y Niños", slug: "bebes", icon: "Baby", type: "producto", hidden_in_form: false },
  { id: "vehiculos", name: "Vehículos", slug: "vehiculos", icon: "Car", type: "producto", hidden_in_form: false },
  { id: "libros", name: "Libros y Papelería", slug: "libros", icon: "BookOpen", type: "producto", hidden_in_form: false },
  { id: "juguetes", name: "Juguetes y Juegos", slug: "juguetes", icon: "Gamepad2", type: "producto", hidden_in_form: false },
  { id: "arte", name: "Arte y Manualidades", slug: "arte", icon: "Palette", type: "producto", hidden_in_form: false },
  { id: "muebles", name: "Muebles", slug: "muebles", icon: "Armchair", type: "producto", hidden_in_form: false },
  // Servicios
  { id: "servicios-hogar", name: "Servicios del Hogar", slug: "servicios-hogar", icon: "Wrench", type: "servicio", hidden_in_form: false },
  { id: "educacion", name: "Educación y Clases", slug: "educacion", icon: "GraduationCap", type: "servicio", hidden_in_form: false },
  { id: "eventos", name: "Eventos", slug: "eventos", icon: "PartyPopper", type: "servicio", hidden_in_form: false },
  { id: "transporte", name: "Transporte y Mudanzas", slug: "transporte", icon: "Truck", type: "servicio", hidden_in_form: false },
  { id: "diseno-tech", name: "Diseño y Tech", slug: "diseno-tech", icon: "Code", type: "servicio", hidden_in_form: false },
  { id: "salud-terapias", name: "Salud y Terapias", slug: "salud-terapias", icon: "Stethoscope", type: "servicio", hidden_in_form: false },
  { id: "fotografia", name: "Fotografía y Video", slug: "fotografia", icon: "Camera", type: "servicio", hidden_in_form: false },
  { id: "inmuebles", name: "Inmuebles", slug: "inmuebles", icon: "Building", type: "servicio", hidden_in_form: false },
  // Mayoreo
  { id: "proveedores-mayoreo", name: "Proveedores y Mayoreo", slug: "proveedores-mayoreo", icon: "Warehouse", type: "producto", hidden_in_form: false },
  // Subcategorias de Proveedores y Mayoreo (parent_id = proveedores-mayoreo en DB).
  // Existen en la tabla `categories` desde la migration 20260411000005 pero no se
  // ofrecen en el form de alta (hidden_in_form: true). Se incluyen aqui para que
  // el zod enum las acepte cuando lleguen por rutas alternativas (admin, RPC,
  // futuro flujo de mayoreo) sin que el server las rechace por desconocidas.
  { id: "alimentos-mayoreo", name: "Alimentos al mayoreo", slug: "alimentos-mayoreo", icon: "UtensilsCrossed", type: "producto", hidden_in_form: true },
  { id: "ropa-mayoreo", name: "Ropa y Textiles al mayoreo", slug: "ropa-mayoreo", icon: "Shirt", type: "producto", hidden_in_form: true },
  { id: "tecnologia-mayoreo", name: "Tecnología al mayoreo", slug: "tecnologia-mayoreo", icon: "Smartphone", type: "producto", hidden_in_form: true },
  { id: "materiales-construccion", name: "Materiales de construcción", slug: "materiales-construccion", icon: "Hammer", type: "producto", hidden_in_form: true },
  { id: "limpieza-mayoreo", name: "Limpieza al mayoreo", slug: "limpieza-mayoreo", icon: "Sparkles", type: "producto", hidden_in_form: true },
  { id: "papeleria-mayoreo", name: "Papelería al mayoreo", slug: "papeleria-mayoreo", icon: "BookOpen", type: "producto", hidden_in_form: true },
  { id: "cosmeticos-mayoreo", name: "Cosméticos al mayoreo", slug: "cosmeticos-mayoreo", icon: "Palette", type: "producto", hidden_in_form: true },
  { id: "insumos-restaurantes", name: "Insumos para restaurantes", slug: "insumos-restaurantes", icon: "UtensilsCrossed", type: "producto", hidden_in_form: true },
  { id: "materias-primas", name: "Materias primas", slug: "materias-primas", icon: "Package", type: "producto", hidden_in_form: true },
  { id: "otros-mayoreo", name: "Otros mayoreo", slug: "otros-mayoreo", icon: "MoreHorizontal", type: "producto", hidden_in_form: true },
  // Otros
  { id: "empleos", name: "Empleos", slug: "empleos", icon: "Briefcase", type: "otro", hidden_in_form: false },
  { id: "otros", name: "Otros", slug: "otros", icon: "MoreHorizontal", type: "otro", hidden_in_form: false },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type CategorySlug = (typeof CATEGORIES)[number]["slug"];
