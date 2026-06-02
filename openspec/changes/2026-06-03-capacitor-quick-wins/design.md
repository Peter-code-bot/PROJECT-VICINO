# Design — Capacitor Quick Wins (A4)

> Implementation plan for change `2026-06-03-capacitor-quick-wins`.
> Three sub-phases, one commit each, in implementation order. `pnpm build`
> green between every commit. CODEX `/ultrareview` before push.
> **All sub-phases require APK device testing by Pedro** — `pnpm build` green
> alone is not sufficient validation for touch/system-button/scroll changes.

## Branch + commit sequence

Branch: `feat/capacitor-quick-wins` cut from `origin/master` HEAD `c806ab5`.

```
feat(haptics): add hapticLight/Medium/Selection helper and wire to touch targets   (4.1)
feat(capacitor): smart back button with modal-aware priority + listener cleanup    (4.2)
feat(ui): contain overscroll behavior to kill parasitic glow on non-PTR pages      (4.3)
```

---

## 1. Sub-phase 4.1 — Haptic feedback helper + integration

### 1a. The helper — `apps/web/lib/haptics.ts` (new file)

The two existing haptic calls (`page-swipe-wrapper.tsx:145`,
`pull-to-refresh-wrapper.tsx:78`) both inline the `await import("@capacitor/haptics")`
+ `Capacitor.isNativePlatform()` guard. The helper centralizes this pattern
so call-sites become one-liners and the web build doesn't pull in haptics:

```ts
// apps/web/lib/haptics.ts
"use client";

let _impactStyle: { Light: unknown; Medium: unknown; Heavy: unknown } | null = null;
let _haptics: { impact: (opts: { style: unknown }) => Promise<void>;
                selectionStart: () => Promise<void>;
                selectionChanged: () => Promise<void>;
                selectionEnd: () => Promise<void> } | null = null;
let _isNative: boolean | null = null;

async function ensureLoaded() {
  if (_isNative === false) return false;
  if (_isNative === null) {
    if (typeof window === "undefined") {
      _isNative = false;
      return false;
    }
    const { Capacitor } = await import("@capacitor/core");
    _isNative = Capacitor.isNativePlatform();
    if (!_isNative) return false;
    const mod = await import("@capacitor/haptics");
    _haptics = mod.Haptics;
    _impactStyle = mod.ImpactStyle;
  }
  return _isNative;
}

export async function hapticLight() {
  if (!(await ensureLoaded()) || !_haptics || !_impactStyle) return;
  await _haptics.impact({ style: _impactStyle.Light });
}

export async function hapticMedium() {
  if (!(await ensureLoaded()) || !_haptics || !_impactStyle) return;
  await _haptics.impact({ style: _impactStyle.Medium });
}

export async function hapticSelection() {
  if (!(await ensureLoaded()) || !_haptics) return;
  await _haptics.selectionChanged();
}
```

**Design notes**:
- Module-level cache (`_haptics`, `_isNative`) so we don't re-import
  on every tap.
- `_isNative === false` short-circuit: web builds skip the entire
  Capacitor module after first call.
- No-op silently on web — call-sites do NOT need their own
  `Capacitor.isNativePlatform()` guard.
- Async signature matches existing pattern; call-sites can `void hapticLight()`
  in click handlers without awaiting (haptics fire as side-effect, don't
  block UI).
- The 2 existing call-sites (`page-swipe-wrapper`, `pull-to-refresh-wrapper`)
  are NOT refactored to use the helper in this sub-phase — they're working
  already, and changing them adds review surface without value. Document
  in tasks.md as low-priority cleanup.

### 1b. Target integration table

