# Tasks — Optimize Web Performance (A3)

> Execution checklist. One commit per sub-phase. `pnpm build` green gate between
> every commit. CODEX `/ultrareview` before push. NO Auto mode — Pedro approves
> each gate.

## Pre-flight

- [x] **T-00 · FASE 0 audit** — completed 2026-06-02 (read-only).
- [x] **T-01 · Pedro firma priorities** — 7 HIGH sub-phases approved 2026-06-03.
- [ ] **T-02 · Branch** — `git checkout master && git pull --rebase origin master && git checkout -b feat/optimize-web-performance`
- [ ] **T-03 · Capture baseline Lighthouse** — Pedro runs Lighthouse on `/`,
  `/rankings`, `/buscar` on mobile throttled 3G BEFORE 3.1 lands. Save the
  3 reports as JSON locally for delta comparison post-merge.

---

## Commit 1 — Sub-phase 3.1 · Crown WebP conversion

- [ ] **T-04 · Pick conversion tool** — `sharp` (transitive) or `cwebp` CLI.
  Pedro decides on quality level (default: WebP quality 80).
- [ ] **T-05 · Convert 3 PNGs** — produce `crown-1.webp`, `crown-2.webp`,
  `crown-3.webp` under `apps/web/public/images/rankings/`. Each ≤ 80 KB,
  total ≤ 150 KB.
- [ ] **T-06 · Delete original PNGs** — `git rm
  apps/web/public/images/rankings/crown-{1,2,3}.png`. Keep the deletions
  visible in the diff for the PR.
- [ ] **T-07 · Edit `podio-ranking.tsx:54-58`** — replace `<img>` with
  `<Image>` from `next/image`, add fixed `width`/`height` per `isFirst`
  (72 vs 56), add `sizes` (`"(max-width: 768px) 72px, 72px"` or
  `"56px"`), no `priority`. Preserve `alt`, `className`.
- [ ] **T-08 · Build gate** — `rm -rf apps/web/.next/dev && pnpm build` verde.
- [ ] **T-09 · Visual diff check** — open `/rankings` in dev, confirm crowns
  render at same size/position. No CLS, no missing crowns.
- [ ] **T-10 · Commit** — explicit add of: `apps/web/public/images/rankings/crown-{1,2,3}.webp`,
  deletion of `crown-{1,2,3}.png`, edit of `apps/web/components/rankings/podio-ranking.tsx`.
  Message: `perf(web): convert crown podium PNGs to webp and serve via next/image`

---

## Commit 2 — Sub-phase 3.2 · next.config tuning

- [ ] **T-11 · Read package.json** — list every `@radix-ui/*` package present.
- [ ] **T-12 · Edit `next.config.ts`** — add `images.formats: ['image/avif',
  'image/webp']` to `images` block. Add `experimental.optimizePackageImports`
  with: `lucide-react`, `framer-motion`, and only the `@radix-ui/*` packages
  from T-11.
- [ ] **T-13 · Build gate** — `pnpm build` verde. No unknown-flag warnings.
- [ ] **T-14 · Commit** — explicit add of `apps/web/next.config.ts`.
  Message: `perf(config): add optimizePackageImports + explicit images.formats`

---

## Commit 3 — Sub-phase 3.3 · LCP `<Image>` priority + sizes

- [ ] **T-15 · Edit `product-card.tsx`** — add optional `priority?: boolean`
  prop, pass to `<Image>`.
- [ ] **T-16 · Edit grid consumers** — in home feed, search results, and any
  other route rendering `<ProductCard>` in a grid, pass `priority={index < 2}`
  for the first 2 cards (first row above the fold).
- [ ] **T-17 · Edit `store-post.tsx:102`** — add `sizes="(max-width: 768px)
  100vw, 600px"` to the feed image `<Image>`.
- [ ] **T-18 · Build gate** — `pnpm build` verde.
- [ ] **T-19 · Commit** — explicit add of all touched files.
  Message: `perf(web): add priority and sizes to LCP images in feed and product card`

