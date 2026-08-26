-- Devolver las coordenadas de una publicacion propia, ya interpretadas.
--
-- Al abrir "Editar publicacion" el vendedor veia un buscador vacio y ningun
-- mapa, como si nunca hubiera puesto ubicacion. Causa: la pagina de edicion no
-- selecciona ubicacion_geo, y el formulario tampoco pasa initialLat/initialLng
-- al mapa, que SI acepta esas props.
--
-- El dato no se pierde —vender/actions.ts:615 solo toca ubicacion_geo si
-- llegan lat y lng, precisamente para no borrarlo— pero el vendedor no puede
-- ver ni ajustar donde esta, y si quiere moverlo tiene que buscar su direccion
-- desde cero.
--
-- Por que un RPC y no anadir la columna al SELECT: ubicacion_geo es de tipo
-- geography, y PostgREST la devuelve en un formato binario hexadecimal que
-- habria que interpretar en TypeScript. En todo el repo no existe hoy ni un
-- solo lector de esa columna desde el cliente, asi que no hay patron probado
-- que copiar, y escribir un interprete de EWKB para leer dos numeros es
-- desproporcionado. La base ya sabe hacerlo con ST_Y y ST_X.
--
-- Comprueba propiedad por dentro aunque la pagina ya la comprueba antes: es
-- SECURITY DEFINER, asi que brinca la RLS, y sin esa comprobacion cualquiera
-- podria pedir las coordenadas exactas de la publicacion de otro. Ojo con eso:
-- el feed publico solo expone la distancia REDONDEADA a 100 m justamente para
-- no revelar la posicion exacta de un vendedor.

CREATE OR REPLACE FUNCTION public.get_product_location(p_product_id UUID)
RETURNS TABLE(lat DOUBLE PRECISION, lng DOUBLE PRECISION)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT ST_Y(ps.ubicacion_geo::geometry), ST_X(ps.ubicacion_geo::geometry)
  FROM products_services ps
  WHERE ps.id = p_product_id
    AND ps.creador_id = v_uid          -- solo la propia
    AND ps.ubicacion_geo IS NOT NULL;
  -- Cero filas si no es suya o si no tiene ubicacion. El llamador distingue
  -- ambas cosas de "no hay dato" sin necesitar dos codigos distintos.
END;
$$;

REVOKE ALL ON FUNCTION public.get_product_location(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_product_location(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_product_location(UUID) TO authenticated;

-- VERIFY:
--   SELECT has_function_privilege('anon','public.get_product_location(uuid)','EXECUTE');
--   -- esperado: false