| Target | File | Intensity | Reason |
|---|---|---|---|
| BottomNav 5 items (Inicio / Buscar / Vender / Chat / Perfil) | `components/layout/bottom-nav.tsx` | **Light** | Frequent, low-attention nav — Light is subtle confirmation |
| FavoriteButton heart toggle (overlay variant on cards + standalone) | `components/shared/favorite-button.tsx` | **Light** | Frequent toggle action — Light confirms tap registered |
| Category tile tap (home `/parati`) | `app/(marketplace)/page.tsx` category tile Link `onClick` | **Light** | Browse navigation — Light matches BottomNav consistency |
| Podium slot tap (`/rankings`) | `components/rankings/podio-ranking.tsx` Link `onClick` | **Light** | Browse navigation — same family |
| Chat send button | `app/(marketplace)/chat/[id]/chat-input.tsx` (or wherever the send handler lives) | **Medium** | Important commit — Medium signals "action taken" |
| "Publicar producto" final CTA | `app/(marketplace)/vender/*` final submit handler | **Medium** | High-stakes commit |
| Sale confirm (buyer/seller "Confirmar venta") | `components/chat/sale-confirmation-card.tsx` confirm handler | **Medium** | High-stakes commit |
| "Continuar con Google" OAuth tap | `app/(auth)/login/login-form.tsx` Google button | **Light** | Single CTA — Light marks tap registered |

**Intentionally NOT touched**:
- ProductCard tap — too frequent during browsing; would feel like noise.
- HomeTabs Link tap — already animates visibly; haptics would over-confirm.
- Header / drawer "Cerrar" buttons — close gestures don't traditionally
  carry haptics on Android.
- Read-only navigation Links (e.g., "Ver más", "Gestionar") — they
  navigate to next page; the next page paint is its own confirmation.

**Call-site shape** (consistent across files):

```tsx
import { hapticLight } from "@/lib/haptics";

<button
  onClick={() => {
    void hapticLight();        // fire-and-forget, no-op on web
    onAction();
  }}
>
```

For Next.js `<Link>` consumers (BottomNav, category tiles, podium slots),
add an `onClick` handler that fires `hapticLight()` and lets the Link
navigate normally (do NOT preventDefault).

### 1c. Build gate
`pnpm build` green. No new TS errors. Manual trace: open `lib/haptics.ts`
in editor, confirm no SSR issues (the `"use client"` directive + the
`typeof window === "undefined"` guard cover server-render).

### 1d. Device validation by Pedro
1. Recompile debug APK
2. Install on Android device
3. Tap each of the 5 bottom nav items → feel Light haptic
4. Tap favorite hearts on product cards → feel Light haptic
5. Send a chat message → feel Medium haptic on send
6. Trigger sale confirmation → feel Medium haptic
7. Tap "Continuar con Google" on login → feel Light haptic
8. Confirm web (browser) version of the site does NOT throw or
   misbehave on any of the same actions

---

## 2. Sub-phase 4.2 — Smart back button + listener cleanup

### 2a. Detection mechanism for open modals

The codebase uses two modal patterns:

1. **Radix-based** (`@radix-ui/react-dialog`, `react-dropdown-menu`,
   `react-popover`): these render the modal content with
   `[role="dialog"][data-state="open"]` (or
   `[data-state="open"][role="menu"]` for DropdownMenu). Radix also handles
   `Escape` key automatically: dispatch a synthetic `KeyboardEvent("keydown",
   { key: "Escape" })` to the document, Radix closes the topmost modal.

2. **Custom drawer / portal** (e.g.,
   `components/profile/account-menu-drawer.tsx`): uses `useState(open)` +
   `createPortal`. No Radix attributes. Currently does not listen for
   Escape.

**Strategy**: hybrid DOM-based detection + standardized
`data-modal-open` convention:

- Radix modals are detected by the existing
  `[data-state="open"][role="dialog"]` selector (free).
- Custom modals add `data-modal-open="true"` to their portal root when
  open, and listen for an `Escape` key dispatched on the document to
  call their internal close function.

**No central store, no React Context**. The DOM IS the state — and
matches React's existing way of expressing modal state via `data-state`.

### 2b. Convention adopted in this PR for custom modals

Update `account-menu-drawer.tsx` to:
- Set `data-modal-open="true"` on the portal root when `open` is true.
- Add a `useEffect` that listens for `keydown` events on the document.
  When `event.key === "Escape"` and `open === true`, call `setOpen(false)`.

