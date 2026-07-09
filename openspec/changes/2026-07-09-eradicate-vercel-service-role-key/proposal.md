# Proposal -- Eradicate SUPABASE_SERVICE_ROLE_KEY from the Vercel runtime

## Why

Exactly TWO consumers of `createAdminClient()` (`apps/web/lib/supabase/admin.ts`, which
reads `process.env.SUPABASE_SERVICE_ROLE_KEY!`) live in the Vercel runtime, where that
key does NOT exist (confirmed: Vercel env only carries the NEXT_PUBLIC_* set). Both crash
at runtime with the same silent-collapse pattern as the onboarding saga's "Obstaculo 4":

1. **`deleteAccount()`** (`apps/web/app/(marketplace)/configuracion/actions.ts:14-15`) --
   the "Eliminar mi cuenta" button in `/configuracion` calls this Server Action, which
   instantiates the admin client and calls `auth.admin.deleteUser`. With the key missing,
   the action throws and the user cannot delete their account. Impact:
   - **Active violation of Apple App Store Guideline 5.1.1(v)** -- VICINO iOS IS published
     (confirmed by Pedro, July 2026; `openspec/project.md` is stale marking it as prep).
     Apps offering account creation MUST offer working in-app account deletion.
   - **LFPDPPP (ARCO) exposure**: a visible production button that fails, while the public
     page `/eliminar-cuenta` (the Google Play Data-deletion URL) promises "Opcion 1 --
     Desde la app ... eliminados de inmediato". The documentation promises a flow that
     does not work.
   - **Blocker for the pending Google Play launch** (Data deletion policy requires working
     in-app deletion plus the web URL).
   - Even if the key existed, this action is WRONG: it skips `delete_user_data`
     (relational data) and storage cleanup entirely.
2. **Admin verifications panel** (`apps/web/app/admin/verifications/page.tsx:57`) -- uses
   the same admin client to generate signed URLs for INE/selfie verification docs. With
   the key missing, `createClient(url, undefined)` throws and the page render crashes.

The correct account-deletion circuit ALREADY EXISTS, orphaned but live:
- Edge Function `delete-account` (`supabase/functions/delete-account/index.ts`) --
  DEPLOYED and verified alive (OPTIONS 200 / POST-noauth 401, probes 2026-07-09). The
  service-role key lives in Supabase Function secrets (`Deno.env.get`), never in Vercel.
  It runs the three layers: `delete_user_data` RPC -> storage cleanup (5 buckets) ->
  `auth.admin.deleteUser`.
- API route `apps/web/app/api/account/delete/route.ts` -- validates the `ELIMINAR`
  confirmation server-side and forwards the caller's JWT to the Edge Function.
  **Zero callers today.**

Git archaeology: commit `8b382d2` ("feat: account deletion (Google Play Data Safety
compliance)") built the correct circuit and wired the button to it. Commit `962b5e8`
("feat: eliminar cuenta, fix FK cascades, remover netlify") later REWIRED the button to
the broken admin-client action -- the regression this change reverts. The fix is to
RECONNECT, not to build.

## What

Two subphases, one guiding thread: after this change, **ZERO code in the Vercel runtime
needs `SUPABASE_SERVICE_ROLE_KEY`** -- the house rule "Service Role solo en Edge
Functions, jamas en cliente" (`openspec/project.md`) is left with no live exceptions.

- **Subfase 1 (deleteAccount)**: rewire `DeleteAccountSection` back to
  `fetch('/api/account/delete')` (restores the `8b382d2` pattern) and eradicate the
  broken `deleteAccount()` action plus its `createAdminClient` import. Redeploy the Edge
  Function to guarantee the deployed version includes the avatars-bucket fix (`4a2d5a1`).
- **Subfase 2 (admin panel)**: remove the key dependency from
  `admin/verifications/page.tsx` via the documented no-key pattern: re-create the storage
  policy `"Admin read verification docs"` on `storage.objects` (the original migration
  `20260429000001` was deleted from the repo as dead code on 2026-06-03 -- it must be
  re-authored) and generate signed URLs with the authenticated admin's user-context
  client.

Each subphase lands as its own commit with independent validation and its own CODEX
review. Deletion semantics are unchanged: **hard-delete with selective anonymization**,
exactly what `delete_user_data` already implements (decision: do not reinvent the schema).

## Scope

### IN
- Subfase 1: rewire button -> API route -> existing Edge Function; delete the broken
  action; Edge Function redeploy (infra step, run by Pedro); e2e smoke via
  `apps/web/scripts/qa-delete-account.mjs`.
- Subfase 2: re-author the admin-read storage policy (Camino 2, Studio) + switch the
  verifications page to the user-context client; validate the panel renders signed URLs.
- Final sweep: confirm `lib/supabase/admin.ts` has zero importers and decide
  delete-vs-keep (report the real grep).

### OUT
- Chat-cascade change (preserving the surviving participant's conversation via SET NULL +
  placeholder) -- future product decision, documented in design.md. Schema untouched.
- MP#07, MP#08, growth/marketing, onboarding (closed and merged).
- Any new deletion semantics (retention windows, soft-delete, etc.).

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Approves design, runs Studio SQL (Camino 2) + Edge Function redeploy, validates, merges ff-only |
| Authoring | Claude Code | OpenSpec, code rewire, policy draft, verification; no deploy, no DB writes |

## Success criteria (objective, measurable)

1. Account deletion works e2e in a prod-like run without `SUPABASE_SERVICE_ROLE_KEY` in
   Vercel: button -> `ELIMINAR` -> API route -> Edge Function -> `delete_user_data` +
   storage cleanup + auth deletion; verified with `qa-delete-account.mjs` and a manual
   flow on 2 viewports (mobile 375x812 + desktop 1280x800).
2. `/admin/verifications` renders signed INE/selfie URLs with NO service-role key in the
   Vercel runtime.
3. `grep -r "SUPABASE_SERVICE_ROLE_KEY" apps/web/app apps/web/lib apps/web/components`
   returns ZERO matches (local seed/QA scripts under `apps/web/*.ts` root and
   `apps/web/scripts/` are dev-tooling and out of the runtime; Edge Functions read it via
   `Deno.env` on Supabase, which is the sanctioned home).
4. `apps/web/lib/supabase/admin.ts` is deleted, or every remaining importer is documented
   with a reason.

## References

- Correct original circuit: commit `8b382d2` (button -> `/api/account/delete` -> Edge Function)
- Regression: commit `962b5e8` (rewired to admin client; same commit shipped
  `20260505000001_fix_delete_user_cascade.sql`, so FK cascades are already sane)
- Relational deletion: `supabase/migrations/20260320000019_account_deletion.sql`
  (`delete_user_data`, SECURITY DEFINER, guard `auth.uid() != target`, anonymizes received
  reviews, `account_deletion_log` with 90-day retention)
- Edge Function: `supabase/functions/delete-account/index.ts` (+ avatars fix `4a2d5a1`)
- Admin no-key pattern: comment block `apps/web/app/admin/verifications/page.tsx:50-56`;
  deleted policy migration `20260429000001` (rls-performance spec follow-ups)
- FASE 0 audit: full FK cascade graph + store/legal analysis (session 2026-07-09)
