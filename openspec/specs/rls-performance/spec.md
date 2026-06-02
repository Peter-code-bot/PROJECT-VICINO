# Spec — rls-performance

> Domain: PostgreSQL Row-Level Security policy authoring conventions and supporting
> indexes for the VICINO Supabase database (`oxxdkwywprkfghhbnoto`).
> Last updated: 2026-06-02 (bootstrapped from change `2026-06-02-optimize-rls-performance`
> after verified deploy: 78 policies optimized, 3 new indexes, smoke verde).

---

## Context

VICINO uses Supabase Postgres with Row-Level Security ENABLED on 27 tables in the
`public` and `storage` schemas. All RLS policies grant access based on the
relationship between the request's authenticated user (`auth.uid()`) and the row
being scanned.

Before A2, 78 policies referenced `auth.uid()` directly inside USING / WITH CHECK
expressions. PostgreSQL evaluates this per-row (function is volatile in that
context), causing linear cost in row count. Wrapping the call as
`(select auth.uid())` enables InitPlan evaluation: one call per query regardless of
row count, yielding 10-100× improvement on tables with significant rows
(`messages`, `media_assets`, `notifications`, `chats`, `sale_confirmations`, etc.).

This spec codifies the conventions that prevent the regression from returning.

---

## Requirement R1 — Policies SHALL wrap auth.uid() in a SELECT subquery

WHEN a Postgres RLS policy on the `public` or `storage` schema references the
function `auth.uid()` in its USING or WITH CHECK expression (directly or inside a
nested subquery), the expression SHALL wrap the call as `(select auth.uid())`. The
system SHALL NOT use `auth.uid()` as a bare expression operand. This enables
InitPlan evaluation: the function runs once per query rather than once per scanned
row.

The same wrapping applies to `auth.uid()` calls passed as arguments to helper
functions:
- `has_role(auth.uid(), 'admin')` → `has_role((select auth.uid()), 'admin')`
- `auth.uid()::text` → `(select auth.uid())::text`
- `auth.uid() IS NOT NULL` → `(select auth.uid()) IS NOT NULL`

### Scenario: New policy is authored with the wrap

- GIVEN a developer is writing a new CREATE POLICY statement
- WHEN the policy needs to filter by the authenticated user
- THEN the expression uses `(select auth.uid())` not `auth.uid()`
- AND CI / code review rejects any bare `auth.uid()` in a USING or WITH CHECK clause

### Scenario: Verification query confirms compliance

- GIVEN the production RLS state at any time
- WHEN this verification query runs:
  ```sql
  SELECT COUNT(*) FROM pg_policies
  WHERE schemaname IN ('public', 'storage')
    AND (
      (qual ~* 'auth\.uid\(\)' AND qual !~* '\(\s*select\s+auth\.uid')
      OR (with_check ~* 'auth\.uid\(\)' AND with_check !~* '\(\s*select\s+auth\.uid')
    );
  ```
- THEN the result is `0`

### Scenario: EXPLAIN ANALYZE shows InitPlan

- GIVEN an authenticated user runs a SELECT against a table protected by an RLS policy
- WHEN `EXPLAIN ANALYZE` is captured for that query
- THEN the plan contains an `InitPlan` node referencing `auth.uid()`
- AND the function call does not appear inside a per-row `Filter` node

---

## Requirement R2 — User-scoped policies SHALL declare `TO authenticated`

WHEN a Postgres RLS policy's USING or WITH CHECK expression is only meaningful
for authenticated users (the expression evaluates to false or null for an
anonymous request because it tests `auth.uid()` equality against a non-null user
column), the policy SHALL declare `TO authenticated`. This prevents the planner
from evaluating the policy for anonymous requests where it would always fail, and
signals the intent in the policy definition.

Policies that MUST keep a broader role clause (no clause or `TO public`):
- Policies whose USING is `TRUE` or filters only on a visibility flag
  (e.g., `activo = TRUE`, `visible = TRUE`)
- Policies that explicitly support an anonymous branch
  (e.g., `(select auth.uid()) IS NULL AND is_hidden = FALSE`)
- Storage object policies for public-read buckets (avatars, product-media public reads)

### Scenario: User-scoped policy gets TO authenticated

