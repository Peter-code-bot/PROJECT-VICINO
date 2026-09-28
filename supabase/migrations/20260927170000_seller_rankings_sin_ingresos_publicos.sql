-- Los ingresos de cada vendedor dejan de ser publicos.
--
-- Hallazgo S08 (revision del 27-sep-2026, confirmado en solo lectura en prod):
-- seller_rankings tiene la policy «Rankings are publicly readable» (SELECT
-- USING true, 20260827130000) y el SELECT de TABLA que Supabase da a anon y
-- authenticated. Con la clave anon, GET /rest/v1/seller_rankings devolvia
-- ingresos, ventas_count y response_avg_minutes de cada seller_id por mes y
-- categoria: cuanto factura cada vendedor.
--
-- La app solo lee directo category_id por periodo (lib/rankings/queries.ts,
-- getActiveCategoryIdsForPeriod). El podio y los periodos salen de
-- get_ranking_hiperlocal y get_available_ranking_periods, que son SECURITY
-- DEFINER y no dependen de estos privilegios.
--
-- Reversion: docs/rollback/20260927170000_seller_rankings_sin_ingresos_publicos_rollback.sql
-- Idempotente.

REVOKE SELECT ON public.seller_rankings FROM anon, authenticated;
GRANT SELECT (category_id, period) ON public.seller_rankings TO anon, authenticated;
-- La RLS ya lo impide, pero los privilegios de tabla existian.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.seller_rankings FROM anon, authenticated;

DO $verify$
BEGIN
  IF has_column_privilege('anon', 'public.seller_rankings', 'ingresos', 'SELECT')
     OR has_column_privilege('anon', 'public.seller_rankings', 'seller_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.seller_rankings', 'ingresos', 'SELECT')
     OR has_column_privilege('authenticated', 'public.seller_rankings', 'ventas_count', 'SELECT') THEN
    RAISE EXCEPTION 'seller_rankings sigue exponiendo ingresos/seller_id/ventas_count';
  END IF;
  IF NOT (has_column_privilege('anon', 'public.seller_rankings', 'category_id', 'SELECT')
          AND has_column_privilege('anon', 'public.seller_rankings', 'period', 'SELECT')
          AND has_column_privilege('authenticated', 'public.seller_rankings', 'category_id', 'SELECT')) THEN
    RAISE EXCEPTION 'se revoco de mas: getActiveCategoryIdsForPeriod dejaria de funcionar';
  END IF;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE proname = 'get_ranking_hiperlocal' LIMIT 1) THEN
    RAISE EXCEPTION 'get_ranking_hiperlocal ya no es SECURITY DEFINER: el podio dependeria de estos privilegios';
  END IF;
END
$verify$;
