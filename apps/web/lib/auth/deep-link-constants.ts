/**
 * Single source of truth for the OAuth deep-link scheme used by the
 * Capacitor APK. Supabase Auth is configured (in the Dashboard
 * allowlist, confirmed 2026-06-01) to redirect to this exact URL after
 * Google OAuth completes; Android's intent-filter for vicino://auth/*
 * delivers it back to the app.
 *
 * Three consumers share this constant:
 *
 *   1. lib/auth/native-oauth.ts -- passes the value verbatim as the
 *      `redirectTo` option to supabase.auth.signInWithOAuth (equality
 *      semantics: the URL Supabase emits matches exactly).
 *
 *   2. components/capacitor-init.tsx -- uses the value as a PREFIX
 *      against incoming deep-link URLs (startsWith). The actual
 *      delivered URL is `vicino://auth/callback?code=...`, so prefix
 *      matching against `vicino://auth/callback` correctly matches.
 *      This is the global Capacitor deep-link listener which DEFER s
 *      OAuth callback URLs to consumer 3 (OAuthUrlListener) to avoid
 *      a race that strips the ?code= query string.
 *
 *   3. components/auth/oauth-url-listener.tsx -- same prefix semantics
 *      (startsWith). This is the OAuth-owned listener that actually
 *      processes the code via exchangeCodeForSession.
 *
 * Because every consumer either uses the value verbatim or as a prefix
 * (and the literal value contains no query string), centralizing the
 * three previously-duplicated local constants here is a pure dedup --
 * no semantic change.
 *
 * See `openspec/specs/auth-session/spec.md` line 144 (pre-dedup TODO)
 * and `openspec/specs/auth-mobile/spec.md` for the broader deep-link
 * contract.
 */
export const OAUTH_DEEP_LINK_CALLBACK = "vicino://auth/callback";

/**
 * Internal deep-link prefix used by the iOS FCM push-token bridge ("Plan C").
 * The native AppDelegate fetches the Firebase token and injects it into
 * Capacitor's openURL pipeline as `vicino://fcm-token/<token>`. Two consumers
 * use this as a PREFIX (startsWith):
 *
 *   1. hooks/usePushNotifications.ts -- its `appUrlOpen` listener detects this
 *      prefix, extracts the verbatim token (split on the prefix) and persists it.
 *
 *   2. components/capacitor-init.tsx -- the GLOBAL `appUrlOpen` handler must
 *      SKIP this prefix; otherwise it would parse the URL and navigate to
 *      `/<token>` (window.location.href), breaking the app on every token.
 *      Mirrors the existing OAUTH_DEEP_LINK_CALLBACK guard.
 */
export const FCM_TOKEN_DEEP_LINK_PREFIX = "vicino://fcm-token/";
