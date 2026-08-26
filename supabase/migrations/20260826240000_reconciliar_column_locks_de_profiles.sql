-- El cierre de asignacion masiva de profiles existe en produccion pero no en el repo.
--
-- Item 135 de Notion. El cambio "2026-06-10-mass-assignment-column-locks" esta
-- CITADO en comentarios de migraciones (20260704000002 y la de hoy
-- 20260826171000) pero no existe ninguna migracion que lo aplique. Los grants si
-- estan en produccion, asi que es el mismo patron de deriva que las cuatro
-- columnas fantasma y las seis categorias fuera de banda: estado real sin
-- respaldo en el repo.
--
-- Esta migracion NO cambia nada en produccion. Declara lo que ya hay, para que un
-- entorno nuevo levantado solo desde supabase/migrations tenga los mismos
-- candados. Sin esto, un entorno nuevo nace con profiles COMPLETAMENTE abierta a
-- UPDATE por parte del usuario — incluidas is_verified, trust_points y rfc — que
-- es exactamente lo que el cierre original vino a evitar.
--
-- Los valores se leyeron de information_schema.column_privileges en produccion,
-- no se dedujeron del codigo.

-- ---------------------------------------------------------------------------
-- 1. UPDATE: solo las dos columnas que el usuario cambia de si mismo.
--
-- Todo lo demas del perfil se edita por RPC. Es deliberado, y es lo que impide
-- que alguien se ponga is_verified, trust_points o total_sales a mano.
-- ---------------------------------------------------------------------------

REVOKE UPDATE ON TABLE public.profiles FROM authenticated, anon;

GRANT UPDATE (foto, fcm_token) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. DELETE: nadie lo usa, y estaba otorgado.
--
-- La ACL decia authenticated=dDxtm: el 'd' es DELETE a nivel de tabla. Hoy es
-- inofensivo porque profiles no tiene ninguna policy de DELETE, asi que la
-- operacion filtra todas las filas y afecta cero — el fallo silencioso de
-- siempre. Pero un privilegio que nadie necesita solo puede hacer daño el dia
-- que alguien añada una policy de DELETE sin pensar en quien tiene el GRANT.
--
-- Comprobado que nada lo usa: la eliminacion de cuenta va por la Edge Function
-- delete-account, que usa auth.admin.deleteUser() con service_role y cascada.
-- La unica linea del repo que borra de profiles es apps/web/clean-and-seed-real.ts,
-- un script de seed que tambien usa SUPABASE_SERVICE_ROLE_KEY.
-- ---------------------------------------------------------------------------

REVOKE DELETE ON TABLE public.profiles FROM authenticated, anon;

-- VERIFY (debe quedar igual que antes de aplicar):
--   SELECT privilege_type, count(*), string_agg(column_name, ', ' ORDER BY column_name)
--   FROM information_schema.column_privileges
--   WHERE table_name = 'profiles' AND grantee = 'authenticated'
--     AND privilege_type = 'UPDATE'
--   GROUP BY 1;
--   -- esperado: UPDATE | 2 | fcm_token, foto
--
--   SELECT has_table_privilege('authenticated','public.profiles','DELETE');
--   -- esperado: false
--
--   Y que el SELECT por columna no se toco:
--   SELECT count(*) FROM information_schema.column_privileges
--   WHERE table_name='profiles' AND grantee='authenticated' AND privilege_type='SELECT';
--   -- esperado: 29
