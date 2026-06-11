# Spec -- chat (delta)

> Domain: database-level authorization for the VICINO chat RPCs (`get_or_create_chat`,
> `mark_messages_as_read`).
> DELTA spec introduced by change `2026-06-10-harden-chat-rpcs-bola`. Merged into a canonical
> `openspec/specs/chat/spec.md` on archive.
> Last updated: 2026-06-10

---

## Context

The chat RPCs are `SECURITY DEFINER` and reachable over PostgREST with the anon key. The acting
user MUST be derived server-side from `auth.uid()`, never asserted by the client payload,
otherwise any caller can act as any user (BOLA/IDOR).

---

## Requirement R1 -- get_or_create_chat SHALL derive the buyer from auth.uid()

WHEN `get_or_create_chat` is invoked, the buyer SHALL be derived from `auth.uid()`, NOT from the
payload; an anonymous caller SHALL be rejected; a self-chat (`auth.uid()` equals the seller)
SHALL be rejected; and when a product id is supplied it SHALL belong to the given seller. The
function signature is preserved (the legacy `p_comprador_id` argument is accepted but ignored).

### Scenario: payload buyer id is ignored
- GIVEN an authenticated user U calls `get_or_create_chat(<some other uuid>, S, P)`
- WHEN the chat is created
- THEN the new chat's `comprador_id` is U (`auth.uid()`), not the passed-in id

### Scenario: anonymous caller is rejected
- GIVEN a request with no authenticated user (`auth.uid()` is NULL)
- WHEN it calls `get_or_create_chat`
- THEN the call is rejected (unauthenticated) and no chat row is created

### Scenario: self-chat and invalid product are rejected
- GIVEN an authenticated user U
- WHEN U calls `get_or_create_chat(_, U, _)` (seller = self) OR passes a product not owned by the seller
- THEN the call raises an error and no chat is created/modified

---

## Requirement R2 -- mark_messages_as_read SHALL require participation and derive the actor from auth.uid()

WHEN `mark_messages_as_read` is invoked, the actor SHALL be derived from `auth.uid()` (the
payload `p_user_id` is ignored), and the function SHALL act only if the actor is the buyer or
the seller of the target chat. WHEN a non-participant invokes it, the system SHALL reject the
call (`forbidden`). A non-existent chat SHALL be a no-op.

### Scenario: non-participant is rejected
- GIVEN an authenticated user X who is neither the buyer nor the seller of chat C
- WHEN X calls `mark_messages_as_read(C, <any uuid>)`
- THEN the call raises `forbidden`
- AND no message read-state or unread counter is changed (in particular the seller's
  `no_leidos_vendedor` is NOT zeroed)

### Scenario: participant marks only their own side
- GIVEN the buyer of chat C
- WHEN they call `mark_messages_as_read(C, <any uuid>)`
- THEN only `leido_por_comprador` / `no_leidos_comprador` are updated (buyer side), derived from `auth.uid()`

---

## Requirement R3 -- both chat RPCs SHALL be EXECUTE-able only by authenticated

WHEN granting execution on `get_or_create_chat` and `mark_messages_as_read`, the system SHALL
revoke EXECUTE from `anon` and `PUBLIC` and grant it only to `authenticated`, with
`SET search_path = public, pg_temp`.

### Scenario: anon has no EXECUTE
- GIVEN the hardened RPCs
- WHEN grants are inspected
- THEN `anon` has no EXECUTE on either function; `authenticated` has EXECUTE

## Implementation notes

- Signature-preserving (Option C): no app edits; the 3 call sites pass values that are now ignored.
- Mirror migration: `supabase/migrations/20260610000003_harden_chat_rpcs.sql`.
- Removing the vestigial id params (2-arg) is a deferred cosmetic cleanup (transient overload).
