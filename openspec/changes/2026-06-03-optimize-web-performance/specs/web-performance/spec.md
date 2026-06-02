# Spec — web-performance (delta)

> Domain: client-side rendering performance for the VICINO web app
> (`vicinomarket.com`) and the Capacitor WebView APK. Covers asset delivery,
> rendering priority hints, and bundle composition.
> This is a DELTA spec — it defines new requirements introduced by change
> `2026-06-03-optimize-web-performance`. It will be merged into a canonical
> `openspec/specs/web-performance/spec.md` after the change archives.
> Last updated: 2026-06-03

---

## Context

VICINO ships a Next.js 16 App Router app with Server Components, Turbopack, and
the @ducanh2912/next-pwa wrapper. Production deploys to Vercel; users also load
the same code as a WebView inside the Android APK.

Core Web Vitals (LCP, CLS, FCP) on the main routes (`/`, `/rankings`,
`/buscar`, `/perfil`) drive both organic discovery and APK perceived
performance. This spec codifies the asset-handling and rendering hint
conventions that A3 introduces.

---

## Requirement R1 — Above-the-fold images SHALL use `next/image` with correct hints

WHEN a component renders an image that is visible in the initial viewport on a
production-supported screen size (mobile 360px and up), the component SHALL use
`<Image>` from `next/image`, NOT a raw `<img>` element. The `<Image>` instance
SHALL declare:

- `width` and `height` matching the rendered pixel dimensions (no implicit fill
  unless `fill` mode is explicitly chosen and constrained by a positioned
  parent),
- `sizes` covering the actual responsive breakpoints used by the layout,
- `priority` only for the single LCP element of the route (the largest visible
  image above the fold), and
- NO `unoptimized` flag, except for known animated/transparent sources where
  format negotiation is undesired (none in the current app — `unoptimized` is
  forbidden by default).

The system SHALL serve those images via Next.js's `/_next/image` route, which
negotiates `image/avif` or `image/webp` based on the `Accept` header.

### Scenario: New component renders above-the-fold image

- GIVEN a developer is writing a component for a route's initial viewport
- WHEN they add an image
- THEN they import `Image` from `next/image`
- AND they provide `width`, `height`, and `sizes`
- AND they do NOT add the `unoptimized` prop
- AND only the LCP element receives `priority`

### Scenario: Asset format negotiation works

- GIVEN a user loads any page with images on a browser supporting AVIF
- WHEN the DevTools network panel is inspected for an image response from `/_next/image`
- THEN the `content-type` header is `image/avif`

### Scenario: Crown rankings asset budget

- GIVEN the `/rankings` route is loaded on mobile (throttled 3G)
- WHEN the network panel sums the bytes transferred for `crown-1`, `crown-2`, and `crown-3`
- THEN the total is ≤ 150 KB

---

## Requirement R2 — Origin handshakes to backend services SHALL be pre-emptive

WHEN the user loads any page of the app, the HTML `<head>` SHALL include
`<link rel="preconnect">` declarations for every origin that will be contacted
in the first 1000 ms of page life:

- `https://oxxdkwywprkfghhbnoto.supabase.co` (REST, Auth, Storage) — with
  `crossOrigin="anonymous"` for CORS pre-flight TLS reuse
- `https://us-east-1.upstash.io` (rate limit helper) — fallback to
  `dns-prefetch` if region uncertain at build time

The system SHALL include `<link rel="dns-prefetch">` for the same hosts as a
fallback for clients that do not honor `preconnect`.

The `wss://` (Realtime) connection inherits the resolved DNS + TLS session
from the `https://` preconnect of the same host, so no separate `wss://`
preconnect is required.

### Scenario: First Supabase request has no handshake row

- GIVEN a cold-loaded page
- WHEN the user authenticates and the first `*.supabase.co` request fires
- THEN the DevTools network waterfall for that request shows no separate
  "DNS Lookup" / "Initial connection" / "SSL" rows
- AND the time from request start to response start is dominated by server
  processing, not handshake

---

## Requirement R3 — Common UI libraries SHALL be tree-shaken at build time

WHEN the build runs (`next build` or `next dev`), the system SHALL apply
`experimental.optimizePackageImports` to bundled UI libraries that ship as
barrel exports:

- `lucide-react` (icon library)
- `framer-motion` (animation library)
- Every `@radix-ui/react-*` package present in `package.json`

The resulting client bundles for any route SHALL include only the specific
icons, components, and primitives imported by the source code — not the full
package surface.

The system SHALL also declare `images.formats: ['image/avif', 'image/webp']`
explicitly in `next.config.ts`, documenting the format negotiation order.
(This matches the Next.js 16 default; the explicit declaration prevents
silent drift if defaults change.)

