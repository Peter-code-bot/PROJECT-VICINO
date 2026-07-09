-- Grant column-level SELECT on profiles.has_seen_onboarding
-- Change: 2026-07-04-harden-onboarding-rpc (read-side companion to 20260704000001).
--
-- Root cause (verified live 2026-07-09): public.profiles carries COLUMN-LEVEL
-- grants (change 2026-06-10-mass-assignment-column-locks) -- `authenticated` has
-- SELECT on every column EXCEPT the sensitive set (has_seen_onboarding, email,
-- fcm_token, rfc, telefono, ...). The has_seen_onboarding column was added later
-- (20260629000001) WITHOUT its grant. Postgres rejects the ENTIRE statement when
-- any selected column lacks privilege, so the (marketplace) layout gate query
-- (`select nombre, foto, es_vendedor, has_seen_onboarding`) failed with 42501,
-- profile collapsed to null, and every logged-in user bounced to /bienvenida
-- forever -- an active production incident, resolved by this grant.
--
-- Least privilege preserved: SELECT only, `authenticated` only. NO UPDATE on the
-- column -- writes go exclusively through the hardened SECURITY DEFINER RPC
-- public.complete_user_onboarding() (20260704000001).
--
-- Lesson (institutional): when adding a column to a table with column-level
-- privileges, the same migration MUST grant the column explicitly, or every
-- SELECT that includes it fails whole. Check with
-- information_schema.column_privileges (role_table_grants shows nothing for
-- column-granted tables and misleads the audit).
--
-- Delivery: Camino 2 (Pedro applied this in Studio on 2026-07-09; verified:
-- authenticated now holds INSERT/REFERENCES/SELECT on the column, no UPDATE).
-- This file is repo-of-record and is NOT applied via `supabase db push`.
-- Bookkeeping: insert version '20260704000002' into
-- supabase_migrations.schema_migrations by hand in Studio (see studio-script).

GRANT SELECT (has_seen_onboarding) ON public.profiles TO authenticated;

-- Tell PostgREST to reload its schema cache so the grant is picked up.
NOTIFY pgrst, 'reload schema';
