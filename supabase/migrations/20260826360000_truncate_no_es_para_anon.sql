-- TRUNCATE deja de estar concedido a anon y authenticated en todo el esquema
-- public, y deja de renacer en cada tabla nueva.
--
-- POR QUE IMPORTA: TRUNCATE **no esta sujeto a RLS**. Todas las demas escrituras
-- de estas tablas las frena la policy correspondiente; TRUNCATE las salta
-- enteras. Una tabla puede tener RLS impecable y quedarse vacia igual.
--
-- ALCANCE HONESTO DE LA GRAVEDAD: hoy no es alcanzable desde la API. PostgREST
-- no expone un verbo TRUNCATE, y se comprobo que NINGUNA funcion de public lo
-- ejecuta por dentro (0 aciertos de 'truncate' en pg_get_functiondef de todas
-- las funciones del esquema), asi que tampoco hay un RPC que sirva de puerta.
-- Esto es defensa en profundidad, no un agujero abierto. Lo que si es un
-- problema real es la parte de abajo.
--
-- LO QUE DE VERDAD LO CONVIERTE EN TRABAJO: no son 28 concesiones olvidadas,
-- es una FABRICA. pg_default_acl tiene, para el esquema public y con postgres
-- como creador, el ACL 'arwdDxtm' para anon y authenticated: la D es TRUNCATE.
-- O sea que cada tabla que cree una migracion futura nace otra vez con el
-- privilegio. Por eso los apretones anteriores sobre profiles,
-- products_services y reviews no generalizaron: se limpiaba el efecto y se
-- dejaba la causa. Aqui se apagan las dos.
--
-- LO QUE ESTA MIGRACION NO PUEDE ARREGLAR:
--   1. La misma entrada de pg_default_acl existe con supabase_admin como
--      creador, y postgres no puede alterarla. No afecta a este repo: las
--      migraciones corren como postgres, asi que la entrada que se arregla es
--      la que aplica a nuestras tablas.
--   2. spatial_ref_sys pertenece a la extension postgis (dueno supabase_admin),
--      asi que el REVOKE fallara ahi. Es justo el CRITICO ya escalado a soporte
--      de Supabase. El bucle lo registra y sigue en vez de abortar la
--      migracion entera por una tabla que ya sabemos que no nos pertenece.

DO $$
DECLARE
  r          record;
  ok         int := 0;
  fallidas   text[] := '{}';
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    BEGIN
      EXECUTE format(
        'REVOKE TRUNCATE ON public.%I FROM anon, authenticated',
        r.relname
      );
      ok := ok + 1;
    EXCEPTION WHEN OTHERS THEN
      -- Una tabla que no es nuestra no puede tumbar la migracion. Se anota y
      -- se sigue: el resumen final dice exactamente cuales quedaron fuera.
      fallidas := fallidas || r.relname;
    END;
  END LOOP;

  RAISE NOTICE 'TRUNCATE revocado en % tablas. Fuera de alcance: %',
    ok, COALESCE(array_to_string(fallidas, ', '), 'ninguna');
END $$;

-- Y que no vuelva a nacer. Sin esto, lo de arriba se deshace solo con la
-- proxima tabla que cree cualquier migracion.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE TRUNCATE ON TABLES FROM anon, authenticated;

-- COMPROBACION (tras aplicar):
--   select count(*) from information_schema.role_table_grants
--    where table_schema='public' and privilege_type='TRUNCATE'
--      and grantee in ('anon','authenticated');
--   -- esperado: 1, y es spatial_ref_sys
--
--   select d.defaclacl::text from pg_default_acl d
--     join pg_namespace n on n.oid=d.defaclnamespace
--    where n.nspname='public' and d.defaclobjtype='r'
--      and pg_get_userbyid(d.defaclrole)='postgres';
--   -- esperado: anon y authenticated SIN la D de arwdDxtm
