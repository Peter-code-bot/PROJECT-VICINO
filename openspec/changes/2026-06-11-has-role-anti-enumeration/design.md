# Design -- #14: has_role anti-enumeration

## RETURN false, not RAISE (the load-bearing decision)

`has_role` is evaluated inside the `USING` / `WITH CHECK` of 14 RLS policies. A policy predicate that
RAISES does not "deny the row" -- it aborts the whole statement with an error. So the guard must
answer the enumeration probe with the same shape a policy expects: a boolean. When a non-admin probes
a third party, the truthful-but-safe answer is `false` (the caller has no business knowing, and a
policy gating on "is X an admin" should treat "you may not ask" as "no"). This keeps every policy's
semantics intact while denying the oracle.

## Self-or-admin gate, original body preserved

```
IF _user_id <> auth.uid() AND caller-not-admin THEN RETURN false; END IF;
RETURN EXISTS (SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role);
```

- The final `RETURN EXISTS(...)` is byte-identical to the original function body, so for the two
  legitimate cases -- (a) you ask about yourself, (b) an admin asks about anyone -- the answer is
  exactly what it always was. That byte-fidelity is what guarantees the 14 policies and 7 wrapper
  functions are unaffected.
- The admin check is itself a direct `EXISTS` on `user_roles` for `auth.uid()` (NOT a recursive
  `has_role` call) -> no recursion, no policy re-entry. `user_roles` reads here run as the DEFINER
  owner, so the lookup is not subject to the `user_roles` SELECT policy.

## EXECUTE lockdown

`REVOKE EXECUTE ... FROM PUBLIC, anon` removes the anonymous enumeration surface entirely; even with
the guard, anon has no business executing the helper. `GRANT ... TO authenticated, service_role`
keeps the app (authenticated) and trusted server paths (service_role) working. SECURITY DEFINER +
`search_path = public, pg_temp` is preserved (locked search_path prevents schema-shadowing).

## Why this is the LAST batch-2 change

`has_role`'s blast radius is every policy and DEFINER function that references it. Sequencing it last
means all the other batch-2 hardening (which leans on `has_role` for its admin checks) was already in
place and validated before the helper itself changed. The change is intentionally conservative: the
only NEW behavior is "non-admin probing a third party -> false"; everything else is byte-faithful.

## Validation evidence (collected live, Studio)

- **Policy inventory:** 14 policies call `has_role((SELECT auth.uid()), ...)` -- ZERO pass a
  third-party uid.
- **Function inventory:** 7 DEFINER functions wrap `has_role` (`admin_get_user`, `admin_list_users`,
  `make_admin`, `manage_user_role`, `moderate_review`, `moderate_set_content_hidden`,
  `resolve_dispute_admin`) -- all pass `auth.uid()`/`v_actor`; `admin_get_user`'s third-party
  `p_user_id` feeds only the `profiles` SELECT, never `has_role`.
- **Smoke 7/7 pass** (DRY-RUN, real non-admin caller `2977f43a` with an ephemeral `'user'` role
  inside the txn): self-admin not broken; enumeration blocked (non-admin -> false); admin sees a
  third party's real role; self-noadmin with a real role not broken; cross-user enumeration blocked;
  ACL anon=false, auth=true.
- **VERIFY post-WRITE (live):** `es_definer=true`, `search_path={public,pg_temp}`, `tiene_guard=true`,
  `anon_exec=false`, `auth_exec=true`, `svc_exec=true`. Re-verify outside txn: `guard_vivo=true`,
  `anon_exec=false`.

## Faithfulness

The mirror is byte-faithful to the applied function source (`pg_get_functiondef`) and the ACL. Do not
reformat or "improve" the body -- any change to the guard or the final EXISTS risks the 14 policies.
