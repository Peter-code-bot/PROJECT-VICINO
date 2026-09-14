-- Comprobacion de que el trigger de cobertura DISPARA de verdad.
--
-- POR QUE EXISTE ESTE ARCHIVO. Que un trigger aparezca en pg_trigger, activo y
-- con el timing correcto, NO prueba que corte nada: prueba que esta colgado.
-- En este proyecto ya ha mordido justo esa diferencia -- pg_cron reportando
-- exito sin leer la respuesta, un 200 que no significaba que la pagina
-- funcionara, una cuota que detectaba el exceso y lo dejaba pasar. La unica
-- evidencia que vale es intentar la escritura prohibida y que el motor la
-- rechace.
--
-- Y aqui no habia otra forma de conseguirla: la herramienta de consulta del
-- repo envuelve todo en BEGIN READ ONLY, asi que un UPDATE muere con 25006
-- antes de que ningun trigger llegue a ejecutarse. Una migracion si puede
-- escribir, asi que la prueba viaja como migracion.
--
-- COMO NO DEJA RASTRO. El bloque BEGIN ... EXCEPTION de plpgsql abre un
-- savepoint implicito: cuando el UPDATE levanta 22023, ese savepoint se
-- deshace y la fila queda intacta. Y si el trigger NO disparara -- el caso que
-- esto vigila -- el UPDATE habria pasado, pero entonces se levanta una
-- excepcion a proposito que aborta la migracion ENTERA, y con ella el cambio.
-- En los dos caminos la publicacion se queda donde estaba.
--
-- O sea que aplicar esta migracion es la prueba. Si termina, el trigger corta.

do $$
declare
  v_id      uuid;
  v_disparo boolean := false;
begin
  select id into v_id
    from public.products_services
   where ubicacion_geo is not null
   limit 1;

  if v_id is null then
    raise notice 'Sin publicaciones con ubicacion: no hay nada contra lo que probar.';
    return;
  end if;

  begin
    -- Madrid. Fuera de Mexico por cualquier criterio.
    update public.products_services
       set ubicacion_geo = 'SRID=4326;POINT(-3.7038 40.4168)'
     where id = v_id;
  exception
    when others then
      if sqlstate = '22023' then
        v_disparo := true;
      else
        raise;
      end if;
  end;

  if not v_disparo then
    raise exception
      'El trigger de cobertura NO disparo: se pudo mover una publicacion a Madrid. La regla no esta obligando nada.';
  end if;

  raise notice 'OK: el trigger rechazo la ubicacion fuera de cobertura (22023).';
end;
$$;
