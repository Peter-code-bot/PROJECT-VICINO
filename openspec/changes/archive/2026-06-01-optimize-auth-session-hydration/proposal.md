# Proposal — Optimize Auth Session Hydration

## Why

After Google OAuth completes in the APK (via the Custom Tab + deep link flow shipped in
`apk-google-oauth-custom-tab`), the `OAuthUrlListener` calls:

```ts
router.push("/");     // navigates immediately — may serve stale unauthenticated cache
router.refresh();     // invalidates server cache — starts AFTER push resolves
```

The user sees the unauthenticated (guest) home screen for the duration of the
`router.refresh()` cycle: 3-5 seconds. This is the "flash de invitado". It also appears
on web after OAuth redirects through `/auth/callback-server/route.ts`.

Root cause: `router.push` completes before the server re-renders with the authenticated
session, and `router.refresh` fires asynchronously after. The gap is the flash window.

Two structural issues amplify the gap:

1. **`(marketplace)/layout.tsx` makes 6 sequential network calls.** After `getUser()`,
   five more database queries run in series (profiles, user_roles, notifications, buyer
   chats, seller chats). Total estimated: 450-1450 ms. These are all independent of each
   other (they only depend on `user.id`) and can be parallelized.

2. **The callback route lacks cache headers.** `apps/web/app/auth/callback-server/route.ts`
   redirects without `Cache-Control: private, no-store` and uses status 307 instead of 303.
   Browsers and Vercel CDN can cache the OAuth redirect response with a consumed `code`
   query parameter, causing subsequent retries to fail.

### Note on middleware (correction from initial audit)

An initial audit hypothesized that `apps/web/proxy.ts` was dead code (because Next.js
historically required `middleware.ts`). **This was wrong.** Next.js 16 renamed the
middleware entry point to `proxy.ts` (see the Next.js 16 docs: "middleware to proxy").
`proxy.ts` IS the active middleware in this codebase — it runs `updateSession` on every
matched request, so the session cookie is already being refreshed at the edge.

Build verification: creating a parallel `middleware.ts` produces the error
`Both middleware file "./middleware.ts" and proxy file "./proxy.ts" are detected.
Please use "./proxy.ts" only.` — confirming proxy.ts is active.

Implication: the flash is caused by F2 (router navigation pattern) + F3 (6 sequential
awaits) + F4 (cache headers) alone, not amplified by a stale session cookie. The
expected magnitude of improvement may be smaller than the original 3-5 s estimate,
but the underlying inefficiencies still merit the fix.

## What

Three targeted fixes:

- **F2**: Replace `router.push("/"); router.refresh()` in `OAuthUrlListener` with
  `window.location.replace("/")`. Hard navigation sends the new session cookie in the
  same request, server responds with authenticated state — no flash window.
- **F3**: Parallelize the 5 DB queries in `(marketplace)/layout.tsx` using `Promise.all`.
  `getUser()` stays sequential (needed for `userId`); the 5 DB calls run concurrently.
- **F4**: Add `Cache-Control: private, no-store` and status `303` to
  `apps/web/app/auth/callback-server/route.ts`.

## Scope

### IN

- `apps/web/components/auth/oauth-url-listener.tsx:71-72` (2 lines replaced)
- `apps/web/app/(marketplace)/layout.tsx:26-58` (sequential awaits -> Promise.all)
- `apps/web/app/auth/callback-server/route.ts` (status 303, Cache-Control header)

### OUT

- F1 (middleware activation): CANCELLED — `proxy.ts` is already the active middleware in
  Next.js 16. Creating `middleware.ts` produces a build error.
- F5 (getClaims migration): deferred until Pedro activates asymmetric JWT in Supabase
  Dashboard. Not in this change.
- `apps/web/proxy.ts`: NOT modified. It is correct as written and already active.
- Web Google OAuth flow (login-form.tsx, register-form.tsx): NOT touched. The flash fix
  is in the listener that runs post-OAuth, not in the OAuth initiation.
- APK deep-link infrastructure (AndroidManifest, callback/page.tsx): NOT touched.
- Supabase migrations / RLS / Edge Functions: NOT touched (see change A2 for RLS).
- Google Cloud Console, Supabase Dashboard: NO manual steps for A1.

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Approves plan, verifies flash gone post-deploy on APK and web |
| Implementation | Claude Code | Implements F2-F4, runs pnpm build between each, requests CODEX review before push |

## Success criteria (objective, measurable)

1. **Flash eliminated in APK**: tap "Continuar con Google" in debug APK, complete OAuth.
   The home screen appears already authenticated — no guest state visible at any point.
2. **Flash eliminated on web**: complete Google OAuth on `vicinomarket.com` in Chrome.
   Redirect from `/auth/callback-server` lands directly at authenticated home.
3. **Layout response time reduced**: server response for `GET /` with an active session
   takes measurably less time (Vercel Function logs show shorter duration for the
   marketplace layout route).
4. **No regression**: email+password login, product listings, chat, notifications,
   and seller flows all work identically after the change.

## References

- `apps/web/proxy.ts` — active middleware (Next.js 16 convention, NOT dead code)
- `apps/web/components/auth/oauth-url-listener.tsx:71-72` — current flash source
- `apps/web/app/(marketplace)/layout.tsx:15-58` — 6 sequential awaits confirmed
- `apps/web/app/auth/callback-server/route.ts:24` — redirect without Cache-Control
- `apps/web/lib/supabase/middleware.ts` — `updateSession` used by proxy.ts
- Next.js 16 docs: middleware to proxy migration
