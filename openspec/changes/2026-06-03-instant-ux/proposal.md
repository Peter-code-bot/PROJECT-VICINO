# Proposal — A5 Instant UX

> Status: FASE 1 draft
> Branch (when FASE 2 starts): `feat/instant-ux`
> Master baseline: `751afaa` (post A4 archive)
> Capability: **instant-ux**
> Owner: Pedro

---

## Problem

The VICINO APK (Capacitor WebView on `https://vicinomarket.com`) feels
fast on the surfaces A1-A4 already touched, but four interactions still
expose either a server round-trip latency or a hard data ceiling that
the user perceives as a stall or a dead-end:

1. **Chat history is capped at 50 messages with no way to load older.**
   `/chat/[id]` server-loads the 50 most recent messages and the client
   has no UI nor server hook to fetch the prior page. Long-running
   conversations literally lose their history above the fold. This is
   the highest-severity UX gap remaining post-A4.

2. **Home feed caps at 150 products and stops.** The Para ti tab fetches
   `.limit(150)` server-side and renders ~15 category carousels from
   that batch. There is no infinite scroll. Power users who scroll past
   the 15 carousels hit a wall with no indication more catalog exists.

3. **Card → detail navigation is a hard route swap.** Tapping a product
   card swaps to `/${categoria}/${slug}` with no visual continuity. The
   image jumps from grid position to detail-page hero position. On a
   native shell this reads as "web", not "app". Next 16.2.6 +
   React 19.2 + WebView Chromium expose the View Transitions API; we
   just have not flipped the switch.

4. **Sale confirm/cancel waits for the server before any visual change.**
   `sale-confirmation-card.tsx` uses a raw `await action(); setLoading()`
   pattern. The StatusPill ("Pendiente" → "Esperando respuesta") does
   not flip until the round-trip completes, contradicting the optimistic
   pattern the other 7 mutation surfaces of the app already adopt via
   `use-optimistic-mutation`.

These four together define what users experience as "the app stalls"
when in fact every fix is local — none of them require a new data
layer.

## Solution

Four targeted changes, plus one shared hook they depend on, all
implemented inside the existing stack (RSC + Server Actions + Realtime
+ `revalidatePath`). **No new data-fetching library** is introduced
(see Constraint C1 below).

| Sub-phase | Scope | Depends on |
|---|---|---|
| **A5.0** | Create `hooks/use-infinite-cursor.ts` — a ~40 LOC custom hook for cursor-based load-more. | — |
| **A5.1** | Wire chat messages load-older with `IntersectionObserver` at the top of the scroll + scroll-position preservation on prepend + Realtime de-dup. | A5.0 |
| **A5.2** | Wire home feed infinite scroll with incremental category grouping. | A5.0 |
| **A5.3** | Enable `experimental.viewTransition` in `next.config.ts` + `view-transition-name` on product-card image and product-detail hero. | — |
| **A5.4** | Migrate `sale-confirmation-card.tsx` `handleConfirm` / `handleCancel` from raw await to `use-optimistic-mutation`. | — |

Each sub-phase ships as **one commit** on `feat/instant-ux`, gated by
`pnpm build` green, with a final CODEX `/ultrareview` pass over the
whole branch before push.

## Why this matters

The four gaps directly contradict the "native feel" promise A4 set
(haptics, smart back, overscroll). A user who taps the back button and
gets a synthetic Escape that closes a Radix dialog cleanly (A4) but
then taps a product card and watches a white-flash hard swap (A5.3
target) experiences whiplash. A5 closes that loop.

Specifically:

- **A5.1** removes a literal data ceiling — users today CANNOT see
  their own chat history past message 51, which damages the trust
  signal core to the product.
- **A5.2** raises the engagement ceiling for active browsers — once
  someone scrolls past 15 carousels, today the app implies the catalog
  ends; in reality there are hundreds more products.
- **A5.3** is the highest-leverage native-feel change available without
  a new dependency. It targets the navigation users do most.
- **A5.4** brings the most stakes-laden mutation in the app (sale
  agreement) up to parity with the favorite-toggle pattern — feedback
  about a $-denominated commit should be at least as instant as a
  heart-tap.

## Non-goals

- **TanStack Query**: deliberately NOT introduced. See Constraint C1.
- **react-virtuoso / list virtualization**: deliberately deferred. The
  largest list rendered today is ~150 items (home), split into ~15
  carousels. No surface reaches the 500+ item threshold where
  virtualization pays for itself.
- **`/chat` (chat list) pagination**: today unbounded but typical
  users have <30 conversations. Defer until telemetry justifies it.