---

## Commit 4 — Sub-phase 3.4 · Remove `unoptimized` from UserAvatar

- [ ] **T-20 · Verify remotePatterns** — confirm `apps/web/next.config.ts:64-89`
  `remotePatterns` already covers every host UserAvatar may receive:
  `**.supabase.co` ✓, `**.googleusercontent.com` ✓, `firebasestorage` ✓, seed
  hosts ✓. If a host is missing, add it BEFORE removing `unoptimized`.
- [ ] **T-21 · Edit `user-avatar.tsx:45`** — delete the `unoptimized` prop from
  the `<Image>` tag. Nothing else changes.
- [ ] **T-22 · Build gate** — `pnpm build` verde.
- [ ] **T-23 · Manual test** — load any page with avatars (e.g., `/rankings`,
  `/perfil`). DevTools network: avatar responses come from `/_next/image`
  with `content-type: image/avif` or `image/webp`. Force a 404 on a src
  (DevTools network blocking) — fallback initial letter still renders.
- [ ] **T-24 · Commit** — explicit add of `apps/web/components/ui/user-avatar.tsx`.
  Message: `perf(web): remove unoptimized flag from UserAvatar to enable AVIF/WebP`

---

## Commit 5 — Sub-phase 3.5 · preconnect + dns-prefetch

- [ ] **T-25 · Edit `apps/web/app/layout.tsx`** — add `<link rel="preconnect">`
  and `<link rel="dns-prefetch">` for the Supabase project URL
  (`https://oxxdkwywprkfghhbnoto.supabase.co`) and Upstash region URL. See
  design.md section 5 for the exact tags.
- [ ] **T-26 · Build gate** — `pnpm build` verde.
- [ ] **T-27 · Manual test** — DevTools network on cold reload of `/`: first
  `*.supabase.co` request shows no separate DNS / connect / TLS rows
  (already done).
- [ ] **T-28 · Commit** — explicit add of `apps/web/app/layout.tsx`.
  Message: `perf(web): add preconnect and dns-prefetch to supabase and upstash`

---

## Commit 6 — Sub-phase 3.6 · `prefetch={false}` on feed / grid Links

- [ ] **T-29 · Edit `product-card.tsx`** — add `prefetch={false}` to the
  outer `<Link>`.
- [ ] **T-30 · Edit `store-post.tsx`** — add `prefetch={false}` to the
  product-image Link (`line 100` area). Keep prefetch on action buttons if
  they navigate to user profile (low-count navigations).
- [ ] **T-31 · Edit `following-rail.tsx`** — add `prefetch={false}` to the
  store carousel Links (lines 26, 36).
- [ ] **T-32 · Edit `podio-ranking.tsx`** — add `prefetch={false}` to the
  outer `<Link>` (line 44).
- [ ] **T-33 · Sweep `apps/web/components/` for other grid Links** — any
  component rendering a grid of `<Link>` cards (e.g., search result item,
  favorite item) should also get `prefetch={false}`.
- [ ] **T-34 · Build gate** — `pnpm build` verde.
- [ ] **T-35 · Commit** — explicit add of all touched files.
  Message: `perf(web): disable Link prefetch on feed and grid cards`

---

## Commit 7 — Sub-phase 3.7 · `@next/bundle-analyzer` install

- [ ] **T-36 · Install** — `pnpm --filter=web add -D @next/bundle-analyzer`
- [ ] **T-37 · Wire up `next.config.ts`** — import `@next/bundle-analyzer`,
  wrap config via `withBundleAnalyzer(...)` between Sentry (outermost) and PWA
  (innermost). See design.md section 7.
- [ ] **T-38 · Add `analyze` script** — `apps/web/package.json` `scripts`:
  `"analyze": "ANALYZE=true next build"`
