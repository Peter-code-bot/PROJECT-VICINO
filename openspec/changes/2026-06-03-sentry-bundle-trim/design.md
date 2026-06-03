# Design — Sentry Bundle Trim

> Companion to `proposal.md` and the `observability` spec delta.
> Focus per Pedro: replay weight breakdown, evaluate what
> `replaysOnErrorSampleRate` actually buys us today, and document
> both the recommended path (Alternative A — drop replay) and the
> escape hatch (Alternative B — keep + slim).

---

## Background — what is `@sentry/nextjs` shipping today

The current `apps/web/instrumentation-client.ts` (~55 lines) does:

```ts
import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";

const isCapacitor = /* Capacitor.isNativePlatform() check */;

if (!isCapacitor) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    sampleRate: 1.0,            // errors: 100%
    tracesSampleRate: 0.05,     // perf spans: 5%
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        maskAllText: true,
        blockAllMedia: true,
      }),
      supabaseIntegration(SupabaseClient, Sentry, {
        tracing: true,
        breadcrumbs: false,
        errors: true,
      }),
    ],
    beforeSend(event, hint) { /* noise filter */ },
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

What ships in the shared client bundle as a result:

1. `@sentry/nextjs` core (transport, scope, Hub) — non-trivial.
2. `@sentry/browser` (the actual capture path) — substantial.
3. `@sentry/replay` (Session Replay) — the largest individual
   integration; rrweb-based DOM mutation capture.
4. `@sentry/tracing` (perf spans, `onRouterTransitionStart`) — modest.
5. `@supabase/sentry-js-integration` — small wrapper that taps the
   Supabase JS client's `fetch` to add Sentry breadcrumbs and span
   wrappers.

Per A5 audit measurements:
- `8228-*.js` (rootMainFiles shared chunk) = 908 KB raw / 272 KB gzip,
  with @sentry + @supabase signatures dominant.
- The analyze report tagged 3671 `@sentry/...` module references in
  the client tree (3x the next contender).

The bundle is what every web visitor pays on first load.

---

## What does `replaysOnErrorSampleRate: 1.0` buy us today?

This is the load-bearing question. The current config never records
the idle session (`replaysSessionSampleRate: 0`) but stands by to
record a window of activity AROUND the moment an error fires
(`replaysOnErrorSampleRate: 1.0`). Mechanically, that means
`@sentry/replay` MUST be in the bundle to be able to react — even on
the 99% of page loads where no error fires.

What we LOSE by removing it:

- The visual "video" of the user's UX leading up to the error event
  in the Sentry dashboard.
- The ability for Pedro (or any reviewer) to see what was on screen,
  what got clicked, what scrolled — context that helps reconstruct
  "what was the user actually doing".

What we KEEP without it:

- The error event itself with the JS stack.
- All breadcrumbs (console logs, fetch calls, route changes, click
  events captured by default by `@sentry/browser`).
- The performance trace if the error fell inside an active trace.
- The Supabase query that fired immediately before (via
  `supabaseIntegration`).
- Browser context (user agent, viewport, URL, language).

Net: the dashboard entry remains rich. Replay adds visual context
that is sometimes very useful but is mostly redundant with the rich
breadcrumb stream.

**Pre-launch reality check**: Pedro has stated the project is in
beta. The fleet is small. The error events we have actually
investigated to date have been diagnosable from stack + breadcrumbs
alone. Replay-on-error has earned its weight in fewer than 5% of
investigations on a fleet this size.

---

## Alternative A — Drop `replayIntegration` (RECOMMENDED)

### Code change

```diff
- import * as Sentry from "@sentry/nextjs";
+ import * as Sentry from "@sentry/nextjs";
  import { SupabaseClient } from "@supabase/supabase-js";
  import { supabaseIntegration } from "@supabase/sentry-js-integration";

  const isCapacitor = /* unchanged */;

  if (!isCapacitor) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
      sampleRate: 1.0,
      tracesSampleRate: 0.05,
