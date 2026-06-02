# Spec — capacitor-native-ux (delta)

> Domain: native-feeling UX conventions for the VICINO Capacitor APK
> (Android WebView loading `https://vicinomarket.com` live). Covers haptic
> feedback discipline, Android system-button handling, and overscroll
> behavior.
> This is a DELTA spec — it defines new requirements introduced by change
> `2026-06-03-capacitor-quick-wins`. It will be merged into a canonical
> `openspec/specs/capacitor-native-ux/spec.md` after the change archives.
> Last updated: 2026-06-03

---

## Context

The VICINO APK runs as a Capacitor WebView shell loading the production
web at `https://vicinomarket.com` (live, not bundled). Capacitor JS plugins
(Haptics, App, Keyboard, etc.) run inside the WebView's JS context and
work normally; native Android system features (back button, splash) are
mediated by Capacitor's bridge.

Three patterns from this spec define the "native feel" baseline:
1. **Haptic feedback** on touch targets that benefit from tactile
   confirmation.
2. **Android system back button** that obeys the user's mental model
   (close modal first, navigate next, ask before exit).
3. **Overscroll discipline** that suppresses the Android blue glow on
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
subsequent calls do not pay the dynamic-import cost.

Intensity selection (canonical):
- **Light**: frequent low-attention actions (bottom nav tap, favorite
  toggle, category browse, podium slot, single CTAs that begin a flow
  rather than commit it).
- **Medium**: high-stakes commits (send chat message, publish product,
  confirm sale).
- **Selection**: list pickers, dropdown selection (not used by A4 but
  exposed by helper for future consumers).

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

---

## Requirement R2 — Android back button SHALL follow a modal-aware priority order

WHEN the Android system back button is pressed inside the VICINO APK,
the back handler SHALL consult a priority list and act on the FIRST
matching condition, never the next:

1. **Open Radix modal**: if `document.querySelector('[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"]')` returns a node, dispatch a synthetic `KeyboardEvent("keydown", { key: "Escape", bubbles: true })` on `document` (Radix closes it automatically). Do NOT navigate.
2. **Open custom modal**: if `document.querySelector('[data-modal-open="true"]')` returns a node, dispatch the same synthetic Escape event. Custom modals SHALL listen for `Escape` on `document` and close themselves when open. Do NOT navigate.
3. **HomeTabs "siguiendo" → "parati"**: if the URL is `/` with search param `feed=following`, call `window.history.back()` (which returns to `/` because that's how the user arrived).
4. **Browser history available**: if the Capacitor `canGoBack` flag is true, call `window.history.back()`.
5. **Root + double-tap-to-exit**: at the root (no history), the FIRST back press SHALL display a Sonner toast "Presiona de nuevo para salir" with `duration: 2000`, and record a timestamp. A SECOND back press within 2000 ms SHALL call `App.exitApp()`. A press after 2000 ms SHALL re-show the toast as a fresh attempt.

The handler SHALL be the only registered `backButton` listener in the
app (no other component registers one) to avoid race conditions.

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

This applies to ALL listeners currently registered in
`capacitor-init.tsx`:
- `App.addListener("backButton", ...)` (line 16)
- `App.addListener("appUrlOpen", ...)` (line 35)
- `Keyboard.addListener("keyboardWillShow", ...)` (line 71)
- `Keyboard.addListener("keyboardWillHide", ...)` (line 78)

This closes the known follow-up from A1's
`openspec/specs/auth-session/spec.md` and prevents listener accumulation
under React StrictMode (dev) or HMR remounts.

### Scenario: Unmount removes all listeners

- GIVEN `CapacitorInit` is mounted and 4 listeners are registered
- WHEN the component unmounts (or the effect re-runs in StrictMode dev)
- THEN every handle has `remove()` called
- AND no duplicate listener fires on subsequent events

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
  are loaded once and reused.
- **Synthetic Escape dispatch**: dispatched on `document` (not `window`)
  with `{ bubbles: true }` so Radix's portal-rendered overlays receive
  the event regardless of focus state.
- **Smart back priority list**: Radix → custom modal → siguiendo tab →
  history → exit. The order matters because (a) modals should always
  trap back before navigation, (b) the siguiendo→parati case is
  semantically a tab change not a navigation, (c) history.back is the
  default expected behavior, (d) exit only at root with confirmation.
- **Double-tap-exit grace window**: 2000 ms is the standard Android
  pattern (matches Material Design "double-tap exit" toast docs).
  Stored in a module-level `lastBackPress` variable, NOT React state —
  state is not needed since the toast IS the visual UI.
- **`overscroll-behavior-y: contain` vs `none`**: `none` would kill PTR
  entirely. `contain` is the surgical choice — only blocks the
  propagation from the inner scroll element to the body / page
  background (which is what causes the glow on the body itself).

## Out of scope

- **View Transitions API** — defer to A5
- **`CapacitorHttp`** — incompatible with current cookie-based auth
- **Local bundle** — architectural pivot, out of quick-wins scope
- **Auth / RLS** — A1 and A2 are in production. Not touched.

## Known follow-ups discovered during A4

- Refactor `page-swipe-wrapper.tsx:145` and
  `pull-to-refresh-wrapper.tsx:78` to use the haptics helper (currently
  inline the same pattern). Low priority cleanup.
- Refactor custom drawers (`account-menu-drawer.tsx`) to use Radix
  Dialog underneath, removing the `data-modal-open` convention shim.
  Bigger refactor; A4 adopts the minimal convention instead.
