# Design — APK Google OAuth via Custom Tab

> Implementation of the proposal. All code paths are platform-branched: web is untouched (exact same flow as today), APK gets the Custom Tab redirect plus deep-link return.

## 1. Architecture

```
[Tap "Continuar con Google" in APK]
        |
        v
[signInWithOAuth({ provider: 'google', redirectTo: 'vicino://auth/callback', skipBrowserRedirect: true })]
        |
        v  (returns { data: { url } } without navigating)
[Browser.open({ url: data.url, presentationStyle: 'popover' })]
        |
        v
[System opens Custom Tab pointing to the Supabase-built OAuth URL on accounts.google.com]
        |
        v
[User authenticates in Chrome (real browser, Google accepts the UA)]
        |
        v
[Google redirects back to Supabase server callback; Supabase exchanges grant for session-code]
        |
        v
[Supabase redirects user agent (the Custom Tab) to redirectTo: vicino://auth/callback?code=<code>]
        |
        v
[Android delivers the URL to the intent-filter scheme="vicino" (AndroidManifest.xml:32-38) -> opens VICINO app]
        |
        v
[OAuthUrlListener mounted in the root layout receives the URL via App.addListener('appUrlOpen') or App.getLaunchUrl()]
        |
        v
[supabase.auth.exchangeCodeForSession(code) -> session stored in client cookie shared with WebView]
        |
        v
[Browser.close() + router.push('/') -> user lands home logged-in]
```

## 2. Helper: `apps/web/lib/auth/native-oauth.ts` (new file)

Centralizes the branching so `login-form.tsx` and `register-form.tsx` each call a single function.

```ts
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { createClient } from '@/lib/supabase/client';

const DEEP_LINK_CALLBACK = 'vicino://auth/callback';

export async function signInWithGoogle(): Promise<{ error?: string }> {
  const supabase = createClient();

  if (Capacitor.isNativePlatform()) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: DEEP_LINK_CALLBACK,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { error: 'Error al conectar con Google. Intenta de nuevo.' };
    if (!data?.url) return { error: 'No se pudo iniciar el flujo de Google.' };
    await Browser.open({ url: data.url, presentationStyle: 'popover' });
    return {};
  }

  // Web path: byte-identical to current code in login-form.tsx:46-51
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
    },
  });
  if (error) return { error: 'Error al conectar con Google. Intenta de nuevo.' };
  return {};
}
```

## 3. Form integration

`apps/web/app/(auth)/login/login-form.tsx:44-53` becomes:

```ts
async function handleGoogleLogin() {
  setError('');
  const result = await signInWithGoogle();
  if (result.error) setError(result.error);
}
```

`apps/web/app/(auth)/register/register-form.tsx:54-63` analogously (`handleGoogleSignup`). Net change per form: roughly 5 lines replaced.

## 4. Global URL listener: `apps/web/components/auth/oauth-url-listener.tsx` (new)

Mounted once in the root layout (`apps/web/app/layout.tsx`), wrapped as a client component. Handles both hot-launch (app already running) and cold-launch (app started by the deep link) cases.

```ts
"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { createClient } from '@/lib/supabase/client';

const DEEP_LINK_PREFIX = 'vicino://auth/callback';

export function OAuthUrlListener() {
  const router = useRouter();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let unmounted = false;
    const supabase = createClient();

    async function handleUrl(url: string) {
      if (unmounted) return;
      if (!url.startsWith(DEEP_LINK_PREFIX)) return;

      const parsed = new URL(url);
      const code = parsed.searchParams.get('code');
      if (!code) return;

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      await Browser.close().catch(() => {});
      if (error) {
        router.push('/login?error=auth_callback_failed');
        return;
      }
      router.push('/');
      router.refresh();
    }

    // Cold-launch: app was started BY the deep link
    App.getLaunchUrl().then((res) => {
      if (res?.url) void handleUrl(res.url);
    });

    // Hot-launch: app was already running
    const subPromise = App.addListener('appUrlOpen', (event) => {
      void handleUrl(event.url);
    });

    return () => {
      unmounted = true;
      void subPromise.then((s) => s.remove());
    };
  }, [router]);

  return null;
}
```

## 5. Root layout mount

`apps/web/app/layout.tsx` gets `<OAuthUrlListener />` inside `<body>`. The component is idempotent across web (`isNativePlatform()` returns false, the effect early-returns) and APK (the effect registers the listener).

## 6. Why `presentationStyle: 'popover'`

On Android, `'popover'` renders the Custom Tab as a full-screen Chrome instance with a visible close affordance, so the user understands they are in a browser and can dismiss cleanly. The alternative `'fullscreen'` removes the affordance and confuses users on cancellation. iOS is irrelevant for this change.

## 7. Cancellation handling

The `Browser.open(...)` call resolves as soon as the Custom Tab is launched, not when it is closed. So `signInWithGoogle()` returns immediately after launch. The form's loading state (if any) is therefore brief.

If the user dismisses the Custom Tab without completing OAuth:

- The `appUrlOpen` listener never fires.
- The user returns to the login screen visually unchanged from when they tapped the button.
- They can tap "Continuar con Google" again to retry.

No explicit cancellation event handling is needed. The `Browser.addListener('browserFinished', ...)` API exists but is not required because the form state is already idle by the time the Tab opens.

## 8. Web path is byte-identical to today

The `else` branch in `signInWithGoogle()` is the exact same `supabase.auth.signInWithOAuth(...)` call from the current `login-form.tsx:46-51`, with the same `redirectTo: ${window.location.origin}/auth/callback`. The web callback `apps/web/app/auth/callback/route.ts` is untouched. Zero risk to the web flow.

## 9. Supabase Auth configuration (Pedro, already done)

Confirmed by Pedro on 2026-06-01: `vicino://auth/callback` added to Supabase Auth, URL Configuration, Redirect URLs allowlist. Total URLs in the allowlist after the change: 9. Supabase accepts the custom scheme.

The web `https://vicinomarket.com/auth/callback` URLs remain in the same allowlist, so the web flow is undisturbed.

## 10. Google Cloud Console (NOT touched)

Google sees only Supabase's callback URL (a `*.supabase.co` host), which is already configured in the existing OAuth 2.0 Web Client ID. Supabase intercepts the Google handshake, exchanges the grant code, and then redirects the user agent to whatever `redirectTo` we passed (`vicino://auth/callback` or `https://vicinomarket.com/auth/callback`). Google does not validate the post-Supabase redirect, so no Android Client ID is needed.

No SHA-1 fingerprints, no `google-services.json`, no Gradle plugin changes.

## 11. Manifest unchanged

The existing `vicino://` intent-filter (`apps/web/android/app/src/main/AndroidManifest.xml:32-38`) already declares the scheme and the BROWSABLE category needed to receive deep links from external apps (including Chrome Custom Tabs). Verified inline. No manifest edits.

## 12. Branch strategy (signed by orchestrator on 2026-06-01)

- This spec (proposal, design, tasks, spec delta) lives on `feat/openspec-2026-06-bootstrap` as a documentation commit (the branch where `openspec/` exists). Not pushed.
- The implementation code lives on a separate branch `fix/apk-google-oauth` cut from `origin/master` (after pulling Javier's recent commits). Not pushed.
- Neither branch reaches production until Pedro decides post-runtime-verification.
- The orchestrator's decision to keep these on separate branches is documented in the previous plan file content; it explicitly rejects the "merge bootstrap to master first" option because the OAuth fix is the unblocker for closed testing and should not be coupled to the SDD merge.
