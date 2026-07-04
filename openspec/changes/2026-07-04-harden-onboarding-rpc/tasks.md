# Tasks -- Harden onboarding RPC

> FASE A = OpenSpec (this directory). FASE B = SQL (studio-script + mirror migration) +
> commit (Claude). FASE C = Pedro runs the SQL in Supabase Studio (Camino 2).
> No `pnpm build` gate for the DB change itself; client is verified (no code change),
> `pnpm type-check` must stay green.

## FASE A -- OpenSpec (this directory)

- [x] T-01 -- proposal.md (why + what + scope + success criteria)
- [x] T-02 -- design.md (DEFINER decision after FASE C grant audit + 0-rows note + delivery)
- [x] T-03 -- tasks.md (this file)
- [x] T-04 -- specs/onboarding/spec.md (EARS delta: R1/R2/R3)
- [ ] T-05 -- PARA y reportar a Pedro. Esperar sign-off antes de FASE B.

---

## FASE B -- SQL + commit (Claude, after Pedro signs off on FASE A)

- [ ] T-06 -- studio-script.sql (4 blocks Camino 2):
  - BLOCK 1 SNAPSHOT (read-only): column existence; `pg_get_functiondef` of the RPC if it
    exists; profiles UPDATE policies; current grants.
  - BLOCK 2 DRY-RUN: `BEGIN; <WRITE>; ROLLBACK;`
  - BLOCK 3 APPLY: `BEGIN; <WRITE>; COMMIT;`
  - BLOCK 4 VERIFY + RLS smoke (Pedro fills `<UUID>`).
- [ ] T-07 -- mirror migration `supabase/migrations/20260704000001_harden_complete_user_onboarding.sql`
  (idempotent `CREATE OR REPLACE` + REVOKE/GRANT; pattern `20260521000011_rpc_update_profile_and_pause.sql`).
- [ ] T-08 -- confirm NO app edits required (client already wired); the only allowed edit is
  the `revalidatePath("/", "layout")` fallback IF the redirect proves sticky in FASE C verify.
- [x] T-09 -- explicit `git add` (studio-script + migration + this openspec dir) + ASCII commit.
  Subfase A first landed as `fix(security): harden complete_user_onboarding RPC to INVOKER + revoke anon`
  (bcf0f72); corrected after the FASE C grant audit with
  `fix(security): correct onboarding RPC to hardened DEFINER after grant audit`.
- [ ] T-10 -- CODEX adversarial review loop (CLAUDE.md) on the SQL (migrations = max priority):
  blocker HIGH = STOP, max 3 iterations. PARA y entregar el script a Pedro antes de que corra.

> **Bookkeeping note (schema_migrations ledger).** The mirror migration is repo-of-record and
> is NOT applied via `supabase db push`. The project's `schema_migrations` ledger is already
> desynchronized (memory `reference_supabase_project.md`). After Pedro applies the WRITE in
> Studio (FASE C), insert the ledger row by hand so future CLI diffs do not try to re-run it:
> ```sql
> INSERT INTO supabase_migrations.schema_migrations (version, name)
> VALUES ('20260704000001', 'harden_complete_user_onboarding')
> ON CONFLICT (version) DO NOTHING;
> ```
> Run this only after BLOCK 3 (APPLY) succeeds.

---

## FASE C -- Pedro execution (Supabase Studio, browser)

- [ ] P-1 -- Open Studio SQL editor for project `oxxdkwywprkfghhbnoto`.
- [ ] P-2 -- Paste BLOCK 1 (SNAPSHOT), run. Capture current `prosecdef`/`proconfig`/grants of
  the live RPC (confirms whether it was DEFINER + anon-executable as suspected).
- [ ] P-3 -- Paste BLOCK 2 (DRY-RUN), run. Confirms the WRITE applies cleanly; ROLLBACK
  persists nothing.
- [ ] P-4 -- Paste BLOCK 3 (APPLY), run. Confirm COMMIT, no errors.
- [ ] P-5 -- Paste ledger INSERT (bookkeeping note above), run.
- [ ] P-6 -- Paste BLOCK 4 (VERIFY), run. Expected: `prosecdef=true` (DEFINER); `proconfig`
  contains `search_path=""`; `authenticated` has EXECUTE; `anon`/`PUBLIC` have none.
- [ ] P-7 -- RLS smoke test (fill `<UUID>` with a real test user): `has_seen_onboarding`
  flips to `true` for that row inside the tx; ROLLBACK.

---

## Closing

- [ ] T-11 -- Client verification (2 viewports, mobile 375x812 + desktop 1280x800): fresh
  user `has_seen_onboarding=false` -> `/bienvenida` -> click "Solo quiero explorar" -> no
  toast error -> reload `/` -> no longer redirects. preview_* MCP + final screenshot.
- [ ] T-12 -- `pnpm type-check` green.
- [ ] T-13 -- push (PAT; clean remote URL after) + open PR to master. Wait for Pedro's
  validation before FF-only merge.
- [ ] T-14 -- After merge: `openspec archive` this change; delete local + remote branch;
  restore the GATE 0 `git stash` ("pwa-config-artifacts") separately if still wanted.

## Rollback plan

The change only replaces one function definition and its grants. To revert:
1. `CREATE OR REPLACE` the previous function body (captured in BLOCK 1 SNAPSHOT), or
2. re-apply the prior grants. No user data is touched by the function definition change.
The RLS smoke ROLLBACK guarantees the verify step persists nothing.
