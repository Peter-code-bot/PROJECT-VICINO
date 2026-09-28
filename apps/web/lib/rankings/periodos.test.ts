import assert from "node:assert/strict";
import test from "node:test";
import { periodoAnterior, periodoEnCdmx, periodosARecalcular } from "./periodos";

test("periodo en hora de CDMX, no en UTC", () => {
  // 1-oct 03:00 UTC = 30-sep 21:00 CDMX (UTC-6).
  assert.equal(periodoEnCdmx(new Date("2026-10-01T03:00:00Z")), "2026-09");
  assert.equal(periodoEnCdmx(new Date("2026-10-01T09:00:00Z")), "2026-10");
});

test("mes anterior, incluido el cambio de año", () => {
  assert.equal(periodoAnterior("2026-10"), "2026-09");
  assert.equal(periodoAnterior("2027-01"), "2026-12");
  assert.throws(() => periodoAnterior("basura"));
});

test("dias 1 y 2 de CDMX recalculan tambien el mes anterior; el resto, solo el actual", () => {
  assert.deepEqual(periodosARecalcular(new Date("2026-10-01T09:00:00Z")), ["2026-10", "2026-09"]);
  assert.deepEqual(periodosARecalcular(new Date("2026-10-02T09:00:00Z")), ["2026-10", "2026-09"]);
  assert.deepEqual(periodosARecalcular(new Date("2026-10-03T09:00:00Z")), ["2026-10"]);
  assert.deepEqual(periodosARecalcular(new Date("2027-01-01T09:00:00Z")), ["2027-01", "2026-12"]);
  assert.deepEqual(periodosARecalcular(new Date("2026-09-30T09:00:00Z")), ["2026-09"]);
});
