# Design — A5 Instant UX

> Companion to `proposal.md` and the `instant-ux` spec delta.
> Focus per Pedro: (a) `use-infinite-cursor` signature + Realtime
> integration in chat, (b) incremental category grouping in home,
> (c) scroll-position preservation on prepend.

---

## A5.0 — `hooks/use-infinite-cursor.ts`

### Goal

A single hook that abstracts cursor-based load-more for any Server
Action that accepts a cursor and a limit. Designed for the two A5
surfaces (chat older messages, home older products) but with a
signature that generalizes to historial (MED follow-up).

### Signature

```ts
type CursorAction<T, C> = (input: { cursor: C | null; limit: number })
  => Promise<{ items: T[]; nextCursor: C | null }>;

interface UseInfiniteCursorOptions<T, C> {
  /** The Server Action. Receives the current cursor (null on initial
   *  manual seed) and the page size. Must return the items in the
   *  same order convention as the call-site renders. */
  action: CursorAction<T, C>;
  /** Items already on the page (e.g. SSR-rendered initial 50). The
   *  hook treats these as "page zero" and does not re-fetch them. */
  initialItems: T[];
  /** Cursor to use for the FIRST load-more call. Typically derived
   *  from the oldest item in `initialItems`. Null disables further
   *  loading (no more pages). */
  initialCursor: C | null;
  /** Page size for each load-more call. Default 30. */
  limit?: number;
  /** When true, `loadMore` prepends results to the items list and the
   *  hook returns a `prependAnchor` ref for scroll preservation
   *  (chat case). When false, results are appended (home case).
   *  Default: false (append). */
  prepend?: boolean;
}

interface UseInfiniteCursorResult<T> {
  items: T[];
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => Promise<void>;
  /** Imperative: insert one item without consuming the cursor (used
   *  by chat-window when a Realtime INSERT arrives for a NEW message
   *  — that message is not a "load older" event). */
  prependLive: (item: T) => void;
  appendLive: (item: T) => void;
  /** Imperative: drop an item (e.g. optimistic rollback). */
  removeItem: (predicate: (item: T) => boolean) => void;
}

export function useInfiniteCursor<T, C>(
  opts: UseInfiniteCursorOptions<T, C>,
): UseInfiniteCursorResult<T>;
```

### Internals

- `items` lives in `useState`.
- `cursor` lives in `useState<C | null>`. Set to `initialCursor` on
  mount.
- `loadMore` is a stable callback (`useCallback`) that:
  1. Bails if `isLoading || !hasMore`.
  2. Sets `isLoading = true`.
  3. Calls `action({ cursor, limit })`.
  4. On resolve: appends or prepends `result.items` to `items` based
     on `opts.prepend`, sets `cursor = result.nextCursor`, sets
     `hasMore = result.nextCursor !== null`, clears error.
  5. On reject (thrown or `{ error: string }`): sets error, leaves
     cursor untouched so caller can retry.
  6. Sets `isLoading = false` in a `finally`.
- A `mountedRef` guards against `setState` after unmount (StrictMode
  + the request races).
- An `inFlightRef` (similar to `use-optimistic-mutation`) prevents
  double-firing if `loadMore` is invoked twice from rapid
  IntersectionObserver triggers.

### Why not just `useState` per call-site

Three call-sites (A5.1, A5.2, eventual MED A5.5) would otherwise
duplicate: cursor tracking, in-flight guard, hasMore derivation,
error reset on retry, and the prepend-vs-append branch. ~40 LOC of
shared hook is cheaper than 3× the same boilerplate.

### Why not `useOptimistic`

`useOptimistic` is for client-state that overlays server-state during
a transition. Here the server-state IS the source of truth and we
just need to accumulate pages — there is no optimistic value to
revert. Plain `useState` + a thin action wrapper is correct.

---

## A5.1 — Chat messages load-older

### The three problems to solve together

