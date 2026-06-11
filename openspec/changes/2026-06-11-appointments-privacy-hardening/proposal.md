# Proposal -- #8: appointments privacy + booking integrity

## Why

Audit finding #8 (CWE-200 / CWE-284, Alto 8.2). `public.appointments` had:
- `SELECT USING (true)` ("Anyone can view appointments") -> any anon/authenticated client could
  read EVERYONE's agenda (buyer/seller ids, dates, notes) -> doxxing, harassment, competitive
  intel on a seller's bookings.
- INSERT `WITH CHECK (auth.uid() = buyer_id)` only -> `seller_id` was client-supplied (spoofable
  to an arbitrary user) and there was no `allow_appointments` / `disponible` check -> spam
  appointments against any user/product.
- UPDATE with no column restriction -> a participant could rewrite ids/dates/status of a row.

## What (applied in Studio, Camino 2, COMMIT)

- **SELECT** -> drop `USING(true)`; `"Participants can view appointments"` (buyer OR seller OR
  admin).
- **`get_booked_slots(p_product_id uuid, p_date date)`** SECURITY DEFINER (GRANT anon +
  authenticated) -> returns ONLY the `confirmed` `appointment_start` times for the product+date,
  with NO buyer identity / notes. The scheduler's "Ocupado" grid reads this instead of the table.
- **INSERT** -> `"Buyers can book appointments"`: `buyer_id = auth.uid()`, `buyer_id <> seller_id`,
  and the product must belong to `seller_id` with `allow_appointments = true`, `estatus =
  'disponible'`, `is_hidden = false`.
- **UPDATE** -> participants-only policy kept + `appointments_guard_update` BEFORE-UPDATE trigger:
  only `status` (and system reminder flags) may change; identity/schedule columns immutable;
  terminal states (`cancelled`/`completed`) are final.
- **Grants** -> REVOKE write from anon; REVOKE DELETE/TRUNCATE from authenticated.

Migration: `supabase/migrations/20260611000001_appointments_privacy_hardening.sql`.
App edit (1): `appointment-scheduler.tsx` booked-slots read -> `rpc('get_booked_slots')`.

## Scope

### IN
- The SELECT/INSERT/UPDATE policy changes, `get_booked_slots`, the guard trigger, the REVOKEs,
  the 1 scheduler edit, mirror migration + delta spec.

### OUT
- A `completed` transition (no app writer today; future cron/admin). #9/#12/#14 (separate).

## Caller impact

- `appointment-scheduler.tsx` booked-slots read -> RPC (migrated). `handleConfirm` (INSERT) and
  `citas/[id]/actions.ts` `cancelAppointment` (UPDATE status) are UNCHANGED -- governed by the
  new policy + trigger (the app already sends buyer_id=auth.uid, seller_id=product.creador,
  and only changes status).
- `weekly-widget.tsx` / `citas/*` read own appointments -> covered by the participants SELECT.
- `send-appointment-reminders` (service-role cron) updates only reminder flags -> allowed by the
  trigger.

## Success criteria

1. A non-participant SELECT of appointments returns 0 rows; `get_booked_slots` returns only times.
2. An INSERT with a forged `seller_id` (not the product creator) or for a product with
   `allow_appointments=false` is rejected.
3. A direct UPDATE changing `buyer_id`/`seller_id`/dates is rejected (42501); changing only
   `status` (cancel) works; a terminal-state transition is rejected.
4. The scheduler still shows "Ocupado" slots; booking + cancel still work.
5. `pnpm build` green; no residual direct read of others' appointments.