This is the only custom modal that A4 modifies. Any other custom modals
in the codebase will work AS-LONG-AS they adopt the same convention —
documented as the canonical pattern in the spec.

### 2c. Back handler priority order

The new handler in `capacitor-init.tsx`:

```ts
const TOAST_GRACE_MS = 2000;
let lastBackPress = 0;

async function handleBack({ canGoBack }: { canGoBack: boolean }) {
  // (1) Radix modal open? Dispatch Escape, Radix closes it.
  const radixOpen = document.querySelector(
    '[data-state="open"][role="dialog"], [data-state="open"][role="menu"], [data-state="open"][role="alertdialog"]'
  );
  if (radixOpen) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return;
  }

  // (2) Custom modal (data-modal-open convention)?
  const customOpen = document.querySelector('[data-modal-open="true"]');
  if (customOpen) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return;
  }

  // (3) Are we on /siguiendo? Back to /parati.
  const url = new URL(window.location.href);
  if (url.pathname === "/" && url.searchParams.get("feed") === "following") {
    window.history.back();   // /?feed=following came from /, history.back lands at /
    return;
  }

  // (4) Browser history?
  if (canGoBack) {
    window.history.back();
    return;
  }

  // (5) Root — double-tap-to-exit with Sonner toast.
  const now = Date.now();
  if (now - lastBackPress < TOAST_GRACE_MS) {
    const { App } = await import("@capacitor/app");
    await App.exitApp();
    return;
  }
  lastBackPress = now;
  const { toast } = await import("sonner");
  toast("Presiona de nuevo para salir", { duration: TOAST_GRACE_MS });
}
```

### 2d. Listener cleanup refactor

Current `capacitor-init.tsx` `useEffect` has no return function. The 4
`addListener` calls return `Promise<PluginListenerHandle>` per Capacitor
8.x API. Refactor:

```ts
useEffect(() => {
  const handles: Array<{ remove: () => Promise<void> }> = [];

  const init = async () => {
    // ... isNative guard ...

    const { App } = await import("@capacitor/app");
    const backH = await App.addListener("backButton", handleBack);
    handles.push(backH);

    const urlH = await App.addListener("appUrlOpen", handleUrlOpen);
    handles.push(urlH);

    // ... existing splash, status bar (no listeners) ...

    const { Keyboard } = await import("@capacitor/keyboard");
    const kbShowH = await Keyboard.addListener("keyboardWillShow", handleKbShow);
    handles.push(kbShowH);
    const kbHideH = await Keyboard.addListener("keyboardWillHide", handleKbHide);
    handles.push(kbHideH);
  };

  init().catch(() => {});

  return () => {
    handles.forEach((h) => { void h.remove(); });
  };
}, []);
```

Closes the A1 follow-up debt. Handles are tracked in the closure; cleanup
runs synchronously calling `void h.remove()` (handle remove is async, but
the `useEffect` return must be sync — fire-and-forget is acceptable for
shutdown).

### 2e. Build gate
`pnpm build` green. TS: confirm `PluginListenerHandle` import or shape is
correct (Capacitor 8.x type).

### 2f. Device validation by Pedro
1. Recompile debug APK
2. Open the account menu drawer → press Android back → drawer closes,
   user stays on the same page
3. Navigate to `/?feed=following`, press back → lands on `/` (parati)
4. Open a deep page (`/producto/[slug]`) → press back → goes to the
   previous page
5. From `/` (parati), press back once → toast appears "Presiona de nuevo
   para salir"
6. Press back again within 2 s → app exits
7. Press back, wait > 2 s, press back again → toast appears again
   (single press is a no-op outside grace window)
8. **Open the account drawer, close it via system back, then check that
   re-opening still works** — confirms the synthetic Escape dispatch
   propagated AND the custom modal's escape handler fires

---

## 3. Sub-phase 4.3 — Overscroll containment

### 3a. The CSS change

Add to `apps/web/app/globals.css`:

```css
html,
body {
  overscroll-behavior-y: contain;
}
```

