# Design — Optimize Web Performance (A3)

> Implementation strategy for `2026-06-03-optimize-web-performance`. Seven
> sub-phases, one commit each, in implementation order. Build gate (`pnpm build`
> green) between every commit. CODEX `/ultrareview` before push.

## Branch + commit sequence

Branch: `feat/optimize-web-performance` cut from `origin/master` HEAD `6fbb59e`.

```
perf(web): convert crown podium PNGs to webp and serve via next/image     (3.1)
perf(config): add optimizePackageImports + explicit images.formats        (3.2)
perf(web): add priority and sizes to LCP images in feed and product card  (3.3)
perf(web): remove unoptimized flag from UserAvatar to enable AVIF/WebP    (3.4)
perf(web): add preconnect and dns-prefetch to supabase and upstash        (3.5)
perf(web): disable Link prefetch on feed and grid cards                   (3.6)
build(deps): add @next/bundle-analyzer for First Load JS measurement      (3.7)
```

## 1. Sub-phase 3.1 — Crown asset optimization

### Problem

`apps/web/public/images/rankings/crown-1.png` (3.8 MB), `crown-2.png` (4.5 MB),
`crown-3.png` (5.1 MB) — total 13.4 MB — served via raw `<img>` in
[`podio-ranking.tsx:54-58`](apps/web/components/rankings/podio-ranking.tsx#L54-L58).

### Approach (in order)

1. **Convert to WebP** using `sharp` (already a transitive dep of Next 16) or
   `cwebp`. Target: < 50 KB per file with visual-lossless quality 80. If 50 KB
   feels too aggressive for the gold crown's gradient detail, allow up to 80 KB.
   Total budget: ≤ 150 KB combined.
2. **SVG alternative**: if the source is vector-friendly (the crowns are stylized
   3D objects with gradients — likely raster only), keep WebP. If the originals
   came from a vector tool, request the SVG from Javier as a follow-up but do NOT
   block this PR on it.
3. **Replace `<img>` with `<Image>`** from `next/image`. Width/height taken from
   the existing CSS classes:
   - `isFirst`: 72px × 72px (`w-[4.5rem] h-[4.5rem]`)
   - others: 56px × 56px (`w-14 h-14`)
4. **`sizes`**: declare `sizes="(max-width: 768px) 72px, 72px"` for the first
   crown, `"(max-width: 768px) 56px, 56px"` for the others. Fixed-pixel because
   the crowns do not scale with viewport.
5. **No `priority`** on the crowns. The LCP element on `/rankings` is the user
   avatar inside the podium ring (`UserAvatar` at line 71), not the crown. The
   crown is the decorative overlay (line 53, `pointer-events-none`).
6. **`alt`** preserved: "Corona lugar {position}".

### File changes

- Delete: `public/images/rankings/crown-{1,2,3}.png`
- Add: `public/images/rankings/crown-{1,2,3}.webp` (or `.svg`)
- Edit: `components/rankings/podio-ranking.tsx:54-58`

### Verification

- Build verde.
- `ls -la public/images/rankings/` shows new files all < 80 KB.
- Open `/rankings` in dev — crowns render visually identical to current.

---

## 2. Sub-phase 3.2 — `next.config.ts` tuning

### Approach

Add to `nextConfig` in `apps/web/next.config.ts`:

```ts
const nextConfig: NextConfig = {
  // ... existing
  images: {
    formats: ['image/avif', 'image/webp'],  // explicit (matches Next 16 default)
    remotePatterns: [ /* unchanged */ ],
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-popover',
      '@radix-ui/react-tooltip',
      '@radix-ui/react-toast',
      '@radix-ui/react-tabs',
      '@radix-ui/react-select',
      '@radix-ui/react-radio-group',
      '@radix-ui/react-switch',
      '@radix-ui/react-checkbox',
      '@radix-ui/react-slider',
      '@radix-ui/react-progress',
      '@radix-ui/react-avatar',
      '@radix-ui/react-accordion',
      '@radix-ui/react-alert-dialog',
      '@radix-ui/react-collapsible',
      '@radix-ui/react-context-menu',
      '@radix-ui/react-hover-card',
      '@radix-ui/react-label',
      '@radix-ui/react-menubar',
      '@radix-ui/react-navigation-menu',
      '@radix-ui/react-scroll-area',
      '@radix-ui/react-separator',
      '@radix-ui/react-toggle',
      '@radix-ui/react-toggle-group',
      'framer-motion',
    ],
  },
};
```

The final Radix list will be the intersection of (a) what `optimizePackageImports`
supports (Next 16 has a built-in allowlist) and (b) what's actually in
`package.json`. Verify by listing `@radix-ui/*` from `apps/web/package.json`
during T-02 and trim the list to those present.

### Out of scope here (documented)

- `cacheComponents` — needs PPR + dynamicIO; PPR not GA in 16.2.x. Defer.
- `reactCompiler` — would benefit from baseline bundle measurement first
  (delivered by 3.7). Defer to a follow-up after the 3.7 baseline is captured.

### Verification

- Build verde.
- No warnings about unknown experimental flags.
- Build output shows `optimizePackageImports` taking effect (Next prints a hint
  for it; if not, ignore — the savings are bundle-time).

---

## 3. Sub-phase 3.3 — LCP `<Image>` discipline

### `product-card.tsx`

The card is rendered in grids across `/`, `/buscar`, `/vendedor/[id]`. The first
card in the first row above the fold is the LCP candidate. Approach:

1. Add a `priority?: boolean` prop to `ProductCard`.
2. Pass `priority` through to the underlying `<Image>`.
3. In the consumers (home feed page, search page), set `priority={index < 2}`
   (first 2 cards) for the grid.
4. Verify the `sizes` attribute on the `<Image>` is correct
   (`(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw` per audit — looks
   fine; do not change).

### `store-post.tsx:102`

Add `sizes="(max-width: 768px) 100vw, 600px"` (4/3 aspect feed image, full-width
on mobile, max ~600px on desktop). Add `priority={isFirstPost}` if the parent
passes index information. If `isFirstPost` is not threaded yet, accept the
audit-flagged degradation here and just add `sizes`; defer `priority` to a
small follow-up commit if needed.

### Verification

- Build verde.
- Lighthouse on `/` (mobile) shows the LCP element is now `_next/image` (not the
  raw page background).
- DevTools network: first product card image loads earlier than the rest.

---

## 4. Sub-phase 3.4 — Remove `unoptimized` from UserAvatar

### Pre-flight check

`apps/web/next.config.ts:64-89` `remotePatterns` includes:
- `**.supabase.co` ✓ — covers Supabase storage avatars
- `**.googleusercontent.com` ✓ — Google OAuth profile pics
- `firebasestorage.googleapis.com` ✓ — legacy
- `picsum.photos`, `i.pravatar.cc`, `images.unsplash.com` ✓ — seed data

All sources used by avatars are allowlisted. Safe to remove `unoptimized`.

### Approach

Edit `apps/web/components/ui/user-avatar.tsx:45`:

```diff
        <Image
          src={src}
          alt={name}
          width={PX[size]}
          height={PX[size]}
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
-         unoptimized
        />
```

That's the entire code change. `onError` fallback to the initial-letter span
remains intact (line 25, 43, 47-49).

### Verification

- Build verde.
- DevTools network on a page with avatars (e.g., `/rankings`, `/perfil`, chat
  list): avatar responses come from `/_next/image?url=...&w=...` with
  `content-type: image/avif` or `image/webp`.
- Force a 404 on an avatar URL — initial letter still renders.

---

## 5. Sub-phase 3.5 — preconnect + dns-prefetch in root layout

### Approach

Edit `apps/web/app/layout.tsx`, in the `<head>` (via Next's metadata or direct
`<link>` in the layout JSX inside the `<html>` element):

```tsx
<head>
  {/* preconnect: opens TCP+TLS early. Supabase Auth/REST + Realtime. */}
  <link rel="preconnect" href="https://oxxdkwywprkfghhbnoto.supabase.co" crossOrigin="" />
  <link rel="preconnect" href="https://oxxdkwywprkfghhbnoto.supabase.co" crossOrigin="anonymous" />
  {/* Upstash for rate-limit */}
  <link rel="preconnect" href="https://us-east-1.upstash.io" />
  {/* dns-prefetch fallback (older browsers + tile loads) */}
  <link rel="dns-prefetch" href="https://oxxdkwywprkfghhbnoto.supabase.co" />
  <link rel="dns-prefetch" href="https://us-east-1.upstash.io" />
</head>
```

Note on the Supabase URL: hardcode the project ref `oxxdkwywprkfghhbnoto`
because `preconnect` does not work with wildcards. Wildcards work for CSP
(`*.supabase.co`) but not for the resource hint. The Upstash hostname is
region-specific; pick the prod region. If unclear at implementation time, leave
Upstash as `dns-prefetch` only (cheaper, no TLS opened).

For the WebSocket path (Realtime): browsers do not open `preconnect` for
`wss://`, only `https://`. The `wss://` Realtime connection reuses the
`https://` host's resolved DNS + TLS session, so the `preconnect` for the
HTTPS host still helps the wss flow.

### Verification

- Build verde.
- DevTools network: first `https://*.supabase.co` request shows no separate
  rows for DNS / connect / TLS (already done via preconnect).

---

## 6. Sub-phase 3.6 — `prefetch={false}` on feed / grid Links

### Files affected (sample of audit hits)

- `apps/web/components/product/product-card.tsx:76-91` — `<Link>` wrapping
  product card. Used in home, search, vendor profile, favorites.
- `apps/web/components/home/store-post.tsx:56, 100, 122, 139, 147` — Links
  inside feed posts (post body, image, action buttons).
- `apps/web/components/home/following-rail.tsx:26, 36` — followed store
  carousel cards.
- `apps/web/components/rankings/podio-ranking.tsx:44` — podium slot `<Link>`.

### Approach

Add `prefetch={false}` to the card-wrapping `<Link>` props (the one that links
to `/producto/[id]`, `/vendedor/[id]`, etc.). Keep prefetch enabled for:
- Header navigation
- Footer navigation
- Drawer / menu Links
- "Ver todos" / pagination Links (small in count, likely to be clicked)

### Verification

- Build verde.
- DevTools network on `/` cold reload: no speculative GETs for `/producto/*`,
  `/vendedor/*` from cards. Network is quiet after initial page paint.
- Click a card: navigates normally (just-in-time prefetch on hover/focus, which
  Next handles automatically for non-prefetched Links).

---

## 7. Sub-phase 3.7 — `@next/bundle-analyzer` install

### Approach

1. `pnpm --filter=web add -D @next/bundle-analyzer`
2. Edit `apps/web/next.config.ts` to wrap the export with the analyzer
   conditionally:

```ts
import bundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

export default withSentryConfig(
  withBundleAnalyzer(withPWA(nextConfig)),  // analyzer inside Sentry, outside PWA
  { /* Sentry options unchanged */ }
);
```

3. Add a `pnpm analyze` script in `apps/web/package.json`:
   ```json
   "scripts": {
     "analyze": "ANALYZE=true next build"
   }
   ```
4. Capture baseline (Pedro runs `pnpm --filter=web analyze` once before
   merging) — save the resulting HTML reports from
   `apps/web/.next/analyze/` as artifacts for the PR description.

### Order of wrapping

`withSentryConfig` outermost (matches existing pattern, line 96), then
`withBundleAnalyzer`, then `withPWA`, then `nextConfig`. Bundle analyzer only
intercepts the build's webpack/turbopack stats; it does not modify the runtime
config, so its position relative to PWA does not matter functionally.

### Verification

- Build verde.
- `pnpm --filter=web analyze` opens 3 HTML reports (`client.html`, `nodejs.html`,
  `edge.html`) under `apps/web/.next/analyze/`.
- Reports show `lucide-react` and Radix imports tree-shaken (verifying 3.2).

---

## 8. CODEX `/ultrareview` focus (before push)

When the 7 commits are on the branch, run `/ultrareview` with this focus:

1. **No LCP regression** — `priority` is set only on the actual LCP element of
   each route, not sprayed on every image (which would invert lazy loading).
2. **No CLS regression** — `<Image>` width/height pairs match the original CSS
   dimensions so no layout shift on render.
3. **`unoptimized` removal is safe** — every URL src in UserAvatar is covered
   by `remotePatterns`.
4. **preconnect hostname is correct** — `oxxdkwywprkfghhbnoto.supabase.co` (no
   wildcards, no typos).
5. **`prefetch={false}` discipline** — applied to card grids only, not to
   navigation Links (which would degrade perceived navigation speed).
6. **`optimizePackageImports` list** — only packages actually in
   `package.json`, no typos.
7. **Bundle analyzer wrapping** — does not break Sentry source map upload or
   PWA service worker registration.

## 9. Rollback strategy

Each sub-phase is one commit. To rollback any single sub-phase:
- `git revert <commit-hash>` on the same branch, then re-push.
- Or, on master post-merge: `git revert <commit-hash>` and push.

The change is additive in nature — nothing removes existing functionality.
Reverting any commit returns to the prior state.

The only sub-phase with irreversible filesystem action is 3.1 (deleting the
PNGs). To rollback: restore from git history (`git checkout <prev-commit> --
apps/web/public/images/rankings/crown-*.png`).

## 10. Out-of-scope (re-confirmed)

- Auth / RLS code — A1, A2 are in production. NOT touched in this change.
- `loading.tsx` route skeletons — separate change, documented in tasks.md
  follow-ups.
- `recharts` / `leaflet` / `framer-motion` usage audit — documented as
  follow-up. Bundle analyzer (3.7) provides the data to decide.
- `cacheComponents`, `reactCompiler` — see proposal Scope OUT for rationale.
- CSP enforce promotion — separate change.
