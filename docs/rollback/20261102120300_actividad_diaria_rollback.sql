-- Reversion de 20261102120300_actividad_diaria. Se corre a mano, DESPUES de
-- revertir 20261102120400 (las metricas leen actividad_diaria) y junto con el
-- cambio del proxy (lib/supabase/middleware.ts llama marcar_visto: sin la
-- funcion, cada dispositivo deja un error en Sentry una vez al dia).
-- ADVERTENCIA: borra el historial de dias activos.

begin;
DROP FUNCTION IF EXISTS public.marcar_visto();
DROP TABLE IF EXISTS public.actividad_diaria;
COMMENT ON COLUMN public.profiles.last_seen_at IS NULL;
commit;
