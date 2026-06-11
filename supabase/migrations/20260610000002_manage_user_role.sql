-- =============================================================================
-- CH-1c -- manage_user_role RPC (closes the P0 #1 side effect)
-- Change: openspec/changes/2026-06-10-hotfix-make-admin-privesc
-- =============================================================================
-- WHY: CH-1b revoked INSERT/UPDATE/DELETE on public.user_roles from anon AND
-- authenticated. That correctly killed the direct-write privesc vector, but it
-- also broke the two legitimate admin Server Actions that managed roles by
-- writing the table directly (apps/web/app/admin/users/actions.ts: assignRole
-- INSERT, removeRole DELETE -- both run with the admin's authenticated session,
-- not service_role, so the REVOKE returns 42501). See
-- docs/security/2026-06-10-user-roles-usage.md (verdict B).
--
-- WHAT: a single admin-guarded SECURITY DEFINER RPC for ALL role mutations, so
-- public.user_roles stays read-only for clients (writes only via this RPC). The
-- app is migrated to call it (.rpc('manage_user_role', ...)).
--
-- STATUS: already applied by Pedro in Supabase Studio (Camino 2, COMMIT done,
-- 2026-06-10). Smokes OK: attacker (non-admin) -> forbidden; admin -> assigns;
-- last-admin removal -> blocked. This file is the idempotent mirror for git.
-- NOTE: reconstructed from the applied behavior per Pedro's description -- if the
-- live body differs (esp. the last-admin guard), reconcile against pg_get_functiondef.
--
-- RUN MODEL: applied manually in Studio. NOT via supabase db push (ledger desynced).
--
-- DEPENDS ON: app_role enum (admin|moderator|user), public.user_roles, has_role().
-- The user_roles table-level write REVOKE from CH-1b stays in place; this RPC is
-- SECURITY DEFINER so it writes as its owner, gated by the in-body admin check.
--
-- READ PATH (do NOT drop): this RPC gates WRITES only. Admin role READS over all
-- rows (apps/web/app/admin/users/page.tsx:55) depend on the CH-1b RLS policy
-- "Admin can manage roles" (its SELECT branch). Dropping that policy would
-- silently break the admin user list. Keep it.
--
-- CONTINGENT ON: the CH-1 recursion smoke (BLOCK 4e). This RPC's guard calls
-- has_role(), which reads user_roles under CH-1b FORCE ROW LEVEL SECURITY -- safe
-- only if the postgres owner role has BYPASSRLS. Confirm before relying on CH-1c.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.manage_user_role(
  p_user_id UUID,
  p_role    app_role,
  p_action  TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_admin_count INTEGER;
BEGIN
  -- Authorization: caller must be admin. SECURITY DEFINER bypasses RLS, enforce
  -- explicitly (mirrors approve_verification_atomic / make_admin).
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'forbidden: solo un admin puede gestionar roles'
      USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('assign', 'remove') THEN
    RAISE EXCEPTION 'accion invalida: %', p_action USING ERRCODE = '22023';
  END IF;

  IF p_action = 'assign' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, p_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  ELSE
    -- remove: protect the last admin so the admin plane can never be emptied.
    -- TOCTOU-safe: serialize concurrent 'remove admin' calls by locking the admin
    -- rows. Use a plain PERFORM ... FOR UPDATE (NO aggregate): "count(*) ... FOR
    -- UPDATE" is invalid in Postgres (SQLSTATE 0A000). Count in a separate
    -- statement after the lock is held.
    IF p_role = 'admin'::app_role THEN
      PERFORM 1 FROM public.user_roles
        WHERE role = 'admin'::app_role
        FOR UPDATE;

      IF EXISTS (
           SELECT 1 FROM public.user_roles
           WHERE user_id = p_user_id AND role = 'admin'::app_role
         )
      THEN
        SELECT count(*) INTO v_admin_count
        FROM public.user_roles WHERE role = 'admin'::app_role;

        IF v_admin_count <= 1 THEN
          RAISE EXCEPTION 'no se puede quitar el ultimo admin'
            USING ERRCODE = '42501';
        END IF;
      END IF;
    END IF;

    DELETE FROM public.user_roles
    WHERE user_id = p_user_id AND role = p_role;
  END IF;
END;
$$;

REVOKE ALL     ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) TO authenticated;

COMMENT ON FUNCTION public.manage_user_role(UUID, app_role, TEXT) IS
  'P0 #1 CH-1c: admin-only role mutations (assign|remove) via SECURITY DEFINER. '
  'user_roles is client-read-only; all writes go through this RPC. Protects the '
  'last admin on remove. Replaces direct .insert/.delete in admin/users/actions.ts.';

-- =============================================================================
-- ROLLBACK (manual): DROP FUNCTION IF EXISTS public.manage_user_role(UUID, app_role, TEXT);
-- and revert admin/users/actions.ts to direct .insert/.delete (which would again
-- require re-granting INSERT/DELETE on user_roles -- NOT recommended, re-opens #1).
-- =============================================================================
