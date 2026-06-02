# Spec — auth-session

> Domain: server-side session hydration, middleware session refresh, and post-OAuth
> navigation for the VICINO web app and APK.
> Last updated: 2026-06-02 (bootstrapped from change optimize-auth-session-hydration after verified deploy).

---

## Context: middleware is the active Next.js 16 entry point

`apps/web/proxy.ts` is the active Next.js middleware (renamed from `middleware.ts` in
Next.js 16). It runs `updateSession` on every matched request and refreshes the Supabase
session cookie at the edge. The matcher excludes `_next/static`, `_next/image`,
`favicon.ico`, and image files. `apps/web/middleware.ts` MUST NOT exist — its presence
produces the build error `Both middleware file "./middleware.ts" and proxy file "./proxy.ts"
are detected. Please use "./proxy.ts" only.`

---

## Requirement: Post-OAuth navigation is atomic — no guest flash

WHEN `OAuthUrlListener` successfully exchanges the PKCE code for a Supabase session,
the system SHALL navigate the user to `/` via a full HTTP navigation (`window.location.replace`),
ensuring the authenticated session cookie is included in the first GET request to the
destination. The system SHALL NOT use client-side router navigation followed by an
asynchronous cache invalidation, as this creates a visible guest-state flash.

### Scenario: APK OAuth completes with no flash

- GIVEN the user completed Google OAuth via Custom Tab in the APK
- AND `exchangeCodeForSession(code)` succeeded
- WHEN `OAuthUrlListener` handles the `appUrlOpen` event
- THEN `window.location.replace("/")` executes
- AND the browser sends GET / with the new session cookie
- AND the authenticated home screen is the first frame the user sees

### Scenario: Error param in deep link routes to login

- GIVEN Supabase redirects back with `?error=access_denied`
- WHEN `OAuthUrlListener` handles the `appUrlOpen` event
- THEN the listener calls `Browser.close()` and navigates to `/login?error=access_denied`
- AND the home screen is never shown

---

## Requirement: CapacitorInit yields OAuth callback URLs to OAuthUrlListener

WHEN a deep link URL starts with `vicino://auth/callback`, the global Capacitor deep-link
handler in `apps/web/components/capacitor-init.tsx` SHALL early-return without navigating
the WebView. OAuth callback URLs are owned exclusively by `OAuthUrlListener` to avoid a
race that strips the `?code=` query parameter via a competing `window.location.href`
navigation. This guard applies to both the hot-launch (`appUrlOpen` event) and cold-launch
(`getLaunchUrl`) paths.

### Scenario: CapacitorInit skips OAuth callbacks (hot-launch)

- GIVEN the APK is running when Android delivers `vicino://auth/callback?code=ABC123`
- WHEN both `CapacitorInit` and `OAuthUrlListener` receive the `appUrlOpen` event
- THEN `CapacitorInit`'s handler matches `url.startsWith("vicino://auth/callback")` and returns early
- AND `OAuthUrlListener`'s handler processes the URL and exchanges the code

### Scenario: CapacitorInit skips OAuth callbacks (cold-launch)

- GIVEN the APK is cold-started by `vicino://auth/callback?code=ABC123`
- WHEN `CapacitorInit` reads `App.getLaunchUrl()`
- THEN it observes `launchUrl.url` starts with `vicino://auth/callback` and skips the navigation
- AND `OAuthUrlListener`'s `App.getLaunchUrl()` call processes the same URL

### Scenario: Non-OAuth deep links are unaffected

- GIVEN the APK receives `vicino://product/123` or `https://vicinomarket.com/rankings`
- WHEN `CapacitorInit` handles the event
- THEN the guard does not match and the existing `window.location.href = path` navigation executes

---

## Requirement: Marketplace layout runs DB queries in parallel with fault isolation

