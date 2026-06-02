# Spec — web-performance

> Domain: client-side rendering performance for the VICINO web app
> (`vicinomarket.com`) and the Capacitor WebView APK. Covers asset delivery,
> rendering priority hints, bundle composition, and speculative prefetch.
> Last updated: 2026-06-03 (bootstrapped from change `2026-06-03-optimize-web-performance`
> after verified Lighthouse + smoke verde).

---

## Context

VICINO ships a Next.js 16 App Router app with Server Components, Turbopack (dev),
Webpack (build), and the `@ducanh2912/next-pwa` wrapper. Production deploys to
Vercel; the same code loads inside the Android APK as a Capacitor WebView.

Core Web Vitals (LCP, CLS, FCP) on the main routes (`/`, `/rankings`, `/buscar`,
`/perfil`) drive both organic discovery and APK perceived performance. This spec
codifies the asset-handling and rendering hint conventions established by A3.

---

## Requirement R1 — Above-the-fold images SHALL use `next/image` with correct hints

WHEN a component renders an image that is visible in the initial viewport on a
production-supported screen size (mobile 360px and up), the component SHALL use
`<Image>` from `next/image`, NOT a raw `<img>` element. The `<Image>` instance
SHALL declare:

- `width` and `height` matching the rendered pixel dimensions OR `fill` mode
  constrained by a positioned parent with an explicit `aspect-*` class (to
  prevent CLS),
- `sizes` covering the actual responsive breakpoints used by the layout — even
  with fixed `width`/`height`, an explicit `sizes` aligns the generated srcset
  with the real CSS dimensions and avoids Next.js's worst-case `100vw` default,
- `priority` only for the single LCP element of the route (the largest visible
  image above the fold), and
- NO `unoptimized` flag, except for known animated sources or sources whose
  hostname is not in `images.remotePatterns` (none in the current app).

The system SHALL serve those images via Next.js's `/_next/image` route, which
negotiates `image/avif` or `image/webp` based on the `Accept` header.

### Scenario: New component renders above-the-fold image

- GIVEN a developer is writing a component for a route's initial viewport
- WHEN they add an image
- THEN they import `Image` from `next/image`
- AND they provide `width`, `height` (or `fill` with `aspect-*` parent), and `sizes`
- AND they do NOT add the `unoptimized` prop
- AND only the LCP element receives `priority`

### Scenario: Asset format negotiation works

- GIVEN a user loads any page with images on a browser supporting AVIF
- WHEN the DevTools network panel is inspected for an image response from `/_next/image`
- THEN the `content-type` header is `image/avif`

### Scenario: Crown rankings asset budget

- GIVEN the `/rankings` route is loaded on mobile (throttled 3G)
- WHEN the network panel sums the bytes transferred for `crown-1`, `crown-2`, and `crown-3`
- THEN the total is ≤ 50 KB (canonical baseline post-A3: ~20.6 KB)

### Scenario: UserAvatar size hints match CSS dimensions

- GIVEN a `UserAvatar` rendered at `size="xl"` (CSS `w-20 sm:w-24` = 80px mobile / 96px sm+)
- WHEN Next.js generates the srcset for the avatar
- THEN the `sizes` prop is `"(max-width: 639px) 80px, 96px"` so the browser picks the smallest variant covering the actual rendered pixels at the user's DPR

---

## Requirement R2 — Critical-path origin handshakes SHALL be pre-emptive

WHEN the user loads any page of the app, the HTML `<head>` SHALL include
`<link rel="preconnect">` declarations for every CORS origin contacted in the
first 1000 ms of page life by the critical-path JS:

- `https://oxxdkwywprkfghhbnoto.supabase.co` (REST, Auth, Storage) — with
  `crossOrigin="anonymous"` for CORS connection-pool reuse

The `crossOrigin="anonymous"` attribute is REQUIRED on the Supabase preconnect
because `supabase-js` issues CORS requests from the browser; the TLS
connection-pool segments by the `crossorigin` attribute, and a preconnect
without it will not be reused by the subsequent CORS fetches.

The `wss://` (Realtime) connection inherits the resolved DNS + TLS session from
the `https://` preconnect of the same host (when feasible) — no separate
`wss://` resource hint is required.

Out of canonical scope (not in `<head>` today):
- Upstash (rate limit) — not on the critical path of any public route, deferred
- Other origins (image hosts in `remotePatterns`, OpenStreetMap tiles) — too many
  preconnects compete for the same connection budget; only the dominant origin is hinted

### Scenario: First Supabase request has no handshake row