- **Publish product optimistic UI**: the upload-then-DB pipeline makes
  predicted UI state non-trivial (no final image URL to render
  optimistically). Defer.
- **Profile form optimistic UI**: MED priority. Not in A5 scope; will
  reuse the wrapper in a follow-up.
- **Historial load-more (ventas + compras)**: MED priority. The hook
  shipped in A5.0 makes this trivial later; not in A5 scope.

## Constraints

- **C1 — No TanStack Query.** The audit confirmed the data plane is
  RSC + Server Actions + Supabase Realtime + `revalidatePath`. There
  is no client-side cache-coherence problem TanStack would solve. The
  custom `use-optimistic-mutation` hook already exceeds
  `useMutation`'s capabilities for this codebase (FIFO temp-id
  tracking, rollback returned from `onMutate`, `allowConcurrent`
  knob). `use-infinite-cursor` follows the same pattern. Introducing
  TanStack now would (a) create two caches that fight each other
  (TanStack cache vs server-driven `revalidatePath`), (b) add ~25 KB
  gz that A3 just optimized out, (c) contradict Pedro's prior
  decision recorded in project memory ("TanStack reserved for queries
  multi-screen client"). A5 does not cross that line.

- **C2 — No new client-side dependency.** `use-infinite-cursor` is
  ~40 LOC of plain React + a generic over the Server Action. View
  Transitions are a browser API. Optimistic UI uses the existing
  wrapper. View-transition-name is a CSS property.

- **C3 — `experimental.viewTransition` is experimental.** If the flag
  breaks SSR or build on Next 16.2.6 with the existing PWA + Sentry +
  bundle-analyzer toolchain (see [next.config.ts](../../../apps/web/next.config.ts)),
  PAUSE A5.3 immediately. Do NOT push around the issue. Report to
  Pedro; possibly demote A5.3 to DEFER or replace with a
  framer-motion-based shared element animation.

- **C4 — Realtime must not double-render messages in A5.1.** The
  channel subscription in `chat-window.tsx` already inserts incoming
  messages via Postgres CDC. The load-older Server Action returns
  OLDER messages by `created_at < cursor`. The two paths address
  different time slices and must not overlap; the design must guard
  against a race where a Realtime INSERT lands during a load-older
  fetch and the cursor query also returns that same message (edge:
  out-of-order arrival or clock skew).

- **C5 — Scroll position preservation on prepend.** When older
  messages are prepended to the DOM, the browser will keep
  `scrollTop` at the literal pixel value, which means the visible
  message moves DOWN out of view. The hook user (or A5.1's call-site)
  must snapshot `scrollHeight` before prepend and restore
  `scrollTop = scrollHeight_new - scrollHeight_old` synchronously
  after the React render that adds the new items. The design
  specifies this contract.

## Impact

- **Risk surface**: low. A5.4 reuses a battle-tested wrapper.
  A5.1/A5.2 add net-new code but inside the existing data pattern.
  A5.0 is a single hook. A5.3 is the only experimental piece and has
  a defined kill-switch (C3).
- **Build size impact**: negligible — `use-infinite-cursor` is ~40
  LOC, no new deps. View Transitions are zero-byte runtime (browser
  primitive). View-transition-name is a single CSS property.
- **Performance**: net positive. Home feed initial payload may
  shrink from 150 to e.g. 30 once incremental loading is wired (A5.2
  has freedom to right-size the initial cursor).
- **Backwards compatibility**: full. All four sub-phases preserve
  existing behavior when the new path is not exercised (no cursor =
  initial page; no Realtime INSERT = no de-dup needed; flag off =
  current navigation).

## Acceptance

- `pnpm build` green after each commit.
- CODEX `/ultrareview` over the full branch with focus on:
  - A5.0 hook signature: clean async semantics, cancellation safety
  - A5.1 Realtime/cursor de-dup logic; scroll-preserve correctness
  - A5.2 incremental grouping consistency vs current 150-shot
  - A5.3 SSR + build stability with the experimental flag
  - A5.4 optimistic semantics for both success and rollback paths
- Pedro APK-device sign-off on 4-7 checkpoints (D-A5.1..D-A5.7 to be
  enumerated in tasks.md).

## Out-of-spec follow-ups (recorded in tasks.md)

- TanStack Query introduction — only when a real client-multi-screen
  caching need emerges
- react-virtuoso — only when a production list crosses 500 items
- `/chat` list pagination — telemetry-gated
- Publish-product optimistic UI — upload pipeline blocker
- Profile form optimistic UI — MED, future PR
- Historial load-more — MED, reuses A5.0 hook
