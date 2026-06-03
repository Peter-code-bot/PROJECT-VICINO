# Tasks — A5 Instant UX

> Companion to `proposal.md` and `design.md`.
> Each sub-phase = 1 commit on `feat/instant-ux`. Gate between each:
> `pnpm build` green. Final gate before push: CODEX `/ultrareview` over
> full branch + Pedro D-checkpoints on APK device.

---

## Pre-flight

- [ ] **GATE 0** — `git fetch origin` + confirm `origin/master` is at
      `751afaa` or newer. Branch from clean master.
- [ ] Create branch `feat/instant-ux` from master.
- [ ] OpenSpec FASE 1 committed to master FIRST (so the spec is on
      master before the implementation branch starts).

---

## A5.0 — `use-infinite-cursor` hook

Commit: `feat(hooks): add use-infinite-cursor hook for cursor-based load-more`

- [ ] Create `apps/web/hooks/use-infinite-cursor.ts` implementing the
      signature defined in `design.md`:
  - `useInfiniteCursor<T, C>(opts: UseInfiniteCursorOptions<T, C>)`
  - Internals: `useState` for items + cursor, `useCallback` for
    `loadMore`, `mountedRef` + `inFlightRef` guards.
  - Imperative API: `prependLive`, `appendLive`, `removeItem`.
  - Prepend/append branching via `opts.prepend` (default false).
- [ ] No console.log statements (typescript-rules).
- [ ] Strict types: no `any`. Generic over `T` (item shape) and `C`
      (cursor shape, typically `string` for ISO timestamps).
- [ ] `pnpm build` green.
- [ ] Commit (ASCII only; `git add` explicit on the single file).

---

## A5.1 — Chat messages load-older

Commit: `feat(chat): load older messages with cursor + scroll preservation`

- [ ] Add `getMessagesBefore(chatId, cursor, limit)` Server Action to
      `apps/web/app/(marketplace)/chat/actions.ts`. RLS enforced via
      same Supabase client used by the SSR initial load.
- [ ] Migrate `chat-window.tsx` from local `useState<Message[]>` to
      `useInfiniteCursor` with `prepend: true`.
- [ ] Initial cursor: `initialMessages[0]?.created_at` if
      `initialMessages.length === 50`, else `null` (no more pages).
- [ ] Add a top-sentinel `<div ref={topSentinelRef} />` inside the
      scroll container.
- [ ] Wire `IntersectionObserver` to fire `loadMore` on sentinel
      visibility with `threshold: 0.1`. Snapshot
      `{ scrollHeight, scrollTop }` to `pendingScrollSnapshotRef`
      BEFORE awaiting `loadMore`.
- [ ] `useLayoutEffect` on `messages.length` consumes the snapshot
      and adjusts `scrollTop = prevScrollTop + (newScrollHeight - prevScrollHeight)`.
- [ ] Channel INSERT handler migrates from
      `setMessages([...messages, msg])` to `appendLive(msg)`.
- [ ] Optimistic temp-id reclaim logic stays. Rollback path uses
      `removeItem(m => m.id === tempId)`. Success path uses
      `removeItem(m => m.id === tempId)` followed by `appendLive(canonical)`.
- [ ] Show a small "Cargando…" indicator above the sentinel when
      `isLoading`.
- [ ] Error surfacing: subtle inline banner when `error !== null`,
      cleared on the next successful `loadMore`.
- [ ] Smoke: open chat with >50 messages, scroll to top, observe
      older messages prepend and the visible message stays in place
      (no jump). `pnpm build` green.
- [ ] Commit.

---

## A5.2 — Home feed infinite scroll

Commit: `feat(home): infinite scroll "Mas productos" below initial carousels`

- [ ] Add `getMoreFeedProducts(cursor, limit)` Server Action to
      `apps/web/app/(marketplace)/actions.ts` (file may not exist yet
      — create it alongside the existing `actions.ts` files in the
      same route group).
- [ ] Compute the cursor for "Más productos" inside `page.tsx`: take
      the oldest `created_at` from the initial 150 products. Pass to
      the new client component as a prop.
- [ ] Create `apps/web/components/home/mas-productos.tsx` client
      component:
  - Props: `initialItems?: ProductCardData[]` (default `[]`),
    `initialCursor: string | null`.
  - Uses `useInfiniteCursor` with `prepend: false`.
  - Renders a header ("Más productos" — copy TBD by Pedro), a
    responsive `grid` of `ProductCard`, and a bottom sentinel for
    the IntersectionObserver.
  - Empty state: when `initialCursor === null` (catalog smaller than
    150), render nothing.
- [ ] Mount `<MasProductos initialCursor={...} />` at the bottom of
      the Para ti feed, AFTER the 15 carousels.
- [ ] Existing 15 carousels stay unchanged. Server grouping logic in
      `page.tsx` stays unchanged. No client re-grouping.
