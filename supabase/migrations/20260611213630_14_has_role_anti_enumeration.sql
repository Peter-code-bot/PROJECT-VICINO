-- #14 has_role anti-enumeration guard + REVOKE anon EXECUTE
-- Aplicado en vivo via Supabase Studio (Camino 2). Espejo byte-fiel.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF _user_id IS DISTINCT FROM (SELECT auth.uid())
     AND NOT EXISTS (
       SELECT 1 FROM user_roles
       WHERE user_id = (SELECT auth.uid()) AND role = 'admin'::app_role
     )
  THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;
