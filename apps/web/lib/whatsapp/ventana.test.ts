import assert from "node:assert/strict";
import test from "node:test";
import { VENTANA_WHATSAPP_MS, duracionCorta, etiquetaVentana, ventanaWhatsApp } from "./ventana";

const H = 60 * 60 * 1000;
const MIN = 60 * 1000;
const AHORA = Date.UTC(2026, 10, 8, 12, 0, 0);

test("sin ultimo mensaje del cliente la ventana esta cerrada", () => {
  assert.deepEqual(ventanaWhatsApp(null, AHORA), { abierta: false, restanteMs: 0 });
  assert.deepEqual(ventanaWhatsApp(undefined, AHORA), { abierta: false, restanteMs: 0 });
});

test("el ultimo mensaje hace una hora deja 23 horas", () => {
  const v = ventanaWhatsApp(new Date(AHORA - H).toISOString(), AHORA);
  assert.equal(v.abierta, true);
  assert.equal(v.restanteMs, 23 * H);
  assert.equal(VENTANA_WHATSAPP_MS, 24 * H);
});

test("a las 24 horas exactas cierra; un minuto antes sigue abierta", () => {
  assert.deepEqual(ventanaWhatsApp(new Date(AHORA - 24 * H), AHORA), { abierta: false, restanteMs: 0 });
  assert.deepEqual(ventanaWhatsApp(new Date(AHORA - 25 * H), AHORA), { abierta: false, restanteMs: 0 });
  const casi = ventanaWhatsApp(new Date(AHORA - 24 * H + MIN), AHORA);
  assert.equal(casi.abierta, true);
  assert.equal(casi.restanteMs, MIN);
});

test("una fecha invalida o un mensaje 'del futuro' no rompen", () => {
  assert.deepEqual(ventanaWhatsApp("no-es-fecha", AHORA), { abierta: false, restanteMs: 0 });
  // Reloj del servidor de Meta un poco adelantado: la ventana no pasa de 24 h + el adelanto.
  const futuro = ventanaWhatsApp(new Date(AHORA + MIN), AHORA);
  assert.equal(futuro.abierta, true);
  assert.equal(futuro.restanteMs, 24 * H + MIN);
});

test("duracionCorta habla en horas y minutos", () => {
  assert.equal(duracionCorta(0), "menos de un minuto");
  assert.equal(duracionCorta(59 * 1000), "menos de un minuto");
  assert.equal(duracionCorta(45 * MIN), "45 min");
  assert.equal(duracionCorta(2 * H), "2 h");
  assert.equal(duracionCorta(2 * H + 10 * MIN), "2 h 10 min");
  assert.equal(duracionCorta(23 * H + 59 * MIN + 59 * 1000), "23 h 59 min");
});

test("la etiqueta explica la regla de WhatsApp en los dos casos", () => {
  assert.equal(
    etiquetaVentana({ abierta: true, restanteMs: 23 * H }),
    "Puedes responder durante 23 h más (ventana de 24 horas de WhatsApp).",
  );
  assert.match(etiquetaVentana({ abierta: false, restanteMs: 0 }), /cerró/);
  assert.match(etiquetaVentana({ abierta: false, restanteMs: 0 }), /24 horas/);
});
