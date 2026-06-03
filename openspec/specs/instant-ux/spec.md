# Spec — instant-ux

> Domain: client-perceived instantaneity for the four user
> interactions that today expose latency or a hard data ceiling. The
> capability covers cursor-based load-more, scroll-position
> preservation on prepend, optimistic UI for high-stakes
> commitments, and shared-element navigation via View Transitions.
>
> Canonical spec. Established by change `2026-06-03-instant-ux` (A5).
> Codex `/ultrareview` follow-ups H1+H2+M1+M2+M3+M4 merged in commit
> `67dfa42` and reflected in R1/R2/R3/R5 below.
>
> Last updated: 2026-06-02

---

## Context

The four interactions covered by this capability:

1. Chat messages: today capped at 50 with no load-older affordance.
2. Home feed: today capped at 150 with no infinite scroll below the
   initial category carousels.
3. Card → detail navigation: today a hard route swap with no shared
   element continuity.
4. Sale confirm/cancel: today a raw `await action()` that delays the
   visible state flip until the server round-trip completes.

The capability is constrained by C1 (no TanStack Query — the
existing RSC + Server Actions + Realtime + `revalidatePath` stack is
the source of truth), C2 (no new client-side dependency), C3
(view-transition flag is experimental and has a kill-switch),
C4 (Realtime and cursor queries must never deliver the same record
twice), and C5 (scroll position must be preserved at the pixel level
on prepend).

---

## Requirement R1 — Server-Action cursor pagination SHALL use a reusable hook

WHEN a list surface needs to load additional items beyond an initial
SSR-rendered page, the call-site SHALL use
`apps/web/hooks/use-infinite-cursor.ts` rather than inlining a
per-surface state machine.

The hook SHALL accept:
- a `CursorAction<T, C>` Server Action whose input is
  `{ cursor: C | null; limit: number }` and whose output is
  `{ items: T[]; nextCursor: C | null; error?: string }`;
