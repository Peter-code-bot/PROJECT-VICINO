# Design — Optimize RLS Performance (A2)

> Implementation plan for proposal `2026-06-02-optimize-rls-performance`.
> The deliverable in FASE B will be a single SQL file that Pedro runs in Supabase Studio.
> This design specifies the rewrite strategy, the exhaustive policy-by-policy mapping,
> the index plan, and the dry-run pattern.

## 1. Rewrite strategy — ALTER POLICY, not DROP+CREATE

PostgreSQL's `ALTER POLICY` supports changing `USING`, `WITH CHECK`, and `TO` clauses
on an existing policy. Therefore the entire migration uses `ALTER POLICY ... USING (...)`
and `ALTER POLICY ... WITH CHECK (...)` and `ALTER POLICY ... TO authenticated` — no
DROP+CREATE is needed.

This has 3 benefits:
- Atomic per-policy change (no window of "no policy active")
- Less SQL noise (no need to repeat the full policy definition)
- Safe against missing `TO` clause changes if a future migration recreates the policy

Caveat: ALTER POLICY cannot change the command (SELECT/INSERT/UPDATE/DELETE) or the
policy name. Neither is needed by this change.

## 2. Function-call rewrite pattern

Wherever `auth.uid()` appears as an expression operand, wrap it in a SELECT subquery:

```
auth.uid() = user_id          →  (select auth.uid()) = user_id
user_id = auth.uid()          →  user_id = (select auth.uid())
auth.uid() IS NOT NULL        →  (select auth.uid()) IS NOT NULL
auth.uid()::TEXT              →  (select auth.uid())::text
has_role(auth.uid(), 'admin') →  has_role((select auth.uid()), 'admin')
```

For nested EXISTS subqueries that reference `auth.uid()`, the wrapping applies inside
the nested subquery too:

```
USING (EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id
               AND (chats.comprador_id = auth.uid() OR chats.vendedor_id = auth.uid())))

→

USING (EXISTS (SELECT 1 FROM chats WHERE chats.id = messages.chat_id
               AND (chats.comprador_id = (select auth.uid())
                    OR chats.vendedor_id = (select auth.uid()))))
```