1. **Cursor query semantics**: `getMessagesBefore(chatId, cursor, limit)`
   Server Action that returns `{ items, nextCursor }` where
   `items` = messages with `created_at < cursor` ordered DESC then
   reversed to ASC for prepend, and `nextCursor` = the oldest item's
   `created_at` (or `null` if `< limit` items returned).
2. **Realtime de-dup**: an INSERT delivered by the channel during a
   load-older fetch must not appear twice. The channel only delivers
   messages CREATED AFTER the subscription starts (no historical
   replay), so by construction it CANNOT deliver a message also
   returned by `getMessagesBefore`. The risk is the OTHER direction:
   the user is at the top, scrolls up, `loadMore` returns N old
   messages, simultaneously a NEW message arrives from the channel
   and the hook's `prependLive` race-condition merges in the wrong
   order. Mitigation: the channel handler calls `appendLive`
   (newest goes at the END), `loadMore` calls a prepend internally
   (older goes at the START). They cannot collide on the same array
   index.
3. **Scroll position preservation on prepend**: see next section.

### Server Action

```ts
// app/(marketplace)/chat/actions.ts — additions
export async function getMessagesBefore(
  chatId: string,
  cursor: string,  // ISO timestamp of the oldest message currently in view
  limit: number = 30,
): Promise<{ items: Message[]; nextCursor: string | null; error?: string }> {
  // RLS guards chat membership — same pattern as the SSR initial load
  // in app/(marketplace)/chat/[id]/page.tsx.
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor")
    .eq("chat_id", chatId)
    .lt("created_at", cursor)         // strict less-than = no overlap
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { items: [], nextCursor: null, error: error.message };
  const items = (data ?? []).reverse(); // ASC order for prepend
  const nextCursor = items.length === limit ? items[0]!.created_at : null;
  return { items, nextCursor };
}
```

### Scroll position preservation contract

The call-site (chat-window) owns the scroll container. The contract is:

1. Before calling `loadMore()`, snapshot
   `prevScrollHeight = container.scrollHeight` and
   `prevScrollTop = container.scrollTop`.
2. Call `loadMore()` and `await` it.
3. In a `useLayoutEffect` keyed on `items.length`, if a snapshot is
   pending, compute
   `delta = container.scrollHeight - prevScrollHeight` and set
   `container.scrollTop = prevScrollTop + delta`. Clear the snapshot.

`useLayoutEffect` (not `useEffect`) is mandatory — the adjustment
must happen BEFORE the browser paints the new layout, otherwise the
user sees a single-frame jump.

```tsx
// chat-window.tsx skeleton
const scrollContainerRef = useRef<HTMLDivElement>(null);
const pendingScrollSnapshotRef = useRef<{ height: number; top: number } | null>(null);

const { items: messages, isLoading, hasMore, loadMore, appendLive } =
  useInfiniteCursor({
    action: ({ cursor, limit }) => getMessagesBefore(chatId, cursor!, limit),
    initialItems: initialMessages,
    initialCursor: initialMessages[0]?.created_at ?? null,
    prepend: true,
  });

useLayoutEffect(() => {
  const snap = pendingScrollSnapshotRef.current;
  if (!snap) return;
  const el = scrollContainerRef.current;
  if (!el) return;
  const delta = el.scrollHeight - snap.height;
  el.scrollTop = snap.top + delta;
  pendingScrollSnapshotRef.current = null;
}, [messages.length]);

// IntersectionObserver target — a sentinel <div /> at the TOP of the list.
// When it enters the viewport, snapshot scroll + trigger loadMore.
useEffect(() => {
  const sentinel = topSentinelRef.current;
  if (!sentinel || !hasMore) return;
  const observer = new IntersectionObserver(([entry]) => {
    if (!entry?.isIntersecting || isLoading) return;
    const el = scrollContainerRef.current;
    if (el) pendingScrollSnapshotRef.current = { height: el.scrollHeight, top: el.scrollTop };
    void loadMore();
  }, { threshold: 0.1 });
  observer.observe(sentinel);
  return () => observer.disconnect();
}, [hasMore, isLoading, loadMore]);
```

### Realtime handler — minor change