- GIVEN a cold-loaded page
- WHEN the user authenticates and the first `*.supabase.co` request fires from `supabase-js`
- THEN the DevTools network waterfall for that request shows no separate
  "DNS Lookup" / "Initial connection" / "SSL" rows
- AND the time from request start to response start is dominated by server
  processing, not handshake

---

## Requirement R3 — Common UI libraries SHALL be tree-shaken at build time

WHEN the production build runs (`next build --webpack`), the system SHALL apply
`experimental.optimizePackageImports` to UI libraries that ship as barrel
exports — listing only packages present as direct deps in `apps/web/package.json`
AND that actually re-export multiple named symbols:

- `lucide-react` (1000+ icon barrel)
- `framer-motion` (large animation barrel)
- `@radix-ui/react-dialog`
- `@radix-ui/react-dropdown-menu`
- `@radix-ui/react-popover`

Single-export Radix packages (`react-dismissable-layer`, etc.) SHALL NOT be
listed — `optimizePackageImports` is a no-op for them and adds misleading config.

The resulting client bundles SHALL include only the specific icons, components,
and primitives imported by the source code — not the full package surface.

The system SHALL also declare `images.formats: ['image/avif', 'image/webp']`
explicitly in `next.config.ts`, documenting the format negotiation order. This
matches the Next.js 16 default; the explicit declaration prevents silent drift
if defaults change.

### Scenario: Bundle analyzer confirms tree-shaking

- GIVEN `pnpm --filter=web analyze` is run on the production build
- WHEN the resulting `client.html` report is inspected
- THEN the `lucide-react` chunk shows only the icons actually imported in the
  source, not the full `lucide-react/dist/esm/icons` directory
- AND the `@radix-ui/*` chunks show only the imported primitive components

---

## Requirement R4 — Speculative navigation prefetch SHALL be disabled on grid card Links

WHEN a `<Link>` component is rendered as a card in a grid or feed of 5 or more
cards (the home feed product carousels, the search results grid, the rankings
podium slots, the following-rail carousel, category tiles, etc.), the `<Link>`
SHALL declare `prefetch={false}`.

When a `<Link>` is part of fixed navigation (header, footer, bottom-nav, sidebar,
drawer menu, single "Gestionar" / "Ver todos" CTAs, search bar entry-point), the
`<Link>` SHALL retain the default `prefetch` behavior (true).

This prevents the network burst on large grids where Next.js otherwise issues a
`GET` for every visible card's destination. The "Ver todos" / pagination /
section header CTAs are single-Link-per-section navigations with high click
probability — they benefit from prefetch.

Hover/focus prefetch is automatic in Next.js for non-prefetched Links — feel is
preserved.

### Scenario: Home feed cold load is quiet after first paint

- GIVEN the home page is cold-loaded
- WHEN the page paint completes and the user idles for 5 seconds
- THEN the DevTools network panel shows no speculative `GET /producto/[id]` or
  `/vendedor/[id]` requests from card prefetches
- AND when the user clicks a card, the navigation still completes within
  500 ms (just-in-time prefetch on hover/focus by Next.js)

### Scenario: Header navigation prefetch remains enabled

- GIVEN the user hovers over a header / bottom-nav `<Link>`
- WHEN the hover persists > 50 ms
- THEN Next.js prefetches the destination page chunk
- AND the click navigation feels instant

---

## Requirement R5 — Bundle size SHALL be measurable on demand

WHEN a developer wants to measure the First Load JS or chunk composition of the
production build, they SHALL be able to run a single command
(`pnpm --filter=web analyze`) that produces HTML reports under
`apps/web/.next/analyze/`.

The system SHALL provide this measurement infrastructure via
`@next/bundle-analyzer` as a devDependency, wired via
`withSentryConfig(withBundleAnalyzer(withPWA(nextConfig)))`. The analyzer SHALL
NOT activate during normal builds (only when `ANALYZE=true` env var is set), so
production deploys are byte-identical to builds prior to the analyzer install.

The `analyze` script SHALL use `cross-env` so the `ANALYZE=true` env var works
on both Windows (PowerShell, cmd, Git Bash) and Unix (Linux Vercel runners).

### Scenario: Developer measures bundle on demand

- GIVEN `@next/bundle-analyzer` is installed
- WHEN the developer runs `pnpm --filter=web analyze`
- THEN three HTML reports are written: `client.html`, `nodejs.html`, `edge.html`

### Scenario: Normal build is unaffected

- GIVEN a normal `pnpm build` runs (without `ANALYZE=true`)
- WHEN the build completes
- THEN no analyzer HTML is generated
- AND the build artifacts are identical (byte-for-byte) to a build prior to
  the analyzer install

