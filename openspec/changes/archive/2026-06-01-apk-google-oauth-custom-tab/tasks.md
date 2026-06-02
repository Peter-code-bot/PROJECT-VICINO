# Tasks — APK Google OAuth via Custom Tab

> Checklist for `/opsx:apply` (or for the manual execution session signed by Pedro on 2026-06-01). Every task links the concrete file affected.
> Tasks T-00 through T-08 are implementation (CC). Tasks V-1 through V-10 are verification. Tasks H-1, H-2 are handoff to Pedro for manual recompile and device test.

## Pre-flight

- [ ] **T-00 · Branch setup** — `git checkout master && git pull --rebase origin master && git checkout -b fix/apk-google-oauth`. Confirm starting commit is `origin/master` HEAD (`ae56827` at time of writing, may have advanced).

## Implementation (CC, on `fix/apk-google-oauth`)

- [ ] **T-01 · Install `@capacitor/browser`** — `pnpm --filter=web add @capacitor/browser@^8.0.0` (match Capacitor 8.x major already in use). Files touched: `apps/web/package.json`, `pnpm-lock.yaml`.
- [ ] **T-02 · Create the OAuth helper** — new file `apps/web/lib/auth/native-oauth.ts` with `signInWithGoogle()` per `design.md` section 2.
- [ ] **T-03 · Refactor `login-form.tsx`** — replace `handleGoogleLogin` body (`apps/web/app/(auth)/login/login-form.tsx:44-53`) with a call to `signInWithGoogle()`. Net diff: roughly 5 lines.
- [ ] **T-04 · Refactor `register-form.tsx`** — replace `handleGoogleSignup` body (`apps/web/app/(auth)/register/register-form.tsx:54-63`) with a call to `signInWithGoogle()`. Net diff: roughly 5 lines.
- [ ] **T-05 · Create the global URL listener** — new file `apps/web/components/auth/oauth-url-listener.tsx` per `design.md` section 4. Client component, no-op on web (early return).
- [ ] **T-06 · Mount the listener in root layout** — edit `apps/web/app/layout.tsx`, import `<OAuthUrlListener />`, render inside `<body>`. Idempotent for web due to the early return inside the effect.
- [ ] **T-07 · Run `cap sync android`** — from `apps/web/`. Expect no new gradle warnings (the only new plugin is `@capacitor/browser`, which has no Android-side gradle config beyond what `cap sync` auto-handles).
- [ ] **T-08 · CODEX Adversarial Review Loop** — per `CLAUDE.md` REGLA AUTOMATICA DE CALIDAD. Auth is in the maximum-priority area list of CLAUDE.md, so this loop is non-negotiable. Up to 3 iterations, all critical issues resolved in-loop, final structured report.

## Validation, static (CC)

- [ ] **V-1 · `pnpm build` from monorepo root** — green (Leccion institucional 1). Type-check passes for the new helper, listener, and form refactors.
- [ ] **V-2 · grep audit** — `grep -nE "signInWithOAuth.*google" apps/web/app/(auth)/`: should return only references inside `native-oauth.ts` (the helper). The forms should NOT call `signInWithOAuth` directly anymore.
- [ ] **V-3 · `cap sync android` log clean** — no new plugin errors. The new `@capacitor/browser` plugin appears in the detected plugins list.
- [ ] **V-4 · Static review of the listener** — confirm `Capacitor.isNativePlatform()` early-return at the top of the effect; confirm `getLaunchUrl()` is awaited before `addListener`; confirm the `unmounted` flag prevents stale closures.

## Commit, no push

- [ ] **T-09 · Commit** — explicit `git add` of: `apps/web/package.json`, `pnpm-lock.yaml`, `apps/web/lib/auth/native-oauth.ts`, `apps/web/app/(auth)/login/login-form.tsx`, `apps/web/app/(auth)/register/register-form.tsx`, `apps/web/components/auth/oauth-url-listener.tsx`, `apps/web/app/layout.tsx`. Exclude PWA artifacts, untracked dotfolders, `keystore.properties`, `.env*`. ASCII-safe commit message: `fix(auth): use custom tab for google oauth in apk webview (close 403 disallowed_useragent)`.
- [ ] **T-10 · Push gate** — Pedro decides timing of push to `origin/fix/apk-google-oauth`. NO push without explicit firma post-V verification.

## Handoff to Pedro (manual)

- [ ] **H-1 · Recompile debug APK** — Pedro in Android Studio: Build, Build APK(s). Install on device (`adb install -r app-debug.apk` or transfer).
- [ ] **H-2 · Runtime device test** — execute the V-5 through V-7 scenarios below on a real Android device.

## Runtime verification (Pedro on device + smoke checks)

- [ ] **V-5 · Happy path on APK** — tap "Continuar con Google", Custom Tab opens, user picks Google account, user lands logged-in at `/` within 30 seconds. Cookie inspector shows Supabase session active.
- [ ] **V-6 · Cancellation does not stick** — tap "Continuar con Google", close Custom Tab via system back without picking an account, user returns to login screen, button is idle, can tap again successfully.
- [ ] **V-7 · Cold-launch deep link** — start OAuth flow, kill the app via recent-apps while Custom Tab is open, complete OAuth, allow the deep link to cold-start the app. App launches and lands logged-in (deep link processed via `App.getLaunchUrl()`).
- [ ] **V-8 · Web regression smoke** — open `https://vicinomarket.com` in desktop Chrome (real browser), tap "Continuar con Google", complete OAuth, land at `/` logged-in. Same flow on mobile Chrome (real browser, not the WebView).
- [ ] **V-9 · Email and password unaffected** — both web and APK can still log in with email and password (separate code path, but smoke verify).
- [ ] **V-10 · Sentry observation 24h post-deploy** — no spike of errors with tags `auth.callback`, `oauth`, `deep-link`. The `pivot_primary_fallback` tag from category specs is unaffected (orthogonal).

## Closing

- [ ] **T-11 · `/opsx:archive`** — after V-5 through V-10 verde on device plus 24h Sentry clean, archive this change. Deltas in `specs/auth-mobile/spec.md` merge into `openspec/specs/auth-mobile/spec.md` (new file under the new domain), and the folder moves to `openspec/changes/archive/2026-06-01-apk-google-oauth-custom-tab/`.