Today's `chat-window.tsx` listens to Postgres CDC and pushes to
`setMessages([...messages, newMsg])`. Migration:

- Replace local `messages` state with `useInfiniteCursor`.
- Channel INSERT handler calls `appendLive(newMsg)` (the hook's
  imperative live-insert API).
- The FIFO temp-id reclaim logic stays — `removeItem` (predicate
  matches tempId) for optimistic rollback, `appendLive` (or a custom
  `replaceItem` we add to the hook later if needed) for the temp →
  real swap. Initial implementation: rollback via `removeItem`,
  then `appendLive` of the canonical message. If this turns out to
  cause a brief flicker, we add an atomic `replaceItem(predicate, replacement)`
  in a follow-up.

### Initial-load edge case

The current SSR fetches 50 messages newest-first then reverses for
rendering. The hook gets `initialItems = initialMessages` (ASC) and
`initialCursor = initialMessages[0]?.created_at`. If
`initialMessages.length < 50` (the chat has fewer than 50 messages
total), `hasMore` should be FALSE from the start. The hook computes
`hasMore = initialCursor !== null` — so the call-site must pass
`initialCursor: initialMessages.length >= 50 ? initialMessages[0]!.created_at : null`.
A5.1 documents this in the call-site.

---

## A5.2 — Home feed infinite scroll with incremental grouping

### The grouping problem

Today's home flow:
```
1. Server fetches 150 most-recent products (ASC by created_at desc)
2. Server groups by category (15 buckets sorted by bucket size)
3. Server picks top 15 buckets with >=3 products
4. Server renders 15 ProductCarousel components, each with ~10 cards
```

If A5.2 just appends another 30 products on load-more, the grouping
breaks: the new 30 could (a) add a 16th category, (b) push an
existing carousel past 3 minimums for the first time, (c) re-order
the bucket-size ranking.

### Three options considered

**Option A — Recompute groups client-side on append (rejected)**.
Move the byCategory logic to the client. Risk: the client now needs
the same `primaryCategorySlug` helper the server uses for the embed
shape. Coupling grows. Bundle grows slightly. Also the server has
already done the work for the first 150 — recomputing means the
client throws it away.

**Option B — Server returns grouped pages (rejected)**.
The Server Action would return groupings, not products. Problem:
groupings are not stable across pages — page 2's grouping may
introduce a new bucket that retroactively changes the layout
chosen for page 1. The user would see carousels appear / re-order
under their finger.

**Option C — Lock the carousels on initial load; load-more shows a
flat "Más productos" feed (chosen)**.

The initial 15 carousels render exactly as today. Below them, a new
section "Más productos" appears with an infinite-scroll flat grid of
products beyond the initial 150, ordered by `created_at` desc. The
cursor is the oldest `created_at` from the initial 150. Each page
appends to the flat grid below the carousels.

Rationale:
- Carousels above stay stable (no shuffle).
- "Más productos" is a clear new affordance with its own header.
- Grouping logic stays server-side and ONLY runs on the initial 150
  (the carousel slice).
- The flat grid below uses the same `ProductCard` component, no new
  component to design.
- Performance: initial render is unchanged. Additional pages are
  pure append, ~30 cards each, well under any virtualization
  threshold.

### Server Action

```ts
// app/(marketplace)/actions.ts — additions
export async function getMoreFeedProducts(
  cursor: string,                    // ISO timestamp; older items only
  limit: number = 30,
): Promise<{ items: ProductCardData[]; nextCursor: string | null; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("products_services")
    .select(/* same SELECT as the initial 150 fetch in page.tsx */)
    .eq("estatus", "disponible")
    .lt("created_at", cursor)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return { items: [], nextCursor: null, error: error.message };
  const nextCursor = data && data.length === limit ? data[data.length - 1]!.created_at : null;
  return { items: (data ?? []), nextCursor };
}
```

### Client component

A new client component `<MasProductos initial={[]} initialCursor={oldest150Created_at} />`
that uses `useInfiniteCursor` (append mode). Renders a header, a
responsive grid of `ProductCard`, an IntersectionObserver sentinel
at the bottom. Empty initial — items grow as user scrolls.

