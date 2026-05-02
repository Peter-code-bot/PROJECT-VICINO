-- =============================================================================
-- VICINO Moderation: migración de reviews.reportada legacy → tabla reports
-- Fase 3 / 4 — Datos históricos
-- =============================================================================
--
-- El sistema legacy guardaba el reporte de una review como un boolean en la
-- propia tabla `reviews` (campo `reportada`). NO conservaba quién reportó.
-- Para preservar historial sin violar la FK reporter_id → auth.users, creamos
-- un usuario "VICINO System" con UUID determinístico y lo asignamos como
-- reporter_id de los registros legacy.
-- =============================================================================

-- 1. Crear usuario sistema (idempotente) -------------------------------------
DO $$
DECLARE
  v_system_user_id UUID := '00000000-0000-0000-0000-000000000001'::uuid;
  v_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM auth.users WHERE id = v_system_user_id) INTO v_exists;

  IF NOT v_exists THEN
    -- INSERT directo a auth.users. La trigger handle_new_user() (definida en
    -- 20260320000002_profiles.sql) crea automáticamente el profile.
    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_user_meta_data,
      raw_app_meta_data,
      is_super_admin,
      created_at,
      updated_at,
      confirmation_token,
      email_change,
      email_change_token_new,
      recovery_token
    ) VALUES (
      v_system_user_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      'system@vicinomarket.com',
      '',
      NOW(),
      '{"full_name": "VICINO System", "is_system": true}'::jsonb,
      '{"provider": "system", "providers": ["system"]}'::jsonb,
      FALSE,
      NOW(),
      NOW(),
      '',
      '',
      '',
      ''
    );

    -- El trigger handle_new_user() ya creó el profile con nombre='VICINO System'.
    -- Forzamos display_name por consistencia con resto del UI.
    UPDATE public.profiles
       SET display_name = 'VICINO System',
           is_hidden    = TRUE   -- el system user no debe aparecer en feeds
     WHERE id = v_system_user_id;
  END IF;
END $$;

-- 2. Migrar reportes legacy de reviews → tabla reports ------------------------
-- Desactivamos auto_hide durante el bulk import (la lógica de auto-hide debe
-- evaluarse solo para reportes nuevos en producción, no históricos).
ALTER TABLE public.reports DISABLE TRIGGER trg_reports_auto_hide;

INSERT INTO public.reports (
  reporter_id,
  target_type,
  target_id,
  reason,
  description,
  status,
  created_at
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid AS reporter_id,
  'review'::report_target_type AS target_type,
  r.id AS target_id,
  'inappropriate_content'::report_reason AS reason,
  COALESCE(r.motivo_reporte, 'Reporte legacy migrado automáticamente') AS description,
  CASE WHEN r.visible THEN 'pending' ELSE 'resolved' END::report_status AS status,
  r.created_at
FROM public.reviews r
WHERE r.reportada = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM public.reports rr
     WHERE rr.target_type = 'review'::report_target_type
       AND rr.target_id = r.id
       AND rr.reporter_id = '00000000-0000-0000-0000-000000000001'::uuid
  )
ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING;

ALTER TABLE public.reports ENABLE TRIGGER trg_reports_auto_hide;

-- 3. Sync is_hidden en reviews migradas ---------------------------------------
-- Si la review legacy tenía visible=FALSE pero is_hidden=FALSE (porque
-- migration 1 corrió pero no se había sincronizado), el trigger
-- sync_reviews_visibility lo arregla en cualquier UPDATE futuro. Forzamos un
-- toque para sincronizar de inmediato:
UPDATE public.reviews
   SET visible = visible
 WHERE reportada = TRUE
   AND is_hidden IS DISTINCT FROM (NOT visible);
