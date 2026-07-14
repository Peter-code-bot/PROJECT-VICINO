# Design -- Eradicate SUPABASE_SERVICE_ROLE_KEY from the Vercel runtime

> Last updated: 2026-07-09. Two independent subphases, one guiding thread: zero
> service-role usage in the Vercel runtime. Deletion semantics unchanged (hard-delete +
> selective anonymization, as `delete_user_data` already implements).

## Subfase 1 -- deleteAccount: reconnect the existing circuit

### Current (broken) wiring

`DeleteAccountSection` (`apps/web/app/(marketplace)/configuracion/delete-account-section.tsx:22`)
-> Server Action `deleteAccount()` (`configuracion/actions.ts:6-19`) -> `createAdminClient()`
with a key that does not exist in Vercel -> throw -> silent collapse. Even with the key,
this path would be wrong: it only calls `auth.admin.deleteUser` and skips relational and
storage cleanup.

### Target wiring (restores commit 8b382d2)

```
DeleteAccountSection (client)
  -> fetch POST /api/account/delete  { confirmText: "ELIMINAR" }
     (route validates confirmText server-side + session; forwards the CALLER'S JWT)
  -> Edge Function delete-account (Supabase; service key from Function secrets)
       1) validates identity from the forwarded JWT (getUser)
       2) rpc delete_user_data(target_user_id)   -- SECURITY DEFINER, transactional,
          guard: auth.uid() IS NOT NULL AND auth.uid() != target -> exception
       3) storage cleanup best-effort: product-media, verification-documents,
          avatars, chat-media, review-media (paths {user_id}/...)
       4) auth.admin.deleteUser (official GoTrue Admin API)
  -> route calls supabase.auth.signOut(); client redirects to /cuenta-eliminada
```

All three layers already exist and the Edge Function is deployed (verified alive via
OPTIONS 200 / POST-noauth 401 on 2026-07-09). Code changes are surgical:

1. `delete-account-section.tsx`: replace the `deleteAccount()` call with the
   `fetch("/api/account/delete", ...)` pattern from `8b382d2` (send `confirmText`, keep
   the existing error box + loading state; on success rely on the route's signOut and do
   `router.push("/cuenta-eliminada")`).
2. `configuracion/actions.ts`: DELETE `deleteAccount()` and the `createAdminClient`
   import (the file keeps nothing else -- if the action was its only content, delete the
   file and its import in the section component accordingly).
3. NO changes to the API route or the Edge Function code (already correct).

### Infra step (Pedro, not a code commit)

`supabase functions deploy delete-account` -- guarantees the DEPLOYED version includes the
avatars-bucket fix (`4a2d5a1`). FASE 0 could not verify the deployed version without the
CLI; the repo version is the desired one. Smoke after redeploy:
`node apps/web/scripts/qa-delete-account.mjs` (creates a throwaway user, runs the RPC,
verifies, cleans up; requires the service key LOCALLY via env, which is dev-tooling and
fine -- it never ships).

### Failure modes considered

- Missing/invalid session -> route 401 with a clear message (already implemented).
- Wrong confirmText -> route 400 (already implemented; the client also gates the button).
- Edge Function 5xx -> route forwards the error; the section shows it in the red box
  (Obstaculo-2 lesson: never swallow errors).
- Partial failure (data deleted, auth deletion fails) -> Edge Function returns an explicit
  "contacta a soporte" error (already implemented); `account_deletion_log` records the
  relational deletion for audit.

## Subfase 2 -- Admin verifications panel without the key

### Current (broken) wiring

`admin/verifications/page.tsx:57` builds `createAdminClient()` ONLY to generate signed
URLs for INE/selfie docs (`signOrNull(adminSupabase, ...)`). The data query itself already
uses the user-context client. With no key in Vercel, the page render crashes.

### Target: policy + user-context client (the pattern the code itself documents at :50-56)

- Re-create the storage policy (the original migration `20260429000001` was deleted from
  the repo as dead code on 2026-06-03 and, per the rls-performance follow-ups, was never
  applied to production -- it must be RE-AUTHORED, not restored):

  ```sql
  CREATE POLICY "Admin read verification docs"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
      bucket_id = 'verification-documents'
      AND has_role((select auth.uid()), 'admin'::app_role)
    );
  ```

  Conventions honored: `TO authenticated` + `(select auth.uid())` InitPlan wrap
  (rls-performance R1/R2); `has_role` is the hardened helper (#14 anti-enumeration).
- Switch `signOrNull` calls to the existing user-context `supabase` client and remove the
  `createAdminClient` import from the page.

### Does the admin's user-context client suffice? (design investigation)

Yes, with the policy above, based on how Supabase Storage authorizes signed-URL creation:
`createSignedUrl` runs through the Storage API with the caller's JWT, and Storage
authorizes object access via RLS on `storage.objects` (SELECT for reads/signing). The
page is already gated to admins (`/admin` layout checks `user_roles` via `has_role`), and
`has_role((select auth.uid()), 'admin')` inside the policy re-checks it at the DB layer.
Two verification points for FASE C (Studio + smoke):
1. Confirm in Studio that no OTHER policy on `storage.objects` already covers
   `verification-documents` reads (BLOCK 1 snapshot of existing storage policies).
2. Smoke: as an admin session, `createSignedUrl('verification-documents', '<path>')`
   returns a URL; as a non-admin, it fails. If Storage's signing path rejects
   user-context signing in practice (edge case not fully verifiable from the repo), the
   fallback is a tiny SECURITY DEFINER RPC that returns the doc list for admins plus
   public-URL-less proxying -- documented here as fallback, NOT built unless the smoke
   fails.

Delivery for the policy: Camino 2 (Pedro in Studio, READ -> WRITE -> VERIFY) + mirror
migration committed as repo-of-record + `schema_migrations` ledger INSERT by hand (ledger
bookkeeping note, same as the onboarding change).

## Architecture note (the guiding thread)

After both subphases, the rule "Service Role solo en Edge Functions, jamas en cliente"
(`openspec/project.md` stack table) has ZERO live exceptions:
- Vercel runtime: no `createAdminClient`, no `SUPABASE_SERVICE_ROLE_KEY` reference.
- The key lives ONLY in Supabase Function secrets (Deno.env) and in local dev-tooling env
  for seed/QA scripts (never shipped, `.env*` gitignored).

### lib/supabase/admin.ts -- delete or keep?

Real grep (2026-07-09): exactly two importers -- `configuracion/actions.ts:4` (removed in
Subfase 1) and `admin/verifications/page.tsx:2` (removed in Subfase 2). After both, zero
importers -> **DELETE the file in Subfase 2's commit**. If any future server-side admin
need appears, the sanctioned home is a new Edge Function, not a Vercel-side client.

## Out of scope (documented product decision)

**Surviving participant's chats.** Today `chats.comprador_id/vendedor_id` are ON DELETE
CASCADE: deleting a user deletes the whole chat and its messages for the OTHER participant
too (their trade history/evidence disappears). This is the accepted current behavior --
Pedro's decision 2026-07-09: schema stays untouched in this change. Future product
decision if it ever hurts: migrate those FKs to SET NULL + render a "Usuario eliminado"
placeholder, preserving the survivor's conversation (mirrors how received reviews are
anonymized rather than deleted). Requires its own change: FK migration + UI null-handling
+ delete_user_data adjustment.
