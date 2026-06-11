# Design -- CH-2: harden chat RPCs (#4)

## Threat model

Supabase exposes every `public` function over PostgREST (`/rest/v1/rpc/<fn>`) callable with
the anon key. A `SECURITY DEFINER` function that trusts a client-supplied identity parameter is
a BOLA/IDOR: the caller asserts who they are instead of the server deriving it. Both chat RPCs
did exactly this.

## Why Option C (signature-preserving) over a 2-arg signature change

The prep dossier (`docs/security/2026-06-10-ch2-chat-rpcs-prep.md`) evaluated three options:

| Option | Cost | Risk |
|---|---|---|
| A. Direct 2-arg (`DROP` + `CREATE`, edit the 1 call site) | small | **Deploy-order race**: prod's live app keeps calling the 3-arg signature until Vercel publishes the 2-arg caller -> a multi-minute window where "start chat" breaks for everyone. |
| B. Transient overload (2-arg + 3-arg shim, then drop shim) | medium | safe, but 2 DB steps + 1 app edit + later cleanup |
| C. Derive-in-place, keep the signature | minimal | **none** -- zero app edits, no deploy race |

The security goal is to stop TRUSTING the client id, not to REMOVE the param. Option C achieves
that by deriving `auth.uid()` inside the existing signature and ignoring the param. The constraint
that rules out A is the deploy window against the live app, not the number of call sites.
Removing the now-vestigial params is cosmetic and deferred (would use B if ever done).

## get_or_create_chat

- `v_comprador := auth.uid()`; reject if NULL (anon out).
- Reject self-chat (`v_comprador = p_vendedor_id`) -- mirrors the app's defense-in-depth check
  at `chat/actions.ts:39`, now enforced at the DB boundary too.
- If `p_producto_id` is given, validate it belongs to `p_vendedor_id` (closes "create a chat
  about someone else's product"). Ownership only -- NOT status -- so chats about paused/sold
  items still work.
- The symmetric lookup `(comprador=v_comprador AND vendedor=p_vendedor) OR (mirror)` and the
  unhide-both block are unchanged (one chat per pair; reopen-on-contact).
- Return type unchanged (`UUID`), so the caller contract `{ chatId } | { error }` is preserved.

## mark_messages_as_read

- `v_user := auth.uid()`; reject if NULL.
- Look up `comprador_id, vendedor_id` for `p_chat_id`. If the chat doesn't exist -> no-op
  `RETURN` (avoids a spurious error on a deleted chat).
- If `v_user = comprador` -> mark buyer side; ELSIF `v_user = vendedor` -> mark seller side;
  ELSE raise `forbidden`. This fixes the original `ELSE` bug where "not the buyer" fell through
  to "is the seller", letting a non-participant zero the seller's counter.
- Return type unchanged (`VOID`); the 2 callers ignore the result, so a `forbidden` raise on a
  direct attack does not affect legitimate UI flows.

## Grants & idempotency

- Both: `REVOKE ALL FROM PUBLIC`, `REVOKE EXECUTE FROM anon`, `GRANT EXECUTE TO authenticated`.
  The in-body `auth.uid()` guard already rejects anon; the REVOKE is defense-in-depth at the
  grants layer (mirrors `20260521000011`).
- `CREATE OR REPLACE` (same signature) -> idempotent, no `DROP`, no signature-change race.
- `SET search_path = public, pg_temp` retained (search_path injection guard).

## Faithfulness note

The mirror migration reproduces the applied behavior per this design. If the live body differs
(e.g., product validation also checks `estatus`/`is_hidden`, or self-chat uses a different
SQLSTATE), reconcile against `SELECT pg_get_functiondef(...)` and update the migration.

## Migration ordering

`20260610000003_harden_chat_rpcs.sql` follows `...0002` (manage_user_role) and depends only on
objects that exist well before it (chats, messages, products_services, the RPC defs from
20260320000009).
