-- A1 (segunda parte) · La revocacion por columna de 20260826170000 no hizo nada.
--
-- Motivo, y vale la pena que quede escrito porque es una trampa que ya mordio dos
-- veces hoy: `authenticated` tiene INSERT **a nivel de TABLA** sobre profiles. Un
-- privilegio de tabla cubre todas las columnas, presentes y futuras, y convierte
-- cualquier REVOKE por columna en un no-op. No falla, no avisa: simplemente
-- has_column_privilege sigue devolviendo true.
--
-- El orden correcto es el que ya se uso con el UPDATE de esta misma tabla
-- (cierre 2026-06-10-mass-assignment-column-locks): quitar el privilegio de
-- tabla y volver a otorgar SOLO las columnas permitidas. Por eso el UPDATE hoy
-- tiene exactamente 2 columnas y el INSERT tenia 35.
--
-- Las 13 que se quedan fuera son las que el usuario no debe poder AFIRMAR sobre
-- si mismo: reputacion, verificacion, moderacion y dato fiscal. Las 22 que se
-- conceden son las que declara de si mismo, mas las que fija el alta.
--
-- Sigue sin romper nada: handle_new_user es SECURITY DEFINER propiedad de
-- postgres, y los cuatro scripts de seed usan SUPABASE_SERVICE_ROLE_KEY.

REVOKE INSERT ON TABLE public.profiles FROM authenticated, anon;

GRANT INSERT (
  id,
  user_id,
  email,
  nombre,
  display_name,
  foto,
  bio,
  telefono,
  ubicacion,
  ubicacion_lat,
  ubicacion_lng,
  es_vendedor,
  seller_type,
  nombre_negocio,
  categoria_negocio,
  descripcion_negocio,
  metodos_pago_aceptados,
  fcm_token,
  has_seen_onboarding,
  last_seen_at,
  created_at,
  updated_at
) ON public.profiles TO authenticated;

-- VERIFY:
--   SELECT c, has_column_privilege('authenticated','public.profiles',c,'INSERT')
--   FROM unnest(ARRAY['is_verified','trust_points','total_sales','rfc','is_hidden',
--                     'verified_at','trust_level','average_rating','reviews_count']) AS c;
--   -- esperado: las nueve en false
--
--   SELECT c, has_column_privilege('authenticated','public.profiles',c,'INSERT')
--   FROM unnest(ARRAY['nombre','bio','telefono','foto','email','id']) AS c;
--   -- esperado: las seis en true
--
--   SELECT has_table_privilege('authenticated','public.profiles','INSERT');
--   -- esperado: false (ya no hay privilegio de tabla que lo cubra todo)