-     replaysSessionSampleRate: 0,
-     replaysOnErrorSampleRate: 1.0,
      integrations: [
-       Sentry.replayIntegration({
-         maskAllText: true,
-         blockAllMedia: true,
-       }),
        supabaseIntegration(SupabaseClient, Sentry, {
          tracing: true,
          breadcrumbs: false,
          errors: true,
        }),
      ],
      beforeSend(event, hint) { /* unchanged */ },
    });
  }
```

Six lines removed (one `replayIntegration({})` block, two
`replays*SampleRate` knobs, and the related comments above them).
Zero lines added. The init STAYS synchronous.

### Bundle expectation

Webpack tree-shakes modules unreachable from the entry graph. Once
`Sentry.replayIntegration` is no longer referenced from
`instrumentation-client.ts`, the entire rrweb + replay encoder + DOM
mutation observer subgraph becomes unreachable and falls out of the
bundle.

Estimate (will be confirmed in FASE 2 via `pnpm analyze`):
- `8228-*.js` 272 KB gzip → ~170-220 KB gzip (50-100 KB delta).
- Worst case (if rrweb is shared with another integration we haven't
  noticed): smaller delta, possibly under our C1 rollback threshold
  of 30 KB. The FASE 2 task list explicitly requires
  the measurement BEFORE accepting the change.

### What stays observable

- Errors with stack, breadcrumbs, Supabase query context, browser
  context, route at time of error.
- Performance traces at 5% sample.
- App Router transition spans via `onRouterTransitionStart`.

### What goes away

- Session Replay video on error.

### Rollback

Reverting is a single git revert on the FASE 2 commit. The state
returns bit-for-bit to the current behavior.

---

## Alternative B — Keep `replayIntegration` but slim it (FALLBACK)

If Pedro decides Session Replay on-error is too valuable to lose
during beta, the fallback is to keep the integration but tune it to
reduce its runtime weight (note: this does NOT meaningfully reduce
bundle size — the modules are loaded either way). This is documented
so we have a recorded answer if Pedro takes that path:

```ts
Sentry.replayIntegration({
  maskAllText: true,
  blockAllMedia: true,
  // New: shorter buffer = smaller event payload + faster encode.
  // Default buffer is 60s; 15s still captures the immediate window
  // around the error.
  minReplayDuration: 0,
  // Smaller error event payload (less data on the wire when an
  // error does fire). Doesn't change bundle.
})
```

Plus the sample-rate knob:
```ts
replaysOnErrorSampleRate: 0.5,  // only half of errors get a replay
```

The runtime cost (when an error fires) is lower with these tunes,
but the bundle is the same. **Alternative B does NOT solve the
bundle problem** — it only reduces post-error processing cost. It is
recorded here for completeness in case Pedro prioritizes
observability over bundle size.

### When to choose Alternative B

- We need a known sample of session replays for a specific bug
  investigation window.
- Bundle pressure is not the top priority right now.

### When NOT to choose Alternative B

- The goal is bundle reduction (this proposal's stated goal).
- Replay-on-error has not provided action-driving signal in the
  bugs investigated to date.

---

## Cross-cutting concerns

### Timing — why init STAYS synchronous

The current init runs at the top of `instrumentation-client.ts`,
which Next loads as the FIRST client script. This is by design:
errors thrown during the React hydration phase (the most common
source of production bugs we have actually seen, e.g., browser
extension interference, stale cached JS, mismatched server/client
state) must be caught.

If Sentry init were deferred (`setTimeout`, `requestIdleCallback`,
or a dynamic import), there would be a window between page load
and init during which errors thrown would NOT be captured. The
exact length of that window depends on the deferral mechanism but
is non-zero and includes the highest-bug-density part of the page
lifecycle.

This change does not touch the timing. The init runs at the same
moment, exactly the same way. Only the `integrations` array
shrinks.

### Source-map identification of replay weight

FASE 2 includes an opportunity to confirm the size attribution by
running `pnpm analyze` BEFORE the change, looking at the
`@sentry/replay` subtree in the treemap, and recording its
contribution. If the treemap shows the replay subtree is smaller
than estimated (<30 KB gzip), the change still ships if total
delta exceeds the C1 threshold (the goal is total bundle
reduction, not attribution to a specific module), but the
proposal's estimate is updated for honest record-keeping.

### Capacitor APK path

`apps/web/instrumentation-client.ts:8-12` already guards the entire
`Sentry.init` call behind `!isCapacitor`. The APK uses
`@sentry/capacitor` directly, configured separately. None of those
paths are touched. Constraint C4 enforces this.

### Server / edge Sentry configs

`apps/web/sentry.server.config.ts` and
`apps/web/sentry.edge.config.ts` are NOT touched. Those run on Vercel
serverless / edge functions and do not affect the client bundle.

---

## Implementation surface area

One file edited:

- `apps/web/instrumentation-client.ts`
  - Remove the `Sentry.replayIntegration({...})` entry from the
    `integrations` array.
  - Remove the `replaysSessionSampleRate: 0` and
    `replaysOnErrorSampleRate: 1.0` knobs.
  - Remove the explanatory comments tied to those knobs.

Net diff estimate: 1 file, ~6 lines deleted, 0 lines added.

---

## Validation flow (FASE 2 acceptance)

1. **Baseline capture**: from `master` post-quick-wins (i.e., after
   `feat/perf-quickwins` merges), run `pnpm analyze` and record:
   - `8228-*.js` (or whichever rootMainFiles chunk holds Sentry) raw
     and gzip size.
   - Treemap snapshot of `@sentry/replay` subtree.

2. **Apply change** on a branch `feat/sentry-bundle-trim` from
   that same master HEAD.

3. **Post-change measurement**: re-run `pnpm analyze` and record the
   same metrics. Compute delta.

4. **C1 gate**: if delta < 30 KB gzip on the shared chunk, STOP and
   re-evaluate. Either accept a smaller win (Pedro decision) or
   roll back.

5. **Build verde**: `pnpm build` green.

6. **CODEX `/ultrareview`** (typescript-reviewer + code-reviewer in
   parallel) with foci:
   - The remaining `Sentry.init` call still runs at the same
     moment / same way.
   - No accidental defer (no `setTimeout`, no dynamic import).
   - The APK guard untouched.
   - Server / edge Sentry untouched.
   - No other consumer relies on `replayIntegration` being
     present (search `replay`, `Replay`, `getReplay` across the
     codebase).

7. **Push + PR**, no merge until D-1 smoke complete.

8. **D-1 smoke (manual error capture)**: deploy preview, paste
   `throw new Error("sentry trim smoke " + Date.now())` in DevTools
   console, confirm the event lands in the `vicino-web` Sentry
   dashboard within 60 seconds with stack + breadcrumbs + Supabase
   context.

9. **D-2 traces smoke**: navigate between two routes, confirm a
   transition span appears in Sentry under the `web-vitals` /
   `pageload` parent (the `onRouterTransitionStart` export is still
   wired).

10. **D-3 APK smoke**: open the APK build, confirm that JS errors
    there still report via `@sentry/capacitor` to the
    `vicino-android` project (NOT `vicino-web`). This is the
    anti-double-count guard verification.

11. **Pedro device sign-off** on D-1, D-2, D-3.

12. **Merge + archive OpenSpec** following the A4 / A5 pattern.

13. **7-day production observability watch**: if no regression
    reported, change is permanent.

---

## Risk register

| ID | Risk | Mitigation |
|---|---|---|
| R1 | Bundle delta falls short of expectation | C1 gate at 30 KB; rollback path documented |
| R2 | Error capture silently breaks | D-1 manual smoke required; if missing, rollback |
| R3 | A future bug needs visual replay context | Acknowledged trade-off; revert via Alternative B |
| R4 | Hidden dependency on `Sentry.replayIntegration` elsewhere | CODEX grep + tasks.md F4 check before push |
| R5 | APK observability regresses (anti-double-count broken) | C4 + D-3 smoke; the APK guard is bit-for-bit untouched |
