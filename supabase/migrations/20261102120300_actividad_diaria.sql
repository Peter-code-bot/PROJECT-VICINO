-- Actividad diaria privada, y profiles.last_seen_at deja de usarse.
--
-- El 1-nov-2026 se comprobo que profiles.last_seen_at nunca cambia despues del
-- alta: nace con now() y nada lo vuelve a escribir. Ni la app ni ninguna
-- funcion lo leen, pero sale en cualquier consulta de "usuarios activos" y da
-- una cifra falsa. last_sign_in_at de auth tampoco sirve: las sesiones no
-- caducan.
--
-- No se arregla escribiendo en profiles, y no es por el costo:
--   * anon y authenticated tienen SELECT sobre profiles.last_seen_at Y sobre
--     profiles.updated_at, y la RLS deja leer cualquier perfil visible. Un
--     last_seen_at vivo publicaria a que hora entra cada persona.
--   * revocar last_seen_at no basta: el trigger profiles_updated_at sella
--     updated_at en cada UPDATE, asi que la hora de la visita se filtraria
--     igual por updated_at.
--
-- En su lugar:
--   * public.actividad_diaria: una fila por cuenta y dia (hora de CDMX) con
--     sesion. RLS sin policies y sin privilegios para anon/authenticated. Da
--     usuarios activos por dia, semana o mes, que un solo timestamp no da.
--   * public.marcar_visto(): la unica escritura. SECURITY DEFINER, solo para
--     authenticated, solo puede marcar a quien llama, y la llave primaria hace
--     que el segundo llamado del dia no escriba nada. El proxy la llama una vez
--     por cuenta, dispositivo y dia (cookie vicino_visto), despues de responder.
--   * profiles.last_seen_at queda documentada como obsoleta. No se borra.
--
-- Se borra con la cuenta: ON DELETE CASCADE sobre auth.users.
-- Reversion: docs/rollback/20261102120300_actividad_diaria_rollback.sql
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.actividad_diaria (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  dia         date NOT NULL,
  primera_vez timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dia)
);

-- Para "activos en la semana X" sin recorrer la tabla por cuenta.
CREATE INDEX IF NOT EXISTS actividad_diaria_dia_idx ON public.actividad_diaria (dia);

COMMENT ON TABLE public.actividad_diaria IS
  'Un dia (hora de CDMX) con sesion abierta por cuenta. Solo la escribe marcar_visto(); no es publica. Ver 20261102120300_actividad_diaria.sql.';

ALTER TABLE public.actividad_diaria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.actividad_diaria FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.actividad_diaria TO service_role;

CREATE OR REPLACE FUNCTION public.marcar_visto()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  INSERT INTO public.actividad_diaria (user_id, dia)
  SELECT (SELECT auth.uid()), (now() AT TIME ZONE 'America/Mexico_City')::date
   WHERE (SELECT auth.uid()) IS NOT NULL
  ON CONFLICT (user_id, dia) DO NOTHING;
$function$;

REVOKE ALL ON FUNCTION public.marcar_visto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_visto() TO authenticated;

COMMENT ON COLUMN public.profiles.last_seen_at IS
  'OBSOLETA desde 20261102120300: nunca se actualiza despues del alta. No usar para medir actividad; la actividad vive en public.actividad_diaria.';

DO $verify$
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.actividad_diaria'::regclass) THEN
    RAISE EXCEPTION 'actividad_diaria quedo sin RLS';
  END IF;
  IF has_table_privilege('anon', 'public.actividad_diaria', 'SELECT')
     OR has_table_privilege('authenticated', 'public.actividad_diaria', 'SELECT')
     OR has_table_privilege('authenticated', 'public.actividad_diaria', 'INSERT') THEN
    RAISE EXCEPTION 'actividad_diaria quedo expuesta a anon/authenticated';
  END IF;
  IF has_function_privilege('anon', 'public.marcar_visto()', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon puede llamar marcar_visto()';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.marcar_visto()', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated no puede llamar marcar_visto()';
  END IF;
END
$verify$;
