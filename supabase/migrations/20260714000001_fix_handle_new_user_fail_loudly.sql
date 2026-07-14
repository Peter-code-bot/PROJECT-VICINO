-- Fix public.handle_new_user() -- signup incident 2026-07-09.
--
-- Problem: the 20260327000002 version wraps the profiles INSERT in
-- EXCEPTION WHEN OTHERS THEN RAISE LOG ...; RETURN NEW. Any INSERT failure is
-- swallowed: the auth.users row is created but no profiles row exists. The
-- user then hits the /bienvenida guard loop (profile missing) and the real
-- cause only surfaces as a Postgres LOG line nobody reads. Silent failure
-- also masked the production signup incident of 2026-07-09.
--
-- Fix: drop the swallow so a failing INSERT aborts the auth.users insert and
-- GoTrue returns "Database error saving new user" -- visible, diagnosable,
-- and mapped to a useful message in register-form. ON CONFLICT (id) DO
-- NOTHING keeps the trigger idempotent if the profile row already exists
-- (e.g. manual backfill raced the trigger).
--
-- Companion (run once, same Studio session): backfill profiles for existing
-- auth.users rows that lost their profile to the old swallow. See
-- PENDIENTES-PEDRO SQL-1 / the studio script for READ/POST verification.
--
-- Delivery: Camino 2 (Pedro runs the WRITE in Studio). This file is
-- repo-of-record and is NOT applied via `supabase db push`.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nombre, foto)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

-- One-time backfill: create the missing profiles rows for users whose signup
-- hit the old swallow. Idempotent (ON CONFLICT DO NOTHING); the set_user_id
-- BEFORE INSERT trigger assigns user_id as usual.
INSERT INTO public.profiles (id, email, nombre, foto)
SELECT
  u.id,
  COALESCE(u.email, ''),
  COALESCE(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', ''),
  COALESCE(u.raw_user_meta_data->>'avatar_url', '')
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;
