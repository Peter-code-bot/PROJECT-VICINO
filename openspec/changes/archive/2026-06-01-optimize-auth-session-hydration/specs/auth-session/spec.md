# Spec — auth-session (delta)

> Domain: server-side session hydration and post-OAuth navigation for the VICINO web app and APK.
> This is a DELTA spec — it defines new requirements introduced by change
> `2026-06-01-optimize-auth-session-hydration`. It will be merged into a canonical
> `openspec/specs/auth-session/spec.md` after the change archives.
> Last updated: 2026-06-01

---

## Context: middleware is already active in Next.js 16

`apps/web/proxy.ts` is the active Next.js middleware (renamed from `middleware.ts` in
Next.js 16). It runs `updateSession` on every matched request and refreshes the Supabase
session cookie at the edge. This is NOT a new requirement — it is the baseline state
that the rest of this spec assumes.

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

## Requirement: Marketplace layout runs DB queries in parallel

WHEN the marketplace layout (`apps/web/app/(marketplace)/layout.tsx`) renders with
an authenticated user, the system SHALL fetch the user profile, roles, notification
count, and chat counts in a single `Promise.all` after resolving the user identity.
The system SHALL NOT execute these queries sequentially.

### Scenario: Authenticated layout renders with parallelized queries

- GIVEN a user with an active session navigates to any marketplace route
- WHEN `MarketplaceLayout` renders on the server
- THEN `supabase.auth.getUser()` resolves first (sequential — needed for userId)
- AND `profiles`, `user_roles`, `notifications`, `chats (comprador)`, and
  `chats (vendedor)` queries all execute concurrently via `Promise.all`
- AND the layout renders when all 5 queries resolve (time = slowest single query)

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

### Scenario: Error redirect is not cached

- GIVEN the code is missing or invalid
- WHEN the callback route falls through to the error path
- THEN the redirect to `/login?error=auth_callback_failed` also has status `303`
- AND `Cache-Control: private, no-store` is present

---

## Implementation notes

- `apps/web/proxy.ts` — active middleware in Next.js 16 (NOT modified by this change)
- `apps/web/components/auth/oauth-url-listener.tsx:71-72` — replaced with `window.location.replace("/")`
- `apps/web/app/(marketplace)/layout.tsx` — `Promise.all` for 5 DB queries (getUser sequential)
- `apps/web/app/auth/callback-server/route.ts` — status 303 + `Cache-Control: private, no-store`
- F1 (middleware activation): CANCELLED — proxy.ts is the Next.js 16 entry point
- F5 (getClaims migration): DEFERRED — requires asymmetric JWT in Supabase Dashboard
