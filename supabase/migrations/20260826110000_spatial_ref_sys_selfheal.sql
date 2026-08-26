-- Red de seguridad para spatial_ref_sys, que NO se puede blindar desde aqui.
--
-- EL PROBLEMA (verificado el 26-ago-2026 contra produccion):
--   public.spatial_ref_sys tiene RLS desactivada y la ACL dice
--   anon=arwdDxtm/supabase_admin: el rol anonimo tiene TODOS los privilegios,
--   incluido DELETE, otorgados por supabase_admin.
--
--   Y esta expuesta por la API publica. Comprobado con la llave anon, la misma
--   que viaja dentro de la web y del APK:
--     GET    /rest/v1/spatial_ref_sys?select=srid&limit=1   -> 200
--     DELETE /rest/v1/spatial_ref_sys?srid=eq.-1            -> 200 (aceptado)
--   El segundo uso un filtro imposible a proposito. Con srid=eq.4326 habria
--   borrado WGS84, el sistema de coordenadas de TODAS las ubicaciones de VICINO,
--   y con el se cae search_nearby_products_v4, el feed de cercania entero y el
--   ranking por ubicacion. Sin iniciar sesion.
--
-- POR QUE NO SE ARREGLA AQUI:
--   Los GRANT los hizo supabase_admin, y en Postgres un REVOKE emitido por quien
--   no otorgo el permiso es un no-op SILENCIOSO — no falla, simplemente no hace
--   nada. Se intento como postgres (no es superusuario) y via
--   supabase_privileged_role: ninguno funciona, y SET ROLE supabase_admin esta
--   denegado. Hay que escalarlo a soporte de Supabase, o mover PostGIS al
--   esquema extensions, que es donde lo instalan los proyectos nuevos.
--
-- QUE HACE ESTA MIGRACION:
--   No evita el borrado. Lo vuelve reversible en un comando y, con el cron,
--   automaticamente reversible en menos de una hora. Convierte "el feed esta
--   muerto y nadie sabe por que" en "se reparo solo".
--
--   El esquema vicino_guard NO esta en los esquemas expuestos por PostgREST
--   (solo lo estan public y graphql_public), asi que el respaldo queda fuera del
--   alcance de la API. Ademas se revoca USAGE a anon y authenticated.

CREATE SCHEMA IF NOT EXISTS vicino_guard;
REVOKE ALL ON SCHEMA vicino_guard FROM PUBLIC, anon, authenticated;

-- Respaldo de las definiciones. Se puebla una vez y se refresca solo si crece,
-- para que un borrado no se propague al respaldo.
CREATE TABLE IF NOT EXISTS vicino_guard.spatial_ref_sys_backup (
  srid      integer PRIMARY KEY,
  auth_name character varying(256),
  auth_srid integer,
  srtext    character varying(2048),
  proj4text character varying(2048)
);

INSERT INTO vicino_guard.spatial_ref_sys_backup (srid, auth_name, auth_srid, srtext, proj4text)
SELECT srid, auth_name, auth_srid, srtext, proj4text
FROM public.spatial_ref_sys
ON CONFLICT (srid) DO NOTHING;

COMMENT ON TABLE vicino_guard.spatial_ref_sys_backup IS
  'Respaldo de public.spatial_ref_sys, que es borrable por cualquier anonimo via la API REST y no se puede blindar sin supabase_admin. Ver 20260826110000.';

-- ---------------------------------------------------------------------------
-- Reparacion: reinserta lo que falte. Idempotente y barata cuando no falta nada.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION vicino_guard.restore_spatial_ref_sys()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_restored integer;
BEGIN
  INSERT INTO public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text)
  SELECT b.srid, b.auth_name, b.auth_srid, b.srtext, b.proj4text
  FROM vicino_guard.spatial_ref_sys_backup b
  WHERE NOT EXISTS (
    SELECT 1 FROM public.spatial_ref_sys s WHERE s.srid = b.srid
  );

  GET DIAGNOSTICS v_restored = ROW_COUNT;

  IF v_restored > 0 THEN
    -- Que quede en el log de Postgres: si esto se dispara, alguien borro filas.
    RAISE WARNING 'spatial_ref_sys: se restauraron % definiciones borradas', v_restored;
  END IF;

  RETURN v_restored;
END;
$function$;

REVOKE ALL ON FUNCTION vicino_guard.restore_spatial_ref_sys() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION vicino_guard.restore_spatial_ref_sys() IS
  'Reinserta las definiciones de spatial_ref_sys que falten respecto al respaldo. Devuelve cuantas restauro. Correr a mano si el feed de cercania deja de devolver resultados.';

-- ---------------------------------------------------------------------------
-- Cron cada hora. Es SQL directo, no HTTP: no pasa por pg_net, asi que no le
-- aplican los timeouts ni la ceguera de net._http_response.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  PERFORM cron.unschedule('restore-spatial-ref-sys-hourly');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'restore-spatial-ref-sys-hourly',
  '23 * * * *',
  $job$ SELECT vicino_guard.restore_spatial_ref_sys(); $job$
);

-- VERIFY:
--   SELECT count(*) FROM vicino_guard.spatial_ref_sys_backup;  -- esperado: 8500
--
--   Simulacro completo, revertido:
--     BEGIN;
--       DELETE FROM public.spatial_ref_sys WHERE srid = 4326;
--       SELECT vicino_guard.restore_spatial_ref_sys();   -- esperado: 1
--       SELECT count(*) FROM public.spatial_ref_sys;     -- esperado: 8500
--     ROLLBACK;
--
--   Y que el respaldo siga fuera del alcance de la API:
--     curl "$URL/rest/v1/spatial_ref_sys_backup" -H "apikey: <anon>"  -> 404