Place near the existing `-webkit-tap-highlight-color: transparent` rule
(`globals.css:175`).

### 3b. Why `contain` and not `none`

- `none`: kills overscroll entirely — pull-to-refresh stops working.
- `contain`: contains the overscroll chain to the element boundary —
  the body doesn't propagate to parent (which is what causes the visible
  glow). Inner scrollers can still trigger pull-to-refresh on the routes
  that wire it up via `PullToRefreshWrapper`.

### 3c. Modal/drawer scroll preservation

Modals and drawers use their own scroll containers (`<DialogContent>` has
internal scroll for tall content; account-menu-drawer has its own
`overflow-y-auto`). `overscroll-behavior-y: contain` on `body` does NOT
affect inner scroller behavior — the property only governs whether scroll
propagates UP. Inner scrollers still scroll freely within their bounds.

### 3d. Build gate
`pnpm build` green. CSS-only change, no TS implications.

### 3e. Device validation by Pedro
1. Recompile debug APK
2. Open `/chat` (list) — scroll to bottom of message threads, attempt to
   overscroll downward → **no blue glow** appears at the bottom of the
   list/body
3. Open `/` (parati) — scroll to bottom, attempt to overscroll → no glow
4. Open a route that has `PullToRefreshWrapper` — pull down at top of the
   list → pull-to-refresh STILL fires, haptic still triggers
5. Open the account menu drawer (which has internal scroll) — scroll
   inside the drawer to its end, attempt to overscroll → inner scroll
   behavior unaffected (no body glow propagating up)

---

## 4. CODEX `/ultrareview` focus (before push)

When the 3 commits are on the branch, run `/ultrareview` with focus:

1. **Haptics helper no-op on web**: confirm `lib/haptics.ts` returns
   silently when `Capacitor.isNativePlatform()` is false. No import of
   `@capacitor/haptics` should happen on web bundle (verify by checking
   bundle composition or by reading the module flow).
2. **No double-fire of haptic** when call-site already lives in a place
   that fires (e.g., page-swipe-wrapper already does Light on tab change
   — confirm we don't add another Light at the BottomNav tap that lands
   on the same tab).
3. **Smart back priority order is correct**: modals before history, exit
   only at root, double-tap window is 2 s.
4. **Listener cleanup runs**: confirm the `useEffect` return function is
   syntactically correct and the `handles` array is populated only AFTER
   `init()` resolves.
5. **`Escape` dispatch is safe**: dispatching a synthetic KeyboardEvent
   to `document` does NOT trigger other unexpected handlers (e.g.,
   accidentally closing a modal that wasn't meant to be closed by the
   Android back). The selector specificity should be tight.
6. **`overscroll-behavior-y: contain` doesn't break the existing
   `PullToRefreshWrapper`** — the property is on `html, body` only;
   inner scrollers in PTR routes are unaffected.
7. **No regression to A1/A2/A3** — auth flow, layout queries,
   image priorities all unchanged.

## 5. Rollback strategy

Each sub-phase is one commit, independently reversible via `git revert
<hash>`:

- 4.1 revert: removes the helper and call-site changes. Web + APK
  return to silent-tap state.
- 4.2 revert: restores the dumb backButton handler; closes the cleanup
  refactor. NOTE: A1 follow-up debt is re-opened. Acceptable for a
  rollback emergency.
- 4.3 revert: removes the 1-line CSS. Glow indicator returns.

## 6. Out-of-scope (re-confirmed)

- View Transitions API (Chrome 111+, supported on the WebView) — defer to
  A5. Justification: requires `experimental.viewTransition` flag in
  `next.config.ts`, definition of `view-transition-name` on hero images,
  and interaction validation with A3's prefetch discipline. Larger surface
  than A4's quick wins.
- `CapacitorHttp` — breaks WebView cookie store; Supabase auth depends on
  it.
- Local bundle (`webDir: dist`) — architectural change.
- Splash / status bar polish — cosmetic, low ROI.
- A1 / A2 / A3 — all in production. NOT touched.