The current Server Component `page.tsx` passes the cursor of the
oldest product in the initial 150 to `<MasProductos>` as a prop. If
the initial fetch returned fewer than 150 (small catalog), the
cursor is `null` and `<MasProductos>` renders nothing.

### Why this DOES NOT use Realtime

The home feed is a discovery surface, not a conversation. Users do
not expect new products to appear under their finger; they expect
fresh content on revisit. Server-side `revalidatePath("/")` from the
publish-product action already handles freshness on the next navigation.
Adding Realtime here would introduce content shifts that hurt the
shopping flow. Out of scope.

---

## A5.3 — View Transitions for product-card → detail

### What gets shipped

1. **Enable the flag** in `apps/web/next.config.ts`:
   ```ts
   experimental: {
     optimizePackageImports: [...existing],
     viewTransition: true,   // <-- new
   }
   ```
   `experimental.viewTransition` instructs Next to wrap App Router
   navigations in a `document.startViewTransition` call when the
   browser supports it. Per Next 15.2+ docs (inherited by 16.x) the
   flag is gated to client navigations; SSR and the static prerender
   pipeline are unaffected.

2. **Annotate the shared element** — `view-transition-name` on the
   product image in `product-card.tsx` and on the hero image in
   `[categoria]/[slug]/page.tsx`. The name must be unique per
   navigation (using the product slug):
   ```tsx
   // product-card.tsx
   <Image
     src={imagen}
     alt={titulo}
     style={{ viewTransitionName: `product-${slug}` }}
     ...
   />

   // [categoria]/[slug]/page.tsx hero
   <Image
     src={hero}
     alt={titulo}
     style={{ viewTransitionName: `product-${slug}` }}
     ...
   />
   ```

3. **Reduced motion guard** — add to `globals.css`:
   ```css
   @media (prefers-reduced-motion: reduce) {
     ::view-transition-group(*) { animation: none !important; }
   }
   ```
   Respects accessibility setting.

### Build / SSR risk and kill-switch (Constraint C3)

The flag is documented as experimental. Risks to validate during
A5.3 commit gate:

- **Build break**: `pnpm build` on the branch — if compile fails, the
  flag is broken on the current Next 16.2.6 with the Sentry + PWA +
  bundle-analyzer stack and A5.3 is paused. Pedro decides
  demote-to-defer vs framer-motion fallback.
- **SSR mismatch**: a hydration error in the browser console for
  pages using `viewTransitionName` would block A5.3 the same way.
- **Webview parity**: the WebView is Chromium ≥111 per A4 baseline
  (no concern), but ensure no console warning about unsupported
  feature.

### Why product-card → detail and nothing else

Card-to-detail is the most-traveled navigation in the app and the
most visually obvious shared element (image continuity). Other
candidates (home tab swap, drawer open) are either already animated
via custom transforms or don't have a natural shared element. A5.3
is surgical, not blanket.

---

## A5.4 — Sale confirm/cancel optimistic UI

### Today's code path

`sale-confirmation-card.tsx:203-218`:
```tsx
async function handleConfirm() {
  void hapticMedium();
  setLoading(true);
  setError("");
  const result = await confirmSale(sc.id);
  if (result?.error) setError(result.error);
  setLoading(false);
}
async function handleCancel() {
  void hapticMedium();
  setLoading(true);
  ...
}
```

`status` is computed from `sc.buyer_confirmed`, `sc.seller_confirmed`,
`sc.status`, `sc.rejected_by`. The StatusPill cannot flip until the
parent re-fetches `sc` (via `revalidatePath`) which only happens
after the server completes.

### The migration

Wrap both actions in `useOptimisticMutation`. Maintain a local
`optimisticStatus` overlay on top of the derived `status`:

