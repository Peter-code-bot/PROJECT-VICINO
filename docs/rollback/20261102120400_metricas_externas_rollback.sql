-- Reversion de 20261102120400_metricas_externas. Se corre a mano. Solo quita
-- las dos funciones de lectura; no hay datos que restaurar.

begin;
DROP FUNCTION IF EXISTS public.metricas_semanales_externas(integer);
DROP FUNCTION IF EXISTS public.metricas_resumen_externas();
commit;
