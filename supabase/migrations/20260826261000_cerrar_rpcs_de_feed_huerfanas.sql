-- Dos RPC del feed que ya nadie usa, y que anon todavia puede ejecutar.
--
-- nearby_products y search_nearby_products fueron sustituidas por
-- search_nearby_products_v4, que es la unica que llama el codigo (5 sitios).
-- Comprobado que estas dos estan huerfanas por tres vias: no aparecen en
-- ninguna llamada .rpc() del repo, ninguna otra funcion del esquema public las
-- invoca, y ningun job de pg_cron las menciona.
--
-- Por que importa que sigan expuestas: las dos son SECURITY DEFINER, o sea
-- brincan la RLS, y NO filtran ps.is_hidden, ni pr.is_hidden, ni user_blocks.
-- Comprobado leyendo su prosrc, no supuesto. Hoy no se nota porque no hay
-- ningun producto oculto ni ningun bloqueo en la base — o sea, es exactamente
-- la clase de agujero que se descubre el dia que moderacion oculta su primer
-- producto y sigue saliendo por la API.
--
-- OJO CON EL REVOKE, que es donde esto se hace mal:
-- las dos tienen EXECUTE concedido a PUBLIC ademas de a anon y authenticated.
-- Todo rol hereda de PUBLIC, asi que revocar solo a anon y authenticated
-- dejaria el agujero abierto Y la comprobacion en verde, porque las entradas
-- nominales de la ACL si habrian desaparecido. Se revoca a los tres.
--
-- NO se hace DROP a proposito. Un DROP es irreversible y necesita el visto
-- bueno de Pedro; un REVOKE se deshace con un GRANT si aparece un consumidor
-- que no vimos, por ejemplo fuera del repo y de la base.

REVOKE ALL ON FUNCTION public.nearby_products(
  double precision, double precision, integer, text, integer
) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.search_nearby_products(
  double precision, double precision, integer, text, uuid[]
) FROM PUBLIC, anon, authenticated;

-- VERIFY (lo que de verdad hay que mirar es has_function_privilege, no la ACL:
-- la ACL puede quedar limpia y el privilegio seguir llegando por PUBLIC):
--   SELECT has_function_privilege('anon',
--     'public.nearby_products(double precision,double precision,integer,text,integer)',
--     'EXECUTE');                                            -- esperado: false
--   SELECT has_function_privilege('anon',
--     'public.search_nearby_products(double precision,double precision,integer,text,uuid[])',
--     'EXECUTE');                                            -- esperado: false
--   SELECT has_function_privilege('anon',
--     'public.search_nearby_products_v4(double precision,double precision,integer,text,uuid[],timestamptz,uuid,integer,boolean,boolean)',
--     'EXECUTE');                                            -- esperado: TRUE, no se toca
