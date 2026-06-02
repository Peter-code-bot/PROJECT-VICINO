# Spec — capacitor-native-ux

> Domain: native-feeling UX conventions for the VICINO Capacitor APK
> (Android WebView loading `https://vicinomarket.com` live). Covers haptic
> feedback discipline, Android system-button handling, listener cleanup,
> and overscroll behavior.
>
> Canonical spec. Established by change `2026-06-03-capacitor-quick-wins`
> (A4). Codex follow-ups merged in commit `3ab33ad`.
>
> Last updated: 2026-06-02

---

## Context

The VICINO APK runs as a Capacitor WebView shell loading the production
web at `https://vicinomarket.com` (live, not bundled). Capacitor JS plugins
(Haptics, App, Keyboard, etc.) run inside the WebView's JS context and
work normally; native Android system features (back button, splash) are
mediated by Capacitor's bridge.

Four patterns from this spec define the "native feel" baseline:
1. **Haptic feedback** on touch targets that benefit from tactile
   confirmation.
2. **Android system back button** that obeys the user's mental model
   (close modal first, navigate next, ask before exit).
3. **Capacitor listener cleanup** to prevent accumulation under
   StrictMode dev double-mounts and HMR.
4. **Overscroll discipline** that suppresses the Android blue glow on
   pages without explicit pull-to-refresh, while preserving PTR where
   wired.

---

## Requirement R1 — Haptic feedback SHALL be invoked via a platform-aware helper

WHEN a touch target benefits from tactile confirmation on a native
platform, the call-site SHALL invoke the corresponding helper exported
from `apps/web/lib/haptics.ts` (`hapticLight`, `hapticMedium`,
`hapticSelection`). The helper SHALL be platform-aware: on web
(`Capacitor.isNativePlatform()` returns false) it returns silently
without importing the haptics plugin. Call-sites SHALL NOT add their
own `Capacitor.isNativePlatform()` guard.

The helper SHALL cache the loaded Capacitor + Haptics modules at the
module scope after the first successful native-platform call, so
subsequent calls do not pay the dynamic-import cost. The helper SHALL
also cache the in-flight load promise so concurrent invocations (e.g.,
two simultaneous taps) share the same dynamic-import resolution instead
of racing two parallel imports.

The helper SHALL fire haptic intent BEFORE the action it confirms,
EXCEPT when the action is a `next/link` navigation whose `onClick`
handler may call `e.preventDefault()`. In that case, haptic SHALL fire
AFTER `onClick` resolves and only if `e.defaultPrevented === false`
(see `HapticLink` in `apps/web/components/shared/haptic-link.tsx`). For
form submissions with validation, the haptic SHALL fire only after ALL
validation checks pass, never on a failure path.

Intensity selection (canonical):
- **Light**: frequent low-attention actions (bottom nav tap, favorite
  toggle, category browse, podium slot, single CTAs that begin a flow
  rather than commit it).
- **Medium**: high-stakes commits (send chat message, publish product,
  confirm sale, cancel sale — rejection is equally destructive as
  confirmation).
- **Selection**: list pickers, dropdown selection (exposed by helper
  for future consumers; see follow-up F1).

### Scenario: New touch target adopts haptic feedback

- GIVEN a developer is wiring a touch handler that confirms an action
- WHEN they add the haptic call
- THEN they import `hapticLight` / `hapticMedium` / `hapticSelection` from `@/lib/haptics`
- AND they call it as a fire-and-forget side effect (`void hapticLight()` before the action)
- AND they do NOT add their own `Capacitor.isNativePlatform()` guard

### Scenario: Web build is unaffected

- GIVEN a user opens `https://vicinomarket.com` in a desktop or mobile browser
- WHEN they tap any haptic-wired target
- THEN the helper returns silently
- AND `@capacitor/haptics` is not loaded into the bundle for that interaction
- AND no console error / warning is emitted

### Scenario: Native APK fires correct intensity

- GIVEN the APK is installed and a user taps a target wired to `hapticMedium`
- WHEN the tap registers
- THEN a Medium-intensity haptic impact fires before or in parallel with the action

### Scenario: Form validation failure does NOT fire haptic

