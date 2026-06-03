# Proposal — Sentry Bundle Trim (drop replayIntegration)

> Status: FASE 1 draft (spec only; implementation deferred until
> feat/perf-quickwins is merged)
> Capability: observability (new)
> Branch (when FASE 2 starts): feat/sentry-bundle-trim
> Master baseline: 57bafb3 (or whatever lands after perf-quickwins)
> Owner: Pedro

---

## Problem

The shared client bundle that loads on every VICINO page is dominated
by `@sentry/nextjs` and its integrations. The post-A5 audit measured:

- `8228-*.js` (in `rootMainFiles` per `.next/build-manifest.json`):
  908 KB raw / 272 KB gzip — Sentry + Supabase signatures.
- Sentry surface area in the analyzer report: 3671 module mentions
  (3x the next contender, `recharts`, at 1124 mentions).

The single heaviest piece of the Sentry SDK on the client is the
**Session Replay** module loaded by `replayIntegration`:

```ts
// apps/web/instrumentation-client.ts (current)
integrations: [
  Sentry.replayIntegration({          // <-- ~50-150 KB gzip estimate
    maskAllText: true,
    blockAllMedia: true,
  }),
  supabaseIntegration(SupabaseClient, Sentry, {
    tracing: true,
    breadcrumbs: false,
    errors: true,
  }),
],
```

The current replay configuration is:

```ts
replaysSessionSampleRate: 0,        // never record idle sessions
replaysOnErrorSampleRate: 1.0,      // record only when an error fires
```

That is, the replay engine is loaded into every page-load bundle so it
can stand by in case an error fires — at which point it would record
a short window of UX context attached to the error report. Across the
fleet, the bundle cost is paid for **every visitor** while only a tiny
fraction ever produces a recording.

## Solution

Remove `replayIntegration` from `apps/web/instrumentation-client.ts`.
Keep the rest of the Sentry init intact:

- `Sentry.init` still runs synchronously on client load (no defer).
- The Capacitor anti-double-count guard
  (`isNativePlatform()` skips init in the APK so `@sentry/capacitor`
  owns reporting in native) stays bit-for-bit.
- `dsn`, `environment`, `sampleRate: 1.0` (errors), `tracesSampleRate: 0.05`
  (perf spans) stay unchanged.
- `supabaseIntegration` stays — its bundle weight is one-tenth of
  replay and it provides high-value tracing of Supabase queries.
- `beforeSend` noise filter (`ResizeObserver loop`,
  `Non-Error promise rejection`) stays.
- `onRouterTransitionStart` export stays.

Net effect: errors + traces + breadcrumbs + supabase query tracing
continue to flow to the `vicino-web` Sentry project. Only the visual
session-recording-on-error pipeline goes away.

## Why this matters

- **Bundle**: removes the largest single integration in the shared
  root chunk. Best-case estimate: -100 KB gzip from the 272 KB
  `8228-*.js` budget. Actual measurement is FASE 2 deliverable.
- **Performance**: faster first paint on Web (lower JS parse cost),
  small win on TTI on every page load.
- **Cost**: pre-launch fleet so the loss-of-visual-replay window is
  narrow. The error reports themselves carry the stack, breadcrumbs,
  and (with `supabaseIntegration`) the query that preceded — already
  enough signal for the bugs we have caught in production so far.

## Non-goals

- **Defer Sentry init**: explicitly out of scope. The current init is
  synchronous so it can catch errors during the first paint and the
  hydration window. Deferring with `setTimeout` / `requestIdleCallback`
  would create a window where errors are missed — exactly the bugs
  Sentry is most useful for catching. See Constraint C2.

- **Switch to `@sentry/browser` slim build**: out of scope. The Next
  integration handles the App Router transition tracking we depend on
  via `onRouterTransitionStart`. A migration to the bare browser SDK
  would require manually wiring the router instrumentation, which
  is a larger change than the bundle delta justifies for now.

- **Drop `supabaseIntegration`**: out of scope. Its query breadcrumb
  + trace value is high and its bundle weight is low.

- **Tune Sentry behavior in the APK**: out of scope. The native flow
  uses `@sentry/capacitor` directly and is unaffected by this change.
  The `isNativePlatform()` guard already keeps the JS init from
  running there.

