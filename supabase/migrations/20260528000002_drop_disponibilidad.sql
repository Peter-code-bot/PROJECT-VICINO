-- MP#07 Item #6 — Drop unused disponibilidad column.
-- Audit confirmed 0 filled rows in production. No code reads.
-- Verified via SQL Camino 2 in Supabase Studio 29-May-2026.

ALTER TABLE public.products_services DROP COLUMN disponibilidad;
