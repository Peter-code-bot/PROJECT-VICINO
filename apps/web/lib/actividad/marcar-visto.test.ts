import assert from "node:assert/strict";
import test from "node:test";
import { diaEnCdmx, faltaMarcarHoy, valorVisto } from "./marcar-visto";

const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";

test("el dia sale en hora de CDMX, no en UTC", () => {
  // 03:30 UTC del 3-nov son las 21:30 del 2-nov en CDMX (UTC-6, sin horario de verano).
  assert.equal(diaEnCdmx(new Date("2026-11-03T03:30:00Z")), "2026-11-02");
  assert.equal(diaEnCdmx(new Date("2026-11-03T06:00:00Z")), "2026-11-03");
});

test("el formato es YYYY-MM-DD con ceros", () => {
  assert.equal(diaEnCdmx(new Date("2027-01-05T18:00:00Z")), "2027-01-05");
});

test("se marca una vez por cuenta, dispositivo y dia", () => {
  assert.equal(faltaMarcarHoy(undefined, ANA, "2026-11-02"), true, "sin cookie: marcar");
  assert.equal(faltaMarcarHoy(valorVisto(ANA, "2026-11-01"), ANA, "2026-11-02"), true, "cookie de ayer: marcar");
  assert.equal(faltaMarcarHoy(valorVisto(ANA, "2026-11-02"), ANA, "2026-11-02"), false, "ya marco hoy");
});

test("cambiar de cuenta en el mismo dispositivo marca a la otra cuenta", () => {
  assert.equal(faltaMarcarHoy(valorVisto(ANA, "2026-11-02"), BETO, "2026-11-02"), true);
});

test("una cookie con solo el dia (version anterior) vuelve a marcar", () => {
  assert.equal(faltaMarcarHoy("2026-11-02", ANA, "2026-11-02"), true);
});
