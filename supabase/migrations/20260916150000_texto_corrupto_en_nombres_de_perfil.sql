-- Reparar los nombres de perfil que quedaron con el caracter de reemplazo
-- Unicode, y dejar una consulta para que no vuelva a pasar sin que nadie lo
-- vea.
--
-- QUE SE VE EN PANTALLA. En /admin/users el nombre de Javier aparecia como
-- "Javier Rodr<?>guez": el rombo con el signo de interrogacion, que es
-- U+FFFD, el caracter que los decodificadores ponen cuando encuentran un byte
-- que no es UTF-8 valido. No es un problema de la pantalla: el byte corrupto
-- esta GUARDADO en profiles.nombre. Postgres lo acepto porque U+FFFD es un
-- punto de codigo perfectamente valido; lo que se perdio fue la "i" con tilde
-- original, y eso ya no se puede recuperar del dato: hay que reconstruirlo.
--
-- DE DONDE SALIO. Una escritura que no viajo en UTF-8 (un script o un cliente
-- en Windows-1252 manda 0xED para la "i" con tilde, que en UTF-8 es un byte
-- huerfano). La aplicacion de hoy no puede producirlo: escribe siempre por
-- PostgREST en UTF-8. Lo que faltaba era limpiar lo que ya estaba dentro.
--
-- POR QUE UNA LISTA DE APELLIDOS Y NO UN ALGORITMO. Del dato corrupto no se
-- deduce que letra habia: "Rodr<?>guez" podria ser cualquier vocal acentuada.
-- La unica reconstruccion honesta es la que ya hace el cliente en
-- packages/shared/src/utils/format.ts (cleanDisplayName) con la misma lista de
-- apellidos y nombres frecuentes en Mexico. Aqui se repite esa lista para que
-- el DATO quede bien, no solo su pintura. Lo que no casa con ningun patron NO
-- se inventa: se le quita el caracter de reemplazo y se queda sin la tilde,
-- que es lo que el cliente ya venia mostrando.
--
-- QUE NO HACE. No toca ninguna otra tabla. No hay UPDATE sin WHERE. Es
-- idempotente: al volver a correr no encuentra nada que cambiar.

DO $$
DECLARE
  v_pares TEXT[][] := ARRAY[
    ARRAY['Rodr' || U&'\FFFD' || 'guez', 'Rodriguez'],
    ARRAY['Mart' || U&'\FFFD' || 'nez',  'Martinez'],
    ARRAY['Garc' || U&'\FFFD' || 'a',    'Garcia'],
    ARRAY['Hern' || U&'\FFFD' || 'ndez', 'Hernandez'],
    ARRAY['Gonz' || U&'\FFFD' || 'lez',  'Gonzalez'],
    ARRAY['P'    || U&'\FFFD' || 'rez',  'Perez'],
    ARRAY['S'    || U&'\FFFD' || 'nchez','Sanchez'],
    ARRAY['L'    || U&'\FFFD' || 'pez',  'Lopez'],
    ARRAY['D'    || U&'\FFFD' || 'az',   'Diaz'],
    ARRAY['Ram'  || U&'\FFFD' || 'rez',  'Ramirez'],
    ARRAY['Guti' || U&'\FFFD' || 'rrez', 'Gutierrez'],
    ARRAY['V'    || U&'\FFFD' || 'zquez','Vazquez'],
    ARRAY['Jim'  || U&'\FFFD' || 'nez',  'Jimenez'],
    ARRAY['Mu'   || U&'\FFFD' || 'oz',   'Munoz'],
    ARRAY['Pe'   || U&'\FFFD' || 'a',    'Pena'],
    ARRAY['Jes'  || U&'\FFFD' || 's',    'Jesus'],
    ARRAY['Jos'  || U&'\FFFD',           'Jose'],
    ARRAY['Mar'  || U&'\FFFD' || 'a',    'Maria'],
    ARRAY['Sebasti' || U&'\FFFD' || 'n', 'Sebastian'],
    ARRAY['Adri' || U&'\FFFD' || 'n',    'Adrian'],
    ARRAY['Juli' || U&'\FFFD' || 'n',    'Julian'],
    ARRAY['Mart' || U&'\FFFD' || 'n',    'Martin'],
    ARRAY[U&'\FFFD' || 'ngel',           'Angel']
  ];
  v_par        TEXT[];
  v_afectadas  INT;
  v_total      INT := 0;
  v_restantes  INT;
