-- Remap old category slugs to new ones before deleting
UPDATE products_services SET categoria = 'servicios-hogar' WHERE categoria = 'servicios-profesionales';

-- Clear and re-insert all categories
DELETE FROM categories;

INSERT INTO categories (nombre, slug, icono, orden, activo) VALUES
  ('Comida y Bebidas', 'comida', 'UtensilsCrossed', 1, true),
  ('Ropa y Accesorios', 'ropa', 'Shirt', 2, true),
  ('Tecnología', 'tecnologia', 'Smartphone', 3, true),
  ('Hogar y Jardín', 'hogar', 'Home', 4, true),
  ('Belleza', 'belleza', 'Sparkles', 5, true),
  ('Salud y Bienestar', 'salud', 'HeartPulse', 6, true),
  ('Deportes y Fitness', 'deportes', 'Dumbbell', 7, true),
  ('Mascotas', 'mascotas', 'PawPrint', 8, true),
  ('Bebés y Niños', 'bebes', 'Baby', 9, true),
  ('Vehículos', 'vehiculos', 'Car', 10, true),
  ('Libros y Papelería', 'libros', 'BookOpen', 11, true),
  ('Juguetes y Juegos', 'juguetes', 'Gamepad2', 12, true),
  ('Arte y Manualidades', 'arte', 'Palette', 13, true),
  ('Muebles', 'muebles', 'Armchair', 14, true),
  ('Servicios del Hogar', 'servicios-hogar', 'Wrench', 15, true),
  ('Educación y Clases', 'educacion', 'GraduationCap', 16, true),
  ('Eventos', 'eventos', 'PartyPopper', 17, true),
  ('Transporte y Mudanzas', 'transporte', 'Truck', 18, true),
  ('Diseño y Tech', 'diseno-tech', 'Code', 19, true),
  ('Salud y Terapias', 'salud-terapias', 'Stethoscope', 20, true),
  ('Fotografía y Video', 'fotografia', 'Camera', 21, true),
  ('Inmuebles', 'inmuebles', 'Building', 22, true),
  ('Empleos', 'empleos', 'Briefcase', 23, true),
  ('Otros', 'otros', 'MoreHorizontal', 24, true);
