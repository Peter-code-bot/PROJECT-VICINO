import assert from "node:assert/strict";
import test from "node:test";
import { hayCambiosDeUbicacion, mismoPunto, RADIO_POR_DEFECTO } from "./cambios-ubicacion";

const PUEBLA = { lat: 19.0414, lng: -98.2063, radius: 10000 };
const VILLAHERMOSA = { lat: 17.9892, lng: -92.9281 };

test("al abrir, el borrador es la ubicación activa: sin cambios (se ve la X)", () => {
  assert.equal(hayCambiosDeUbicacion({ lat: PUEBLA.lat, lng: PUEBLA.lng }, 10000, PUEBLA), false);
});

test("mover el pin, buscar, GPS o una reciente a otro punto: hay cambios", () => {
  assert.equal(hayCambiosDeUbicacion(VILLAHERMOSA, 10000, PUEBLA), true);
});

test("solo cambiar el radio: hay cambios; volver al radio de antes: no", () => {
  assert.equal(hayCambiosDeUbicacion({ lat: PUEBLA.lat, lng: PUEBLA.lng }, 50000, PUEBLA), true);
  assert.equal(hayCambiosDeUbicacion({ lat: PUEBLA.lat, lng: PUEBLA.lng }, 10000, PUEBLA), false);
});

test("la ubicacion activa leida de la cookie (3 decimales) coincide con la elegida", () => {
  const elegida = { lat: 17.98924, lng: -92.92814 };
  const deLaCookie = { lat: Number(elegida.lat.toFixed(3)), lng: Number(elegida.lng.toFixed(3)), radius: 10000 };
  assert.equal(mismoPunto(elegida, deLaCookie), true);
  assert.equal(hayCambiosDeUbicacion(elegida, 10000, deLaCookie), false);
});

test("un punto a mas de ~70 m si cuenta como cambio", () => {
  assert.equal(hayCambiosDeUbicacion({ lat: PUEBLA.lat + 0.0007, lng: PUEBLA.lng }, 10000, PUEBLA), true);
});

test("sin ubicación activa, cualquier punto elegido es un cambio", () => {
  assert.equal(hayCambiosDeUbicacion(VILLAHERMOSA, 10000, null), true);
});

test("sin borrador, o con coordenadas malas, no hay nada que aplicar", () => {
  assert.equal(hayCambiosDeUbicacion(null, 50000, PUEBLA), false);
  assert.equal(hayCambiosDeUbicacion({ lat: Number.NaN, lng: 1 }, 10000, PUEBLA), false);
});

test("ubicación activa sin radio: se compara contra el radio por defecto", () => {
  const sinRadio = { lat: PUEBLA.lat, lng: PUEBLA.lng };
  assert.equal(hayCambiosDeUbicacion(sinRadio, RADIO_POR_DEFECTO, sinRadio), false);
  assert.equal(hayCambiosDeUbicacion(sinRadio, 5000, sinRadio), true);
});

test("mismoPunto tolera nulos", () => {
  assert.equal(mismoPunto(null, PUEBLA), false);
  assert.equal(mismoPunto(PUEBLA, undefined), false);
});