PostgreSQL still recognizes the wrapping as InitPlan-eligible even inside nested
subqueries, because the wrapping subquery is correlation-free (does not reference
the outer table's columns).

## 3. TO authenticated classification

| Policy command | Has auth.uid() ref? | Has anon path (auth.uid() IS NULL or filter only on visibility flags)? | Resulting `TO` clause |
|---|---|---|---|
| SELECT | Yes | No | `TO authenticated` |
| SELECT | Yes | Yes (block_aware_*) | KEEP `TO public` (no clause = public) |
| SELECT | No (filter is `TRUE` or visibility flag) | N/A | KEEP current (TO public/anon) |
| INSERT/UPDATE/DELETE | Always (only auth users mutate) | N/A | `TO authenticated` |

Specific policies that KEEP TO public (no change to TO):
- `profiles "Anyone can view profiles"` (USING TRUE — public read)
- `profiles "block_aware_profiles_select"` (has anon branch)
- `categories "Anyone can view active categories"`
- `product_variants "Anyone can view variants"` (USING TRUE)
- `media_assets "Anyone can view media"` (USING TRUE)
- `coupons "Anyone can view active coupons"`
- `service_availability "Anyone can view availability"`
- `bookings` SELECT policies — review individually (audit shows participant-only, so TO authenticated)
- `appointments "Anyone can view appointments"` (USING true)
- `reviews "Anyone can view visible reviews"` (USING `visible = TRUE`)
- `reviews "block_aware_reviews_select"` (has anon branch)
- `products_services "Anyone can view available products"` (mixed: allows anon to see disponible)
- `products_services "block_aware_products_select"` (has anon branch)
- `store_follows "Anyone can view store follows"`
- All `storage.objects` policies named `"Public read *"` and `avatar_read`

Specific policies that already have `TO authenticated` (no TO change, only the auth.uid() wrap):
- `reports` (4 policies — created already TO authenticated)
- `user_blocks "users_manage_own_blocks"`
- `critical_reports` (3 policies)
- `audit_log "admins_insert_audit"` (admins_read_audit has no clause, needs adding)
- `seller_rankings "Rankings are publicly readable"` — current TO authenticated (acceptable per audit; keep)
- Hardened storage.objects policies in `20260425000002_harden_storage_policies.sql` (avatar_upload, avatar_update, avatar_delete, owner upload product media, owner delete product media, owner upload chat media)

All other policies with `auth.uid()` get `TO authenticated` added.

## 4. Exhaustive policy mapping (the rewrite table)

The full list of ALTER POLICY statements derives from Section 1 of the audit. Each row
in that section produces one `ALTER POLICY` block (or skip if "Already Uses (select
auth.uid())?" is "Yes" for both USING and WITH CHECK).

The FASE B script will generate these mechanically. Here is the per-table count:

| Table | # policies to ALTER (auth.uid wrap) | # policies to add TO authenticated |
|---|---|---|
| profiles | 2 (update, insert) — `block_aware_profiles_select` only wraps, keeps TO public | 2 |
| user_roles | 2 | 2 |
| categories | 1 (`Admin can manage categories`) | 1 |
| products_services | 4 (anyone-view stays TO public; sellers create/update/delete go TO authenticated; block_aware keeps TO public, only wraps) | 3 |
| product_variants | 1 (sellers can manage) | 1 |
| media_assets | 4 (insert/update/delete ownership + media select ownership aware) | 3 (insert/update/delete) — `media select ownership aware` keeps TO public |
| sale_confirmations | 4 | 4 |
| reviews | 3 (insert reviews, reviewed user can respond, admin can manage) | 3 — `block_aware_reviews_select` only wraps |
| chats | 3 | 3 |
| messages | 2 + `block_aware_messages_select` (wrap only, but this one HAS no anon path — see note below) | 2-3 |
| favorites | 3 | 3 |
| coupons | 1 (sellers manage; `anyone view active` keeps TO public, no wrap) | 1 |
| seller_verification | 4 | 4 |
| trust_level_verification | 4 | 4 |
| disputes | 3 | 3 |
| notifications | 2 | 2 |
| service_availability | 1 (sellers manage own) | 1 |
| bookings | 3 | 3 |
| appointments | 2 (create + update; anyone-view keeps TO public, no wrap) | 2 |
| reports | 4 (already TO authenticated; only wrap) | 0 |
| user_blocks | 1 (already TO authenticated; only wrap) | 0 |
| critical_reports | 3 (already TO authenticated; only wrap) | 0 |
| audit_log | 2 (admins_read_audit needs TO authenticated added) | 1 |
| store_follows | 0 (already optimized in migration 20260528000003) | 0 |
| product_categories | 4 | 4 |
| storage.objects (public schema, multiple buckets) | ~10 to wrap | ~6 (owner-specific ones; public reads stay TO public/anon) |

Total estimated: ~67 policies to ALTER (some only USING, some only WITH CHECK, some
both); ~55 policies to gain `TO authenticated`.

Note on `block_aware_messages_select`: the audit shows it has no `auth.uid() IS NULL`
branch but does have `chats.comprador_id = auth.uid()` checks. This means anon never
sees messages. It SHOULD be `TO authenticated`. Decision in FASE B: add `TO authenticated`.

## 5. Index plan

3 indexes, all `CREATE INDEX CONCURRENTLY IF NOT EXISTS`:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_services_categoria_id
  ON public.products_services(categoria_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trust_level_verification_user_id
  ON public.trust_level_verification(user_id);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_seller_id
  ON public.appointments(seller_id);
```

Reasons:
- `CONCURRENTLY`: avoids long row locks on the table being indexed. Safe for production
  while the app is live. Required for `products_services` which may already be sizable.
- `IF NOT EXISTS`: idempotent — re-running the script does not error.
- All three are simple btree (default). No partial / functional indexes needed (the
  filtered columns are direct equality matches in RLS).

Constraint: `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**. The
script structure must place index creation OUTSIDE the BEGIN/COMMIT of the policy
changes (see section 6).

## 6. Script structure — dry-run, then real run

The script in FASE B will have THIS structure (Pedro runs the whole thing in one
Studio paste, but reads the verification before committing):

```sql
-- ============================================================
-- BLOCK 1: SNAPSHOT BEFORE (read-only, no transaction needed)
-- ============================================================
-- Lists every policy with its current qual + with_check, so Pedro
-- has a snapshot to compare against.
SELECT schemaname, tablename, policyname, cmd, roles,
       qual, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- ============================================================
-- BLOCK 2: DRY-RUN — wrap the changes in BEGIN/ROLLBACK first
-- so Pedro can read the output of the verification query inside
-- the same transaction without persisting any change.
-- ============================================================
BEGIN;

-- ... all ALTER POLICY statements ...

-- Verification inside transaction:
SELECT COUNT(*) AS policies_still_inline
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (
    (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%( SELECT auth.uid()%')
    OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%( SELECT auth.uid()%')
  );
-- Expected: 0

SELECT COUNT(*) AS policies_with_to_authenticated
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND 'authenticated' = ANY(roles);

ROLLBACK;  -- discard the dry-run; nothing persisted

-- ============================================================
-- BLOCK 3: REAL RUN — same SQL, committed
-- (Pedro re-pastes the same ALTER statements with BEGIN/COMMIT
--  after the dry-run confirms expected counts)
-- ============================================================
BEGIN;
-- ... same ALTER POLICY statements ...
COMMIT;

-- ============================================================
-- BLOCK 4: INDEXES (outside transaction; CONCURRENTLY required)
-- ============================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_services_categoria_id
  ON public.products_services(categoria_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_trust_level_verification_user_id
  ON public.trust_level_verification(user_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_appointments_seller_id
  ON public.appointments(seller_id);

-- ============================================================
-- BLOCK 5: FINAL VERIFY (read-only)
-- ============================================================
-- Confirm all policies converted:
SELECT schemaname, tablename, policyname, cmd, roles
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
  AND (
    (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%( SELECT auth.uid()%')
    OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%( SELECT auth.uid()%')
  );
-- Expected: 0 rows returned

-- Confirm indexes created:
SELECT schemaname, tablename, indexname
FROM pg_indexes
WHERE indexname IN (
  'idx_products_services_categoria_id',
  'idx_trust_level_verification_user_id',
  'idx_appointments_seller_id'
);
-- Expected: 3 rows
```

Pedro's process:
1. Paste BLOCK 1, run, save the output (snapshot before).
2. Paste BLOCK 2 (the dry-run), run, read the verification numbers. If expected, ROLLBACK already ran inside the block.
3. Paste BLOCK 3, run. Reads "COMMIT" in output.
4. Paste BLOCK 4 (indexes, one at a time if Studio prefers — they can take seconds each).
5. Paste BLOCK 5, run. Confirm counts.

## 7. Versioned migration file

The same SQL also lives in:

```
supabase/migrations/20260602000001_optimize_rls_performance.sql
```

This is committed to git for auditability. It is **not applied via `supabase db push`** —
Pedro runs the equivalent in Studio. The file matters because:
- Future `supabase db pull` will sync this state (no drift detection error)
- A new environment created from `supabase db reset` will apply this migration locally
- Git history shows the change with a timestamp

Per the existing memory `reference_supabase_project.md`, the `schema_migrations` ledger
in production is already desynchronized — running CLI commands from this state has known
risks. Pedro's manual application via Studio is the safer path for this change too.

## 8. Risk analysis

| Risk | Likelihood | Mitigation |
|---|---|---|
| ALTER POLICY fails because policy name does not match exactly (e.g., case sensitivity) | Low — names captured verbatim from migrations | Snapshot before; FASE B verifies every policy name exists in pg_policies before generating ALTER |
| Wrapping changes semantics (e.g., for a policy that needs per-row evaluation) | Negligible — `auth.uid()` is stable within a transaction by design | Postgres docs explicitly recommend the wrap as a no-op semantic change |
| Index creation blocks production traffic | Low — CONCURRENTLY avoids row locks | Each CREATE INDEX CONCURRENTLY may take minutes on large tables but does not block reads/writes |
| Dry-run BLOCK 2 fails partially mid-transaction | Low — Postgres rolls back automatically on error inside BEGIN | Pedro sees the error, fixes the offending ALTER, re-runs |
| F2 changes (adding TO authenticated) accidentally locks out anon access | Medium — needs careful classification | Section 3 above explicitly lists which policies KEEP TO public; FASE B mapping enforces this |

## 9. Out-of-scope items (re-confirmed)

- PostGIS (`idx_products_location` GIST on `ubicacion_geo`) — already present, not touched
- Polymorphic `media_assets` refactor — deferred
- `reviews.visible` deprecation — separate cleanup
- F5 (getClaims) — requires Supabase Dashboard asymmetric JWT setting (Pedro action)