- **Reduce `tracesSampleRate`**: orthogonal. The sample rate affects
  quota, not bundle size. Out of scope of this change.

## Constraints

- **C1 — Bundle reduction MUST be measurable.** FASE 2 acceptance
  requires `pnpm analyze` before/after on the same master baseline,
  with a concrete gzip delta for `8228-*.js` (or whatever shared root
  chunk the SDK lands in post-change). If the reduction is <30 KB
  gzip the change SHALL be rolled back: the value is the bundle, not
  the principle.

- **C2 — Sentry init MUST remain synchronous.** No `setTimeout`, no
  `requestIdleCallback`, no `await import("@sentry/nextjs")`, no
  lazy. The init runs the same way it does today; only the
  integrations list shrinks. This protects error capture during the
  first-paint + hydration window where the bugs Sentry is most
  useful for catching actually fire.

- **C3 — Error capture MUST survive end-to-end.** FASE 2 acceptance
  requires a manual throw on a deployed preview / production tab,
  observed as an event in the `vicino-web` Sentry dashboard within
  the normal latency window (~30 seconds). If the test event does
  not appear, rollback.

- **C4 — APK observability MUST be untouched.** No changes to
  `@sentry/capacitor` init, no changes to `instrumentation.ts`
  (Node side) or `sentry.server.config.ts` / `sentry.edge.config.ts`.
  This change is web-bundle-only.

- **C5 — Replay drop MUST be reversible.** The alternative
  (Alternative B in design.md — keep replay but slim its config) is
  documented so that if Pedro decides Session Replay on-error has
  beta-period value, we can switch to that path without re-doing the
  research.

## Impact

- **Risk surface**: low-to-medium. The Sentry SDK itself stays loaded
  and active; we are removing one integration's modules from the
  graph. The graph trimming is what reduces bundle. The runtime
  behavior of the remaining init is unchanged.
- **Production observability**:
  - Errors: unchanged (same `captureException` path).
  - Traces: unchanged.
  - Breadcrumbs: unchanged.
  - Supabase query tracing: unchanged.
  - Session Replay on-error: **gone**. When an error fires post-merge,
    the Sentry dashboard entry will have stack + breadcrumbs +
    Supabase query context but NO video reconstruction of the UX
    leading up to the error.
- **APK**: zero impact. `@sentry/capacitor` handles native reporting
  per the existing flow.
- **Quotas**: traces sample at 0.05, replay quota becomes irrelevant
  (was already minimal because of `replaysSessionSampleRate: 0`).
- **Backwards compatibility**: full. No API change, no consumer-visible
  change beyond the bundle delta.

## Acceptance

- `pnpm build` green.
- `pnpm analyze` shows a measurable shared-root gzip reduction on the
  chunk where `@sentry/nextjs` lives (target: >=30 KB gzip; rollback
  threshold per C1).
- Manual error capture smoke: open vicinomarket.com in a preview
  deployment built from the FASE 2 branch, paste
  `throw new Error("sentry trim smoke " + Date.now())` in the
  DevTools console, confirm the event appears in the `vicino-web`
  Sentry dashboard within 60 seconds.
- Production deploy via the standard A4 / A5 path.
- No follow-up rollback within the first 7 days (no observability
  regression reported by Pedro from the production dashboard view).

## Decision open for Pedro (Alternative B)

If Pedro decides Session Replay on-error is too valuable to lose
during the beta window, the alternative is to **keep**
`replayIntegration` but tighten its configuration to reduce its
runtime weight. design.md documents Alternative B in detail. The
proposal records the question for explicit Pedro decision; once
Pedro selects Alternative A (drop) or Alternative B (keep + tighten),
tasks.md FASE 2 executes accordingly. This proposal recommends
Alternative A.

## Out-of-spec follow-ups (recorded in tasks.md)

- F1 — Sentry SDK source-map inspection to identify the next-largest
  trimmable module after replay (potential follow-up bundle pass).
- F2 — Cost/benefit of `supabaseIntegration` revisit if a future
  audit shows it heavier than expected.
- F3 — Defer-init experiment behind a feature flag, gated by Pedro
  decision and a measured error-loss-window study. Not in this
  proposal; recorded for future awareness.