- GIVEN a form has two validation checks before submission
- WHEN the user submits and the second check fails
- THEN no haptic fires
- AND the error message renders inline

### Scenario: Cancelled link click does NOT fire haptic

- GIVEN a `HapticLink` has a custom `onClick` that calls `e.preventDefault()`
- WHEN the user taps the link
- THEN the caller's `onClick` runs first
- AND because `e.defaultPrevented === true`, no haptic fires

---

## Requirement R2 — Android back button SHALL follow a modal-aware priority order

WHEN the Android system back button is pressed inside the VICINO APK,
the back handler SHALL consult a priority list and act on the FIRST
matching condition, never the next:

1. **Open Radix modal**: if `document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"]')` returns a node, dispatch a synthetic `KeyboardEvent("keydown", { key: "Escape", bubbles: true })` on `document` (Radix closes it automatically). Do NOT navigate.
2. **Open custom modal**: if `document.querySelector('[data-modal-open="true"]')` returns a node, dispatch the same synthetic Escape event. Custom modals SHALL listen for `Escape` on `document` and close themselves when open. Do NOT navigate.
3. **HomeTabs "siguiendo" -> "parati"**: if the URL is `/` with search param `feed=following`, call `window.history.back()` (which returns to `/` because that's how the user arrived).
4. **Browser history available**: if the Capacitor `canGoBack` flag is true, call `window.history.back()`.
5. **Root + double-tap-to-exit**: at the root (no history), the FIRST back press SHALL display a Sonner toast "Presiona de nuevo para salir" with `duration: 2000`, and record a timestamp. A SECOND back press within 2000 ms SHALL call `App.exitApp()`. A press after 2000 ms SHALL re-show the toast as a fresh attempt.

The handler SHALL be the only registered `backButton` listener in the
app (no other component registers one) to avoid race conditions.

The handler body SHALL be wrapped in a try/catch with a `console.error`
fallback. Capacitor invokes the listener with a floated `.catch`, so an
unhandled reject (e.g., dynamic `import("sonner")` fails on flaky
network) would surface as `unhandledRejection` without the boundary.
The catch SHALL fail silent — the back button must not crash the app.

### Scenario: Back closes Radix dialog

- GIVEN a `<Dialog>` from `@/components/ui/dialog` is open (renders `[role="dialog"][data-state="open"]`)
- WHEN the Android back button is pressed
- THEN a synthetic Escape event is dispatched on `document`
- AND Radix closes the dialog
- AND the page does NOT navigate back

### Scenario: Back closes custom drawer

- GIVEN `account-menu-drawer.tsx` is open (renders portal with `data-modal-open="true"`)
- WHEN the Android back button is pressed
- THEN a synthetic Escape event is dispatched
- AND the drawer's `keydown` listener calls `setOpen(false)`
- AND the page does NOT navigate back

### Scenario: Back from siguiendo returns to parati

- GIVEN the user is on `/?feed=following` (HomeTabs siguiendo active)
- WHEN the Android back button is pressed
- THEN `window.history.back()` is called
- AND the user lands on `/` (parati)

### Scenario: Double-tap-to-exit at root

- GIVEN the user is on `/` with no further history
- WHEN the Android back button is pressed
- THEN a Sonner toast "Presiona de nuevo para salir" appears with duration 2000 ms
- AND a timestamp is recorded
- WHEN the Android back button is pressed again within 2 seconds
- THEN `App.exitApp()` is called

### Scenario: Single back outside grace window is a no-op

- GIVEN the user is on `/` with no history
- AND they pressed back > 2 seconds ago (grace expired)
- WHEN they press back again
- THEN a fresh Sonner toast appears
- AND the app does NOT exit

---

## Requirement R3 — Capacitor listener handles SHALL be cleaned up on unmount

WHEN `CapacitorInit` registers Capacitor plugin event listeners via
`addListener` (which returns `Promise<PluginListenerHandle>`), the
`useEffect` SHALL store every returned handle in a closure-scoped array
and call `void handle.remove()` for each in the effect's cleanup function.

Because the listener registrations are async, the cleanup MUST handle
the race where the effect unmounts BEFORE an `addListener` promise has
resolved. The init function SHALL maintain a `cancelled` flag set by
the cleanup; at every `await` checkpoint, if `cancelled === true`, the
just-resolved handle SHALL be `remove()`'d immediately and the init
SHALL return. This same guard SHALL be placed before any post-await
side-effect (e.g., `SplashScreen.hide`, `StatusBar.setStyle`).

Any module-level state used by listeners (e.g., the double-tap-exit
`lastBackPress` timestamp) SHALL be reset in the cleanup to avoid
leaking state across remount cycles.

This applies to ALL listeners currently registered in
`capacitor-init.tsx`:
- `App.addListener("backButton", ...)`
- `App.addListener("appUrlOpen", ...)`
- `Keyboard.addListener("keyboardWillShow", ...)`
- `Keyboard.addListener("keyboardWillHide", ...)`

This closes the known follow-up from A1's
`openspec/specs/auth-session/spec.md` and prevents listener accumulation
under React StrictMode (dev) or HMR remounts.

### Scenario: Unmount removes all listeners

- GIVEN `CapacitorInit` is mounted and 4 listeners are registered
- WHEN the component unmounts (or the effect re-runs in StrictMode dev)
- THEN every handle has `remove()` called
- AND no duplicate listener fires on subsequent events

### Scenario: Unmount mid-async removes the late-resolving handle

- GIVEN `CapacitorInit` is in the middle of `await App.addListener("backButton", ...)` when the component unmounts
- WHEN the awaited promise resolves AFTER cleanup ran
- THEN the code detects `state.cancelled === true`
- AND calls `void backH.remove()` on the just-resolved handle
- AND does NOT push it into the handles array (init has already returned)

---

## Requirement R4 — Overscroll behavior SHALL be contained at the page boundary

WHEN any page in the APK is loaded, the `html` and `body` elements SHALL
declare `overscroll-behavior-y: contain`. This SHALL:
- suppress the Android default blue glow indicator at the top/bottom of
  the body on pages without pull-to-refresh wiring,
- preserve `PullToRefreshWrapper`'s pull-to-refresh gesture on routes
  that wire it (the wrapper installs its own touchmove handler on its
  child; `contain` on body does not block child scrollers),
- NOT affect inner scroll containers (modals, drawers, chat threads,
  scrollable lists) — `contain` governs the propagation chain only.

The rule SHALL be declared in `apps/web/app/globals.css` next to the
existing `-webkit-tap-highlight-color: transparent` declaration.

### Scenario: No glow on non-PTR routes

- GIVEN the user is on a route without `PullToRefreshWrapper` (e.g., `/chat` list)
- WHEN they scroll to the bottom of the content and continue to drag
- THEN no blue glow appears at the bottom of the body

### Scenario: PTR routes still trigger pull-to-refresh

- GIVEN the user is on a route that wraps its content in `PullToRefreshWrapper`
- WHEN they pull down at the top of the list
- THEN the PTR animation appears
- AND the haptic at `pull-to-refresh-wrapper.tsx:78` fires
- AND the refresh action executes

### Scenario: Modal internal scroll unaffected

- GIVEN the account drawer is open with content longer than the viewport
- WHEN the user scrolls inside the drawer to its end and continues to drag
- THEN the inner scroll behavior is unchanged (no body-glow propagation)
- AND no visual artifact appears at the drawer boundary

---

## Implementation notes

- **Haptics helper module-level cache**: `lib/haptics.ts` checks
  `Capacitor.isNativePlatform()` once and stores the result in a
  module-level variable. Subsequent calls short-circuit on web; on
  native, the `@capacitor/haptics` `Haptics` and `ImpactStyle` modules
  are loaded once and reused. The load promise itself is cached so two
  concurrent first-time invocations share a single dynamic-import.
- **`HapticLink` onClick ordering**: caller `onClick` runs FIRST so it
  may call `e.preventDefault()`. Haptic fires only if
  `e.defaultPrevented === false`. This prevents tactile feedback on a
  tap the application cancelled.
- **Synthetic Escape dispatch**: dispatched on `document` (not `window`)
  with `{ bubbles: true }` so Radix's portal-rendered overlays receive
  the event regardless of focus state.
- **Smart back priority list**: Radix -> custom modal -> siguiendo tab ->
  history -> exit. The order matters because (a) modals should always
  trap back before navigation, (b) the siguiendo->parati case is
  semantically a tab change not a navigation, (c) history.back is the
  default expected behavior, (d) exit only at root with confirmation.
- **`data-modal-open` convention**: this is the canonical attribute
  that ANY non-Radix overlay (custom drawer, bottom-sheet, side-sheet,
  custom dialog) MUST set on its outermost open-state element. Pair
  with a `useEffect`-installed `Escape` listener gated by the open
  state. Radix already exposes `data-state="open"` automatically and
  handles Escape itself, so Radix overlays do NOT need this attribute.
- **Double-tap-exit grace window**: 2000 ms is the standard Android
  pattern (matches Material Design "double-tap exit" toast docs).
  Stored in a module-level `lastBackPress` variable, NOT React state —
  state is not needed since the toast IS the visual UI. Reset to 0 in
  the effect cleanup.
- **`overscroll-behavior-y: contain` vs `none`**: `none` would kill PTR
  entirely. `contain` is the surgical choice — only blocks the
  propagation from the inner scroll element to the body / page
  background (which is what causes the glow on the body itself).

## Out of scope

- **View Transitions API** — deferred to A5
- **`CapacitorHttp`** — incompatible with current cookie-based auth
- **Local bundle** — architectural pivot, out of quick-wins scope
- **Auth / RLS** — A1 and A2 are in production. Not touched.

## Follow-ups

### F1 — `hapticSelection()` exported but has no call-site

The helper exposes `hapticSelection()` (maps to
`Haptics.selectionChanged()`) for future consumers (list pickers,
dropdown selectors, scrubbers). No current call-site uses it as of
2026-06-02. Documented by the Codex review as a LOW nit; intentionally
kept to avoid re-introducing it later when needed.

### F2 — Possible scrollY edge-case in `pull-to-refresh-wrapper.tsx`

In [pull-to-refresh-wrapper.tsx:40](../../../apps/web/components/layout/pull-to-refresh-wrapper.tsx#L40):

```
if (window.scrollY > 0 || isRefreshing) return;
```

vs [line 51](../../../apps/web/components/layout/pull-to-refresh-wrapper.tsx#L51):

```
if (deltaY > 0 && window.scrollY <= 0) {
```

The guard at line 40 returns when `scrollY > 0` (strictly greater), but
the pull-entry check at line 51 allows `scrollY <= 0`. When `scrollY`
is exactly 0 (top of page) both branches behave consistently. When
`scrollY` becomes negative due to iOS-style rubber-band overscroll, the
guard at 40 does NOT short-circuit, so the pull continues — this is
likely the intended behavior on iOS but should be confirmed against
Android WebView's overscroll semantics, especially now that
`overscroll-behavior-y: contain` is in place (which may produce a
different `scrollY` curve at the boundary). Low priority; verify on
device the first time PTR feels off.

### F3 — Custom drawers could be migrated to Radix Dialog

`account-menu-drawer.tsx`, `bottom-sheet.tsx`,
`product-reviews-drawer.tsx`, `seller-mobile-drawer.tsx`, and
`change-location-sheet.tsx` are custom overlays adopting the
`data-modal-open` convention. A future cleanup could migrate them to
Radix Dialog primitives, which would remove the convention shim and
get focus trap + scroll lock + Escape handling for free. This is a
bigger refactor; A4 adopts the minimal convention instead. Until then,
ANY new custom overlay added to the codebase MUST set
`data-modal-open="true"` on its open-state root AND install an
`Escape` keydown listener gated by `open`.

### F4 — Helper consolidation in PTR / page-swipe wrappers

`page-swipe-wrapper.tsx:145` and `pull-to-refresh-wrapper.tsx:78`
currently inline the same Capacitor + Haptics dynamic-import pattern
that `lib/haptics.ts` encapsulates. Refactor them to call
`hapticLight()` / `hapticMedium()` instead, removing the duplicated
guards. Low priority cleanup.
