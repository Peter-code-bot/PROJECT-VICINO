# Proposal — APK Google OAuth via Custom Tab

## Why

The VICINO APK (Capacitor shell loading `https://vicinomarket.com` in a WebView) cannot complete Google OAuth: Google returns `Error 403: disallowed_useragent` because its "Use Secure Browsers" policy blocks OAuth flows initiated from embedded WebViews. Confirmed in device on 2026-06-01 against the debug APK compiled post E-bis-1.

The web flow in real browsers (Chrome, Safari, etc.) is unaffected. The block is server-side at `accounts.google.com` based on the User-Agent of the request originator. Whitelisting `accounts.google.com` in `capacitor.config.ts:18` does not help because the policy is enforced on Google's side after navigation, not by Capacitor.

Without this fix, the APK can only log users in via email and password, which (a) breaks the "Continuar con Google" UI promise visible on `/login` and `/register`, (b) reduces conversion in Android closed testing where Google login is the expected default, and (c) blocks the Play Console closed-testing milestone.

## What

Open the Google OAuth flow in a Chrome Custom Tab (a system browser, which Google accepts) instead of the WebView, and return to the app via a `vicino://auth/callback?code=...` deep link. The deep link is captured by an in-app listener that exchanges the code for a Supabase session and navigates the user home.

## Scope

### IN

- New dependency `@capacitor/browser` (official Capacitor plugin, v8.x compatible).
- Platform branching via `Capacitor.isNativePlatform()` in the Google sign-in flow: APK uses Custom Tab plus deep link; web uses the existing `signInWithOAuth` flow unchanged.
- A single global URL listener mounted in the root app layout that captures `vicino://auth/callback?code=...` and completes the session via `exchangeCodeForSession`.
- Reuse of the existing `vicino://` intent-filter in `AndroidManifest.xml` (no manifest changes).

### OUT

- The web Google login flow (not touched; the `else` branch is byte-identical to today's code in `login-form.tsx:46-51`).
- The Supabase server-side callback route `apps/web/app/auth/callback/route.ts` (only used by the web path; APK callback is fully client-side via the deep link listener).
- The native Google Sign-In plugin (`@codetrix-studio/capacitor-google-auth`, Camino 1 in the diagnostic). Deferred. Re-evaluate post-beta if UX feedback requests the native account picker.
- Changes to Google Cloud Console. Camino 2 reuses the existing Supabase Web Client ID; Google only sees the Supabase callback URL.
- iOS (out of scope of this monorepo today).

## Stakeholders

| Role | Person | Responsibility for this change |
|---|---|---|
| Founder, sole deployer | Pedro | Approves the spec, has already added `vicino://auth/callback` to Supabase Auth Redirect URLs allowlist (confirmed: 9 URLs total), recompiles the APK debug, runs runtime verification on device |
| Implementation | Claude Code | Implements branching, helper, listener, runs `pnpm build` and `cap sync android`, runs the CODEX Adversarial Review Loop (auth is in the maximum-priority area list from CLAUDE.md) |
| Branding | Alejandro | No participation in this change |

## Success criteria (objective, measurable)

1. **OAuth completes in APK debug**: tapping "Continuar con Google" in the recompiled debug APK opens a Chrome Custom Tab, the user authenticates against Google, and lands logged-in at `/` within 30 seconds end-to-end.
2. **Web flow unchanged**: the same tap on `vicinomarket.com` in a desktop Chrome or mobile Chrome (real browser) follows the exact same code path it does today, completes via `/auth/callback`, and reaches `/` logged-in.
3. **Cancellation does not stick**: closing the Custom Tab (system back, X, swipe) returns the user to the login screen with the button in an idle state, ready for a retry. No infinite loading.
4. **Cold-start deep link works**: killing the app via recent-apps while the Custom Tab is open, completing OAuth, returning — the cold-start of the app receives the deep link via `App.getLaunchUrl()` and completes the session.
5. **No regression to email and password**: the existing email and password sign-in form continues to work for both web and APK (separate code path; smoke verified).

## References

- Diagnostic plan 2026-06-01 (`C:\Users\pedro\.claude\plans\redise-o-p-gina-lazy-flame.md` previous content): D1-D5 mapping with archivo:line.
- `apps/web/capacitor.config.ts:11` (WebView loads live URL).
- `apps/web/android/app/src/main/AndroidManifest.xml:32-38` (existing `vicino://` intent-filter).
- Supabase Auth Redirect URLs allowlist: `vicino://auth/callback` confirmed added by Pedro on 2026-06-01.
