# Tasks -- Eradicate SUPABASE_SERVICE_ROLE_KEY from the Vercel runtime

> FASE A = OpenSpec (this directory). FASE B = Subfase 1 (deleteAccount reconnect).
> FASE C = Subfase 2 (admin panel no-key). Each subfase: ONE commit, `pnpm build` verde,
> CODEX adversarial review, STOP for Pedro's validation before the next. Infra steps
> (Edge Function redeploy, Studio SQL) are run by PEDRO -- they are not code commits.
> Discipline: explicit `git add`, ASCII commits, ff-only, never commit `.env` /
> service-role key / PWA artifacts (`sw.js`/`workbox`). Stash `pwa-config-artifacts`
> stays untouched.

## FASE A -- OpenSpec (this directory)

- [x] A-01 -- proposal.md (why both breakages + reconnect-not-build + success criteria)
- [x] A-02 -- design.md (Subfase 1 rewire, Subfase 2 policy + user-context, architecture
  note, admin.ts deletion decision, chats out-of-scope note)
- [x] A-03 -- tasks.md (this file)
- [x] A-04 -- specs/service-role-isolation/spec.md (EARS delta R1-R4)
- [ ] A-05 -- PARA. Pedro approves before FASE B.

---

## FASE B -- Subfase 1: deleteAccount reconnect (Claude code + Pedro infra)

- [ ] B-01 -- Rewire `delete-account-section.tsx` to `fetch("/api/account/delete")`
  (restore `8b382d2` pattern: send `confirmText`, keep error box + loading, on success
  `router.replace("/")`).
- [ ] B-02 -- Eradicate `deleteAccount()` + `createAdminClient` import from
  `apps/web/app/(marketplace)/configuracion/actions.ts` (delete the file if empty).
- [ ] B-03 -- Confirm NO edits needed in `api/account/delete/route.ts` nor the Edge
  Function source (already correct).
- [ ] B-04 -- `pnpm build` verde local.
- [ ] B-05 -- Commit (explicit adds, ASCII):
  `fix(security): reconnect account deletion to edge function, drop admin client action`
- [ ] B-06 -- CODEX adversarial review loop (Server Actions + auth = max priority).
  Blocker HIGH = STOP, max 3 iterations.
- [ ] B-07 -- INFRA (Pedro): `supabase functions deploy delete-account` (guarantees the
  avatars fix `4a2d5a1` is the deployed version).
- [ ] B-08 -- SMOKE (Pedro, local env with dev-tooling key):
  `node apps/web/scripts/qa-delete-account.mjs` -> all steps green.
- [ ] B-09 -- UI validation, 2 viewports (mobile 375x812 + desktop 1280x800): login with a
  throwaway/test user -> Configuracion -> Eliminar mi cuenta -> type ELIMINAR -> account
  deleted, signed out, redirected home; login again fails (user gone). Screenshot each
  viewport.
- [ ] B-10 -- STOP. Pedro validates Subfase 1 before FASE C.

---

## FASE C -- Subfase 2: admin verifications without the key

- [ ] C-01 -- Author `studio-script.sql` block for the storage policy (Camino 2):
  BLOCK 1 SNAPSHOT (existing policies on storage.objects covering
  `verification-documents`), BLOCK 2 DRY-RUN, BLOCK 3 APPLY
  (`CREATE POLICY "Admin read verification docs" ...` per design.md), BLOCK 4 VERIFY +
  smoke (admin session signs a URL; non-admin fails).
- [ ] C-02 -- Mirror migration `supabase/migrations/<ts>_admin_verification_docs_read.sql`
  (repo-of-record, NOT applied via CLI) + ledger bookkeeping note
  (INSERT into supabase_migrations.schema_migrations by hand after APPLY).
- [ ] C-03 -- Switch `admin/verifications/page.tsx` signOrNull calls to the user-context
  `supabase` client; remove `createAdminClient` import.
- [ ] C-04 -- DELETE `apps/web/lib/supabase/admin.ts` (grep confirms zero importers after
  C-03; if anything still imports it, STOP and document instead).
- [ ] C-05 -- Final sweep: `grep -r "SUPABASE_SERVICE_ROLE_KEY\|createAdminClient"
  apps/web/app apps/web/lib apps/web/components` -> ZERO matches.
- [ ] C-06 -- `pnpm build` verde local.
- [ ] C-07 -- Commit (explicit adds, ASCII):
  `fix(security): admin verification docs via storage policy, drop vercel service role`
- [ ] C-08 -- CODEX adversarial review loop (RLS/storage policy = max priority).
- [ ] C-09 -- INFRA (Pedro, Studio): run BLOCK 1 -> 2 -> 3 -> ledger INSERT -> BLOCK 4.
  If the user-context signing smoke FAILS (design.md fallback case), STOP -> fallback
  design discussion before any further code.
- [ ] C-10 -- UI validation: `/admin/verifications` renders with signed INE/selfie URLs
  as an admin user (desktop 1280x800; page is desktop-oriented admin tooling -- mobile
  spot-check only if layout renders there).
- [ ] C-11 -- STOP. Pedro validates Subfase 2.

---

## Closing

- [ ] D-01 -- push branch + PR to master (PAT/credential-manager; keep remote URL clean).
  PR body: both subphases, reconnect-not-build, zero service-role in Vercel runtime.
- [ ] D-02 -- Pedro validation -> ff-only merge.
- [ ] D-03 -- Archive this change (manual bootstrap pattern if the CLI delta format does
  not match, same as harden-onboarding-rpc) + delete branch local+remote.
- [ ] D-04 -- Follow-up NOT in this change: update stale `openspec/project.md` mobile
  row (iOS is PUBLISHED since July 2026; repo still says pre-store).

## Rollback plan

- Subfase 1 is a pure client rewire: revert the commit to restore the previous (broken)
  action -- no data risk. The Edge Function redeploy is idempotent.
- Subfase 2: `DROP POLICY "Admin read verification docs" ON storage.objects;` restores
  the prior state; revert the commit to restore the admin-client page (broken in Vercel
  but unchanged behavior elsewhere). No user data is touched by either subfase.
