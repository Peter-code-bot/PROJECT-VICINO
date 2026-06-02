# Tasks — Optimize RLS Performance (A2)

> Execution checklist. FASE A is the OpenSpec (this directory).
> FASE B is the SQL script generation + git commit (Claude).
> FASE C is Pedro running the SQL in Supabase Studio.
> No `pnpm build` gate — this change does not touch app code.

## FASE A — OpenSpec (this directory)

- [x] **T-00 · Audit complete** — 65 migration files read; 114 policies inventoried; gaps identified.
- [x] **T-01 · Write proposal.md** — why + what + scope + success criteria
- [x] **T-02 · Write design.md** — rewrite strategy + per-table mapping + script structure
- [x] **T-03 · Write tasks.md** — this file
- [x] **T-04 · Write specs/rls-performance/spec.md** — EARS-style R1, R2, R3 requirements
- [ ] **T-05 · PARA y reportar a Pedro** — deliver inventory + spec for review. Wait for sign-off before FASE B.

---

## FASE B — SQL script (Claude, after Pedro signs off on FASE A spec)

- [ ] **T-06 · Generate the SQL file** — write `supabase/migrations/20260602000001_optimize_rls_performance.sql`
  per the structure in design.md section 6:
  - BLOCK 1: SNAPSHOT BEFORE (SELECT pg_policies)
  - BLOCK 2: DRY-RUN (BEGIN; ALTERs; SELECT verification; ROLLBACK)
  - BLOCK 3: REAL RUN (BEGIN; same ALTERs; COMMIT)
  - BLOCK 4: CREATE INDEX CONCURRENTLY (3 indexes, outside transaction)
  - BLOCK 5: FINAL VERIFY (SELECT pg_policies + SELECT pg_indexes)
- [ ] **T-07 · ALTER POLICY statements** — one per row from Section 1 of the audit:
  - For each policy with inline `auth.uid()`, generate `ALTER POLICY "..." ON ... USING (...)` and/or `WITH CHECK (...)` with the wrapped expression.
  - For each policy classified as user-scoped, append `ALTER POLICY "..." ON ... TO authenticated`.
  - SKIP `store_follows` policies (already optimized).
  - SKIP policies classified as `TO public` keep (block_aware_*, public-catalog reads, public storage buckets) for the TO clause; STILL apply the auth.uid() wrap on those that have inline auth.uid() references.
- [ ] **T-08 · Mechanical verification** — grep the generated SQL for any remaining bare
  `auth.uid()` (not inside a `(select ... )` block). Should return zero matches.
- [ ] **T-09 · Commit the migration file** — explicit `git add supabase/migrations/20260602000001_optimize_rls_performance.sql`
  + the OpenSpec change directory. ASCII commit message:
  `docs(openspec): add optimize-rls-performance change + sql migration (manual run in studio)`
- [ ] **T-10 · PARA y entregar el script a Pedro** — present the full SQL for review BEFORE Pedro runs it. NO push to origin yet (or push the branch only, no merge).

---

## FASE C — Pedro execution (Supabase Studio, browser)

- [ ] **P-1 · Open Supabase Studio** — https://supabase.com/dashboard/project/oxxdkwywprkfghhbnoto/sql/new
- [ ] **P-2 · Paste BLOCK 1, run** — copy the output as a snapshot. Save it locally if Pedro wants to diff later.
- [ ] **P-3 · Paste BLOCK 2 (dry-run), run** — confirm the verification queries inside the BEGIN block return:
  - `policies_still_inline = 0`
  - `policies_with_to_authenticated` matches the expected count from design.md section 4
  - ROLLBACK at the end discards changes — nothing persisted.
- [ ] **P-4 · Paste BLOCK 3 (real run), run** — same SQL with COMMIT. Confirm Studio shows "COMMIT" and no errors.
- [ ] **P-5 · Paste BLOCK 4 (indexes), run each** — CREATE INDEX CONCURRENTLY statements. Studio may show them as long-running; that is expected on large tables.
- [ ] **P-6 · Paste BLOCK 5 (final verify), run** — confirm:
  - 0 rows from the policies-still-inline query
  - 3 rows from the indexes query
- [ ] **P-7 · `EXPLAIN ANALYZE` smoke test** — pick a large table (e.g., `messages` or `products_services`) and run a representative SELECT as an authenticated user. Confirm the plan shows an `InitPlan` node for the auth.uid() subquery.
- [ ] **P-8 · App smoke test** — log in, view products, send a message, check notifications. All work identically (no authorization regression).

---

## Closing

- [ ] **T-11 · Push the migration commit** to `feat/optimize-rls-performance` branch + open PR to master (after Pedro confirms FASE C verde).
- [ ] **T-12 · Merge + archive** — FF-merge to master; archive the OpenSpec change to `openspec/changes/archive/`; merge spec delta into `openspec/specs/rls-performance/spec.md`; push.

---

## Rollback plan (if anything goes wrong)

If post-run smoke test reveals a regression:

1. **Policy regression** (anon can no longer read, or authenticated can no longer mutate):
   - Identify the offending policy from the smoke test failure.
   - Run `ALTER POLICY ... USING (<original expression>)` to revert just that one policy.
   - The snapshot from BLOCK 1 contains every policy's original USING/WITH CHECK.
2. **Index causes plan regression** (rare; planner picks the new index where it shouldn't):
   - `DROP INDEX CONCURRENTLY <index_name>` — also non-blocking.
3. **Full rollback**: re-paste a generated `ALTER POLICY` script that uses the original
   `auth.uid()` form (Claude can generate from the snapshot).

PKCE codes, sessions, user data are NOT affected by any rollback — RLS changes only
affect access control evaluation, not stored data.
