-- A1 · El candado de asignacion masiva de profiles se puso al UPDATE y se olvido
-- del INSERT.
--
-- Estado encontrado el 26-ago-2026:
--   UPDATE para authenticated:  2 columnas  (fcm_token, foto)
--   INSERT para authenticated: 35 columnas  (TODAS)
--
-- Entre esas 35 estan is_verified, verified_at, trust_level, trust_points,
-- average_rating, reviews_count, total_sales, is_hidden y rfc. Es decir: la
-- reputacion, la verificacion, la moderacion y el dato fiscal.
--
-- Es el item 133 de la pagina de Notion, y es REAL pero LATENTE. La policy
-- "Allow trigger insert profiles" tiene WITH CHECK (auth.uid() = id), asi que un
-- usuario solo puede insertar SU fila; y hoy los 11 usuarios ya la tienen, asi
-- que la clave primaria rechaza el duplicado. La ventana real es estrecha: entre
-- que alguien se registra y que el trigger handle_new_user termine de crear su
-- perfil. Ahi cabria un INSERT propio con is_verified = true y trust_points a
-- gusto.
--
-- Estrecha no es lo mismo que inexistente, y el arreglo no cuesta nada.
--
-- Por que revocar no rompe nada, comprobado antes de escribir esto:
--   - handle_new_user, que es quien crea los perfiles de verdad, es SECURITY
--     DEFINER y propiedad de postgres: no pasa por estos grants.
--   - Las unicas lineas del repo que insertan en profiles son los seed
--     (seed-all-categories, seed-food-playstore, seed-more-rankings,
--     seed-rankings) y los cuatro usan SUPABASE_SERVICE_ROLE_KEY, que se salta
--     RLS y grants.
--   - Las ediciones de perfil del usuario NO pasan por UPDATE directo: solo
--     tiene fcm_token y foto. Lo demas va por RPC, que es el diseño.
--
-- Se dejan sin tocar las columnas que describen lo que el usuario declara de si
-- mismo (nombre, bio, telefono, ubicacion, datos del negocio). Este cambio quita
-- lo que el usuario NO debe poder afirmar sobre si mismo.

REVOKE INSERT (
  is_verified,
  verified_at,
  trust_level,
  trust_points,
  average_rating,
  average_rating_as_buyer,
  average_rating_as_seller,
  reviews_count,
  reviews_count_as_buyer,
  reviews_count_as_seller,
  total_sales,
  is_hidden,
  rfc
) ON public.profiles FROM authenticated, anon;

-- VERIFY:
--   SELECT c, has_column_privilege('authenticated','public.profiles',c,'INSERT')
--   FROM unnest(ARRAY['is_verified','trust_points','trust_level','total_sales',
--                     'is_hidden','rfc']) AS c;
--   -- esperado: las seis en false
--
--   Y que lo legitimo sigue en pie:
--   SELECT c, has_column_privilege('authenticated','public.profiles',c,'INSERT')
--   FROM unnest(ARRAY['nombre','bio','telefono','foto']) AS c;
--   -- esperado: las cuatro en true
--
--   Prueba viva, en transaccion revertida, con un uuid sin fila de perfil:
--     BEGIN;
--       SET LOCAL ROLE authenticated;
--       SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--       INSERT INTO public.profiles (id, nombre, is_verified, trust_points)
--       VALUES ('<uuid>','x',true,9999);
--     ROLLBACK;
--     -- esperado: permission denied for table profiles
