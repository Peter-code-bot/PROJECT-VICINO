# Spec — auth-mobile

> Domain: authentication flows specific to the Android APK (Capacitor WebView).
> Web authentication is out of scope for this domain — see the web app routes directly.
> Last updated: 2026-06-01 (bootstrapped from change apk-google-oauth-custom-tab after successful deploy).

---

## Requirement: APK Google OAuth opens in a Chrome Custom Tab, not the WebView

WHEN a user taps "Continuar con Google" inside the VICINO Android APK (Capacitor WebView), the system SHALL open the Supabase-generated OAuth URL via `@capacitor/browser` (which delegates to Chrome Custom Tabs), and SHALL NOT navigate the WebView itself to `accounts.google.com`. This satisfies Google's "Use Secure Browsers" policy and avoids the `disallowed_useragent` 403.

### Scenario: Tap launches a Custom Tab on Android

- GIVEN the user is on the `/login` route inside the Android APK
- WHEN the user taps the "Continuar con Google" button
- THEN the app calls `signInWithOAuth({ skipBrowserRedirect: true })` and receives the OAuth URL
- AND the app calls `Browser.open({ url })` to open the URL in a Chrome Custom Tab
- AND the WebView itself never navigates to `accounts.google.com`

---

## Requirement: Web Google OAuth flow is unchanged

WHEN a user taps "Continuar con Google" in a real browser (any platform where `Capacitor.isNativePlatform()` returns false), the system SHALL execute the exact same `supabase.auth.signInWithOAuth({ provider, redirectTo: '<origin>/auth/callback' })` call that existed in the pre-fix codebase, with no behavioral or interface change.

### Scenario: Web flow keeps using the HTTPS callback

- GIVEN the user is on `vicinomarket.com/login` in a real browser (not the APK WebView)
- WHEN the user taps "Continuar con Google"
- THEN `Capacitor.isNativePlatform()` returns false
- AND the helper executes the web branch
- AND `redirectTo` is `https://vicinomarket.com/auth/callback` (same as before)
- AND the server-side `apps/web/app/auth/callback/route.ts` handles the post-OAuth session exchange (unchanged)

---

## Requirement: Deep link returns the APK to the app with the session code

WHEN Supabase completes the Google OAuth handshake and redirects the user to `vicino://auth/callback?code=<code>`, the system SHALL deliver the URL to the app via the Android intent-filter declared in `AndroidManifest.xml:32-38`, AND the in-app `OAuthUrlListener` component SHALL receive the URL via `App.addListener('appUrlOpen', ...)` (hot-launch) or via `App.getLaunchUrl()` (cold-launch).

### Scenario: Hot-launch deep link processes the session

- GIVEN the APK is in the background while the Custom Tab handles OAuth
- AND the user successfully authenticates and is redirected to `vicino://auth/callback?code=ABC123`
- WHEN Android delivers the URL to the app
- THEN the app comes to the foreground
- AND the `OAuthUrlListener` `useEffect` `appUrlOpen` listener fires with the URL
- AND the listener calls `supabase.auth.exchangeCodeForSession('ABC123')`
- AND on success, `Browser.close()` is called and the user is routed to `/`

### Scenario: Cold-launch deep link processes the session

- GIVEN the APK was killed while the Custom Tab was open
- AND the user authenticates and the URL `vicino://auth/callback?code=ABC123` is the cold-start intent
- WHEN the app launches
- THEN `App.getLaunchUrl()` returns `{ url: 'vicino://auth/callback?code=ABC123' }`
- AND the listener processes the URL identically to the hot-launch scenario
- AND the user is routed to `/` logged-in

### Scenario: WebView lands on /callback (Android URI parsing artifact)

- GIVEN `vicino://auth/callback` is parsed by Android as host=`auth`, path=`/callback`
- AND the WebView navigates to `https://vicinomarket.com/callback`
- THEN `apps/web/app/callback/page.tsx` catches the landing
- AND immediately redirects to `/auth/callback` forwarding any query params
- AND the `OAuthUrlListener` processes the `code` in parallel via `getLaunchUrl()` or `appUrlOpen`
- AND the user lands at `/` logged-in (the redirect to `/auth/callback` is a visual cover; the actual session exchange runs independently)

---

## Requirement: Cancelling the Custom Tab returns the user to the login screen idle

IF the user closes the Custom Tab without completing OAuth (system back, X gesture, or app switcher), THEN the `appUrlOpen` listener SHALL NOT fire, AND the login form's button SHALL be idle (no infinite loading state), AND the user SHALL be able to retry by tapping the button again.

### Scenario: User cancels the Custom Tab

- GIVEN the user tapped "Continuar con Google" and the Custom Tab is open
- WHEN the user closes the Custom Tab without authenticating
- THEN no `appUrlOpen` event fires for any `vicino://auth/callback` URL
- AND the form's loading state is already idle (because `Browser.open` resolved at launch time, not at close time)
- AND tapping "Continuar con Google" again starts a fresh flow

