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
