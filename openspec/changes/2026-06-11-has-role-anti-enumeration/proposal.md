# Proposal -- #14: has_role anti-enumeration guard

## Why

Audit finding #14 (CWE-200 role enumeration / info disclosure, Bajo-Med 4.3).
`public.has_role(_user_id uuid, _role app_role)` is a SECURITY DEFINER helper used by RLS policies to
test role membership. As originally defined (`20260320000002_profiles.sql:129-136`) it was:

```sql
CREATE OR REPLACE FUNCTION has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- No guard: it answered for ANY `_user_id`, not just the caller's.
- EXECUTE was available to `PUBLIC`/`anon`.

So anon and any authenticated user could call `rpc('has_role', {_user_id:<any-uuid>, _role:'admin'})`
via PostgREST and **enumerate who is an admin** (and any other role), one uid at a time.

## What (applied in Studio, Camino 2: DRY-RUN -> WRITE -> VERIFY OK)

A self-or-admin guard plus an EXECUTE lockdown. Byte-faithful mirror in
`supabase/migrations/20260611213630_14_has_role_anti_enumeration.sql`:

- If `_user_id <> auth.uid()` AND the caller is NOT admin -> `RETURN false`.
  - `RETURN false` (NOT `RAISE`) is deliberate: 14 RLS policies evaluate `has_role(...)` inside
    `USING` / `WITH CHECK`; raising would break those policy evaluations. Returning false is the
    safe "no" that policies already expect.
- Otherwise (own uid, or caller is admin) -> the ORIGINAL `RETURN EXISTS(... user_roles ...)` body,
  byte-identical -> behavior unchanged for every legitimate caller.
- `SET search_path TO 'public','pg_temp'`; `REVOKE EXECUTE FROM PUBLIC, anon`;
  `GRANT EXECUTE TO authenticated, service_role`.

## Scope

### IN
- The `has_role` body guard + the REVOKE/GRANT, mirror migration + delta spec. No app change (the
  4 app call sites already pass the session uid -- see Caller impact).

### OUT
- Any change to the 14 policies or 7 DEFINER functions that call `has_role` (they already pass
  `auth.uid()` -- inventory below). This is the LAST batch-2 change precisely because `has_role`'s
  blast radius is every policy that references it; the body's self/admin path is kept byte-faithful.

## Caller impact

- **App (4 sites, all self-checks):** `admin/moderation/{users,messages,reviews,listings}/page.tsx`
  call `rpc('has_role', {_user_id: user.id, _role:'admin'})` where `user` is
  `supabase.auth.getUser()` -> `_user_id = auth.uid()` -> guard self-branch -> byte-faithful. None
  passes a third-party uid from a non-admin context.
- **14 RLS policies** call `has_role((SELECT auth.uid()), ...)` -> always the caller's own uid ->
  unaffected.
- **7 SECURITY DEFINER functions** wrap `has_role` (`admin_get_user`, `admin_list_users`,
  `make_admin`, `manage_user_role`, `moderate_review`, `moderate_set_content_hidden`,
  `resolve_dispute_admin`) -> all call `has_role(auth.uid()/v_actor, ...)`. `admin_get_user` takes a
  third-party `p_user_id` but uses it only for the `SELECT ... profiles`, never as the `has_role`
  argument.

## Success criteria

1. A non-admin calling `has_role(<other-uid>, 'admin')` gets `false` (enumeration blocked).
2. A caller asking about their OWN uid, or an admin asking about anyone, gets the true membership.
3. `anon` EXECUTE on `has_role` is revoked; `authenticated` + `service_role` retained.
4. All 14 policies and 7 functions keep working (self/admin path byte-faithful; smoke 7/7 pass).
