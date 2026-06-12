# Tasks -- #14: has_role anti-enumeration

## FASE A -- OpenSpec
- [x] proposal.md, design.md, tasks.md, specs/authorization/spec.md, studio-script.sql

## FASE B -- mirror + grep gate + commit
- [x] 20260611213630_14_has_role_anti_enumeration.sql (byte-faithful: guard + REVOKE/GRANT)
- [x] grep app call sites: 4 sites (admin/moderation/{users,messages,reviews,listings}/page.tsx),
      all pass `_user_id: user.id` from `auth.getUser()` -> self-check -> byte-faithful. NONE passes a
      third-party uid from a non-admin context. STOP gate clean.
- [x] no app edit needed (call sites already session-scoped)
- [x] CODEX review; HIGH -> STOP

## FASE C -- Studio (DONE, Camino 2 DRY-RUN -> WRITE -> VERIFY)
- [x] guard self-or-admin (RETURN false, not RAISE); SET search_path public,pg_temp;
      REVOKE EXECUTE FROM PUBLIC, anon; GRANT authenticated, service_role
- [x] policy inventory: 14 policies call has_role((SELECT auth.uid()), ...) -- zero third-party uid
- [x] function inventory: 7 DEFINER wrappers all pass auth.uid()/v_actor; admin_get_user's
      third-party p_user_id feeds only the profiles SELECT
- [x] smoke 7/7 pass (real non-admin 2977f43a, ephemeral 'user' role in-txn)
- [x] VERIFY post-WRITE: es_definer=true, search_path={public,pg_temp}, tiene_guard=true,
      anon_exec=false, auth_exec=true, svc_exec=true; re-verify out-of-txn: guard_vivo=true, anon_exec=false

## Out of scope
- Any change to the 14 policies / 7 functions (byte-faithful self/admin path keeps them intact).
- Batch-2 is complete after this; rebase onto master once PR #32 merges.