- [ ] Smoke: open `/`, scroll past last carousel, "Más productos"
      header appears with 30 cards. Continue scrolling — page 2 loads.
- [ ] `pnpm build` green.
- [ ] Commit.

---

## A5.3 — View Transitions: product-card → detail

Commit: `feat(ui): enable view transitions for product-card -> detail navigation`

- [ ] Enable `experimental.viewTransition: true` in
      `apps/web/next.config.ts`.
- [ ] **GATE C3**: run `pnpm build`. If it fails or surfaces SSR
      warnings, PAUSE A5.3 immediately. Report to Pedro. Do NOT push
      through the issue.
- [ ] Add `style={{ viewTransitionName: \`product-${slug}\` }}` to
      the `<Image>` in `apps/web/components/product/product-card.tsx`.
- [ ] Add the matching `viewTransitionName` style to the hero
      `<Image>` in `apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx`.
- [ ] Add the `prefers-reduced-motion` guard to `apps/web/app/globals.css`:
      ```css
      @media (prefers-reduced-motion: reduce) {
        ::view-transition-group(*) { animation: none !important; }
      }
      ```
- [ ] Smoke (browser): from `/`, tap any product card. Detail page
      opens with the image animating from card position to hero
      position. No white flash.
- [ ] Smoke (older browser fallback): the navigation still works
      (the API is progressively enhanced — startViewTransition does
      nothing when unsupported, and Next's wrapper handles the
      branch).
- [ ] `pnpm build` green.
- [ ] Commit.

---

## A5.4 — Sale confirm/cancel optimistic UI

Commit: `feat(sale): migrate confirm/cancel to use-optimistic-mutation`

- [ ] Add `useOptimisticMutation` wrapping `confirmSale` and another
      wrapping `cancelSale` in `sale-confirmation-card.tsx`.
- [ ] Introduce local `useState<ConfirmationStatus | null>` for
      `optimisticStatus`. Compute
      `effectiveStatus = optimisticStatus ?? derivedStatus` and pass
      that to the StatusPill + downstream conditionals.
- [ ] `onMutate` for confirm: snapshot previous `optimisticStatus`,
      set to `"esperando"`, return rollback that restores previous.
- [ ] `onMutate` for cancel: same pattern, set to `"rechazado"`.
- [ ] `onSuccess` for both: clear the overlay (`setOptimisticStatus(null)`)
      so the parent's revalidated `sc` becomes authoritative.
- [ ] Move `void hapticMedium()` from the function body into
      `onMutate` (next to the optimistic flip, consistent with
      `favorite-button.tsx`).
- [ ] Remove the manual `setLoading` / `setError` since the wrapper
      exposes `isPending` and `error`.
- [ ] Update the CTA buttons to use `isPending` from the mutation
      (disable while in flight).
- [ ] Smoke: open chat with a pending sale. Tap "Confirmar venta".
      StatusPill flips to "Esperando respuesta" before the request
      completes. Force-error path: simulate network down, confirm
      rollback restores "Pendiente".
- [ ] `pnpm build` green.
- [ ] Commit.

---

## Branch-level gates

- [ ] All 5 sub-phase commits live on `feat/instant-ux`.
- [ ] Final `pnpm build` green from a clean checkout of the branch.
- [ ] Launch CODEX `/ultrareview` over the branch with focus areas:
  - **A5.0**: hook generic correctness, mountedRef + inFlightRef
    races, behavior when `loadMore` is called on `!hasMore`.
  - **A5.1**: Realtime/cursor de-dup — confirm no message can appear
    in both paths; scroll-preservation correctness under StrictMode
    double-render; error path doesn't consume cursor.
  - **A5.2**: initial cursor derivation (off-by-one on the
    boundary); empty-state when `initialCursor === null`; server
    SELECT shape matches the existing `ProductCard` consumer.
  - **A5.3**: `experimental.viewTransition` interaction with PWA SW
    + Sentry wrapper; reduced-motion guard correctness; check no
    accessibility regression.
  - **A5.4**: optimistic overlay correctly cleared on success;
    rollback restores derived status not a stale overlay; CTA button
    disable state.
- [ ] PAUSE on CODEX HIGH blockers per the A4 protocol — Pedro
      reviews before any fix iteration. Max 3 fix iterations.
- [ ] After CODEX clears + fixes applied: `pnpm build` green again.

---

## Pedro device validation (post-CODEX, post-fix)

Per `design.md` D-checkpoints:

- [ ] **D-A5.1** Chat load-older works, no scroll jump.
- [ ] **D-A5.2** Home "Más productos" infinite scroll works.
- [ ] **D-A5.3** Card → detail view transition animates the image.
- [ ] **D-A5.4** Confirm sale → StatusPill flips instantly.
- [ ] **D-A5.5** Reject sale → StatusPill flips instantly.
- [ ] **D-A5.6** Force chat send error → optimistic message rolls back.
- [ ] **D-A5.7** Force load-more error → cursor not consumed, retry possible.

