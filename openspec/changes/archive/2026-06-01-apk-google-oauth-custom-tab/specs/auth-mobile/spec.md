# Spec delta — auth-mobile

## ADDED Requirements

### Requirement: APK Google OAuth opens in a Chrome Custom Tab, not the WebView

WHEN a user taps "Continuar con Google" inside the VICINO Android APK (Capacitor WebView), the system SHALL open the Supabase-generated OAuth URL via `@capacitor/browser` (which delegates to Chrome Custom Tabs), and SHALL NOT navigate the WebView itself to `accounts.google.com`. This satisfies Google's "Use Secure Browsers" policy and avoids the `disallowed_useragent` 403.

#### Scenario: Tap launches a Custom Tab on Android

- GIVEN the user is on the `/login` route inside the Android APK
- WHEN the user taps the "Continuar con Google" button
- THEN the app calls `signInWithOAuth({ skipBrowserRedirect: true })` and receives the OAuth URL
- AND the app calls `Browser.open({ url })` to open the URL in a Chrome Custom Tab
- AND the WebView itself never navigates to `accounts.google.com`

### Requirement: Web Google OAuth flow is unchanged

WHEN a user taps "Continuar con Google" in a real browser (any platform where `Capacitor.isNativePlatform()` returns false), the system SHALL execute the exact same `supabase.auth.signInWithOAuth({ provider, redirectTo: '<origin>/auth/callback' })` call that existed in the pre-fix codebase, with no behavioral or interface change.

#### Scenario: Web flow keeps using the HTTPS callback

- GIVEN the user is on `vicinomarket.com/login` in a real browser (not the APK WebView)
- WHEN the user taps "Continuar con Google"
- THEN `Capacitor.isNativePlatform()` returns false
- AND the helper executes the web branch
- AND `redirectTo` is `https://vicinomarket.com/auth/callback` (same as before)
- AND the server-side `apps/web/app/auth/callback/route.ts` handles the post-OAuth session exchange (unchanged)

### Requirement: Deep link returns the APK to the app with the session code

WHEN Supabase completes the Google OAuth handshake and redirects the user to `vicino://auth/callback?code=<code>`, the system SHALL deliver the URL to the app via the Android intent-filter declared in `AndroidManifest.xml:32-38`, AND the in-app `OAuthUrlListener` component SHALL receive the URL via `App.addListener('appUrlOpen', ...)` (hot-launch) or via `App.getLaunchUrl()` (cold-launch).

#### Scenario: Hot-launch deep link processes the session

- GIVEN the APK is in the background while the Custom Tab handles OAuth
- AND the user successfully authenticates and is redirected to `vicino://auth/callback?code=ABC123`
- WHEN Android delivers the URL to the app
- THEN the app comes to the foreground
- AND the `OAuthUrlListener` `useEffect` `appUrlOpen` listener fires with the URL
- AND the listener calls `supabase.auth.exchangeCodeForSession('ABC123')`
- AND on success, `Browser.close()` is called and the user is routed to `/`

#### Scenario: Cold-launch deep link processes the session

- GIVEN the APK was killed while the Custom Tab was open
- AND the user authenticates and the URL `vicino://auth/callback?code=ABC123` is the cold-start intent
- WHEN the app launches
- THEN `App.getLaunchUrl()` returns `{ url: 'vicino://auth/callback?code=ABC123' }`
- AND the listener processes the URL identically to the hot-launch scenario
- AND the user is routed to `/` logged-in

### Requirement: Cancelling the Custom Tab returns the user to the login screen idle

IF the user closes the Custom Tab without completing OAuth (system back, X gesture, or app switcher), THEN the `appUrlOpen` listener SHALL NOT fire, AND the login form's button SHALL be idle (no infinite loading state), AND the user SHALL be able to retry by tapping the button again.

#### Scenario: User cancels the Custom Tab

- GIVEN the user tapped "Continuar con Google" and the Custom Tab is open
- WHEN the user closes the Custom Tab without authenticating
- THEN no `appUrlOpen` event fires for any `vicino://auth/callback` URL
- AND the form's loading state is already idle (because `Browser.open` resolved at launch time, not at close time)
- AND tapping "Continuar con Google" again starts a fresh flow

### Requirement: Listener early-returns on web platforms

WHEN `OAuthUrlListener` mounts in a non-native platform (web browser), the system SHALL early-return inside the `useEffect` and SHALL NOT register any `appUrlOpen` listener or call `getLaunchUrl()`. This guarantees zero side effects on the web build.

#### Scenario: Web mount is a no-op

- GIVEN the app is running in a real browser (`Capacitor.isNativePlatform()` returns false)
- WHEN the root layout mounts `<OAuthUrlListener />`
- THEN the `useEffect` evaluates `isNativePlatform()` as false on its first line and returns
- AND no listeners are registered
- AND no Capacitor APIs are invoked
