-- Migración para agregar columna sort_order a la tabla products_services
-- Permitirá a los vendedores ordenar manualmente sus productos en su perfil.

ALTER TABLE public.products_services
ADD COLUMN sort_order integer DEFAULT 0;

COMMENT ON COLUMN public.products_services.sort_order IS 'Orden visual personalizado establecido por el vendedor para su perfil';
