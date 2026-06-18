-- Migración: idx_products_pagination
-- Propósito: Optimizar la paginación Keyset usando un índice compuesto de fecha de creación y UUID.
-- Zero-downtime: Ejecutado de forma concurrente para no bloquear transacciones.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_pagination
  ON public.products_services (created_at DESC, id DESC);