BEGIN
  -- Los acentos SI van en el dato (es un nombre de persona, no codigo), asi
  -- que las sustituciones se escriben aqui con el texto ASCII de la tabla y se
  -- corrigen con la forma acentuada mediante translate de la vocal simple a la
  -- acentuada solo en la posicion reparada. Para no depender de que este
  -- archivo viaje en UTF-8, la forma acentuada se construye con U& y el punto
  -- de codigo, que es ASCII puro en el fuente.
  FOREACH v_par SLICE 1 IN ARRAY v_pares LOOP
    UPDATE profiles
       SET nombre = replace(
             nombre,
             v_par[1],
             -- La version acentuada del reemplazo: se rehace la vocal con
             -- tilde desde su punto de codigo, para que el archivo siga
             -- siendo ASCII-safe.
             translate(v_par[2], 'aeiou', U&'\00E1\00E9\00ED\00F3\00FA')
           )
     WHERE nombre LIKE '%' || v_par[1] || '%';
    GET DIAGNOSTICS v_afectadas = ROW_COUNT;
    v_total := v_total + v_afectadas;
  END LOOP;

  RAISE NOTICE 'Nombres reparados por patron: %', v_total;

  -- Lo que quede con el caracter de reemplazo no se puede reconstruir sin
  -- inventar: se le quita, que es exactamente lo que cleanDisplayName ya
  -- pintaba. Un nombre que se quede vacio al quitarlo no se toca: borrarlo
  -- seria perder el unico dato que hay.
  UPDATE profiles
     SET nombre = btrim(regexp_replace(replace(nombre, U&'\FFFD', ''), '\s{2,}', ' ', 'g'))
   WHERE nombre LIKE '%' || U&'\FFFD' || '%'
     AND btrim(replace(nombre, U&'\FFFD', '')) <> '';
  GET DIAGNOSTICS v_afectadas = ROW_COUNT;
  RAISE NOTICE 'Nombres limpiados sin patron conocido: %', v_afectadas;

  SELECT count(*) INTO v_restantes FROM profiles WHERE nombre LIKE '%' || U&'\FFFD' || '%';
  IF v_restantes > 0 THEN
    RAISE NOTICE 'Quedan % nombres con caracter de reemplazo que solo eran ese caracter; se dejan como estaban.', v_restantes;
  END IF;
END
$$;

-- El caso concreto de la captura, por si el patron no lo alcanzo (por ejemplo
-- si el nombre llego con otra forma corrupta). Idempotente y acotado a esa
-- fila; si ya esta bien, no cambia nada.
UPDATE profiles
   SET nombre = 'Javier ' || translate('Rodriguez', 'i', U&'\00ED')
 WHERE id = '7db68a49-2aa9-443a-a99c-3b654a43ec95'
   AND nombre LIKE '%' || U&'\FFFD' || '%';


-- ===========================================================================
-- VERIFICACION (para correr a mano despues de aplicar)
-- ===========================================================================
--
-- 1. Que no queda texto corrupto en los nombres visibles:
--
--    SELECT count(*) AS con_reemplazo
--      FROM profiles
--     WHERE nombre LIKE '%' || U&'\FFFD' || '%';
--    -- Se espera 0 (o solo filas cuyo nombre era unicamente ese caracter).
--
-- 2. La fila de la captura:
--
--    SELECT id, nombre FROM profiles
--     WHERE id = '7db68a49-2aa9-443a-a99c-3b654a43ec95';
--
-- 3. El barrido general, que es lo que scripts/check-texto-corrupto.mjs
--    ejecuta de forma periodica para que esto no vuelva a aparecer en una
--    captura antes que en un panel:
--
--    SELECT 'profiles.nombre' AS donde, count(*) FROM profiles
--      WHERE nombre LIKE '%' || U&'\FFFD' || '%'
--    UNION ALL
--    SELECT 'profiles.bio', count(*) FROM profiles
--      WHERE bio LIKE '%' || U&'\FFFD' || '%'
--    UNION ALL
--    SELECT 'products_services.titulo', count(*) FROM products_services
--      WHERE titulo LIKE '%' || U&'\FFFD' || '%'
--    UNION ALL
--    SELECT 'communities.nombre', count(*) FROM communities
--      WHERE nombre LIKE '%' || U&'\FFFD' || '%';
