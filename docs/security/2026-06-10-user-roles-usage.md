# VICINO - Auditoria de uso de user_roles en la app (P0 #1 follow-up)

Fecha: 2026-06-10
Objetivo: tras el lockdown del P0 (REVOKE INSERT/UPDATE/DELETE ON public.user_roles FROM
anon, authenticated + FORCE RLS + policy "Admin can manage roles"), confirmar si alguna
gestion LEGITIMA de roles desde la app se rompe. Efecto colateral ya confirmado en Studio:
un admin tampoco puede escribir user_roles directo (42501 permission denied) -- el grant lo
frena antes que la policy.

Metodo: read-only (grep + lectura). No se corrio SQL, no se edito codigo, no se pusheo.

## GATE 0 (premisa corregida)

- HEAD de la rama de trabajo: `b6fe85d` (security/fase0-audit-verification, basada en 83132f9).
- **origin/master AVANZO a `3f4fffc`** (ya no es 83132f9). Es 1 commit:
  `3f4fffc fix(deeplinks): set real Apple Team ID HPTJ743Q64 in AASA appID`.
- `git diff 83132f9..origin/master -- apps/web/app/admin apps/web/lib/auth` = **vacio**: el
  codigo de gestion de roles NO cambio en el master nuevo, asi que esta auditoria es valida
  contra produccion actual. Al mergear el P0 hay que rebasar la rama sobre `3f4fffc` (trivial,
  sin conflicto en estos archivos).

## Inventario de referencias a user_roles en apps/web

| file:line | tipo | snippet | se rompe con el REVOKE? |
|---|---|---|---|
| app/admin/layout.tsx:20 | READ | `.from("user_roles").select("role")` (gate admin, rol propio) | NO (authenticated conserva SELECT; rol propio via "Users can view own roles") |
| app/admin/page.tsx:13 | READ | `.from("user_roles").select("role")` (gate admin, rol propio) | NO |
| app/admin/users/page.tsx:21 | READ | `.from("user_roles").select("role")` (gate admin, rol propio) | NO |
| app/admin/users/page.tsx:40 | READ | `.from("user_roles").select("user_id")` (lista por rol) | NO (admin lee filas ajenas via policy "Admin can manage roles") |
| app/admin/users/page.tsx:55 | READ | `.from("user_roles").select("user_id, role")` (mapa de roles, TODAS las filas) | NO -- **pero depende de la policy "Admin can manage roles"** (ver nota) |
| lib/auth/require-admin.ts:12 | READ | `.from("user_roles").select("role").eq(user.id).eq("admin")` | NO (rol propio) |
| lib/auth/require-admin-or-moderator.ts:11 | READ | `.from("user_roles").select("role")` (rol propio) | NO |
| app/(marketplace)/layout.tsx:48 | READ | `.from("user_roles").select("role").eq("user_id", user.id).in("role",["admin","moderator"])` (badge, sesion activa) | NO (rol propio, sesion confirmada; NO corre como anon) |
| **app/admin/users/actions.ts:18** | **WRITE** | `supabase.from("user_roles").insert({ user_id, role })` (assignRole) | **SI -- ROTO (42501)** |
| **app/admin/users/actions.ts:37-41** | **WRITE** | `supabase.from("user_roles").delete().eq(user_id).eq(role)` (removeRole) | **SI -- ROTO (42501)** |
| app/admin/users/role-actions.tsx:23,25,34,36 | UI (llama Server Actions) | `assignRole/removeRole(userId, "admin"/"moderator")` | indirecto (depende de las 2 actions de arriba) |

Gestion de roles via RPC: **NINGUNA**. Grep de `make_admin|manage_role|set_role|assign_role|
remove_role|grant_role|update_role` en apps/web = **cero hits**. La app NO usa make_admin ni
ningun RPC de rol; gestiona roles por escritura DIRECTA a la tabla.

Cliente usado por las escrituras: `requireAdmin()` -> `createClient()` de `@/lib/supabase/server`
= **cliente de SESION de usuario (rol `authenticated`), NO service-role**. Por eso el REVOKE a
`authenticated` lo frena (un service-role bypassearia el grant; aqui no se usa).

## VEREDICTO: **B**

Hay escritura DIRECTA a user_roles desde la app (panel admin de gestion de usuarios). El REVOKE
del P0 la rompe. Hay que enrutarla por un RPC con guard admin.

### Call sites a migrar (exactos)

| # | file:line | funcion | accion | rol(es) | nota |
|---|---|---|---|---|---|
| 1 | app/admin/users/actions.ts:18 | `assignRole(userId, role)` | INSERT user_roles | admin, moderator | idempotente: hoy trata `error.code === "23505"` (unique) como exito -> el RPC debe `ON CONFLICT DO NOTHING` |
| 2 | app/admin/users/actions.ts:37-41 | `removeRole(userId, role)` | DELETE user_roles | admin, moderator | borra por (user_id, role) |

UI que las invoca (NO cambia): `app/admin/users/role-actions.tsx` (toggles de admin y moderator).
Validacion de input: `assignRoleSchema` / `removeRoleSchema` de `@vicino/shared` (reusar en el RPC).
Rate limit: `writeRateLimit` por `user.id` (se mantiene en la action).

## Nota CRITICA (no borrar la policy)

La policy `"Admin can manage roles"` NO es huerfana: la pantalla de admin
`app/admin/users/page.tsx:55` lee TODAS las filas de user_roles (`select("user_id, role")` sin
filtro), y para que un admin vea filas AJENAS necesita la rama SELECT de esa policy
(`FOR ALL USING has_role(admin)`). Si se dropea, se rompe el listado de usuarios del panel admin.
=> Mantener la policy. El fix de B = mover solo las ESCRITURAS al RPC; las LECTURAS siguen por la
policy.

## Fix recomendado (siguiente sesion, se aplica en Studio + migra los 2 call sites)

RPC `manage_user_role(p_user_id UUID, p_role app_role, p_action TEXT)` SECURITY DEFINER:
- guard: `has_role(auth.uid(), 'admin')` (rechaza no-admin / anon).
- `p_action = 'assign'` -> `INSERT ... ON CONFLICT (user_id, role) DO NOTHING`.
- `p_action = 'remove'` -> `DELETE ... WHERE user_id = p_user_id AND role = p_role`.
- `SET search_path = public, pg_temp`; `REVOKE ALL FROM PUBLIC`; `REVOKE EXECUTE FROM anon`;
  `GRANT EXECUTE TO authenticated`.
- Migrar `assignRole` -> `supabase.rpc("manage_user_role", { p_user_id, p_role, p_action: 'assign' })`
  y `removeRole` -> `... p_action: 'remove'`. El REVOKE de tabla se queda (escrituras solo via RPC).
- Las LECTURAS (incl. page.tsx:55) NO cambian; siguen por la policy "Admin can manage roles".
