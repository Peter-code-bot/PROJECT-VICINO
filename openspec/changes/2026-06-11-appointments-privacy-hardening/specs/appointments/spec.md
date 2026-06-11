# Spec -- appointments (delta)

> Domain: privacy + integrity of the `appointments` table (read access, booking, state machine).
> DELTA spec from change `2026-06-11-appointments-privacy-hardening`. Last updated 2026-06-11.

## Context

`appointments` links a buyer, a seller, and a product to a time slot. It previously had a
public SELECT, an INSERT that trusted a client-supplied `seller_id`, and an unrestricted UPDATE.

## Requirement R1 -- appointment rows SHALL be visible only to participants or admin

WHEN a client reads `appointments`, only the buyer, the seller, or an admin SHALL see a row. The
public "booked slots" grid SHALL be served by `get_booked_slots(p_product_id, p_date)` (SECURITY
DEFINER), which returns ONLY the `confirmed` start-times -- no buyer identity, no notes.

### Scenario: non-participant cannot read others' appointments
- GIVEN a user who is neither buyer nor seller of appointment A
- WHEN they SELECT appointments
- THEN A is not returned

### Scenario: booked-slots grid has no identity
- WHEN the scheduler requests booked slots for a product + date
- THEN it receives only `appointment_start` times via `get_booked_slots` (no buyer_id / notes)

## Requirement R2 -- booking SHALL pin the actor and validate the product

WHEN an appointment is inserted, the buyer SHALL be `auth.uid()`, the `seller_id` SHALL be the
product's creator, the buyer SHALL NOT be the seller, and the product SHALL accept appointments
(`allow_appointments = true`, `estatus = 'disponible'`, not hidden).

### Scenario: forged seller_id is rejected
- GIVEN a buyer inserting an appointment with `seller_id` != the product creator
- THEN the insert is rejected

### Scenario: non-appointment product is rejected
- GIVEN a product with `allow_appointments = false`
- WHEN a buyer tries to book it
- THEN the insert is rejected

## Requirement R3 -- only status SHALL be mutable, with valid transitions

WHEN an appointment is updated, only `status` (and system reminder flags) SHALL change; identity
and schedule columns SHALL be immutable; `cancelled` / `completed` SHALL be terminal.

### Scenario: re-pointing an appointment is blocked
- WHEN a participant UPDATEs `buyer_id` / `seller_id` / a date/time column
- THEN the update is rejected (42501)

### Scenario: participant cancels
- WHEN the buyer or seller sets `status = 'cancelled'` on a future `confirmed` appointment
- THEN it succeeds

## Implementation notes
- Mirror migration: `20260611000001_appointments_privacy_hardening.sql`.
- `get_booked_slots` granted to anon + authenticated (product detail is public).
- anon has no write; authenticated has no DELETE/TRUNCATE.
