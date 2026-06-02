# Tasks — Capacitor Quick Wins (A4)

> Execution checklist. One commit per sub-phase. `pnpm build` green gate
> between every commit. CODEX `/ultrareview` before push. **Each sub-phase
> also requires Pedro device testing on a real Android APK before the next
> sub-phase starts.**

## Pre-flight

- [x] **T-00 · FASE 0 audit** — completed 2026-06-03 (read-only).
- [x] **T-01 · Pedro firma priorities** — 3 HIGH sub-phases approved
  2026-06-03 (4.1 haptics, 4.2 smart back + cleanup, 4.3 overscroll).
- [ ] **T-02 · Branch** — `git checkout master && git pull --rebase origin
  master && git checkout -b feat/capacitor-quick-wins`

---

## Commit 1 — Sub-phase 4.1 · Haptics helper + integration

### Code changes

- [ ] **T-03 · Create `apps/web/lib/haptics.ts`** per design.md section 1a.
  Exports `hapticLight()`, `hapticMedium()`, `hapticSelection()`. All
  guarded by `Capacitor.isNativePlatform()`. Module-level cache for the
  loaded modules.
- [ ] **T-04 · Wire BottomNav 5 items** (`components/layout/bottom-nav.tsx`)
  — add `onClick={() => void hapticLight()}` to each Link.
- [ ] **T-05 · Wire FavoriteButton toggle**
  (`components/shared/favorite-button.tsx`) — add `void hapticLight()` in
  the `onClick` handler before `mutate()` call.
- [ ] **T-06 · Wire category tile tap** in `app/(marketplace)/page.tsx`
  category Links — add `onClick={() => void hapticLight()}`.
- [ ] **T-07 · Wire podium slot tap**
  (`components/rankings/podio-ranking.tsx`) — add `onClick={() => void
  hapticLight()}` to the outer `<Link>`.
- [ ] **T-08 · Wire chat send button** — locate the send handler in the
  chat input component (`app/(marketplace)/chat/[id]/...`) and add `void
  hapticMedium()` at the start of the send action.
- [ ] **T-09 · Wire "Publicar producto" final CTA** — locate the submit
  handler in the publish flow (`app/(marketplace)/vender/...` or its
  client component) and add `void hapticMedium()` on submit.
- [ ] **T-10 · Wire sale confirm** — locate the buyer/seller confirm
  handler in `components/chat/sale-confirmation-card.tsx` (or
  equivalent) and add `void hapticMedium()` on confirm.
- [ ] **T-11 · Wire "Continuar con Google"** OAuth tap in
  `app/(auth)/login/login-form.tsx` — add `void hapticLight()` at the
  start of the Google sign-in handler.

### Gate

- [ ] **T-12 · Build gate** — `pnpm build` from repo root, green required.
- [ ] **T-13 · Commit** — explicit add of new file `lib/haptics.ts` + all
  call-site files. Message:
  `feat(haptics): add hapticLight/Medium/Selection helper and wire to touch targets`

### Device validation (Pedro)

- [ ] **D-1 · Recompile debug APK** — `cap sync android` + Android Studio
  build, or equivalent CLI.
- [ ] **D-2 · Install on device** — `adb install -r app-debug.apk` or
  transfer.
- [ ] **D-3 · Test haptic on each target** per design.md section 1d.
- [ ] **D-4 · Smoke web (browser)** — confirm no errors, taps work
  silently as expected (no haptic, no crash, no console error).

---

## Commit 2 — Sub-phase 4.2 · Smart back button + listener cleanup

### Code changes

- [ ] **T-14 · Edit `account-menu-drawer.tsx`** — when `open` is true,
  set `data-modal-open="true"` on the portal root div, AND add a
  `useEffect` that listens for `keydown` events on `document` with
  `event.key === "Escape"` calling `setOpen(false)`. Cleanup on unmount.
- [ ] **T-15 · Rewrite `capacitor-init.tsx` backButton handler** per
  design.md section 2c. Priority order: Radix modals → custom modals
  (data-modal-open) → siguiendo→parati → history.back → double-tap-exit
  with Sonner toast.
- [ ] **T-16 · Refactor `capacitor-init.tsx` `useEffect` for cleanup**
  per design.md section 2d. Store all 4 `addListener` handles in a
  `handles` array, return a cleanup function that calls
  `void h.remove()` for each. Covers backButton, appUrlOpen,
  keyboardWillShow, keyboardWillHide (closes A1 follow-up).

### Gate

- [ ] **T-17 · Build gate** — `pnpm build` green.
- [ ] **T-18 · Commit** — explicit add of
  `apps/web/components/capacitor-init.tsx` +
  `apps/web/components/profile/account-menu-drawer.tsx`. Message:
  `feat(capacitor): smart back button with modal-aware priority + listener cleanup`

### Device validation (Pedro)

- [ ] **D-5 · Recompile + install debug APK**.
- [ ] **D-6 · Back closes drawer** — open account drawer, press
  Android back, drawer closes WITHOUT navigating.
