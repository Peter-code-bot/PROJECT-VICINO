# Tasks — Sentry Bundle Trim

> Companion to proposal.md and design.md. Each task gets ticked off
> during FASE 2 implementation. Branch: feat/sentry-bundle-trim from
> master HEAD (post-quick-wins merge).

---

## Pre-flight

- [ ] **GATE 0** — `git fetch origin` + confirm master is at the
      expected baseline (post `feat/perf-quickwins` merge or whatever
      Pedro establishes).
- [ ] Branch `feat/sentry-bundle-trim` from clean master.
- [ ] OpenSpec FASE 1 committed to master FIRST (this very spec)
      so the change is on-record before any code touches.

---

## Step 1 — Baseline capture (decision-critical)

- [ ] Confirm `pnpm analyze` runs cleanly on the baseline (no
      cached state from a prior analyze run polluting the result).
- [ ] Record `8228-*.js` raw size (`stat -c%s` or equivalent) and
      gzip size (`gzip -c | wc -c`). Note the exact filename — the
      hash suffix changes per build.
- [ ] Open `.next/analyze/client.html`, screenshot or note the
      `@sentry/replay` subtree size.
- [ ] Sanity check: confirm `8228-*.js` is in
      `.next/build-manifest.json` `rootMainFiles` (it should be).

The baseline numbers go into the FASE 2 commit message as
"Baseline (master HEAD <hash>): 8228 X KB raw / Y KB gzip".

---

## Step 2 — Apply the change

- [ ] Edit `apps/web/instrumentation-client.ts`:
  - Remove the `Sentry.replayIntegration({...})` entry from the
    `integrations` array.
  - Remove the `replaysSessionSampleRate: 0` line.
  - Remove the `replaysOnErrorSampleRate: 1.0` line.
  - Remove or update the comments tied to those knobs.
- [ ] DO NOT touch `Sentry.init` timing. DO NOT add `setTimeout`,
      `requestIdleCallback`, dynamic import, or feature-flag gating
      (per Constraint C2).
- [ ] DO NOT touch `apps/web/sentry.server.config.ts` (per C4).
- [ ] DO NOT touch `apps/web/sentry.edge.config.ts` (per C4).
- [ ] DO NOT touch `apps/web/instrumentation.ts` (server-side init).
- [ ] DO NOT touch the Capacitor `isNativePlatform()` guard.
- [ ] Confirm `onRouterTransitionStart` export still appears at the
      end of the file (App Router requirement).
- [ ] `pnpm build` green.

---

## Step 3 — Post-change measurement

- [ ] Re-run `pnpm analyze`. Record:
  - New `8228-*.js` raw + gzip sizes (filename hash will differ).
  - Same chunk name's `@sentry/replay` subtree presence
    (expected: absent or near-absent).
- [ ] Compute delta. If `gzip(after) - gzip(before) <= -30 KB` (i.e.,
      a reduction of at least 30 KB), proceed.
- [ ] If delta is smaller than 30 KB gzip, **STOP**. Report the
      measured delta to Pedro. Possible outcomes:
  - Pedro accepts the smaller win and we proceed.
  - Pedro decides the value is not worth the risk and we revert.
  - The treemap shows replay is still present (a bug in the change);
    fix and re-measure.

---

## Step 4 — Hidden-dependency check

- [ ] `grep -rn "replayIntegration\|Sentry.getReplay\|@sentry/replay"
      apps/ packages/ instrumentation*.ts sentry.*.config.ts`
      — confirm zero matches outside the file we just edited.
- [ ] `grep -rn "replay" apps/web/lib/ apps/web/hooks/ apps/web/components/`
      with a sane filter — confirm no app-level code references the
      Sentry replay API.
- [ ] If matches surface, evaluate per case; some may be unrelated
      (audio/video controls, optimistic flags). Document in the FASE 2
      commit message that the check ran clean OR that the match was
      false-positive.

---

## Step 5 — Commit (FASE 2)

- [ ] `git add` explicit on `apps/web/instrumentation-client.ts`.
- [ ] Commit message ASCII-clean. Include in the body:
  - Baseline + after numbers (raw + gzip) for the shared chunk.
  - Explicit "Sentry init STAYS synchronous; only the integrations
    array shrinks" note.
  - "APK observability untouched; Capacitor guard unchanged."
  - "No server / edge Sentry config touched."
  - Link back to this spec for the rationale.

---

## Step 6 — CODEX `/ultrareview`

