-- Reversion de 20261108190000_sin_modo_vendedor_no_se_muestra.sql
-- Una sola transaccion (BEGIN..COMMIT).
--
-- Devuelve el WITH CHECK de "Sellers can update own products" a como estaba
-- (dueno y no suspendido). Con esto, una cuenta sin Modo Vendedor vuelve a
-- poder dejar 'disponible' una publicacion pausada; la app lo sigue frenando
-- en toggleProductStatus, pero PostgREST directo no.

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER POLICY "Sellers can update own products" ON public.products_services
  WITH CHECK (
    ((SELECT auth.uid()) = creador_id)
    AND (NOT (SELECT vicino_guard.cuenta_suspendida()))
  );
COMMIT;

-- La fila del ledger se quita aparte, a mano:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261108190000';
