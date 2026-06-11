-- =============================================================================
-- #8 -- appointments privacy + booking integrity (CWE-200 / CWE-284)
-- Change: openspec/changes/2026-06-11-appointments-privacy-hardening
-- =============================================================================
-- WHY: appointments had SELECT USING(true) (anyone could read everyone's agenda:
-- buyer/seller ids, dates, notes), an INSERT that only checked buyer_id=auth.uid()
-- (seller_id was client-supplied -> spoofable; no allow_appointments / disponible
-- check), and an UPDATE with no column restriction (any participant could rewrite
-- ids/dates/status). Fix: participants-only SELECT + a definer RPC for the public
-- booked-slots grid (start-times only, no identity), a hardened INSERT policy, and
-- a status-only UPDATE guard trigger.
--
-- STATUS: applied in Studio (Camino 2, COMMIT). Idempotent mirror (reconcile vs
-- pg_get_functiondef / pg_policies).
-- App: appointment-scheduler.tsx booked-slots read -> rpc('get_booked_slots').
-- handleConfirm (INSERT) / cancelAppointment (UPDATE status) unchanged -- governed
-- by the policy + trigger.
-- =============================================================================

-- ---- SELECT: kill USING(true); participants + admin only ----
DROP POLICY IF EXISTS "Anyone can view appointments" ON public.appointments;
CREATE POLICY "Participants can view appointments" ON public.appointments
  FOR SELECT
  TO authenticated
  USING (
    (select auth.uid()) = buyer_id
    OR (select auth.uid()) = seller_id
    OR public.has_role((select auth.uid()), 'admin')
  );

-- ---- public booked-slots via SECURITY DEFINER RPC (no buyer identity / notes) ----
CREATE OR REPLACE FUNCTION public.get_booked_slots(p_product_id UUID, p_date DATE)
RETURNS TABLE(appointment_start TIME)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT a.appointment_start
  FROM public.appointments a
  WHERE a.product_id = p_product_id
    AND a.appointment_date = p_date
    AND a.status = 'confirmed';
$$;
REVOKE ALL    ON FUNCTION public.get_booked_slots(UUID, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booked_slots(UUID, DATE) TO anon, authenticated;

-- ---- INSERT: buyer=auth.uid(); seller=product creador; allow_appointments; disponible; no self ----
DROP POLICY IF EXISTS "Authenticated users can create" ON public.appointments;
CREATE POLICY "Buyers can book appointments" ON public.appointments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (select auth.uid()) = buyer_id
    AND buyer_id <> seller_id
    AND EXISTS (
      SELECT 1 FROM public.products_services p
      WHERE p.id = product_id
        AND p.creador_id = seller_id
        AND p.allow_appointments = true
        AND p.estatus = 'disponible'
        AND p.is_hidden = false
    )
  );

-- ---- UPDATE: participants only (policy kept) + status-only guard trigger ----
-- Trigger: only `status` (and the system reminder flags) may change; identity /
-- schedule columns are immutable; terminal states (cancelled/completed) are final.
-- Reminder cron (service-role) only touches reminder_*_sent -> allowed.
CREATE OR REPLACE FUNCTION public.appointments_guard_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.product_id        IS DISTINCT FROM OLD.product_id
     OR NEW.buyer_id        IS DISTINCT FROM OLD.buyer_id
     OR NEW.seller_id       IS DISTINCT FROM OLD.seller_id
     OR NEW.appointment_date  IS DISTINCT FROM OLD.appointment_date
     OR NEW.appointment_start IS DISTINCT FROM OLD.appointment_start
     OR NEW.appointment_end   IS DISTINCT FROM OLD.appointment_end THEN
    RAISE EXCEPTION 'solo status es modificable en appointments'
      USING ERRCODE = '42501';
  END IF;

  IF OLD.status IN ('cancelled', 'completed')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'cita en estado terminal (% -> %)', OLD.status, NEW.status
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS appointments_guard_update ON public.appointments;
CREATE TRIGGER appointments_guard_update
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.appointments_guard_update();

-- ---- revoke unneeded write paths ----
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.appointments FROM anon;
REVOKE DELETE, TRUNCATE ON public.appointments FROM authenticated;

-- =============================================================================
-- ROLLBACK (manual): restore "Anyone can view appointments" USING(true) and the
-- loose INSERT/UPDATE (NOT recommended -- re-opens #8); DROP get_booked_slots +
-- appointments_guard_update; revert appointment-scheduler.tsx to the direct SELECT.
-- =============================================================================
