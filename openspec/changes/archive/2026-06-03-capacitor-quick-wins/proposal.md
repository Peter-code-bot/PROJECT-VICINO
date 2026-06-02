# Proposal — Capacitor Quick Wins (A4)

## Why

The VICINO APK is a Capacitor shell loading `https://vicinomarket.com` in a
WebView (live mode, NOT bundle local — confirmed in `apps/web/capacitor.config.ts:11`).
A1 fixed the Google OAuth flow; A2 + A3 hardened DB and web rendering. The
APK still feels distinctly "web" rather than "native" in 3 acute places:

1. **No haptic feedback on touch.** `@capacitor/haptics` IS installed and used
   in exactly 2 places — `page-swipe-wrapper.tsx:145` (tab swipe) and
   `pull-to-refresh-wrapper.tsx:78` (pull trigger). Every other tap (5 bottom
   nav items, favorite toggle, chat send, category tiles, "Publicar producto",
   "Comprar", podium slots, ~20+ targets) lands silently. On stock Android UX,
   these would all give tactile confirmation.

2. **Dumb Android back button.** Current handler in `capacitor-init.tsx:16-22`
   does only `window.history.back()` or `App.exitApp()`. It DOES NOT close
   open modals/drawers/sheets. A user opens the account drawer, taps the
   system back gesture, expects the drawer to close — instead the app
   navigates away or exits. Also: no double-tap-to-exit confirmation —
   accidental swipe-back at root quits the app silently.

3. **No overscroll control.** `globals.css` has no `overscroll-behavior`
   declarations. WebView Android shows the default blue glow indicator at
   the top/bottom of every scrollable list, including the body itself, on
   pages without pull-to-refresh. Feel is "web in a wrapper", not native.

### Related debt this PR pays off

The A1 archive (`openspec/specs/auth-session/spec.md`) lists as known
follow-up: *"`capacitor-init.tsx` `App.addListener` handles are never removed
on unmount — accumulates listeners under HMR/StrictMode."* Since A4 already
needs to rewrite the back-button listener with a smarter handler, this is
the natural moment to close that debt: store all 4 handles
(`backButton`, `appUrlOpen`, `keyboardWillShow`, `keyboardWillHide`) and
remove them in the `useEffect` cleanup.

## What

Three sub-phases in implementation order, each one commit gated by
`pnpm build` green, CODEX `/ultrareview` before push, and **APK device
testing by Pedro** (build verde alone is not sufficient — these are touch
+ system-button + scroll changes that only manifest on a real Android
device).

- **4.1 Haptic feedback helper + integration**. Create
  `apps/web/lib/haptics.ts` exporting `hapticLight()`, `hapticMedium()`,
  `hapticSelection()` — all guarded by `Capacitor.isNativePlatform()` so
  they no-op on web. Wire to ~10 high-value touch targets (see design.md
  section 1 for the table of target → intensity).
- **4.2 Smart back button + listener cleanup**. Rewrite the `backButton`
  handler in `capacitor-init.tsx` to consult a priority list before
  navigating: (a) close topmost open Radix dialog if any, (b) close custom
  drawer if any, (c) back from `siguiendo` tab to `parati`, (d) `history.back`
  if possible, (e) double-tap-to-exit with Sonner toast confirmation.
  In the same commit, refactor the `useEffect` to store all 4 listener
  handles and remove them in the cleanup function.
- **4.3 Overscroll containment**. Add
  `overscroll-behavior-y: contain;` to `html, body` in `globals.css`. This
  kills the parasitic blue glow on pages without pull-to-refresh while
  preserving pull-to-refresh where it's wired up (the `contain` keyword
  contains the chain at the element boundary, doesn't disable the gesture
  entirely).

### Out of scope for A4 (deferred to follow-ups in tasks.md)

- **View Transitions API** (Chrome 111+ supported in WebView). Will be A5.
  Separate sub-phase because (a) requires `experimental.viewTransition` flag
  in `next.config.ts` validation, (b) requires defining `view-transition-name`
  on hero images per route, (c) interaction with our `prefetch={false}`
  discipline from A3.6 needs validation.
