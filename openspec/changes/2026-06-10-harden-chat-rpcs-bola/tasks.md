# Tasks -- CH-2: harden chat RPCs (#4)

> FASE A = OpenSpec (this dir). FASE B = SQL mirror + commit. FASE C = Pedro runs
> the SQL in Studio. No `pnpm build` gate for the DB change -- signature is preserved,
> so NO app code is touched. FASE C was done first (Pedro applied + verified live).

## FASE A -- OpenSpec (this directory)

- [x] T-01 - proposal.md (#4 + the mark_messages_as_read non-participant extra finding)
- [x] T-02 - design.md (Option C signature-preserving + participation guard + self-chat/product validation)
- [x] T-03 - tasks.md (this file)
- [x] T-04 - specs/chat/spec.md (EARS delta)
- [x] T-05 - studio-script.sql (5-block Camino 2 record)

## FASE B -- SQL mirror + commit

- [x] T-06 - mirror migration `supabase/migrations/20260610000003_harden_chat_rpcs.sql`
  (idempotent CREATE OR REPLACE, both RPCs + REVOKE/GRANT)
- [x] T-07 - confirm NO app edits required (signature preserved); the 3 call sites
  (chat/actions.ts:43,197; chat/[id]/page.tsx:87) are unchanged
- [x] T-08 - explicit `git add` + ASCII commit:
  `fix(security): chat RPCs derive auth.uid + participation guard (#4)`
- [x] T-09 - CODEX adversarial review; HIGH -> STOP

## FASE C -- Pedro execution (Studio) -- DONE

- [x] P-1 - get_or_create_chat CREATE OR REPLACE + REVOKE anon/PUBLIC + GRANT authenticated (COMMIT)
- [x] P-2 - mark_messages_as_read CREATE OR REPLACE + REVOKE anon/PUBLIC + GRANT authenticated (COMMIT)
- [x] P-3 - VERIFY: both functions authenticated|EXECUTE only, zero anon
- [ ] P-4 - (optional) smoke S1 (non-participant mark-read -> forbidden) and S2
  (get_or_create_chat ignores p_comprador_id -> buyer = auth.uid())
- [ ] P-5 - reconcile `pg_get_functiondef` of both RPCs against the migration mirror

## Closing

- [ ] T-10 - shipped together with the P0 in the same PR (branch security/fase0-audit-verification).
- [ ] T-11 - merge + archive after Pedro/Alejandro sign-off.

## Out of scope (separate change)

- Remove vestigial `p_comprador_id` / `p_user_id` params (2-arg cleanup, via transient overload).
- #14 has_role info-disclosure (LAST).