- `initialItems: T[]` already rendered by SSR;
- `initialCursor: C | null` derived from the boundary of
  `initialItems` (typically the oldest item's timestamp);
- an optional `limit` (default 30);
- an optional `prepend` boolean (default false — append mode).

The hook SHALL expose:
- `items: T[]` (initial + loaded pages, in render order);
- `isLoading: boolean` (single flag, no per-page state);
- `hasMore: boolean` (`cursor !== null`);
- `error: string | null` (cleared on next successful call);
- `loadMore(): Promise<void>` (idempotent on rapid re-entry —
  internal `inFlightRef` guards double-fires);
- `prependLive(item: T)` and `appendLive(item: T)` (imperative
  inserts that do NOT consume the cursor — for Realtime events or
  user-originated commits);
- `removeItem(predicate: (item: T) => boolean)` (for optimistic
  rollback or temp-id reclaim).

The hook SHALL guard against state updates after unmount via a
`mountedRef` set false in the cleanup of a mount-effect.

The hook SHALL NOT use `useTransition`, AbortController-based
cancellation, or any external data-fetching library.

### Scenario: New surface adopts the hook

- GIVEN a developer needs to add load-more to a new list surface
- WHEN they wire it
- THEN they author a Server Action matching `CursorAction<T, C>`
- AND they call `useInfiniteCursor` with `initialItems` from SSR and
  `initialCursor` from the boundary item
- AND they do NOT inline a per-surface cursor state machine

### Scenario: hasMore is false when initial page is short

- GIVEN an SSR initial fetch returns fewer items than the page limit
- WHEN the call-site computes `initialCursor`
- THEN it passes `null` for the cursor
- AND `hasMore` is `false` from the first render
- AND `loadMore` is a no-op

### Scenario: Rapid loadMore re-entry collapses to one request

- GIVEN `loadMore` is invoked twice in the same animation frame
  (e.g. by an IntersectionObserver that fires on threshold cross
  AND on a synthetic scroll jitter)
- WHEN the second call enters
- THEN it observes `inFlightRef.current === true` and returns
  immediately
- AND only one Server Action call is made

### Scenario: loadMore error does NOT consume the cursor

- GIVEN a `loadMore` call rejects or returns `{ error: string }`
- WHEN the hook handles the failure
- THEN `error` is set to the message
- AND `cursor` is left unchanged
- AND a subsequent `loadMore` call will retry from the same cursor

---

## Requirement R2 — Chat message history SHALL be loadable beyond the initial page

WHEN the user opens an existing chat in `/chat/[id]`, the initial 50
most recent messages SHALL render as today, AND the user SHALL be
able to load older messages by scrolling up.

The mechanism SHALL be:

1. A `getMessagesBefore(chatId, cursor, limit)` Server Action that
   returns messages with `created_at < cursor`, ordered ASC for
   prepend, with `nextCursor` = the oldest returned `created_at` (or
   `null` if fewer than `limit` items returned).
2. A top sentinel `<div>` inside the scrollable message container.
3. An `IntersectionObserver` with `threshold: 0.1` that, when the
   sentinel becomes visible AND `hasMore && !isLoading`, snapshots
   the scroll container's `{ scrollHeight, scrollTop }` to a ref
   BEFORE calling `loadMore`.
4. A `useLayoutEffect` keyed on `messages.length` that, when a
   snapshot is pending, reads the new `scrollHeight` and sets
   `scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)`,
   then clears the snapshot.

This SHALL preserve the user's visual position: the message that
was at the top of the viewport before the prepend SHALL remain at
the same pixel offset after the prepend (no visible jump).

### Scenario: User scrolls up in a chat with >50 messages

- GIVEN a chat with 200 historical messages
- AND the initial render shows messages 151-200
- WHEN the user scrolls up so the top sentinel enters the viewport
- THEN the next 30 older messages (121-150) prepend
- AND the message that was at the visual top before the load
  remains in the same viewport pixel position after the load
- AND the user can continue scrolling up to load 91-120, 61-90, etc.

### Scenario: Chat with fewer than 50 messages does NOT show load affordance

- GIVEN a chat with 12 messages
- WHEN it renders
- THEN `initialCursor` is `null`
- AND `hasMore` is `false`
- AND no sentinel-driven loadMore fires regardless of scroll

### Scenario: load-older does NOT duplicate a newly-arrived Realtime message

- GIVEN a Realtime channel delivers a new INSERT (post-subscription)
  while a `loadMore` is in flight
- WHEN the load-more resolves with N OLDER messages
- THEN the array order is: older-page items (prepended at the front)
  + existing items + the new INSERT (appended at the back)
- AND no message id appears twice

### Scenario: load-older error preserves cursor for retry

- GIVEN a `loadMore` rejects due to network failure
- WHEN the user scrolls down then back up
- THEN the sentinel re-fires and the same cursor is retried

---

## Requirement R3 — Home feed SHALL support infinite scroll without disturbing initial carousels

WHEN the user opens `/` (Para ti tab), the initial 15 category
carousels SHALL render exactly as before A5 (no change to grouping
logic, no client-side re-grouping).

A new section "Más productos" SHALL render AFTER the initial 15
carousels with:
- a section header,
- a responsive grid of `ProductCard` items,
- a bottom sentinel for `IntersectionObserver`,
- pages of items loaded via `getMoreFeedProducts(cursor, limit)`
  with cursor = `created_at < boundary`.

The boundary cursor SHALL be the OLDEST `created_at` of the initial
150 products. If the initial fetch returned fewer than 150 products
(catalog smaller than the page), the cursor SHALL be `null` and
"Más productos" SHALL render nothing.

The new section SHALL NOT use Realtime. Freshness is delegated to
the existing `revalidatePath("/")` calls from publish-product
mutations.

The new section SHALL use `useInfiniteCursor` with `prepend: false`.

### Scenario: Catalog larger than 150 products

- GIVEN the database contains 800 active products
- AND `page.tsx` fetches the most-recent 150 for the carousels
- WHEN the user scrolls past the last carousel
- THEN "Más productos" header appears
- AND the first 30 products (151-180 by recency) load and render
- AND continuing to scroll loads 181-210, 211-240, etc.

### Scenario: Catalog smaller than 150 products

- GIVEN the database contains 87 active products
- WHEN the user opens `/`
- THEN all 87 render in carousels (grouping logic unchanged)
- AND "Más productos" header does NOT appear

### Scenario: Initial carousels are unaffected by load-more

- GIVEN the user has loaded several "Más productos" pages
- WHEN they scroll back to the top
- THEN the 15 carousels are in the same order with the same items
- AND no carousel has gained or lost cards
- AND no carousel has been added or removed

### Scenario: Publishing a new product refreshes on next visit

- GIVEN a user publishes a product via `/vender`
- WHEN they navigate back to `/`
- THEN `revalidatePath("/")` has invalidated the cache
- AND the new product appears in the initial 150 fetch
- AND the cursor for "Más productos" is recomputed from the new boundary

---

## Requirement R4 — Product card → detail navigation SHALL animate the shared image element

WHEN the user taps a product card (`product-card.tsx`) and the
browser supports the View Transitions API, the navigation to
`/${categoria}/${slug}` SHALL animate the card image into the hero
image position on the detail page.

The mechanism SHALL be:

1. `experimental.viewTransition: true` enabled in
   `apps/web/next.config.ts`.
2. `viewTransitionName: \`product-${slug}\`` applied via inline style
   to the `<Image>` in `product-card.tsx`.
3. The same `viewTransitionName` applied to the hero `<Image>` in
   `[categoria]/[slug]/page.tsx`.
4. A `prefers-reduced-motion: reduce` media query in `globals.css`
   that disables the view-transition-group animation:
   `::view-transition-group(*) { animation: none !important; }`.

When the browser does NOT support View Transitions, the navigation
SHALL fall through to the standard Next.js route swap with no
visible regression.

When the user has `prefers-reduced-motion: reduce`, the animation
SHALL NOT play; the navigation SHALL complete instantly.

If enabling the experimental flag breaks `pnpm build` or causes an
SSR hydration warning, A5.3 SHALL be paused immediately (Constraint
C3) — the design does not allow shipping around the issue.

### Scenario: Supported browser, no reduced-motion

- GIVEN the user is on `/` in the Capacitor APK (Chromium 111+)
- AND no reduced-motion preference is set
- WHEN they tap a product card whose image has
  `view-transition-name: product-zapatos-nike-jordan`
- THEN the browser animates the image from its card position into
  the hero position on the detail page
- AND there is no intermediate white flash

### Scenario: Reduced motion preference

- GIVEN the user has `prefers-reduced-motion: reduce`
- WHEN they tap a card
- THEN no animation plays
- AND the navigation completes immediately

### Scenario: Browser without View Transitions support

- GIVEN a browser older than Chrome 111
- WHEN they tap a card
- THEN the navigation uses Next's default route swap
- AND there is no console error
- AND no `viewTransitionName` styles cause visual artifacts

### Scenario: Build fails with the flag enabled

- GIVEN A5.3 enables `experimental.viewTransition: true`
- AND `pnpm build` fails or surfaces an SSR warning
- WHEN the developer encounters the failure
- THEN A5.3 is paused immediately
- AND the issue is reported to Pedro before any other change
- AND the flag is NOT shipped to master in a broken state

---

## Requirement R5 — Sale confirm and cancel SHALL flip status optimistically

WHEN the user taps "Confirmar venta" or "Rechazar" in
`sale-confirmation-card.tsx`, the StatusPill and downstream visual
state SHALL update to reflect the intended action within the same
frame as the tap — NOT after the server round-trip completes.

The mechanism SHALL be:

1. Both `confirmSale` and `cancelSale` Server Actions wrapped in
   `useOptimisticMutation`.
2. A local `optimisticStatus: ConfirmationStatus | null` state.
3. `onMutate` for confirm: snapshot previous `optimisticStatus`, set
   to `"esperando"`, return a rollback function that restores the
   snapshot.
4. `onMutate` for cancel: same pattern, set to `"rechazado"`.
5. `onSuccess` for both: clear the overlay
   (`setOptimisticStatus(null)`) so the parent's revalidated `sc`
   becomes authoritative.
6. `effectiveStatus = optimisticStatus ?? derivedStatus` (derived
   from `sc` props as today).
7. The fire-and-forget `void hapticMedium()` call relocated to live
   inside `onMutate` (next to the optimistic flip), matching the
   convention used by `favorite-button.tsx`.

`isPending` from the wrapper SHALL drive the CTA button disable
state. The manual `setLoading`/`setError` state SHALL be removed.

### Scenario: Optimistic confirm

- GIVEN a sale confirmation card with `status = "pendiente"` and
  `optimisticStatus = null`
- WHEN the user taps "Confirmar venta"
- THEN within the same render, `optimisticStatus = "esperando"`
- AND the StatusPill renders "Esperando respuesta"
- AND `void hapticMedium()` fires
- AND the action is dispatched in a transition

### Scenario: Server error rolls back

- GIVEN an optimistic confirm flip has rendered "Esperando respuesta"
- WHEN the Server Action returns `{ error: "Network failure" }`
- THEN the rollback function restores `optimisticStatus = null`
- AND the StatusPill reverts to the derived status (probably
  "Pendiente")
- AND `error` is non-null
- AND the user can retry

### Scenario: Server success clears the overlay

- GIVEN an optimistic confirm flip has rendered "Esperando respuesta"
- WHEN the Server Action resolves successfully
- AND `revalidatePath()` causes the parent to re-render with the
  updated `sc`
- THEN `optimisticStatus = null` (cleared in `onSuccess`)
- AND the derived status from the new `sc` props wins
- AND the StatusPill reflects the authoritative state

### Scenario: Cancel follows the same pattern

- GIVEN a pending sale
- WHEN the user taps "Rechazar"
- THEN `optimisticStatus = "rechazado"` within the same frame
- AND the StatusPill renders "Rechazado"
- AND the card visually transitions to the rejected styling
- AND rollback on error restores the prior status

---

## Cross-cutting

- **No console.log statements** anywhere in A5 code (TypeScript
  ruleset enforces; build hooks audit).
- **Strict types**: hook generic over `T` and `C`; no `any` in the
  hook or its consumers. Server Actions narrow `error: unknown`
  before returning.
- **Tests**: smoke per sub-phase as documented in `tasks.md`. Unit
  tests for the hook (mountedRef, inFlightRef, prepend vs append,
  hasMore derivation, error retains cursor) are STRONGLY
  recommended but treated as an opportunistic follow-up if time
  permits — A5's commit cadence does NOT block on test additions
  beyond the existing project floor.
- **Build & deploy**: each sub-phase commit gated by `pnpm build`
  green; final branch state passes CODEX `/ultrareview` per the A4
  protocol (PAUSE on HIGH blockers).

## Out of scope (explicit non-requirements)

- TanStack Query introduction (per proposal Constraint C1 and audit
  findings).
- List virtualization (no surface crosses the threshold).
- `/chat` (chat list) pagination (telemetry-gated).
- Publish product optimistic UI (upload pipeline blocker).
- Profile form optimistic UI (MED, future PR).
- Historial load-more (MED, follow-up using A5.0 hook).
- View Transitions for navigations other than product-card → detail
  (per-navigation cost; future PR after A5.3 stabilizes).

---

## Codex `/ultrareview` follow-ups merged at archive

Reflected in the requirements above (not as separate paragraphs):

- **H1** in R2 — `isPrependingRef` discriminates prepend commits from
  bottom-append commits in the chat scroll preservation effect.
  Without the flag, a Realtime INSERT arriving during an in-flight
  loadOlder would consume the snapshot meant for the prepend and
  the user would see a jump.
- **H2** in R1 — both Server Actions that drive the hook
  (`getMessagesBefore`, `getMoreFeedProducts`) clamp `limit` via
  `Math.min(Math.max(1, limit), 50)`. The clamp is used for both the
  `.limit()` call and the `nextCursor` derivation.
- **M1** in R5 — `cancelMutation.onSuccess` does NOT clear the
  optimistic overlay. The card unmounts via parent state cleanup
  (SSR and Realtime UPDATE both filter to
  `["pending_confirmation","completed"]`, so a cancelled sc never
  reaches the component). Clearing the overlay would briefly
  collapse `effectiveStatus` to "pendiente" during the gap before
  Realtime removes the card — visible flicker. The overlay survives
  until unmount. `confirmMutation.onSuccess` still clears because
  the card stays mounted and transitions to "esperando".
- **M2** in R5 — rollback uses a functional updater. Only reverts
  if the current value is still the one this onMutate wrote, so a
  concurrent mutation's overlay value survives.
- **M3** in R3 — `viewTransitionName` cleared 500 ms after the click
  via `setTimeout`. The browser snapshot is captured synchronously
  inside `document.startViewTransition` (called by Next's
  experimental wrapper), so by 500 ms the property has been read
  and is free to clear. Ref re-checked because the component may
  have unmounted during the navigation.
- **M4** in R1 — Server Actions validate the cursor with
  `Number.isNaN(Date.parse(cursor))` before issuing the query.
  Returns `"Cursor invalido"` instead of leaking the verbose
  Postgres cast error.

---

## Follow-ups (not load-bearing for A5 acceptance)

### F1 — `hapticSelection()` callsite consolidation
Outside the instant-ux capability. See `capacitor-native-ux` F1.

### F2 — Chat read-receipt UI on prepend
After A5.1's `mark_messages_as_read` RPC runs once on SSR, the
prepended older page does NOT re-run the RPC. The newly visible
older messages keep their read-state from when they were last
seen by SSR. This is correct (the user did already see them
earlier) but the Realtime UPDATE handler will continue to flip
flags live. Not a bug, just a behavior to remember if a future
"read marker" UI is added.

### F3 — Hook unit tests
Strongly recommended. Coverage targets:
- mountedRef + setState after unmount,
- inFlightRef rapid re-entry collapse,
- prepend vs append branching,
- hasMore derivation from nextCursor,
- error path preserves cursor.
Not blocking on A5 cadence; opportunistic follow-up.

### F4 — `<MasProductos>` key on initialCursor
After publish-product `revalidatePath('/')`, the home Server
Component re-runs with a new initial 150 and a new
`masProductosInitialCursor`. `<MasProductos>` receives the new
cursor as a prop. The hook does NOT internally re-key on the prop
change. The React reconciler's natural unmount/remount cycle
during the Server Component re-render handles this in practice.
If telemetry ever shows stale items in the same session without a
hard reload, the fix is one line:
`<MasProductos key={initialCursor ?? 'empty'} initialCursor={...} />`.

### F5 — Custom drawer → Radix Dialog migration
Outside the instant-ux capability. See `capacitor-native-ux` F3.

### F6 — View Transitions reverse-navigation continuity
Forward (card → detail) works via just-in-time naming. Reverse
(detail → home via back button) has no shared element because the
original card's name is gone by the time the user returns. Persist
"which card was clicked" across navigation (sessionStorage keyed
by product id, or a URL hash) to enable the reverse animation.
Cost is one file, value is shipped polish — defer until A5.3 has
device telemetry.

### F7 — `replaceItem` atomic temp → real swap
Today the chat `onSuccess` calls a `setItems(prev => prev.map(...))`
through the hook's escape hatch to do the temp → real id swap. If
device testing shows a one-frame flicker, add an atomic
`replaceItem(predicate, replacement)` to the hook so the
operation is a single state update instead of `removeItem` +
`appendLive`. Not load-bearing today.

### F8 — View Transitions beyond product-card → detail
Other navigations (chat list → conversation, rankings → seller
profile, home tabs swap) could opt into shared-element transitions
with the same just-in-time naming pattern. Per-navigation cost,
not per-app. Defer until A5.3 stabilizes in production.

### F9 — Chat Realtime subscribe gap (codex HIGH-1, pre-existing)

Between the SSR `initialMessages` fetch and the moment the Realtime
`.subscribe()` callback resolves there is a window (~500–1500 ms on
mobile) where INSERTs from the other party fall through both paths:
too new to be in the SSR initial set, too old to have triggered
the channel because it was not yet open. **Not introduced by
A5.1** — the cursor + DESC fix narrows the consequence slightly
because the SSR window now ends with the *latest* 50 rather than
the oldest 50, but the gap itself is pre-existing.

Proper fix is a "catch-up on subscribe" pattern: track the
`created_at` of the SSR's newest message; after the channel
`.subscribe()` callback fires with `status === "SUBSCRIBED"`,
issue a one-shot `getMessagesAfter(chatId, newestCreatedAt)` and
merge-deduplicate into the buffer. Out of A5 scope; tracked here
because A5.1 surfaced it during review.

### F10 — ESLint `no-explicit-any` cleanup in marketplace surfaces

The CODEX review surfaced pre-existing `no-explicit-any` errors
in `apps/web/app/(marketplace)/page.tsx` (lines 119, 208, 211,
253 — byCategory iteration casts) and `sale-confirmation-card.tsx:80`
(`icon: any` on the local `MetaCell` component). Not introduced
by A5. The build script (`node scripts/check-no-todo.mjs && next build --webpack`)
does NOT run `eslint`, so CI stays green; a cleanup PR should
type-narrow these to proper `ProductRow` / Lucide icon types.

### F11 — Same-`created_at` cursor tiebreaker

Both `getMessagesBefore` and `getMoreFeedProducts` use
`.lt('created_at', cursor)` without a secondary `id` tiebreaker.
Under bulk seed scripts that insert with identical microsecond
timestamps a boundary record can be silently skipped. Real
Supabase `now()` makes natural collisions extremely unlikely.
Defer until a seeded environment demonstrates the gap; the fix
is a compound cursor `(created_at, id)` with
`.or('created_at.lt.{cursor},and(created_at.eq.{cursor},id.lt.{id})')`.

### F12 — View-transition reverse-navigation continuity

(Renamed F6 for clarity in the Codex follow-up list. Same
content; defer until forward A5.3 has device telemetry.)

### LOW / NIT (deferred to cleanup PR)

- **L-NIT-1** `react-hooks/exhaustive-deps` warning on the Realtime
  channel `useEffect` in chat-window. `currentUserId` and
  `setMessages` (from the hook's setItems) are stable; suppress
  with an explanatory `// eslint-disable-next-line` or add them
  to the deps.
- **L-NIT-2** `cursor as string` cast in both call-site action
  closures (`chat-window.tsx`, `mas-productos.tsx`). The hook
  guarantees non-null before calling; the cast is safe but defeats
  the generic. Restructure to use a non-null assertion or rework
  the closure typing.
- **L-NIT-3** `::view-transition-image-pair(*)` missing from the
  `prefers-reduced-motion` guard in `globals.css`. Most browsers
  do not yet implement View Transitions Level 2, so this is not
  a current regression — add for completeness.
- **L-NIT-4** Unused imports in `sale-confirmation-card.tsx`
  (`Clock`, `ChevronDown`, `formatPrice`, `isRejected`) left over
  from the A5.4 refactor. ESLint warning.