- **`CapacitorHttp`**. Would intercept JS `fetch`/`XHR` via native OkHttp,
  breaking the WebView cookie store that Supabase auth + Set-Cookie rely on.
  Not applicable for our live-WebView setup.
- **Local bundle (`webDir: dist`)**. Architectural change; the live
  `server.url` is canonical (matches Vercel deploys + A3 perf work assumes
  CDN delivery).
- **Splash screen tuning**. Already configured decently in
  `capacitor.config.ts:31-41`. Cosmetic ROI is low.
- **Per-route status bar tinting**. Would require dispatching style/color
  changes on route change events. High complexity vs cosmetic upside.

## Scope

### IN (this change)

- `apps/web/lib/haptics.ts` (new file)
- `apps/web/components/capacitor-init.tsx` (smart back + cleanup)
- `apps/web/components/layout/bottom-nav.tsx` (5 nav taps → `hapticLight`)
- `apps/web/components/shared/favorite-button.tsx` (toggle → `hapticLight`)
- `apps/web/components/profile/account-menu-drawer.tsx` (add
  `data-modal-open` attribute + escape handler for smart back detection)
- Other touch-target consumers per the table in design.md (chat send button,
  "Publicar producto" CTA in `vender`, "Comprar" / sale confirm flow, category
  tiles in home)
- `apps/web/app/globals.css` (overscroll-behavior-y)

### OUT (deferred — see tasks.md follow-ups)

- View Transitions (A5)
- CapacitorHttp
- Local bundle
- Splash / status bar polish
- Refactor of custom drawers (account-menu-drawer) to use Radix Dialog primitive
  underneath — out of scope; we add a 1-attribute convention instead
- Auth / RLS / proxy.ts — A1 and A2 are in production. NOT touched.

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Approves spec, **recompiles debug APK after each sub-phase commit**, installs on device, validates haptics/back/overscroll. Merges PR. |
| Authoring + implementation | Claude Code | Spec, code, build gates, CODEX review, helper architecture |

## Success criteria (objective, measurable on device)

1. **Haptic on bottom nav**: tapping any of the 5 bottom nav items on the
   APK produces a Light haptic impact (verifiable by feel).
2. **Haptic on favorite toggle**: tapping the heart on any product card
   produces a Light haptic.
3. **Haptic on chat send**: hitting send in a chat thread produces a
   Medium haptic.
4. **Back closes account drawer**: open the account menu drawer, press the
   Android back button → the drawer closes WITHOUT navigating.
5. **Back from siguiendo → parati**: navigate to `/?feed=following`, press
   back → lands on `/` (parati), not on the previous external route.
6. **Double-tap-exit at root**: on `/` (parati, no history left), press
   back once → Sonner toast appears with "Presiona de nuevo para salir";
   press back again within 2 s → app exits. Wait > 2 s → toast disappears,
   single back is a no-op again.
7. **No glow indicator** on overscrolling a list page without
   pull-to-refresh (e.g., chat list, profile sub-pages).
8. **Pull-to-refresh still works** on routes that have it wired up
   (verified by triggering pull on those routes).
9. **No regression on existing flows** — login (web + APK), product flow,
   chat, notifications, seller dashboard.

## References

- `apps/web/capacitor.config.ts` — live WebView config
- `apps/web/components/capacitor-init.tsx:16-22` — current dumb back handler
- `apps/web/components/layout/page-swipe-wrapper.tsx:145` — reference
  haptics call pattern
- A1 archive `openspec/specs/auth-session/spec.md` (Known follow-ups
  section) — listener cleanup debt this PR pays off
- Sonner Toaster mounted at `app/layout.tsx:106` —
  `<Toaster richColors position="bottom-center" />` ready to use
- HomeTabs URL-based state at
  `apps/web/components/home/home-tabs.tsx` — `/?feed=following` ↔ `/`
- Radix Dialog primitive renders `[role="dialog"][data-state="open"]`
  attribute — primary detection mechanism for smart back
