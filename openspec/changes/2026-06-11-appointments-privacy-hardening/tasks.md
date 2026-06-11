# Tasks -- #8: appointments privacy + booking integrity

## FASE A -- OpenSpec
- [x] proposal.md, design.md, tasks.md, specs/appointments/spec.md, studio-script.sql

## FASE B -- mirror + app edit + commit
- [x] 20260611000001_appointments_privacy_hardening.sql (SELECT participants + get_booked_slots +
      INSERT gate + status-only trigger + REVOKEs)
- [x] app: appointment-scheduler.tsx booked-slots read -> rpc('get_booked_slots')
- [x] handleConfirm / cancelAppointment UNCHANGED (governed by policy + trigger)
- [x] residual: no direct read of others' appointments (scheduler is the only public read -> RPC now)
- [x] pnpm build green
- [x] CODEX review; HIGH -> STOP

## FASE C -- Studio (DONE)
- [x] SELECT participants; get_booked_slots; INSERT "Buyers can book appointments";
      appointments_guard_update trigger; UPDATE participants; REVOKE anon write / auth DELETE+TRUNCATE
- [ ] P-reconcile: pg_get_functiondef(get_booked_slots / appointments_guard_update) + pg_policies vs mirror
- [ ] P-smoke: non-participant SELECT -> 0 rows; get_booked_slots -> times only; forged seller_id INSERT
      -> rejected; UPDATE of buyer_id/dates -> 42501; cancel (status) -> ok; scheduler grid + booking work

## Out of scope
- completed transition (future cron/admin). #9 / #12 / #14.