- GIVEN a policy whose USING is `user_id = (select auth.uid())` (or any expression that depends on `(select auth.uid())` with no anon branch)
- WHEN the policy is created or updated
- THEN `TO authenticated` is declared
- AND `pg_policies.roles` for that policy contains `{authenticated}`

### Scenario: Public-read policy keeps anon access

- GIVEN a policy whose USING is `TRUE`, filters only on a visibility flag, or has an explicit anon branch (e.g., `block_aware_*_select`)
- WHEN the policy is created or updated
- THEN the policy's role clause is `TO public` (or omitted, equivalent to `TO public`)
- AND anonymous requests continue to match the policy where the expression allows

### Scenario: ALTER POLICY preserves omitted TO clause

- GIVEN an existing policy is `TO authenticated`
- WHEN an `ALTER POLICY` is issued that changes only USING or WITH CHECK without specifying TO
- THEN the role assignment is PRESERVED (per Postgres ALTER POLICY semantics: omitted clauses retain existing value)

---

## Requirement R3 — Foreign-key and RLS-filtered columns SHALL have indexes

WHEN a column is either (a) a foreign key referencing another table's primary key,
OR (b) referenced in an RLS policy's USING / WITH CHECK expression as an equality
filter, the column SHALL have a btree index. Sequential scans during RLS
evaluation on large tables negate the InitPlan optimization from R1.

The specific gaps closed by A2 (canonical references):
- `products_services.categoria_id` (FK to `categories.id`, plus heavy category-filter use) — `idx_products_services_categoria_id`
- `trust_level_verification.user_id` (RLS-filtered) — `idx_trust_level_verification_user_id`
- `appointments.seller_id` (RLS-filtered; `buyer_id` was already indexed) — `idx_appointments_seller_id`

### Scenario: New schemas must include indexes

- GIVEN a developer adds a new table with a foreign key column
- WHEN they create the table
- THEN they also create a btree index on the FK column in the same migration
- AND if they author an RLS policy that filters by a non-FK column, that column also gets an index

### Scenario: Production state verification

- WHEN this verification query runs at any time:
  ```sql
  SELECT indexname FROM pg_indexes
  WHERE indexname IN (
    'idx_products_services_categoria_id',
    'idx_trust_level_verification_user_id',
    'idx_appointments_seller_id'
  );
  ```
- THEN exactly 3 rows are returned

---

## Implementation notes

- Reference policy already following R1 from day-1 of authoring: `store_follows` (migration 20260528000003)
- Rewrite pattern: `auth.uid() = user_id` → `(select auth.uid()) = user_id`
- Helper function calls also wrap: `has_role(auth.uid(), 'admin')` → `has_role((select auth.uid()), 'admin')`
- `ALTER POLICY` supports changing USING, WITH CHECK, and TO clauses without DROP+CREATE; omitted clauses preserve their existing value
- `CREATE INDEX CONCURRENTLY IF NOT EXISTS` is the safe pattern for production index creation (does not block reads/writes)
- This spec does NOT modify PostGIS / `ubicacion_geo` policies or the `idx_products_location` GIST index — those are out of scope

## Out of scope (documented as deferred)

- F5 of A1 (getClaims migration) — requires asymmetric JWT in Supabase Dashboard
- `media_assets` polymorphic ownership refactor — separate spec
- `reviews.visible` column deprecation — separate cleanup
- PostGIS / geography column policies — explicit out-of-scope per Pedro

## Known follow-ups discovered during A2 (not in this spec)

- **`dedup-media-assets-legacy-policies`** — 3 Dashboard-created policies on `public.media_assets` (`Owner insert media`, `Owner update media`, `Owner delete media`) coexist with the canonical migration-defined set (`media insert/update/delete ownership aware`). A2 wrapped them in BLOCK 6 byte-for-byte preserving semantics; DROP vs keep decision deferred to a separate change after verifying snapshot diffs.
- **`Admin read verification docs`** — migration `20260429000001_admin_verification_docs_read.sql` was never applied to production (schema_migrations ledger desynchronized). Decide if the admin verification flow needs the policy re-created or document as deferred.

## Future enforcement options

- Add a CI check (or pre-commit hook) that greps new migrations for bare `auth.uid()` in USING/WITH CHECK and fails the build
- Add a CI check that detects new FK / RLS-filtered columns without indexes
