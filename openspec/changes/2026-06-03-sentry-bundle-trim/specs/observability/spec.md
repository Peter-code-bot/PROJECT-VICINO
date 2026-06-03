# Spec — observability (delta)

> Domain: error reporting, performance tracing, and session
> diagnostics for the VICINO web shell that loads inside the
> Capacitor APK and on `https://vicinomarket.com`. The capability
> covers how Sentry is initialized on the client, what integrations
> ship in the shared bundle, how the APK avoids double-counting
> errors with the web project, and what observability surfaces
> remain authoritative after this change.
>
> This is a DELTA spec — it defines new requirements introduced by
> change `2026-06-03-sentry-bundle-trim`. It will be merged into a
> canonical `openspec/specs/observability/spec.md` after the change
> archives. (No prior canonical observability spec exists; this
> change establishes the capability.)
>
> Last updated: 2026-06-03

---

## Context

The VICINO web shell uses `@sentry/nextjs` for client-side
observability. The shell loads inside the Capacitor APK WebView
AND on the public web (`vicinomarket.com`). To prevent every JS
error from being reported twice (once via `@sentry/capacitor` on
native and once via `@sentry/nextjs` in the WebView),
`instrumentation-client.ts` guards the entire `Sentry.init` call
behind `Capacitor.isNativePlatform()` — on the APK, the JS init
returns immediately and `@sentry/capacitor` is the sole reporter.

Pre-change configuration includes Session Replay
(`replayIntegration` with `replaysSessionSampleRate: 0` +
`replaysOnErrorSampleRate: 1.0`) — never records idle sessions but
stands by to record activity around an error. The replay subgraph
is the largest individual contributor to the client bundle.

The audit measurement from post-A5 (master `57bafb3`):
- `8228-*.js` (in `rootMainFiles`): 908 KB raw / 272 KB gzip,
  dominated by `@sentry` + `@supabase` signatures.
- 3671 `@sentry/...` module references in the analyze treemap
  (3x the next contender).

This spec defines the contract for the trimmed Sentry init that
removes `replayIntegration` while preserving all other
observability surfaces.

---

## Requirement R1 — Client Sentry SHALL initialize synchronously at module top-level

WHEN the VICINO web client loads in a non-Capacitor context (web
browser, NOT the APK WebView), `apps/web/instrumentation-client.ts`
SHALL call `Sentry.init` synchronously at module top-level. The
init SHALL NOT be wrapped in `setTimeout`, `requestIdleCallback`,
`Promise.resolve().then`, dynamic `import("@sentry/nextjs")`, or any
other deferral mechanism.

The reasoning is non-negotiable: production bugs we have actually
caught fire during the React hydration phase and during first paint
(stale cached JS, browser extension interference, mismatched
server/client state). A deferred init would create a non-zero
window where these errors are missed. The bundle savings from
deferral do not justify the loss of capture coverage in that
window.

### Scenario: Client Sentry init runs at top of the entry point

- GIVEN the VICINO web client is loading on `https://vicinomarket.com`
- AND the user is NOT inside the Capacitor APK
- WHEN the first client JS evaluates
- THEN `Sentry.init` is called synchronously before any other module
- AND a `throw new Error("...")` from any code that runs subsequently
  is captured by Sentry
- AND the captured event includes browser context (UA, viewport,
  URL), stack, breadcrumbs from `@sentry/browser`, and the most
  recent Supabase query (via `supabaseIntegration`)

### Scenario: Client Sentry init is skipped inside the APK

- GIVEN the VICINO web client is loading inside the Capacitor APK
  WebView
- AND `window.Capacitor.isNativePlatform()` returns true
- WHEN the first client JS evaluates
- THEN `Sentry.init` is NOT called
- AND the `@sentry/capacitor` SDK (initialized separately by the
  native shell) is the sole reporter
- AND no event is sent from this code path to the `vicino-web`
  Sentry project

### Scenario: Deferred init is explicitly forbidden

- GIVEN a developer is reviewing or modifying `apps/web/instrumentation-client.ts`
- WHEN they consider wrapping `Sentry.init` in any deferral mechanism
- THEN the change is rejected at code review
- AND the reviewer points at this requirement (R1) and the
  measured-error-loss-window study requirement (F3 in tasks.md)
  that would have to precede such a change

---

## Requirement R2 — Client Sentry SHALL ship without `replayIntegration` in its default configuration

WHEN `Sentry.init` is called in `apps/web/instrumentation-client.ts`,
the `integrations` array SHALL NOT include
`Sentry.replayIntegration`. The `replaysSessionSampleRate` and
`replaysOnErrorSampleRate` options SHALL be omitted from the init
config (their values are irrelevant without the integration loaded).

This removes the Session Replay subgraph (`@sentry/replay` + rrweb +
mutation observers) from the client bundle. The trade-off is the
loss of visual UX recording around an error event. All other Sentry
surfaces (errors with stacks, breadcrumbs, traces, supabase query
breadcrumbs, browser context) remain authoritative.

### Scenario: Client bundle does NOT include the replay subgraph

- GIVEN the VICINO web client is built post-change
- WHEN `pnpm analyze` runs and the resulting `client.html` is
  inspected
- THEN `@sentry/replay` does NOT appear as a top-level subtree of
  any chunk in `rootMainFiles`