WHEN the marketplace layout (`apps/web/app/(marketplace)/layout.tsx`) renders with
an authenticated user, the system SHALL fetch the user profile, roles, notification
count, and chat counts (buyer and seller) concurrently via `Promise.allSettled` after
resolving the user identity. The system SHALL NOT execute these queries sequentially,
and SHALL NOT use `Promise.all` because a single failed query would crash the entire
layout — instead, each result is coalesced to a safe default (`null` / `0`) on rejection.

### Scenario: Authenticated layout renders with parallelized queries

- GIVEN a user with an active session navigates to any marketplace route
- WHEN `MarketplaceLayout` renders on the server
- THEN `supabase.auth.getUser()` resolves first (sequential — needed for userId)
- AND `profiles`, `user_roles`, `notifications`, `chats (comprador)`, and
  `chats (vendedor)` queries all execute concurrently via `Promise.allSettled`
- AND the layout renders when all 5 results settle

### Scenario: Single query failure does not crash the layout

- GIVEN one of the 5 parallel queries rejects (e.g., network blip)
- WHEN `Promise.allSettled` returns
- THEN the failing entry has `status === "rejected"`
- AND the corresponding field falls back to its safe default (`null` for profile, `false` for isAdmin, `0` for counts)
- AND the layout renders successfully with degraded but functional state

---

## Requirement: Auth callback response is not cached

WHEN `apps/web/app/auth/callback-server/route.ts` processes a PKCE code and redirects
the user, the HTTP response SHALL include `Cache-Control: private, no-store` and SHALL
use status `303 See Other`. The PKCE code is single-use; caching the redirect response
would cause subsequent navigations to fail with an already-consumed code.

### Scenario: Successful OAuth redirect is not cached

- GIVEN Supabase delivers a valid `code` to `/auth/callback-server`
- WHEN `exchangeCodeForSession(code)` succeeds
- THEN the redirect response has status `303`
- AND the response header `Cache-Control: private, no-store` is present
- AND Vercel CDN and browsers do not cache the response
- AND the `Set-Cookie` header for the Supabase session is delivered alongside (unaffected by Cache-Control)

### Scenario: Error redirect is not cached

- GIVEN the code is missing or invalid
- WHEN the callback route falls through to the error path
- THEN the redirect to `/login?error=auth_callback_failed` also has status `303`
- AND `Cache-Control: private, no-store` is present

---

## Implementation notes

- `apps/web/proxy.ts` — active middleware in Next.js 16 (do NOT create middleware.ts)
- `apps/web/components/auth/oauth-url-listener.tsx` — calls `window.location.replace("/")` on success; `useRouter` retained for the two error paths (`/login?error=...`)
- `apps/web/components/capacitor-init.tsx` — guards OAuth callback URLs with `OAUTH_CALLBACK_PREFIX = "vicino://auth/callback"` on both hot- and cold-launch paths
- `apps/web/app/(marketplace)/layout.tsx` — `Promise.allSettled` over 5 DB queries; per-result coalescing with `status === "fulfilled"` checks
- `apps/web/app/auth/callback-server/route.ts` — `NO_CACHE_REDIRECT_INIT` constant: `{ status: 303 as const, headers: { "Cache-Control": "private, no-store" } }`, applied to both success and error redirects
- F5 (getClaims migration): deferred — requires asymmetric JWT (RS256) in Supabase Dashboard

## Known follow-ups (out of scope for this domain initially)

- `forgot-password/page.tsx:18` uses `/auth/callback` (loader page, no route handler) instead of `/auth/callback-server` — password reset silently fails on web
- `capacitor-init.tsx` `App.addListener` handles are never removed on unmount — accumulates listeners under HMR/StrictMode
- `proxy.ts:24` rate-limits `/auth/callback` but web flows now target `/auth/callback-server`
- DRY: string `"vicino://auth/callback"` duplicated in `capacitor-init.tsx`, `oauth-url-listener.tsx`, `native-oauth.ts`
