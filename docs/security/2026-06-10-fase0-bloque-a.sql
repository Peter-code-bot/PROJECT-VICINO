-- VICINO FASE 0 - BLOQUE A: confirmacion del estado VIVO (read-only)
-- Proyecto Supabase ref: oxxdkwywprkfghhbnoto
-- Correr en Supabase Studio SQL Editor (corre como postgres). NO modifica nada.
-- Pegar los resultados de A1-A12 de vuelta para afinar los fixes antes de crear cambios OpenSpec.
-- Motivo: el ledger schema_migrations esta desincronizado y hay policies creadas a mano en el
-- Dashboard; el codigo en git puede diferir de la BD viva.

-- A1. ACL de funciones criticas
SELECT proname, prosecdef, proacl, pg_get_function_arguments(oid) AS args
FROM pg_proc WHERE proname IN ('make_admin','has_role','get_or_create_chat','mark_messages_as_read');

-- A2. Cuerpo vivo de make_admin (tiene guard?)
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'make_admin';

-- A3. Grants de funcion a anon/authenticated
SELECT routine_name, grantee, privilege_type
FROM information_schema.role_routine_grants
WHERE routine_name IN ('make_admin','has_role','get_or_create_chat','mark_messages_as_read','update_profile_and_pause')
ORDER BY routine_name, grantee;

-- A4. Privilegios a NIVEL COLUMNA en profiles (PII SELECTable por anon?)
SELECT grantee, privilege_type, column_name
FROM information_schema.column_privileges
WHERE table_schema='public' AND table_name='profiles' AND grantee IN ('anon','authenticated')
ORDER BY grantee, column_name;

-- A5. Columnas vivas de profiles
SELECT column_name FROM information_schema.columns
WHERE table_schema='public' AND table_name='profiles' ORDER BY column_name;

-- A6. RLS policies vivas de tablas clave
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname='public'
  AND tablename IN ('profiles','products_services','appointments','sale_confirmations','reviews','chats','messages','user_roles')
ORDER BY tablename, cmd, policyname;

-- A7. Storage review-media
SELECT id, public, allowed_mime_types FROM storage.buckets WHERE id='review-media';
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='storage' AND (qual ILIKE '%review-media%' OR with_check ILIKE '%review-media%');

-- A8. Policies que llaman has_role (lista)
SELECT tablename, policyname, cmd FROM pg_policies
WHERE qual ILIKE '%has_role%' OR with_check ILIKE '%has_role%';

-- A9. TODAS las funciones public callables por anon/authenticated
SELECT p.proname, p.prosecdef AS sec_definer, g.grantee, g.privilege_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid=p.pronamespace AND n.nspname='public'
JOIN information_schema.role_routine_grants g ON g.routine_name=p.proname AND g.routine_schema='public'
WHERE g.grantee IN ('anon','authenticated')
ORDER BY p.prosecdef DESC, p.proname;

-- A10. user_roles: segundo vector de privesc (escribir rol propio sin make_admin?)
SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='user_roles';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='user_roles' AND grantee IN ('anon','authenticated');

-- A11. has_role: texto de cada caller (policies + funciones), confirmar que SIEMPRE recibe auth.uid()
SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies
WHERE qual ILIKE '%has_role%' OR with_check ILIKE '%has_role%';
SELECT proname FROM pg_proc WHERE prosrc ILIKE '%has_role%' AND proname <> 'has_role';

-- A12. Columnas que el plan ASUME existen
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema='public'
  AND ((table_name='profiles' AND column_name IN ('average_rating','rating_promedio'))
    OR (table_name='products_services' AND column_name='allow_appointments'));