---

## Push + PR + merge + archive

- [ ] `git push -u origin feat/instant-ux`.
- [ ] Open PR to master with summary of 5 sub-phases + CODEX results.
- [ ] DO NOT merge until D-A5.1..D-A5.7 verde on device.
- [ ] After Pedro OK: `git checkout master && git pull --rebase` +
      `git merge --ff-only feat/instant-ux` + `git push origin master`.
- [ ] Confirm Vercel production deploy verde with the final hash.
- [ ] Archive: `git mv openspec/changes/2026-06-03-instant-ux/ openspec/changes/archive/` +
      merge the `instant-ux` delta spec into `openspec/specs/instant-ux/spec.md`
      as canonical + document any follow-ups discovered.
- [ ] Delete `feat/instant-ux` local + remote.

---

## Follow-ups (intentionally deferred)

These are documented here so they are NOT forgotten and NOT
re-litigated mid-implementation:

- **F1 — TanStack Query introduction.** Only when a real
  multi-screen client-side caching need emerges. Per proposal.md
  Constraint C1 and audit findings. Document the trigger condition
  if it occurs.
- **F2 — react-virtuoso / list virtualization.** Only when a
  production list crosses ~500 items. Today the largest list is
  ~150 (home), reduced to ~15 carousels × ~10 cards. Re-evaluate
  if `/chat` list reaches that size for power sellers.
- **F3 — `/chat` (chat list) pagination.** Today unbounded SELECT
  on `chats` ordered by `updated_at`. Typical users <30 chats. Add
  pagination + load-more (trivial via `use-infinite-cursor`) when
  telemetry shows the top decile crossing some threshold (TBD).
- **F4 — Publish product optimistic UI.** Upload pipeline makes the
  optimistic state non-trivial (no predicted image URL). Re-evaluate
  if/when the upload moves to a presigned URL flow that the client
  can render before the DB commit.
- **F5 — Profile form optimistic UI.** MED priority. Reuses
  `use-optimistic-mutation` once we decide the right granularity
  (per-field vs whole-form save). Out of A5 scope.
- **F6 — Historial load-more.** MED priority. `use-infinite-cursor`
  ships in A5.0, so this becomes a small per-tab wiring task in a
  follow-up PR.
- **F7 — Realtime replace-item for chat temp → real swap.** If the
  rollback-then-append pattern in A5.1 produces a visible flicker,
  add an atomic `replaceItem(predicate, replacement)` to the hook.
  TBD on device.
- **F8 — View Transitions beyond product-card.** Other navigations
  (home tab swap, drawer open, settings → sub-settings) could
  receive the same treatment in a future PR if A5.3 ships clean.
  Cost is per-navigation, not per-app.

- **F9 — Chat Realtime subscribe gap (codex HIGH-1, pre-existing).**
  Between the SSR `initialMessages` fetch and the moment the Realtime
  `.subscribe()` callback resolves there is a window (~500–1500 ms on
  mobile) where INSERTs from the other party are neither in the
  initial set nor delivered by the channel. Not introduced by A5.1
  -- the cursor + DESC fix narrows the consequence slightly. Proper
  fix is a "catch-up on subscribe" pattern: after `status ===
  "SUBSCRIBED"`, issue a one-shot `getMessagesAfter(chatId,
  newestCreatedAt)` and merge-deduplicate. Out of A5 scope.

- **F10 — ESLint `any` cleanup in marketplace surfaces.** The branch
  ESLint pass surfaces pre-existing `no-explicit-any` errors in
  `apps/web/app/(marketplace)/page.tsx` (lines 119, 208, 211, 253
  -- byCategory iteration casts) and `sale-confirmation-card.tsx:80`
  (`icon: any` on the local `MetaCell` component). Not introduced by
  A5, build script does not run ESLint so CI stays green, but a
  cleanup PR should type-narrow these.

- **F11 — Same-`created_at` boundary tiebreaker for cursors.** Both
  `getMessagesBefore` and `getMoreFeedProducts` use `.lt(created_at)`
  without a secondary `id` tiebreaker. Under bulk seed scripts that
  insert with identical microsecond timestamps a boundary product
  can be silently skipped. Real Supabase `now()` makes natural
  collisions extremely unlikely. Defer until a seeded environment
  demonstrates the gap.

- **F12 — `view-transition-name` reverse-navigation continuity.**
  Forward animation (card -> detail) works via the just-in-time
  + cleanup pattern. The reverse (detail -> home via back button)
  has no shared element because the original card's name is gone by
  the time the user returns. Persisting "which card was clicked"
  across navigation (sessionStorage keyed by product id, or a URL
  hash) would enable the reverse animation. Out of A5 scope.
