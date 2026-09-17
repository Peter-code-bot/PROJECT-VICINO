import assert from "node:assert/strict";
import test from "node:test";
import { frenoEnMemoria } from "./freno-en-memoria";

test("deja pasar hasta el tope y rechaza el resto dentro de la ventana", () => {
  const freno = frenoEnMemoria({ tope: 3, ventanaMs: 60_000 });
  const t = 1_000_000;
  assert.equal(freno.permitir("ip-a", t), true);
  assert.equal(freno.permitir("ip-a", t + 100), true);
  assert.equal(freno.permitir("ip-a", t + 200), true);
  assert.equal(freno.permitir("ip-a", t + 300), false, "la cuarta en la misma ventana se rechaza");
});

test("cada identificador tiene su propia cuota", () => {
  const freno = frenoEnMemoria({ tope: 1, ventanaMs: 60_000 });
  const t = 2_000_000;
  assert.equal(freno.permitir("ip-b", t), true);
  assert.equal(freno.permitir("ip-b", t + 10), false);
  assert.equal(freno.permitir("ip-c", t + 20), true, "otra IP no hereda el rechazo");
});

test("la ventana desliza: pasada la ventana vuelve a haber hueco", () => {
  const freno = frenoEnMemoria({ tope: 2, ventanaMs: 10_000 });
  const t = 3_000_000;
  assert.equal(freno.permitir("ip-d", t), true);
  assert.equal(freno.permitir("ip-d", t + 1_000), true);
  assert.equal(freno.permitir("ip-d", t + 2_000), false);
  assert.equal(freno.permitir("ip-d", t + 12_000), true, "la primera ya salio de la ventana");
});

test("una rafaga a caballo del corte no pasa como dos ventanas distintas", () => {
  const freno = frenoEnMemoria({ tope: 2, ventanaMs: 10_000 });
  const t = 4_000_000;
  assert.equal(freno.permitir("ip-e", t + 9_000), true);
  assert.equal(freno.permitir("ip-e", t + 9_500), true);
  // Con ventana FIJA esto caeria en el tramo siguiente y pasaria; con ventana
  // deslizante las dos anteriores siguen contando.
  assert.equal(freno.permitir("ip-e", t + 10_500), false);
});