Two reviewers in parallel (typescript + code-reviewer) with foci:

- [ ] Init still runs at module top-level, same as before. No defer.
- [ ] `Sentry.init` argument shape valid post-removal (no orphan
      properties referencing removed integration).
- [ ] APK guard byte-identical.
- [ ] Server / edge configs not in the diff.
- [ ] `onRouterTransitionStart` export still present.
- [ ] No new dependencies, no `console.log`, no `.env` leak,
      no commit attribution noise.

Protocol per A4 / A5: HIGH blocker -> PAUSE before fixing, report
to Pedro. Nits -> fix and report. PAUSE before push.

---

## Step 7 — Push + PR

- [ ] `git push -u origin feat/sentry-bundle-trim`.
- [ ] Open PR to master. Body must include:
  - Baseline vs after numbers (raw + gzip).
  - CODEX result summary.
  - D-1 / D-2 / D-3 device checkpoints (below) as an unchecked
    test plan.
- [ ] DO NOT merge until D-1 / D-2 / D-3 verde.

---

## Step 8 — Pedro device validation

D-checkpoints from design.md:

- [ ] **D-1 Manual error capture**: paste `throw new Error("sentry
      trim smoke " + Date.now())` in DevTools console on a preview
      deployment of the branch. Event appears in the `vicino-web`
      Sentry dashboard within 60 seconds with stack + breadcrumbs +
      Supabase query context.
- [ ] **D-2 Traces smoke**: navigate `/` -> `/buscar` -> `/`.
      A pageload + navigation span appears in Sentry tied to the
      session.
- [ ] **D-3 APK regression**: open the APK build, force a JS error
      (e.g., via a hidden dev affordance or by tapping a known
      crash path). Confirm the error lands in `vicino-android`
      (NOT `vicino-web`). The anti-double-count guard is intact.

---

## Step 9 — Merge + Vercel + archive

- [ ] After Pedro OKs D-1..D-3: standard A4 / A5 merge flow.
  - `git checkout master && git pull --rebase`.
  - `git merge --ff-only feat/sentry-bundle-trim`.
  - `git push origin master`.
- [ ] Confirm Vercel production deploy verde with the final hash.
- [ ] Archive OpenSpec change to
      `openspec/changes/archive/2026-06-03-sentry-bundle-trim/`.
- [ ] Promote the delta spec into
      `openspec/specs/observability/spec.md` as canonical (since
      this is the first observability capability change).
- [ ] Update memory if the bundle delta is significant (>50 KB
      gzip) so future audits know the trimmed Sentry baseline.

---

## Step 10 — Cleanup

- [ ] `git branch -d feat/sentry-bundle-trim`.
- [ ] `git push origin --delete feat/sentry-bundle-trim`.

---

## Step 11 — 7-day production observability watch

- [ ] Day 1: confirm the post-merge production traffic generates
      Sentry events in the dashboard (no silent break).
- [ ] Day 3: confirm trace sample is producing data.
- [ ] Day 7: if no regression observed, the change is permanent.
      If regression observed, follow rollback steps (single
      `git revert` of the FASE 2 commit on master).

---

## Follow-ups (intentionally deferred)

- **F1** — Sentry SDK source-map inspection to identify the
  next-largest trimmable module after replay. Potential follow-up
  bundle pass. Only worth a session if telemetry shows more bundle
  pressure post-trim.

- **F2** — Cost / benefit of `supabaseIntegration` revisit. Today's
  audit estimated it as small (one-tenth of replay) but a precise
  measurement was not made. If it ends up heavier than estimated,
  consider whether the query-tracing value justifies the cost.

- **F3** — Defer-init experiment behind a feature flag. Out of
  scope of this change (per C2). Recorded for future awareness in
  case Pedro ever decides to take that bigger risk. Would require:
  - A measured study of error-loss window (instrument a deferred
    init in dev with a known-throwing route and count missed
    errors).
  - A flag rollout (deferred init for a fraction of users)
    monitored against control.
  - Pedro explicit GO based on the study results.

- **F4** — Hidden-dependency audit deeper sweep (if Step 4 surfaces
  any suspicious match that needed investigation but turned out
  innocuous). Record the false-positive list for future reference.

- **F5** — Consider migration to `@sentry/browser` (slim) with
  manual App Router instrumentation if a future bundle audit shows
  `@sentry/nextjs` itself is the next biggest target. Bigger
  change; defer until trim delta is measured and Pedro signs off.
