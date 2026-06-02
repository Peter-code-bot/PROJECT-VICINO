# Proposal — Optimize Web Performance (A3)

## Why

Lighthouse / Core Web Vitals on `vicinomarket.com` and the APK (Capacitor WebView)
have headroom on LCP, FCP, and TBT. The A3 FASE 0 audit (read-only, master HEAD
`6fbb59e`) surfaced 6 high-impact gaps and 1 acute regression that A3 closes in
order of impact.

### The crown PNG regression (immediate driver)

Commits `25cb7a9` + `75d6883` (Javier, 2026-06-01/02) introduced 3 local PNG assets
for the rankings podium crowns:

```
apps/web/public/images/rankings/crown-1.png  3.8 MB
apps/web/public/images/rankings/crown-2.png  4.5 MB
apps/web/public/images/rankings/crown-3.png  5.1 MB
```

They are rendered as raw `<img>` in
[`components/rankings/podio-ranking.tsx:54-58`](apps/web/components/rankings/podio-ranking.tsx#L54-L58),
above the fold on `/rankings`. The total above-fold payload jumped by ~13 MB
overnight, with no Next.js image optimization (no AVIF/WebP negotiation, no
responsive `srcset`, no `priority` discipline). This is a fresh perf regression
that A3 corrects.

### Other gaps from the audit

1. `<Image>` in [`product-card.tsx`](apps/web/components/product/product-card.tsx)
   (LCP on `/` and `/buscar`) has no `priority`.
2. `<Image>` in [`store-post.tsx:102`](apps/web/components/home/store-post.tsx#L102)
   has no `priority` and no `sizes` — Next.js falls back to a worst-case sizes guess.
3. [`user-avatar.tsx:45`](apps/web/components/ui/user-avatar.tsx#L45) uses
   `unoptimized` on `next/image` for 19+ surfaces, bypassing AVIF/WebP
   negotiation across the entire app.
4. No `<link rel="preconnect">` to `*.supabase.co` or `*.upstash.io` in
   [`apps/web/app/layout.tsx`](apps/web/app/layout.tsx) — every first request to
   the backend pays the full TLS handshake.
5. Default `<Link prefetch>` on every card link in home / rankings / search grids —
   Next.js speculatively GETs every visible card's destination, ballooning idle
   network traffic on feed-heavy routes.
6. No `experimental.optimizePackageImports` in
   [`next.config.ts`](apps/web/next.config.ts) — `lucide-react` (35 KB),
   `@radix-ui/*` (combined ~25 KB), and `framer-motion` (45 KB) are NOT
   barrel-tree-shaken.
7. No `@next/bundle-analyzer` installed — we cannot measure baseline First Load
   JS or verify wins post-change.

## What

Seven sub-phases, in implementation order, each shipped as one commit gated by
`pnpm build` green and reviewed via CODEX `/ultrareview` before push:

- **3.1 Crown asset optimization** — convert the 3 PNGs to WebP < 50 KB each
  (target: < 30 KB if visual quality holds, SVG if a vector representation is
  feasible from the original). Replace the raw `<img>` with `next/image` + correct
  `sizes` (`4.5rem` for the #1 slot, `3.5rem` for #2/#3). No `priority` on crowns —
  the user-avatar inside the podium ring is the actual LCP; the crown is the
  decorative overlay.
- **3.2 next.config tuning** — add `experimental.optimizePackageImports` for
  `lucide-react`, `@radix-ui/react-*` packages, and `framer-motion`. Add explicit
  `images.formats: ['image/avif', 'image/webp']` (documents intent; Next 16 defaults
  to the same). `cacheComponents` and `reactCompiler` are **NOT** included — see
  Scope OUT below.
- **3.3 LCP `<Image>` discipline** — add `priority` to product card image only when
  the card is in the first viewport row, and add `sizes` to `store-post.tsx:102`.
  Verify Lighthouse identifies the correct LCP element after the change.
- **3.4 Remove `unoptimized` from UserAvatar** — delete the `unoptimized` flag
  from `user-avatar.tsx:45`. Verify `next.config.ts` `images.remotePatterns`
  already includes `**.supabase.co` (it does, lines 66-68). Test the error
  fallback (initial letter) still triggers correctly on broken URLs.
- **3.5 preconnect in root layout** — add `<link rel="preconnect">` tags for
  `https://*.supabase.co`, `wss://*.supabase.co`, and `https://*.upstash.io` to
  `app/layout.tsx`. Add `<link rel="dns-prefetch">` as fallback for clients that
  don't honor preconnect.
- **3.6 `prefetch={false}` on grid Links** — apply to the card Links in
  `product-card.tsx`, `store-post.tsx`, `following-rail.tsx`, the rankings podium
  `podio-ranking.tsx`, and any other > 5-card grid that uses default prefetch.
  Keep prefetch on small navigation Links (header, footer, drawer).
- **3.7 `@next/bundle-analyzer` install** — add as devDependency, wire to a
  separate `pnpm analyze` script. Capture First Load JS baseline before 3.1-3.6
  changes if possible, otherwise capture after.

## Scope

### IN (this change)

- `apps/web/public/images/rankings/crown-{1,2,3}.{png,webp,svg}`
- `apps/web/components/rankings/podio-ranking.tsx`
- `apps/web/next.config.ts`
- `apps/web/components/product/product-card.tsx`
- `apps/web/components/home/store-post.tsx`
- `apps/web/components/ui/user-avatar.tsx`
- `apps/web/app/layout.tsx`
- Possibly: `apps/web/components/home/following-rail.tsx` (grid card Links)
- `apps/web/package.json` (devDep `@next/bundle-analyzer`)

### OUT (deferred to follow-up changes)

- **`experimental.cacheComponents`** — requires `experimental.ppr: 'incremental'`
  + `experimental.dynamicIO: true` prerequisite chain. PPR is not GA in
  Next.js 16.2.x stable. Re-evaluate when PPR ships GA.
- **`experimental.reactCompiler`** — React Compiler integration is functionally
  usable in Next 16 with Turbopack, but the rollout pattern (annotation mode vs
  all-files) requires baseline bundle measurements first. Defer to a separate
  change after 3.7 captures the baseline.
- **`loading.tsx`** in heavy routes (`/`, `/rankings`, `/buscar`, `/perfil`) —
  documented as follow-up in `tasks.md`. UX-percibida improvement, not a Core
  Web Vitals number.
- **`recharts` / `leaflet` / `framer-motion` usage audit** — defer. The audit
  flagged them as heavy but did not measure actual UI usage. Audit + replace in
  a separate change if measurement shows them dominating the bundle.
- **Auth / RLS code** — A1 and A2 are in production. NOT touched.
- **CSP enforcement promotion** — separate Report-Only → Enforce migration.

### SKIP (already optimal, no change)

- **`next/font`** — `Inter` + `Outfit` already set up via `next/font/google` with
  `display: 'swap'`, `subsets: ['latin']`, CSS variables in `app/layout.tsx`.
  Zero `<link>` to `fonts.googleapis.com` or `@import` Google Fonts CSS.
- **Heavy date / HTTP / utility libraries** — `moment`, `axios`, `uuid`,
  `lodash` are NOT installed (verified against `apps/web/package.json`).

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Approves spec, runs smoke test (Lighthouse before/after on `/`, `/rankings`, `/buscar`), merges PR |
| Authoring + implementation | Claude Code | Spec, code, build gates, CODEX review |
| Recent regression author | Javier | Crown PNGs introduced in `25cb7a9`; A3 corrects without his involvement |

## Success criteria (objective, measurable)

1. **Rankings LCP**: Lighthouse on `/rankings` (mobile, throttled 3G) shows LCP
   ≤ 2.5 s. Pre-A3 baseline (to be captured before 3.1 lands) likely > 4 s due
   to 13 MB crown payload.
2. **Crown total payload**: combined size of `crown-1`, `crown-2`, `crown-3`
   served on `/rankings` first paint ≤ 150 KB total (was ~13 MB).
3. **Home LCP**: Lighthouse on `/` (mobile, throttled 3G) shows LCP element is
   the first product card image and the image is delivered via Next.js
   `_next/image` with `format=avif` or `webp`.
4. **AVIF/WebP on avatars**: Network panel on any page loading user avatars
   shows responses with `content-type: image/avif` or `image/webp` (not
   `image/jpeg` straight from Supabase storage).
5. **TTFB on API calls**: time-to-first-byte on the first `*.supabase.co`
   request after a fresh page load is measurably reduced (subjective, but
   timeline waterfall in DevTools should show no separate handshake row for
   Supabase after preconnect lands).
6. **Bundle First Load JS**: `pnpm analyze` produces a report. After 3.2,
   `lucide-react` / Radix / framer-motion modules show tree-shaking (only the
   imported icons / primitives appear in the bundle, not the full barrel).
7. **No regression on existing flows** — login (web + APK), product list /
   detail, chat, notifications, seller dashboard, ranking display, rankings
   smoke test (`/rankings` shows top 3 sellers with crowns visible).

## References

- Audit report (FASE 0): persisted as part of the A3 transcript (2026-06-02);
  prioritization table embedded in the proposal above.
- Master HEAD baseline for A3: `6fbb59e` (post A2 archive).
- Recent crown commits: `25cb7a9 feat(web): update podium crowns with local png
  assets`, `75d6883 chore(assets): remove white backgrounds from podium crowns
  using rembg`, `5f8f494 style(web): increase spacing above podium...`.
- Existing perf wins to preserve: A1 layout query `Promise.allSettled` and
  middleware activation (`proxy.ts` is the Next.js 16 entry point).