- AND the gzip size of the shared root chunk (`8228-*.js` or its
  successor by hash) is reduced relative to the pre-change baseline
  by at least 30 KB

### Scenario: Errors still capture rich context

- GIVEN the trimmed Sentry init is live in production
- WHEN a user triggers a JS error (real or via DevTools `throw`)
- THEN the Sentry event in the `vicino-web` dashboard contains:
  - the JS stack
  - default `@sentry/browser` breadcrumbs (console, fetch, click,
    route change)
  - the most recent Supabase query that ran (via
    `supabaseIntegration`)
  - browser context (UA, viewport, URL, language)
- AND the event does NOT contain a Session Replay recording

### Scenario: Reversing the decision is one-line

- GIVEN Pedro decides Session Replay is needed back
- WHEN a follow-up change re-adds `Sentry.replayIntegration` to the
  `integrations` array
- THEN the bundle grows back by the same delta this change saved
- AND no other rewiring is required

---

## Requirement R3 — APK observability path SHALL NOT be touched by this change

WHEN this change is applied, the Capacitor APK's observability
path (which uses `@sentry/capacitor` configured outside the
`instrumentation-client.ts` file) SHALL remain bit-for-bit
unchanged.

Specifically:
- The `isCapacitor` guard at the top of `instrumentation-client.ts`
  SHALL retain its exact current shape.
- `@sentry/capacitor` SDK references SHALL NOT be modified by this
  change.
- The `vicino-android` Sentry project SHALL continue to receive
  native crash + JS error events from the APK with no observable
  difference from pre-change.

### Scenario: APK still reports to vicino-android

- GIVEN the APK build post-change is installed on a device
- WHEN a JS error fires inside the WebView (via a known test path)
- THEN the event appears in the `vicino-android` Sentry project
  (the native SDK reports it)
- AND the event does NOT appear in `vicino-web`

### Scenario: Anti-double-count guard remains effective

- GIVEN the trimmed `instrumentation-client.ts` is loaded inside
  the APK WebView
- WHEN the file evaluates
- THEN the `isCapacitor` check returns true
- AND the `Sentry.init` call is skipped
- AND no event is sent to `vicino-web` from this WebView

---

## Requirement R4 — Traces and route-transition spans SHALL continue to flow

WHEN the trimmed Sentry init is live, performance tracing SHALL
continue at the existing `tracesSampleRate: 0.05` (5%), and App
Router transition spans (via `onRouterTransitionStart`) SHALL
continue to be emitted by the existing export.

### Scenario: Pageload and navigation spans appear

- GIVEN the trimmed Sentry init is live
- WHEN a user navigates from `/` to `/buscar` and back
- THEN a pageload span and a navigation span appear in Sentry under
  the session (sampling: 5% of users on average)

### Scenario: onRouterTransitionStart export stays

- GIVEN a code reviewer is inspecting `instrumentation-client.ts`
- WHEN they look at the file's exports
- THEN `onRouterTransitionStart` is still exported from the file
  and matches `Sentry.captureRouterTransitionStart`

---

## Requirement R5 — `supabaseIntegration` SHALL remain in the integrations array

WHEN the trimmed Sentry init is live, the `supabaseIntegration`
from `@supabase/sentry-js-integration` SHALL remain in the
`integrations` array with its existing configuration
(`tracing: true`, `breadcrumbs: false`, `errors: true`).

The rationale: this integration is small (estimated at one-tenth
of the replay weight) and provides high-value tracing of Supabase
queries that has been useful in actual error investigations.

### Scenario: Supabase query context appears in error events

- GIVEN the trimmed Sentry init is live
- AND a JS error fires immediately after a Supabase query
- WHEN the Sentry event is inspected in the dashboard
- THEN the event includes a breadcrumb (or span attachment) for
  the Supabase query that fired right before the error

---

## Cross-cutting

- **Strict TypeScript**: no `any`, no unsafe casts introduced.
- **No console.log**: the trimmed init must not add any.
- **No `.env` or secret changes**: the DSN remains in
  `NEXT_PUBLIC_SENTRY_DSN`, untouched.
- **Build**: `pnpm build` green; `pnpm analyze` available for
  measurement before / after.
- **Rollback**: a single `git revert` of the FASE 2 commit returns
  the bundle and behavior bit-for-bit to the current state. The
  alternative (Alternative B in design.md — keep replay but slim
  config) is documented if the trade-off needs revisiting.

## Out of scope (explicit non-requirements)

- Defer-init experiment (F3 in tasks.md). Forbidden by R1 unless
  preceded by a measured error-loss-window study and explicit
  Pedro GO.
- Migration to `@sentry/browser` slim. Larger change; documented
  as F5 in tasks.md.
- Tuning `tracesSampleRate`. Orthogonal to bundle.
- Dropping `supabaseIntegration`. Cost / benefit was decided in
  favor of keeping per R5.
- Changes to server / edge Sentry configs. Out of bundle scope.
- APK observability behavior. Untouched per R3.

## Decision recorded for the FASE 2 author

Per proposal.md, the recommended path is **Alternative A — drop
`replayIntegration` entirely**. Alternative B (keep + slim config)
is documented in design.md as the fallback if Pedro decides
on-error Session Replay is too valuable to lose during beta.
FASE 2 executes Alternative A unless Pedro explicitly directs
otherwise before branch creation.