```tsx
const [optimisticStatus, setOptimisticStatus] =
  useState<ConfirmationStatus | null>(null);

const confirmMutation = useOptimisticMutation(confirmSale, {
  onMutate: () => {
    const previous = optimisticStatus;
    setOptimisticStatus("esperando");  // flip pill immediately
    return () => setOptimisticStatus(previous);
  },
  onSuccess: () => {
    // revalidatePath() in the action triggers parent re-render with
    // authoritative sc — clear the overlay so derived status wins.
    setOptimisticStatus(null);
  },
});

const cancelMutation = useOptimisticMutation(cancelSale, {
  onMutate: () => {
    const previous = optimisticStatus;
    setOptimisticStatus("rechazado");
    return () => setOptimisticStatus(previous);
  },
  onSuccess: () => setOptimisticStatus(null),
});

const effectiveStatus = optimisticStatus ?? derivedStatus;
```

### Why an overlay rather than mutate `sc`

`sc` is a prop driven by the server. Mutating it locally would be
fighting the data flow. An optimistic overlay keyed against the
prop is the cleaner separation — and it naturally clears itself on
re-render with the new prop.

### Haptics relocation

The current call fires `void hapticMedium()` before `setLoading`.
With `useOptimisticMutation`, the fire-and-forget haptic moves into
`onMutate` (right next to the optimistic state flip). This is
already the convention used by `favorite-button.tsx`.

---

## Cross-cutting concerns

### Cancellation safety

`use-infinite-cursor` does NOT implement AbortController-based
cancellation. Server Actions in Next 16 don't expose the underlying
fetch to a client AbortSignal cleanly, and the cost of a stale
load-more resolving after a route change is "we update state on an
unmounted component" — which the `mountedRef` guard handles. If
this turns out to be a real problem in practice, we add an explicit
cancel in a follow-up.

### Why no `useTransition` wrapping load-more

`use-optimistic-mutation` uses `useTransition` because it commits a
rollback if the action errors AND wants React to keep the rest of
the page interactive. `use-infinite-cursor` does NOT have a rollback
concern (no UI change to revert if the load-more fails) and the
"keep rest of page interactive" guarantee is already there because
we await an async function and React only re-renders the items list
when state changes. Adding `useTransition` would be ceremony with no
behavior change.

### `revalidatePath` interaction

A5.4's `confirmSale` and `cancelSale` already call
`revalidatePath()`. That re-fetches `sc` on the next route push. The
optimistic overlay holds visual state during the round-trip; the
authoritative `sc` arrives via the revalidation and overrides the
overlay (per the `effectiveStatus = optimisticStatus ?? derived`
fallback). No conflict.

### Commit gates (FASE 2)

Sub-phase order on `feat/instant-ux`:
1. `feat(hooks): add use-infinite-cursor hook for cursor-based load-more` (A5.0)
2. `feat(chat): load older messages with cursor + scroll preservation` (A5.1)
3. `feat(home): infinite scroll "Más productos" below initial carousels` (A5.2)
4. `feat(ui): enable view transitions for product-card -> detail navigation` (A5.3, with kill-switch as Constraint C3)
5. `feat(sale): migrate confirm/cancel to use-optimistic-mutation` (A5.4)

Gate between each: `pnpm build` green. CODEX `/ultrareview` over the
whole branch at the end, before push.

### APK device validation (Pedro D-checkpoints)

| ID | Check |
|---|---|
| D-A5.1 | Open a chat with >50 messages. Scroll to top. Older messages load. Visible message does NOT jump. |
| D-A5.2 | Open home. Scroll past last carousel. "Más productos" header + first 30 cards appear without a manual tap. |
| D-A5.3 | Tap a product card from home. Image animates from card position to hero position. No white flash. |
| D-A5.4 | Open a chat with a pending sale confirmation. Tap "Confirmar venta". StatusPill flips to "Esperando respuesta" within a frame (not after network). |
| D-A5.5 | Same as D-A5.4 but tap "Rechazar". StatusPill flips to "Rechazado" immediately. |
| D-A5.6 | Force chat send error (airplane mode mid-tap). Optimistic message disappears (rollback). |
| D-A5.7 | Force load-more error in chat. UI surfaces the error subtly; cursor not consumed, retry possible by scrolling up again. |
