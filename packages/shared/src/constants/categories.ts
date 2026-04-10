export const CATEGORIES = [
  // Productos
  { id: "comida", name: "Comida y Bebidas", slug: "comida", icon: "UtensilsCrossed", type: "producto" },
  { id: "ropa", name: "Ropa y Accesorios", slug: "ropa", icon: "Shirt", type: "producto" },
  { id: "tecnologia", name: "Tecnología", slug: "tecnologia", icon: "Smartphone", type: "producto" },
  { id: "hogar", name: "Hogar y Jardín", slug: "hogar", icon: "Home", type: "producto" },
  { id: "belleza", name: "Belleza", slug: "belleza", icon: "Sparkles", type: "producto" },
  { id: "salud", name: "Salud y Bienestar", slug: "salud", icon: "HeartPulse", type: "producto" },
  { id: "deportes", name: "Deportes y Fitness", slug: "deportes", icon: "Dumbbell", type: "producto" },
  { id: "mascotas", name: "Mascotas", slug: "mascotas", icon: "PawPrint", type: "producto" },
  { id: "bebes", name: "Bebés y Niños", slug: "bebes", icon: "Baby", type: "producto" },
  { id: "vehiculos", name: "Vehículos", slug: "vehiculos", icon: "Car", type: "producto" },
  { id: "libros", name: "Libros y Papelería", slug: "libros", icon: "BookOpen", type: "producto" },
  { id: "juguetes", name: "Juguetes y Juegos", slug: "juguetes", icon: "Gamepad2", type: "producto" },
  { id: "arte", name: "Arte y Manualidades", slug: "arte", icon: "Palette", type: "producto" },
  { id: "muebles", name: "Muebles", slug: "muebles", icon: "Armchair", type: "producto" },
  // Servicios
  { id: "servicios-hogar", name: "Servicios del Hogar", slug: "servicios-hogar", icon: "Wrench", type: "servicio" },
  { id: "educacion", name: "Educación y Clases", slug: "educacion", icon: "GraduationCap", type: "servicio" },
  { id: "eventos", name: "Eventos", slug: "eventos", icon: "PartyPopper", type: "servicio" },
  { id: "transporte", name: "Transporte y Mudanzas", slug: "transporte", icon: "Truck", type: "servicio" },
  { id: "diseno-tech", name: "Diseño y Tech", slug: "diseno-tech", icon: "Code", type: "servicio" },
  { id: "salud-terapias", name: "Salud y Terapias", slug: "salud-terapias", icon: "Stethoscope", type: "servicio" },
  { id: "fotografia", name: "Fotografía y Video", slug: "fotografia", icon: "Camera", type: "servicio" },
  { id: "inmuebles", name: "Inmuebles", slug: "inmuebles", icon: "Building", type: "servicio" },
  // Otros
  { id: "empleos", name: "Empleos", slug: "empleos", icon: "Briefcase", type: "otro" },
  { id: "otros", name: "Otros", slug: "otros", icon: "MoreHorizontal", type: "otro" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
