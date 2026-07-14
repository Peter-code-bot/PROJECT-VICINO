# Spec -- service-role-isolation (delta)

> Domain: isolation of the Supabase service-role key away from the Vercel runtime, and
> the two user-facing capabilities that previously leaked it (in-app account deletion,
> admin verification-docs review).
> This is a DELTA spec -- it defines requirements introduced by change
> `2026-07-09-eradicate-vercel-service-role-key`. It merges into a canonical
> `openspec/specs/service-role-isolation/spec.md` after the change archives.
> Last updated: 2026-07-09

---

## Context

VICINO deploys the Next.js app on Vercel, where `SUPABASE_SERVICE_ROLE_KEY` is
intentionally NOT configured. The sanctioned home for the key is Supabase Edge Function
secrets (house rule: "Service Role solo en Edge Functions, jamas en cliente"). Two
runtime consumers violated this and crashed: the account-deletion Server Action and the
admin verifications panel. Account deletion is store-mandated (Apple 5.1.1(v) -- iOS is
published; Google Play Data deletion -- launch pending) and rights-mandated (LFPDPPP
cancelacion).

---

## Requirement R1 -- Authenticated users SHALL delete their account in-app through the three-layer circuit

WHEN an authenticated user confirms account deletion in the app (typing the confirmation
word), the system SHALL execute the full deletion circuit: the API route validates the
confirmation and session and forwards the CALLER'S JWT to the `delete-account` Edge
Function, which SHALL (1) delete relational data via the transactional
`delete_user_data` RPC, (2) best-effort remove the user's storage objects across the five
user-content buckets, and (3) delete the auth user via the GoTrue Admin API. Deletion
semantics are hard-delete with selective anonymization (received reviews anonymized,
moderation/audit trails preserved, `account_deletion_log` retained 90 days).

### Scenario: happy-path deletion

- GIVEN a logged-in user on `/configuracion` who typed `ELIMINAR`
- WHEN they confirm deletion
- THEN `/api/account/delete` returns success, the session is signed out, and the client
  redirects to `/cuenta-eliminada`
- AND their profile, listings, chats, favorites, notifications and other owned rows are
  gone; their received reviews are anonymized; their storage files are removed
- AND a subsequent login with the same credentials fails (auth user deleted)

### Scenario: errors are surfaced, never swallowed

- GIVEN the Edge Function or RPC fails for any reason
- WHEN the deletion is attempted
- THEN the UI shows the error in the visible error box (no silent spinner, no silent
  no-op)

---

## Requirement R2 -- Only the account owner SHALL trigger their own deletion

WHEN the deletion circuit executes, the system SHALL derive the target user exclusively
from the caller's JWT: the Edge Function validates the forwarded token (`getUser`) and
`delete_user_data` SHALL raise for any caller whose `auth.uid()` differs from the target
(`Unauthorized: cannot delete another user's data`). No client-supplied user id SHALL be
trusted anywhere in the circuit.

### Scenario: cross-user deletion attempt is rejected

- GIVEN an authenticated user A holding a valid session
- WHEN `delete_user_data` is invoked with `target_user_id` = user B
- THEN the function raises and no row of user B is deleted

### Scenario: anonymous invocation is rejected

- GIVEN a request with no valid JWT
- WHEN it POSTs to the Edge Function or the API route
- THEN it is rejected with 401 and nothing is deleted

---

## Requirement R3 -- The Vercel runtime SHALL NOT use the service-role key

WHEN the `apps/web` runtime code (app/, lib/, components/) is inspected, the system SHALL
contain ZERO references to `SUPABASE_SERVICE_ROLE_KEY` and ZERO admin-client
constructions. The service-role key SHALL live only in Supabase Edge Function secrets
(read via `Deno.env`) and in local, gitignored dev-tooling env for seed/QA scripts.

### Scenario: runtime grep is clean

- GIVEN the change is applied
- WHEN `grep -r "SUPABASE_SERVICE_ROLE_KEY\|createAdminClient" apps/web/app apps/web/lib apps/web/components` runs
- THEN it returns zero matches
- AND `apps/web/lib/supabase/admin.ts` no longer exists (or every importer is documented)

### Scenario: future admin-privileged needs go to Edge Functions

- GIVEN a future feature needs service-role privileges
- WHEN it is designed
- THEN the privileged code lands in a Supabase Edge Function (key via `Deno.env`), never
  in a Vercel Server Action, route handler, or page

---

## Requirement R4 -- Admins SHALL review verification docs without the service-role key

WHEN an admin opens `/admin/verifications`, the system SHALL generate signed URLs for
INE/selfie documents using the ADMIN'S OWN authenticated client, authorized at the DB
layer by a `storage.objects` SELECT policy scoped to `bucket_id =
'verification-documents'` and `has_role((select auth.uid()), 'admin'::app_role)`. The
policy SHALL be `TO authenticated` and SHALL use the InitPlan-wrapped `auth.uid()` form
(rls-performance R1/R2 conventions).

### Scenario: admin sees the documents

- GIVEN an authenticated user holding the `admin` role
- WHEN `/admin/verifications` renders pending verifications
- THEN signed URLs for selfie/INE-front/INE-back resolve and display
- AND no admin client or service-role key is involved

### Scenario: non-admin cannot sign verification docs

- GIVEN an authenticated user WITHOUT the `admin` role
- WHEN they attempt `createSignedUrl` on an object in `verification-documents`
- THEN the Storage API rejects it (no matching SELECT policy)