- [ ] **D-7 · Back from siguiendo → parati** — navigate to
  `/?feed=following`, press back → lands on `/`.
- [ ] **D-8 · Back from deep page** — open a product detail, press
  back → goes to the previous page.
- [ ] **D-9 · Double-tap-exit at root** — on `/`, press back once →
  Sonner toast appears. Press back again within 2 s → app exits.
- [ ] **D-10 · Grace expiry** — press back, wait > 2 s, press back
  again → toast re-appears (single back is no-op outside grace).
- [ ] **D-11 · Re-open drawer after Escape close** — confirms the
  synthetic Escape dispatch is clean.

---

## Commit 3 — Sub-phase 4.3 · Overscroll containment

### Code changes

- [ ] **T-19 · Edit `apps/web/app/globals.css`** — add
  `overscroll-behavior-y: contain;` rule on `html, body`. Place near
  the existing `-webkit-tap-highlight-color: transparent` line (~175).

### Gate

- [ ] **T-20 · Build gate** — `pnpm build` green.
- [ ] **T-21 · Commit** — explicit add of `apps/web/app/globals.css`.
  Message:
  `feat(ui): contain overscroll behavior to kill parasitic glow on non-PTR pages`

### Device validation (Pedro)

- [ ] **D-12 · Recompile + install debug APK**.
- [ ] **D-13 · No glow on `/chat` list** — scroll to bottom, attempt to
  overscroll → no blue glow.
- [ ] **D-14 · No glow on `/` parati** — same test.
- [ ] **D-15 · PTR still fires** — on a route with
  `PullToRefreshWrapper`, pull down at top → PTR triggers, haptic
  still fires.
- [ ] **D-16 · Drawer internal scroll OK** — open account menu
  drawer, scroll inside, attempt to overscroll → behavior unchanged
  (no body glow propagating).

---

## Pre-push review

- [ ] **T-22 · CODEX `/ultrareview`** — run on branch
  `feat/capacitor-quick-wins`. Focus per design.md section 4.
  All CRITICAL/HIGH issues resolved before push.
- [ ] **T-23 · Report to Pedro** — present CODEX findings + device
  validation summary. Wait for push approval.

---

## Handoff to Pedro (post-push)

- [ ] **H-1 · Vercel deploy** — Pedro merges `feat/capacitor-quick-wins`
  via fast-forward; Vercel auto-deploys (web build unaffected by
  Capacitor — haptics no-op on web).
- [ ] **H-2 · Production smoke on web** —
  https://vicinomarket.com tap interactions work normally (no haptic,
  no errors).
- [ ] **H-3 · APK production build** — Pedro compiles release APK
  (signed) and installs on Play Console internal testing.
- [ ] **H-4 · APK device verification** — repeat D-3 through D-16 on
  the release APK (not debug). All checks green before promoting to
  closed testing.

---

## Closing

- [ ] **T-24 · Archive change** — after H-2 + H-4 verde plus 24 h Sentry
  clean, move directory to
  `openspec/changes/archive/2026-06-03-capacitor-quick-wins/`. Merge
  spec delta into canonical
  `openspec/specs/capacitor-native-ux/spec.md` (creates the canonical
  spec if it didn't exist). ASCII commit:
  `docs(openspec): archive capacitor-quick-wins after verified deploy`.

---

## Known follow-ups (separate changes, NOT bundled into A4)

### Out-of-scope for A4 (deferred to specific change IDs)

- **A5: View Transitions** — enable `experimental.viewTransition` in
  `next.config.ts`, define `view-transition-name` on hero images
  (product card → detail page is the highest-impact target), validate
  interaction with A3.6 `prefetch={false}` discipline. WebView Chrome
  111+ supports it across the entire minSdk=24 device pool.
- **CapacitorHttp evaluation** — currently blocked by the WebView cookie
  store dependency from Supabase auth. Would require coordinating with
  Supabase + next/auth migration to a native cookie / token flow.
- **Local bundle (`webDir: dist`)** — architectural pivot from
  live-WebView to bundled-Next-static. Out of A4 quick-wins scope.
- **Splash screen / status bar per-route polish** — cosmetic; low ROI.

### Discovered follow-ups during implementation (place-holder; populate during/after CODEX review)

- **Refactor 2 existing haptic call-sites to use the helper** —
  `page-swipe-wrapper.tsx:145` and `pull-to-refresh-wrapper.tsx:78`
  currently inline the same pattern the helper centralizes. Low priority
  cleanup; A4 intentionally does NOT change them to minimize review
  surface.
- **Refactor custom drawers to use Radix Dialog** —
  `account-menu-drawer.tsx` (and any future custom drawers) would
  benefit from sharing the Radix `data-state="open"` convention. A4
  adopts a minimal `data-modal-open="true"` + Escape handler shim
  instead — refactor can come later.
- **`prefetch={false}` discipline audit on smart back** — if Pedro
  observes any prefetch races during the back-button flow (e.g., the
  toast appears but back-to-prefetched-page lands slowly), open a
  follow-up to validate the interaction.
