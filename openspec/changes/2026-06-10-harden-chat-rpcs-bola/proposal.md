# Proposal -- CH-2: harden chat RPCs against BOLA/IDOR (#4)

## Why

Audit finding #4 (CWE-639 / CWE-862, Alto/CVSS 8.1). `get_or_create_chat` and
`mark_messages_as_read` are `SECURITY DEFINER` but derived the acting user from a
client-supplied parameter (`p_comprador_id` / `p_user_id`) instead of `auth.uid()`, and had
the Supabase default EXECUTE grant to anon/authenticated. A direct PostgREST call (bypassing
the app) could therefore act as ANY user:

- `get_or_create_chat(victimBuyer, victimSeller, ...)` -> create/reopen a chat between two
  arbitrary third parties and unhide it.
- `mark_messages_as_read(victimChat, victimUser)` -> mark another user's messages read / zero
  their unread counter.

Extra finding surfaced during prep (`docs/security/2026-06-10-ch2-chat-rpcs-prep.md`):
`mark_messages_as_read`'s `ELSE` branch treated "not the buyer" as "is the seller", so a
logged-in NON-participant could zero the SELLER's unread counter for any chat id.

Evidence (production): `supabase/migrations/20260320000009_chats_messages.sql:41-74`
(get_or_create_chat) and `:98-115` (mark_messages_as_read). search_path was already locked in
`20260425000001:8-12`, but neither had an auth guard or REVOKE.

## What

**Option C -- signature-preserving derive-in-place** (chosen over a 2-arg signature change to
avoid a deploy-order race against the live app; see design.md). Both functions keep their exact
signatures so the 3 existing call sites and live PostgREST calls keep resolving -- ZERO app
edits -- but now:

- Derive the actor from `auth.uid()` and IGNORE the client-supplied id param.
- `get_or_create_chat`: reject anon, reject self-chat, and validate that `p_producto_id`
  (when given) belongs to `p_vendedor_id`.
- `mark_messages_as_read`: reject anon, look up the chat participants, and act only if the
  caller is the buyer or the seller; reject non-participants (`forbidden`).
- `REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM anon` + `GRANT EXECUTE TO authenticated` on
  both; keep `SET search_path = public, pg_temp`.

Applied by Pedro in Supabase Studio (Camino 2, COMMIT). VERIFY: both functions are
`authenticated | EXECUTE` only, zero anon. Mirror migration:
`supabase/migrations/20260610000003_harden_chat_rpcs.sql` (idempotent, `CREATE OR REPLACE`).

## Scope

### IN
- `CREATE OR REPLACE` of both RPCs (signature-preserving) + REVOKE/GRANT.
- Mirror migration + studio-script + this OpenSpec change + EARS delta spec.

### OUT
- Removing the vestigial `p_comprador_id` / `p_user_id` params (cosmetic 2-arg cleanup) --
  deferred; would require a transient overload to avoid a deploy-order race.
- #14 `has_role` info-disclosure -- separate change, LAST.

## Call sites (unchanged)

The signature is preserved, so NO app edits are needed. The 3 callers already pass the
server-derived `user.id` (now ignored in favor of `auth.uid()`):
- `apps/web/app/(marketplace)/chat/actions.ts:43` (get_or_create_chat)
- `apps/web/app/(marketplace)/chat/actions.ts:197` (mark_messages_as_read)
- `apps/web/app/(marketplace)/chat/[id]/page.tsx:87` (mark_messages_as_read)

## Success criteria

1. `get_or_create_chat` called by anon (no JWT) is rejected; called by an authenticated user
   creates a chat whose `comprador_id = auth.uid()` regardless of `p_comprador_id`.
2. Self-chat (`auth.uid() = p_vendedor_id`) is rejected.
3. `mark_messages_as_read` called by a non-participant raises `forbidden`; called by a
   participant marks only their own side read.
4. Both functions: `authenticated | EXECUTE` only, zero anon (VERIFY query).
5. No app behavior change for legitimate flows (start chat, open chat, mark read).

## References

- Prep dossier: `docs/security/2026-06-10-ch2-chat-rpcs-prep.md` (verdict: Option C)
- Canonical hardening pattern: `20260521000011_rpc_update_profile_and_pause.sql`
- Reviewer suggested: Alejandro (audit author)