---

## Implementation notes

- **LCP discipline**: `priority` on `<Image>` triggers eager loading + preload
  hint. Setting it on non-LCP images inverts lazy loading, hurting LCP. Apply
  only to the largest visible image above the fold of each route. For carousels
  with mapped children, thread a `priorityFirstItem` (or equivalent) prop and
  apply `priority={index === 0 && priorityFirstItem}` to the first card only.
- **AVIF/WebP negotiation**: Next.js `/_next/image` reads the request `Accept`
  header. Modern browsers send `image/avif,image/webp,*/*` — they get the most
  efficient format. Older browsers fall back to the original format.
- **`remotePatterns`**: every `Image.src` URL must match an entry in
  `next.config.ts` `images.remotePatterns`, otherwise Next.js refuses to
  optimize and throws. Removing `unoptimized` from a component is safe only
  after auditing every src origin against `remotePatterns`.
- **`preconnect` semantics**: does not support wildcards. The exact Supabase
  project hostname is hardcoded in `app/layout.tsx`. Per memory
  `reference_supabase_project`, the ref is `oxxdkwywprkfghhbnoto`.
- **TLS pool segmentation by `crossorigin`**: a preconnect without
  `crossOrigin="anonymous"` will NOT be reused by `supabase-js` CORS requests.
- **`wss://`** resource hints are not standardized; the `https://` preconnect
  for the same host is sufficient because TLS session resumption applies.
- **Bundle analyzer wrap order**: Sentry outermost (existing pattern),
  bundle-analyzer middle (identity pass-through when `ANALYZE` unset), PWA
  innermost.
- **Crown asset budget**: source WebP at 200px-wide covers DPR 2.78x for a
  56px display; crown-1 (72px display, 3x retina = 216px) needs 256px source
  to avoid upscaling.

## Out of scope (deferred to follow-up changes)

- `loading.tsx` route skeletons — UX perceived improvement, separate change
- `experimental.cacheComponents` — requires PPR (`ppr: 'incremental'` +
  `dynamicIO: true`); PPR not GA in Next 16.2.x
- `experimental.reactCompiler` — deferred pending baseline measurement (3.7
  delivered the data) and live Next.js docs verification of Turbopack-native
  stability
- `recharts` / `leaflet` / `framer-motion` usage audit — bundle-analyzer
  baseline post-A3 shows two big shared chunks (8228=887 KB, main=793 KB
  uncompressed); investigate which of these libs dominate before deciding
  replacement vs dynamic import
- CSP enforce promotion (currently Report-Only) — separate change
- Auth / RLS — A1 and A2 are in production. Not touched.
- Upstash preconnect — rate limit is not on the critical path of any public
  route; opportunity cost of an extra connection slot exceeds the gain

## Known follow-ups discovered during A3 implementation

- **Big shared bundles**: `8228-*.js` (887 KB uncompressed, ~300 KB gzipped) and
  `main-*.js` (793 KB uncompressed, ~270 KB gzipped) are loaded on every route.
  Open `apps/web/.next/analyze/client.html` to identify offenders; candidates
  are `@sentry/nextjs`, `framer-motion`, `recharts`, `leaflet`.
- **LCP on home `/parati`**: A3 deliberately did NOT apply `priorityFirstItem`
  to the first ProductCarousel (below-fold risk on mobile). If post-merge
  Lighthouse identifies the LCP element as the first card of "Recientes" on
  desktop, the fix is a 1-line caller addition (infrastructure ready in
  `ProductCarousel`).
- **Raw `<img>` pre-existing**: `app/(marketplace)/page.tsx:536` (nearbyStores
  panel) and `buscar/usuarios/page.tsx:288` (with `eslint-disable`) — pre-existed
  on master before A3. Migrate to `next/image` in a follow-up refactor.
- **`UserAvatar PX.xl=96` vs CSS `w-20`=80px mismatch**: A3 mitigated via
  `SIZES_HINT` (responsive `sizes` for `xl`). Architectural fix (align `PX` and
  CSS) deferred — current state is correct; SIZES_HINT is the load-bearing
  optimization for the `/rankings` LCP.
- **Crown SVG**: if Javier has the source vector for the podium crowns, an SVG
  replacement is smaller and crisper at all DPRs. Currently 256px WebP for #1
  and 200px WebP for #2/#3.
- **`isFirstPost` threading for `store-post.tsx`**: A3 added `priority` prop but
  the home page consumer threads `priority={index === 0}` directly in the
  `.map`. The component itself does not auto-derive — additional consumers must
  thread explicitly.