### Scenario: Bundle analyzer confirms tree-shaking

- GIVEN `pnpm --filter=web analyze` is run on the production build
- WHEN the resulting `client.html` report is inspected
- THEN the `lucide-react` chunk shows only the icons actually imported in the
  source, not the full `lucide-react/dist/esm/icons` directory
- AND the `@radix-ui/*` chunks show only the imported primitive components

---

## Requirement R4 — Speculative navigation prefetch SHALL be disabled on grid card Links

WHEN a `<Link>` component is rendered as a card in a grid or feed of 5 or more
cards (the home feed, the search results, the rankings podium slots, the
following-rail carousel, etc.), the `<Link>` SHALL declare `prefetch={false}`.

When a `<Link>` is part of fixed navigation (header, footer, drawer menu,
"Ver todos" pagination CTA), the `<Link>` SHALL retain the default
`prefetch` behavior (true).

This prevents the network burst on large grids where Next.js otherwise
issues a `GET` for every visible card's destination.

### Scenario: Home feed cold load is quiet after first paint

- GIVEN the home page is cold-loaded
- WHEN the page paint completes and the user idles for 5 seconds
- THEN the DevTools network panel shows no speculative `GET /producto/[id]` or
  `/vendedor/[id]` requests
- AND when the user clicks a card, the navigation still completes within
  500 ms (just-in-time prefetch on hover/focus by Next.js)

### Scenario: Header navigation prefetch remains enabled

- GIVEN the user hovers over a header `<Link>`
- WHEN the hover persists > 50 ms
- THEN Next.js prefetches the destination page chunk
- AND the click navigation feels instant

---

## Requirement R5 — Bundle size SHALL be measurable

WHEN a developer wants to measure the First Load JS or chunk composition of
the production build, they SHALL be able to run a single command
(`pnpm --filter=web analyze`) that produces HTML reports under
`apps/web/.next/analyze/`.

The system SHALL provide this measurement infrastructure via
`@next/bundle-analyzer` as a devDependency. The analyzer SHALL NOT activate
during normal builds (only when `ANALYZE=true` env var is set), so production
deploys are unaffected.

### Scenario: Developer measures bundle on demand

- GIVEN `@next/bundle-analyzer` is installed
- WHEN the developer runs `pnpm --filter=web analyze`
- THEN three HTML reports are written: `client.html`, `nodejs.html`, `edge.html`
- AND a browser auto-opens to the `client.html` report

### Scenario: Normal build is unaffected

- GIVEN a normal `pnpm build` runs (without `ANALYZE=true`)
- WHEN the build completes
- THEN no analyzer HTML is generated
- AND the build artifacts are identical (byte-for-byte) to a build prior to
  the analyzer install

---

## Implementation notes

- LCP discipline: `priority` on `<Image>` triggers eager loading + preload
  hint. Setting it on non-LCP images inverts lazy loading, hurting LCP. Apply
  only to the largest visible image above the fold of each route.
- AVIF/WebP negotiation: Next.js `/_next/image` reads the request `Accept`
  header. Modern browsers send `image/avif,image/webp,*/*` — they get the
  most efficient format. Older browsers fall back to the original format.
- `remotePatterns`: every `Image.src` URL must match an entry in
  `next.config.ts` `images.remotePatterns`, otherwise Next.js refuses to
  optimize and throws. Removing `unoptimized` from `UserAvatar` is safe only
  because `**.supabase.co` and `**.googleusercontent.com` are allowlisted.
- `preconnect` does not support wildcards. The exact Supabase project hostname
  must be hardcoded. Per memory `reference_supabase_project`, the ref is
  `oxxdkwywprkfghhbnoto`.
- `wss://` resource hints are not standardized; the `https://` preconnect for
  the same host is sufficient because TLS session resumption applies.

## Out of scope

- `loading.tsx` route skeletons — UX perceived improvement, separate change.
- `experimental.cacheComponents` — requires PPR prerequisite, not GA in
  Next 16.2.x.
- `experimental.reactCompiler` — deferred pending baseline measurement and
  live Next.js docs verification.
- `recharts` / `leaflet` / `framer-motion` replacement — defer until bundle
  analyzer shows them dominating First Load JS.
- CSP enforce promotion — separate change.
- Auth / RLS — A1 and A2 are in production. Not touched.

## Known follow-ups (listed in tasks.md for traceability)

- Add `loading.tsx` skeletons to heavy routes after measuring perceived
  navigation feel post-A3.
- Evaluate `experimental.reactCompiler` after capturing the 3.7 bundle
  baseline.
- Consider Crown SVG if Javier has the source vector.
- Thread `isFirstPost` from feed mapping to add `priority` to the first feed
  post image.
