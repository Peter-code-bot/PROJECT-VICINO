-- Reversion de 20261102120000_cuentas_internas. Se corre a mano.
--
-- ORDEN: las migraciones de esta serie se revierten de la ultima a la primera
-- (120400 -> 120300 -> 120200 -> 120100 -> 120000). Las funciones de 120100 y
-- 120400 leen cuentas_internas: si esta tabla se borra antes, cada venta que se
-- complete FALLA (check_sale_completion).
--
-- Los DATOS no se adivinan aqui: que perfiles y comunidades estaban ocultos
-- antes (por moderacion, por ejemplo) lo dice el respaldo. Restaurarlos con el
-- restaurar-*.sql que genero scripts/respaldo-cuentas-internas.mjs justo antes
-- de aplicar.

begin;

DROP POLICY IF EXISTS purchase_requests_select ON public.purchase_requests;
CREATE POLICY purchase_requests_select ON public.purchase_requests
  FOR SELECT
  USING ((status = 'open'::public.request_status) OR (buyer_id = auth.uid()));

DROP TABLE IF EXISTS public.cuentas_internas;

commit;
