-- Deshacer la sobre-acentuacion que dejo 20260916150000.
--
-- QUE PASO. La migracion anterior reparaba los nombres con el caracter de
-- reemplazo Unicode y, para no escribir acentos en el archivo, construia la
-- forma correcta con translate(forma_ascii, 'aeiou', 'aeiou acentuadas'). Eso
-- acentua TODAS las vocales, no solo la que llevaba tilde: "Javier
-- Rodr<?>guez" quedo como "Javier Rodrigu ez" con las cinco vocales
-- acentuadas. Un apellido mal escrito de otra forma no es un arreglo.
--
-- Comprobado en produccion tras aplicarla: UNA fila afectada
-- (0186140a-f8b9-4cd9-bde8-a426a024fec5). Esta migracion la devuelve a su
-- forma correcta y barre las demas formas que ese translate pudo producir,
-- por si otra fila aparece despues (un entorno de pruebas replicando el
-- ledger, por ejemplo).
--
-- LA LECCION, que es la que importa: el reemplazo acentuado se escribe
-- ENTERO, con U&'...' y el punto de codigo de cada letra, nunca derivandolo
-- de la forma sin acentos. Asi el archivo sigue siendo ASCII puro (no depende
-- de la codificacion del editor ni del transporte) y dice exactamente que
-- texto va a quedar guardado. La lista de abajo es la forma correcta de
-- hacerlo.
--
-- Idempotente: al volver a correr no encuentra nada que cambiar.

-- ===========================================================================
-- VERIFICACION (para correr a mano despues de aplicar)
-- ===========================================================================
--
-- 1. La fila que la migracion anterior dano:
--
--    SELECT id, nombre FROM profiles
--     WHERE id = '0186140a-f8b9-4cd9-bde8-a426a024fec5';
--    -- Se espera: Javier Rodriguez con la i acentuada y el resto sin acento.
--
-- 2. Que no queda ninguna forma sobre-acentuada de las que ese translate
--    podia producir. Dos vocales acentuadas en la misma palabra no
--    ocurren en castellano, asi que sirven de senal:
--
--    SELECT id, nombre FROM profiles
--     WHERE nombre ~ '[[:alpha:]]*[^[:ascii:]][[:alpha:]]*[^[:ascii:]]'
--     ORDER BY nombre;
--    -- Se esperan 0 filas (salvo nombres con dos letras no ASCII de
--    -- verdad, que habria que mirar uno a uno).
--
-- 3. Y que sigue sin haber texto corrupto:
--
--    node scripts/check-texto-corrupto.mjs


DO $$
DECLARE
  v_pares TEXT[][] := ARRAY[
    ARRAY[U&'R\00F3dr\00EDg\00FA\00E9z', U&'Rodr\00EDguez'],
    ARRAY[U&'M\00E1rt\00EDn\00E9z', U&'Mart\00EDnez'],
    ARRAY[U&'G\00E1rc\00ED\00E1', U&'Garc\00EDa'],
    ARRAY[U&'H\00E9rn\00E1nd\00E9z', U&'Hern\00E1ndez'],
    ARRAY[U&'G\00F3nz\00E1l\00E9z', U&'Gonz\00E1lez'],
    ARRAY[U&'P\00E9r\00E9z', U&'P\00E9rez'],
    ARRAY[U&'S\00E1nch\00E9z', U&'S\00E1nchez'],
    ARRAY[U&'L\00F3p\00E9z', U&'L\00F3pez'],
    ARRAY[U&'D\00ED\00E1z', U&'D\00EDaz'],
    ARRAY[U&'R\00E1m\00EDr\00E9z', U&'Ram\00EDrez'],
    ARRAY[U&'G\00FAt\00ED\00E9rr\00E9z', U&'Guti\00E9rrez'],
    ARRAY[U&'V\00E1zq\00FA\00E9z', U&'V\00E1zquez'],
    ARRAY[U&'J\00EDm\00E9n\00E9z', U&'Jim\00E9nez'],
    ARRAY[U&'M\00FAn\00F3z', U&'Mu\00F1oz'],
    ARRAY[U&'P\00E9n\00E1', U&'Pe\00F1a'],
    ARRAY[U&'J\00E9s\00FAs', U&'Jes\00FAs'],
    ARRAY[U&'J\00F3s\00E9', U&'Jos\00E9'],
    ARRAY[U&'M\00E1r\00ED\00E1', U&'Mar\00EDa'],
    ARRAY[U&'S\00E9b\00E1st\00ED\00E1n', U&'Sebasti\00E1n'],
    ARRAY[U&'Adr\00ED\00E1n', U&'Adri\00E1n'],
    ARRAY[U&'J\00FAl\00ED\00E1n', U&'Juli\00E1n'],
    ARRAY[U&'M\00E1rt\00EDn', U&'Mart\00EDn'],
    ARRAY[U&'Ang\00E9l', U&'\00C1ngel']
  ];
  v_par       TEXT[];
  v_afectadas INT;
  v_total     INT := 0;
BEGIN
  FOREACH v_par SLICE 1 IN ARRAY v_pares LOOP
    UPDATE profiles
       SET nombre = replace(nombre, v_par[1], v_par[2])
     WHERE nombre LIKE '%' || v_par[1] || '%';
    GET DIAGNOSTICS v_afectadas = ROW_COUNT;
    v_total := v_total + v_afectadas;
  END LOOP;
  RAISE NOTICE 'Nombres devueltos a su acentuacion correcta: %', v_total;
END
$$;
