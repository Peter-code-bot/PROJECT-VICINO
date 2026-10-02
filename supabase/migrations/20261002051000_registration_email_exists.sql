-- Lookup for the explicit duplicate-email UX approved by Javier, 2026-10-01.
-- Only the application's server may ask; Auth rows never leave the function.
CREATE OR REPLACE FUNCTION public.registration_email_exists(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(email) = lower(btrim(p_email))
      AND deleted_at IS NULL
  );
$$;

REVOKE ALL ON FUNCTION public.registration_email_exists(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registration_email_exists(text) TO service_role;

-- Rollback after restoring the previous application:
-- REVOKE EXECUTE ON FUNCTION public.registration_email_exists(text) FROM service_role;
-- DROP FUNCTION public.registration_email_exists(text);
