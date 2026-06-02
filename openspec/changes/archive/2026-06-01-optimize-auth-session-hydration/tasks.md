# Tasks — Optimize Auth Session Hydration

> Execution checklist. Every task references the concrete file and line.
> Gate: `pnpm build` from monorepo root between each code commit. Auth area = CODEX review required before push.

## Pre-flight

- [x] **T-00 · Branch** — `git checkout master && git pull --rebase origin master && git checkout -b feat/optimize-auth-session`
- [x] **T-01 · F1 cancelled** — verified via build error that `apps/web/proxy.ts` is the
  active Next.js 16 middleware entry point. No `middleware.ts` is needed.
  Build error message: `Both middleware file "./middleware.ts" and proxy file "./proxy.ts"
  are detected. Please use "./proxy.ts" only.`

---

## Commit 1 — OpenSpec correction

- [ ] **T-02 · Commit OpenSpec** — explicit add of
  `openspec/changes/2026-06-01-optimize-auth-session-hydration/` (all 4 files:
  proposal.md, design.md, tasks.md, specs/auth-session/spec.md).
  Message: `docs(openspec): correct middleware hypothesis, proxy.ts active in next 16`

---

## Commit 2 — F2: Eliminate flash

- [ ] **T-03 · Edit `oauth-url-listener.tsx:71-72`** — replace:
  ```ts
  router.push("/");
  router.refresh();
  ```
  with:
  ```ts
  window.location.replace("/");
  ```
  Keep the `useRouter` import — still used by lines 57 and 68 for the error redirects to `/login`.
- [ ] **T-04 · Build gate** — `pnpm build` green from repo root.
- [ ] **T-05 · Commit** — explicit add of `apps/web/components/auth/oauth-url-listener.tsx`.
  Message: `fix(auth): replace router.push+refresh with window.location.replace`

---

## Commit 3 — F3: Parallelize layout queries

- [ ] **T-06 · Edit `apps/web/app/(marketplace)/layout.tsx:26-58`** — restructure the
  sequential awaits into two steps: (1) `getUser()` alone, (2) `Promise.all` for the 5 DB
  queries (profiles, user_roles, notifications, buyer chats, seller chats). See
  design.md section 3 for the exact code shape.
- [ ] **T-07 · Build gate** — `pnpm build` green.
- [ ] **T-08 · Commit** — explicit add of `apps/web/app/(marketplace)/layout.tsx`.
  Message: `perf(layout): parallelize marketplace layout DB queries`

---

## Commit 4 — F4: Fix callback route headers

- [ ] **T-09 · Edit `apps/web/app/auth/callback-server/route.ts:24,29`** — change both
  `NextResponse.redirect(...)` calls to include
  `{ status: 303, headers: { "Cache-Control": "private, no-store" } }`.
- [ ] **T-10 · Build gate** — `pnpm build` green.
- [ ] **T-11 · Commit** — explicit add of `apps/web/app/auth/callback-server/route.ts`.
  Message: `fix(callback): add Cache-Control no-store and status 303`

---

## Pre-push review

- [ ] **T-12 · CODEX adversarial review** — run `/ultrareview` on branch
  `feat/optimize-auth-session`. Auth is maximum-priority area per CLAUDE.md. Focus:
  - F2: destination `"/"` is a hardcoded literal, not from user input
  - F3: no query in the `Promise.all` depends on the result of another query
  - F4: `Cache-Control` header does not affect the `Set-Cookie` header on the same response
  - F1 cancellation rationale is documented
  All CRITICAL and HIGH issues must be resolved before push.
- [ ] **T-13 · Report to Pedro** — present CODEX findings + final diff (3 code commits +
  1 docs commit). Wait for push approval.

---

## Handoff to Pedro (post-push)

- [ ] **H-1 · Vercel deploy** — Pedro merges `feat/optimize-auth-session` to master via
  fast-forward. Vercel auto-deploys.
- [ ] **H-2 · Runtime verification on APK** — execute V-1 through V-4 below on device.

---

## Verification

- [ ] **V-1 · Flash eliminated (APK)** — complete Google OAuth on debug APK. The home
  screen appears authenticated on first paint. No guest state visible.
- [ ] **V-2 · Flash eliminated (web)** — complete Google OAuth on `vicinomarket.com` in
  desktop Chrome. Redirect from `/auth/callback-server` lands at authenticated home.
- [ ] **V-3 · Email+password unaffected** — login with email+password on both web and
  APK. No regression.
- [ ] **V-4 · Other flows smoke test** — product listings, chat, notifications, seller
  dashboard, logout, and re-login. All functional.

---

## Closing

- [ ] **T-14 · Archive this change** — after V-1 through V-4 verde plus 24h Sentry
  clean, move this directory to `openspec/changes/archive/2026-06-01-optimize-auth-session-hydration/`.
  Merge spec delta into `openspec/specs/auth-session/spec.md` (canonical domain spec).
