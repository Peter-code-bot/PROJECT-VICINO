-- Reversion de 20260927170000_seller_rankings_sin_ingresos_publicos. Se corre a mano.
-- ADVERTENCIA: vuelve a publicar los ingresos de cada vendedor a la clave anon.
-- Devuelve los privilegios de tabla que Supabase da por defecto.

begin;
REVOKE SELECT (category_id, period) ON public.seller_rankings FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.seller_rankings TO anon, authenticated;
commit;