---

## Requirement: Listener early-returns on web platforms

WHEN `OAuthUrlListener` mounts in a non-native platform (web browser), the system SHALL early-return inside the `useEffect` and SHALL NOT register any `appUrlOpen` listener or call `getLaunchUrl()`. This guarantees zero side effects on the web build.

### Scenario: Web mount is a no-op

- GIVEN the app is running in a real browser (`Capacitor.isNativePlatform()` returns false)
- WHEN the root layout mounts `<OAuthUrlListener />`
- THEN the `useEffect` evaluates `isNativePlatform()` as false on its first line and returns
- AND no listeners are registered
- AND no Capacitor APIs are invoked

---

## Implementation notes

- Helper: `apps/web/lib/auth/native-oauth.ts` — `signInWithGoogle()` with platform branching
- Listener: `apps/web/components/auth/oauth-url-listener.tsx` — mounted in root layout, no-op on web
- WebView landing cover: `apps/web/app/callback/page.tsx` — catches `/callback`, redirects to `/auth/callback`
- APK loader: `apps/web/app/auth/callback/page.tsx` — shows spinner during session exchange
- Supabase redirect URL `vicino://auth/callback` confirmed in allowlist (Pedro, 2026-06-01)
- No Google Cloud Console changes required (Supabase reuses the existing Web Client ID)

---

## Known follow-up — MED-2 deep-link `startsWith` boundary (deferred 2026-06-03)

**Finding (CODEX Tanda A SEC/AUTH review)**:

The three consumers of the centralized constant `OAUTH_DEEP_LINK_CALLBACK = "vicino://auth/callback"` perform their match via plain `String.prototype.startsWith` with no boundary enforcement:

- `apps/web/components/capacitor-init.tsx:124` (hot-launch deferral guard)
- `apps/web/components/capacitor-init.tsx:143` (cold-launch deferral guard)
- `apps/web/components/auth/oauth-url-listener.tsx:35` (OAuth handler gate)

A malicious URL such as `vicino://auth/callbackevil?code=ATTACKER_CODE` matches the prefix and would reach the OAuth handler.

**Vector reachability**:

The Android intent-filter for the `vicino://` scheme (`apps/web/android/app/src/main/AndroidManifest.xml` lines 33-38) declares no `android:host` or `android:pathPattern`, so Android delivers any `vicino://...` URL to the app. An attacker can emit such a URL from another installed Android app, a browser/email link, an NFC tag, or a QR code. The malicious URL reaches `OAuthUrlListener` and triggers `supabase.auth.exchangeCodeForSession(attacker_code)`.

**PKCE mitigation closes the realistic exploit**:

Supabase OAuth uses PKCE. `exchangeCodeForSession` requires the `code_verifier` stored locally during `signInWithOAuth`. An attacker's `code` was not issued for this device's PKCE challenge, so the exchange fails and returns an error — no session is granted. Session steal is not achievable through this path. Code phishing has no extraction mechanism. The only residual concern is DoS spam, which requires malware already installed on the device AND is bounded by Supabase's own auth rate-limit at the server.

**Decision (2026-06-03)**: do NOT implement the boundary check now. PKCE provides the load-bearing defense; the prefix laxity is a theoretical hardening with no exploit available under the current threat model. The cost of touching the OAuth-mobile path (regression risk) exceeds the marginal ROI.

**Re-evaluate the decision if any of the following becomes true**:

- Supabase deprecates PKCE for the Capacitor flow or we migrate to a non-PKCE provider.
- The `vicino://` intent-filter is widened to additional path prefixes that another integration consumes.
- A second deep-link consumer outside the OAuth flow is added that does NOT have a PKCE-equivalent backstop.
- Telemetry shows repeated `exchangeCodeForSession` failures with patterns suggesting an attacker probing the path.

**Fix ready-to-apply if the decision is reversed**:

Add a boundary-aware helper to `apps/web/lib/auth/deep-link-constants.ts`:

```ts
/**
 * Boundary-aware matcher for the OAuth deep link. Returns true iff
 * `url` is exactly `vicino://auth/callback` OR is followed by `?`
 * (query string) or `/` (path segment). Closes the prefix ambiguity
 * where `vicino://auth/callbackevil?code=...` would otherwise match.
 */
export function isOAuthDeepLink(url: string): boolean {
  if (!url.startsWith(OAUTH_DEEP_LINK_CALLBACK)) return false;
  const suffix = url.slice(OAUTH_DEEP_LINK_CALLBACK.length);
  return suffix === "" || suffix.startsWith("?") || suffix.startsWith("/");
}
```

Then replace the three `url.startsWith(OAUTH_DEEP_LINK_CALLBACK)` call sites listed above with `isOAuthDeepLink(url)`. The constant itself stays unchanged (it remains the canonical outbound `redirectTo` value passed to `signInWithOAuth`). `apps/web/lib/auth/native-oauth.ts:26` does not need to change (equality, not a matcher).
