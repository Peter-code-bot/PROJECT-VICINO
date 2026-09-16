-- Quitar el EXECUTE que PUBLIC hereda por defecto en las funciones
-- SECURITY DEFINER de `public`.
--
-- QUE ES ESTO Y QUE NO ES. No cierra ningun agujero hoy: las 26 funciones
-- afectadas ya tienen GRANT EXECUTE explicito a `anon` y a `authenticated`, asi
-- que revocarle a PUBLIC no le quita el acceso a nadie. Comprobado antes de
-- escribir esto, funcion por funcion: cero de las 26 dependen SOLO del grant de
-- PUBLIC.
--
-- POR QUE SE HACE IGUAL. Porque `=X/postgres` en la ACL es una trampa, y en
-- esta misma jornada ya mordio una version de ella. Al intentar revocar la
-- lectura de products_services.ubicacion_geo, el REVOKE por COLUMNA no hizo
-- nada: habia un privilegio de TABLA por encima que lo cubria. No fallo, no
-- aviso — simplemente la columna siguio saliendo por la API, y solo se
-- descubrio porque despues se verifico el resultado en vez de darlo por bueno.
--
-- Aqui el mecanismo es el mismo un escalon mas arriba: mientras PUBLIC tenga
-- EXECUTE, un futuro `REVOKE EXECUTE ... FROM anon` sobre cualquiera de estas
-- funciones parecera funcionar y no cerrara nada, porque `anon` es miembro de
-- PUBLIC y seguiria ejecutandola por esa via. Quien lo haga lo dara por hecho.
-- Esta migracion hace que ese REVOKE futuro signifique lo que dice.
--
-- Postgres concede EXECUTE a PUBLIC en CADA funcion nueva, por defecto y sin
-- que nadie lo escriba, asi que esto reaparece con cada funcion que se cree sin
-- un REVOKE explicito. La comprobacion de abajo sirve para volver a barrerlo.
--
-- QUE NO SE TOCA:
--   - `st_estimatedextent`: es de PostGIS, no nuestra.
--   - Las funciones que dependieran solo de PUBLIC: no hay ninguna, pero el
--     bucle lo comprueba igual en vez de fiarse de la lista.
--
-- Las funciones de trigger conservan su comportamiento pase lo que pase: el
-- privilegio de EXECUTE se comprueba al CREAR el trigger, no al dispararlo.

do $$
declare
  f record;
  n integer := 0;
begin
  for f in
    select p.oid,
           p.oid::regprocedure::text as firma
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prosecdef
       and p.proacl is not null
       and array_to_string(p.proacl, ',') like '=X/%'
       and p.proname <> 'st_estimatedextent'
       -- Solo si alguien MAS puede seguir ejecutandola: sin esto, revocarle a
       -- PUBLIC una funcion que solo PUBLIC podia llamar la dejaria muerta.
       and (
         array_to_string(p.proacl, ',') like '%anon=X%'
         or array_to_string(p.proacl, ',') like '%authenticated=X%'
         or exists (select 1 from pg_trigger t where t.tgfoid = p.oid)
       )
  loop
    execute format('revoke execute on function %s from public', f.firma);
    n := n + 1;
  end loop;

  raise notice 'EXECUTE de PUBLIC retirado en % funciones SECURITY DEFINER.', n;
end;
$$;

-- ---------------------------------------------------------------------------
-- VERIFY
--
--   -- Cuantas quedan con EXECUTE para PUBLIC (esperado: solo st_estimatedextent):
--   SELECT p.proname
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname='public' AND p.prosecdef
--      AND array_to_string(p.proacl, ',') LIKE '=X/%';
--
--   -- Y que lo que la app usa sigue vivo, con la llave anon:
--   POST /rest/v1/rpc/get_ranking_hiperlocal   -> 200
--   GET  https://vicinomarket.com/rankings     -> 200
--   GET  https://vicinomarket.com/             -> 200
-- ---------------------------------------------------------------------------
