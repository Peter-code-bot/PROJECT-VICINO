import assert from "node:assert/strict";
import test from "node:test";
import { debeAjustarPorAltura } from "./ajuste-por-altura";

test("la primera medición solo sirve de referencia", () => {
  assert.equal(debeAjustarPorAltura(undefined, 844), false);
});

test("al bajar la altura visible (se abre el teclado) se ajusta", () => {
  assert.equal(debeAjustarPorAltura(844, 560), true);
  assert.equal(debeAjustarPorAltura(560, 558.9), true, "más de 1 px");
});

test("al crecer la altura visible (se cierra el teclado) no se ajusta", () => {
  assert.equal(debeAjustarPorAltura(560, 844), false);
  assert.equal(debeAjustarPorAltura(560, 600), false);
});

test("las alturas fraccionarias de visualViewport no cuentan como bajada", () => {
  assert.equal(debeAjustarPorAltura(560, 560), false, "igual");
  assert.equal(debeAjustarPorAltura(560, 559.5), false, "medio píxel");
  assert.equal(debeAjustarPorAltura(560, 559), false, "exactamente 1 px");
  assert.equal(debeAjustarPorAltura(559.6363, 559.0001), false, "ruido de DPR");
});

test("si la altura baja y sube antes del frame, se compara con la última que sí se midió", () => {
  // El cleanup cancela el frame de 560; el de 600 compara contra 844, no contra 560.
  assert.equal(debeAjustarPorAltura(844, 600), true);
});

test("valores no finitos nunca disparan el ajuste", () => {
  assert.equal(debeAjustarPorAltura(Number.NaN, 500), false);
  assert.equal(debeAjustarPorAltura(844, Number.NaN), false);
  assert.equal(debeAjustarPorAltura(Number.POSITIVE_INFINITY, 500), false);
  assert.equal(debeAjustarPorAltura(844, Number.NEGATIVE_INFINITY), false);
});
