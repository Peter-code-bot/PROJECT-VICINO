# Design -- #8: appointments privacy + booking integrity

## SELECT: participants + a slots RPC

RLS can hide whole rows, so the SELECT policy becomes participants-only (buyer/seller/admin). But
the booking UI needs to show which slots are taken WITHOUT revealing who booked them. So a
SECURITY DEFINER `get_booked_slots(product, date)` returns just the `confirmed`
`appointment_start` times (no buyer_id, no notes), granted to anon + authenticated (the product
detail page is public). The scheduler reads this instead of the table -- a 1:1 shape match (rows
with `appointment_start`, the client does `.slice(0,5)`).

## INSERT: forced identity + product gate

The old INSERT trusted the client `seller_id`. The new `WITH CHECK` requires `buyer_id =
auth.uid()`, forbids self-booking (`buyer_id <> seller_id`), and validates the product belongs to
`seller_id` and accepts appointments (`allow_appointments`, `disponible`, not hidden). The app's
`handleConfirm` already sends `buyer_id = user.id` and `seller_id = product.creador_id`, so legit
bookings pass; a forged `seller_id` or a non-appointment product is rejected. `status` defaults to
`confirmed` (the client cannot meaningfully set it; the guard trigger also pins it on update).

## UPDATE: status-only guard trigger

A column-grant cannot express "only status may change" with row context, so a BEFORE-UPDATE
trigger compares NEW vs OLD: identity/schedule columns (`product_id`, `buyer_id`, `seller_id`,
date, start, end) are immutable; terminal states (`cancelled`/`completed`) cannot transition. The
reminder cron (service-role) only writes `reminder_*_sent`, which the trigger does not block. The
app `cancelAppointment` changes only `status` (and already validates participant + future + not
terminal), so it passes. This keeps both legit flows working with zero app change to them.

## State machine

- INSERT -> `confirmed` (gated). 
- `confirmed -> cancelled` by buyer OR seller (future appts; app-validated).
- `confirmed -> completed` -- NO app writer today; reserved for a future cron/admin (the trigger
  permits confirmed->completed; tighten to service-role/admin if desired later).
- `cancelled` / `completed` are terminal.

## Faithfulness

Reconcile `get_booked_slots` + `appointments_guard_update` bodies and the 4 policies against
`pg_get_functiondef` / `pg_policies`. The mirror is reconstructed from the applied design.
