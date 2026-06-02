# Proposal — Optimize RLS Performance (A2)

## Why

Audit of `supabase/migrations/*.sql` (65 files, final-state inventory) revealed three
classes of performance gaps in the RLS layer of the production Supabase database
`oxxdkwywprkfghhbnoto`:

1. **`auth.uid()` evaluated per-row, not per-statement**: 95+ CREATE POLICY statements
   reference `auth.uid()` directly inside `USING` and `WITH CHECK` expressions. Without
   subquery wrapping, PostgreSQL evaluates the function once per scanned row (volatile,
   not stable inside the policy context). Wrapping as `(select auth.uid())` converts it
   to an `InitPlan` — one evaluation per query, regardless of row count. The expected
   impact is 10-100× on tables with significant rows (chats, messages, sale_confirmations,
   reviews, media_assets, notifications). The pattern is already proven in this codebase:
   `store_follows` (migration 20260528000003) was authored with `(select auth.uid())`
   from the start and demonstrates the target pattern.

2. **Missing role specificity on user-scoped policies**: ~107 policies have no explicit
   `TO` clause, meaning PostgreSQL applies them to ALL roles (anon, authenticated, etc.).
   For policies whose USING/WITH CHECK only make sense for authenticated users (e.g.,
   `auth.uid() = user_id`), the absence of `TO authenticated` forces the planner to
   evaluate them even when the request is anonymous (where they would always evaluate
   to false), wasting CPU. Adding `TO authenticated` is a free win and improves
   defense-in-depth clarity.

3. **Missing indexes on RLS-filtered columns and one FK**:
   - **FK without index**: `products_services.categoria_id` → `categories(id)`. Causes
     sequential scans on JOIN and on category filter (a primary use case in the
     marketplace).
   - **RLS columns without index**:
     - `trust_level_verification.user_id` — referenced in SELECT/INSERT/UPDATE policies
       but no index supports the lookup during permission checks.
     - `appointments.seller_id` — referenced in the UPDATE policy for participants but
       has no index; `buyer_id` already has `idx_appointments_buyer`.

RLS is **enabled** across 27 tables in VICINO production. None of these tables have
RLS disabled. The optimization is a pure performance change — it does not alter
authorization semantics.

## What

A single SQL migration applied via Supabase Studio SQL Editor (browser), authored by
Claude and reviewed by Pedro, that:

- **F1**: Rewrites every `auth.uid()` reference in USING / WITH CHECK to
  `(select auth.uid())`. Same for `has_role(auth.uid(), ...)` → uses the wrapped form
  inside the function call. Surgical, policy-by-policy via `ALTER POLICY`. No DROP+CREATE.
- **F2**: Adds `TO authenticated` to user-scoped policies (policies whose access checks
  are meaningful only for logged-in users). Policies with explicit anon paths (the
  `block_aware_*_select` policies, public-catalog reads, public storage buckets) keep
  their `TO public` (or no clause = effectively TO public) so anon access continues
  to work.
- **F3**: Creates 3 indexes for the gaps identified:
  - `idx_products_services_categoria_id` on `products_services(categoria_id)`
  - `idx_trust_level_verification_user_id` on `trust_level_verification(user_id)`
  - `idx_appointments_seller_id` on `appointments(seller_id)`
  - All using `CREATE INDEX CONCURRENTLY IF NOT EXISTS` (safe for production, no row
    locks; idempotent).

The script is versioned as `supabase/migrations/20260602000001_optimize_rls_performance.sql`
in this repo so the change is auditable in git, but **Pedro runs it manually in Supabase
Studio** rather than `supabase db push`. Reason: Pedro's deploy model is browser-only
for SQL; the Supabase CLI is not in the production path.

## Scope

### IN

- ALTER POLICY rewrites for every policy with inline `auth.uid()` (per Section 6.1 of
  the audit; complete list in design.md)
- ADD `TO authenticated` clauses per Section 6.2 of the audit
- CREATE INDEX CONCURRENTLY for 3 gaps per Section 6.3 and 6.4
- A snapshot-before SELECT and a verification-after SELECT bracketing the writes
- A versioned migration file in `supabase/migrations/` for git history (NOT applied via CLI)

### OUT

- PostGIS / `ubicacion_geo` policies and indexes — explicitly excluded per Pedro
- Changes to RLS semantics (who can read/write what) — the rewrite is byte-equivalent in
  outcome, only faster
- `media_assets` polymorphic ownership refactor (documented as deferred in the audit;
  separate ticket)
- The deprecated `reviews.visible` column sync (separate cleanup ticket)
- F5 from A1 (getClaims migration) — separate, requires Supabase Dashboard JWT setting

## Stakeholders

| Role | Person | Responsibility |
|---|---|---|
| Founder, sole deployer | Pedro | Reviews SQL, runs it in Supabase Studio, verifies via `EXPLAIN ANALYZE` on a large table |
| Authoring | Claude Code | Generates the SQL based on the audit (FASE B), commits migration file, no `db push` |

## Success criteria (objective, measurable)

1. **Post-execution verification query** returns the expected count: every policy that
   referenced `auth.uid()` inline now references `(select auth.uid())`:
   ```sql
   SELECT COUNT(*) FROM pg_policies
   WHERE schemaname = 'public'
     AND (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%( select auth.uid()%'
          OR with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%( select auth.uid()%');
   -- Expected: 0
   ```
2. **`EXPLAIN ANALYZE` on a large table** (e.g., `SELECT * FROM messages WHERE chat_id = '<id>'`
   as an authenticated user with active session) shows an `InitPlan` node for the auth.uid()
   subquery, not a per-row evaluation. The query plan should look like:
   ```
   InitPlan 1 (returns $0)
     -> Result (cost ... )
           Output: auth.uid()
   Seq Scan (or Index Scan) on messages
     Filter: chat_id = $0 ...
   ```
3. **The 3 new indexes appear** in `pg_indexes` after run:
   - `idx_products_services_categoria_id`
   - `idx_trust_level_verification_user_id`
   - `idx_appointments_seller_id`
4. **No application behavior change**: all authorization checks return the same results
   for the same users (smoke test login, view products, send messages, etc.).
5. **No errors in the Studio output** — ALTER POLICY statements all succeed, no
   "policy does not exist" errors.

## References

- Audit output: persisted at `C:\Users\pedro\.claude\projects\c--Users-pedro\750684f1-ce56-42a2-974f-535700ce58a6\tool-results\toolu_01HzKHjis2kbSqUvvByLJVkf.json` (2026-06-02)
- Already-optimized reference policies: `store_follows` (migration 20260528000003 lines 22-27)
- Supabase performance docs: RLS at scale — wrap `auth.uid()` in subquery for InitPlan
- Memory: `reference_supabase_project.md` — project ref `oxxdkwywprkfghhbnoto`, schema_migrations ledger desynchronized, CLI from repo root
