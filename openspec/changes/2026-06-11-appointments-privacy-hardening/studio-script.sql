-- =============================================================================
-- #8 appointments privacy + booking integrity -- STUDIO SCRIPT
-- Change: 2026-06-11-appointments-privacy-hardening
-- =============================================================================
-- STATUS: ALREADY APPLIED (Camino 2, COMMIT). Idempotent. Canonical SQL in
-- 20260611000001_appointments_privacy_hardening.sql.
-- =============================================================================

-- ---- BLOCK 1: SNAPSHOT (read-only) ----
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE schemaname='public' AND tablename='appointments'
ORDER BY cmd, policyname;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='appointments' AND grantee IN ('anon','authenticated')
ORDER BY grantee, privilege_type;

-- ---- BLOCK 2: APPLY (see migration for full bodies) ----
-- DROP POLICY "Anyone can view appointments"; CREATE "Participants can view appointments";
-- CREATE FUNCTION get_booked_slots(uuid, date) ... GRANT anon, authenticated;
-- DROP POLICY "Authenticated users can create"; CREATE "Buyers can book appointments" (gated);
-- CREATE FUNCTION appointments_guard_update() + TRIGGER appointments_guard_update BEFORE UPDATE;
-- REVOKE INSERT,UPDATE,DELETE,TRUNCATE FROM anon; REVOKE DELETE,TRUNCATE FROM authenticated;

-- ---- BLOCK 3: VERIFY ----
SELECT policyname, cmd, qual, with_check FROM pg_policies
WHERE schemaname='public' AND tablename='appointments' ORDER BY cmd, policyname;
-- expect: SELECT participants-only (no USING true); INSERT gated; UPDATE participants.
SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('get_booked_slots','appointments_guard_update');
SELECT tgname FROM pg_trigger WHERE tgrelid='public.appointments'::regclass AND NOT tgisinternal;
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='appointments' AND grantee IN ('anon','authenticated')
ORDER BY grantee, privilege_type;
-- expect: anon no write; authenticated SELECT/INSERT/UPDATE (no DELETE/TRUNCATE).

-- ---- BLOCK 4: SMOKE (SET LOCAL ROLE authenticated; replace uuids; BEGIN/ROLLBACK) ----
-- non-participant SELECT -> 0 rows; get_booked_slots(<product>,<date>) -> times only;
-- INSERT with seller_id != product creador -> rejected; UPDATE buyer_id/date -> 42501;
-- UPDATE status='cancelled' (participant, confirmed) -> ok.
