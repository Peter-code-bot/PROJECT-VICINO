-- migration: add has_seen_onboarding

BEGIN;

-- Añadir la columna si no existe
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS has_seen_onboarding BOOLEAN NOT NULL DEFAULT FALSE;

COMMIT;