- [ ] **T-39 · Build gate** — `pnpm build` verde (without ANALYZE).
- [ ] **T-40 · Smoke analyzer** — `pnpm --filter=web analyze` opens 3 HTML
  reports. Confirm they generate without error.
- [ ] **T-41 · Commit** — explicit add of `apps/web/next.config.ts`,
  `apps/web/package.json`, `pnpm-lock.yaml`.
  Message: `build(deps): add @next/bundle-analyzer for First Load JS measurement`

---

## Pre-push review

- [ ] **T-42 · CODEX `/ultrareview`** — run on branch `feat/optimize-web-performance`.
  Focus areas listed in design.md section 8:
  1. No LCP regression (priority only on real LCP element)
  2. No CLS regression (width/height match CSS dimensions)
  3. unoptimized removal safe (remotePatterns cover all UserAvatar src hosts)
  4. preconnect hostname correct
  5. prefetch={false} discipline (cards only, not nav)
  6. optimizePackageImports list accurate
  7. Bundle analyzer wrapping correct vs Sentry + PWA
  All CRITICAL and HIGH issues resolved before push.
- [ ] **T-43 · Pedro Lighthouse delta** — Pedro runs Lighthouse again on `/`,
  `/rankings`, `/buscar` post-changes. Compare deltas vs T-03 baseline.
- [ ] **T-44 · Report to Pedro** — present CODEX findings + Lighthouse deltas +
  bundle-analyzer screenshots. Wait for push approval.

---

## Handoff to Pedro (post-push)

- [ ] **H-1 · Vercel deploy** — Pedro merges via fast-forward; Vercel
  auto-deploys.
- [ ] **H-2 · Production smoke test** — web invitado + autenticado + APK.
  Confirm `/rankings` crowns visible, no regression on product list / chat /
  notifications.
- [ ] **H-3 · Production Lighthouse** — Pedro runs Lighthouse against
  production `vicinomarket.com` on `/`, `/rankings`, `/buscar`. Capture the
  3 reports as proof of A3 wins for the OpenSpec archive.

---

## Closing

- [ ] **T-45 · Archive change** — after smoke verde + Lighthouse production
  reports captured, move directory to
  `openspec/changes/archive/2026-06-03-optimize-web-performance/`. Merge spec
  delta into canonical `openspec/specs/web-performance/spec.md`. ASCII commit:
  `docs(openspec): archive optimize-web-performance after verified deploy`.

---

## Known follow-ups (separate changes, NOT bundled into A3)

- **`loading.tsx` route skeletons** — add `loading.tsx` with skeleton UI to
  `/`, `/rankings`, `/buscar`, `/perfil`. UX-percibida improvement, not a Core
  Web Vital number. Defer until A3 lands and we measure if the route
  transitions feel slow without skeletons.
- **`recharts` / `leaflet` / `framer-motion` usage audit** — bundle-analyzer
  (3.7) data will tell us whether these dominate the bundle. If
  `framer-motion` is < 5% of First Load JS, leave it. If `recharts` is in
  every route bundle, lazy-import it.
- **`experimental.cacheComponents`** — needs `experimental.ppr: 'incremental'`
  + `dynamicIO: true` first. PPR not GA in Next 16.2.x. Revisit when PPR
  ships GA.
- **`experimental.reactCompiler`** — verify in live Next 16 docs whether the
  Turbopack-native path is GA. If yes, enable with `compilationMode:
  'annotation'` first (file-by-file opt-in via `"use memo"` directive). If
  unstable, defer.
- **CSP enforce promotion** — currently `Content-Security-Policy-Report-Only`.
  Monitor browser console for 1-2 days post-A3, then promote to enforce.
- **Crown SVG (if available)** — if Javier has the source vector for the
  crowns, swap WebP for SVG. Smaller payload + sharper at all sizes.
- **`isFirstPost` threading for `store-post.tsx`** — A3 only adds `sizes` to
  this component; threading `priority` from the consumer requires a small
  refactor of the feed mapping. Defer if not needed for LCP.
