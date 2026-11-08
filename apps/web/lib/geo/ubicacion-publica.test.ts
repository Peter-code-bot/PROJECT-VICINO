import assert from "node:assert/strict";
import test from "node:test";
import {
  PRECISION_POR_DEFECTO_AL_CREAR,
  PRECISION_SI_FALTA,
  centroAproximado,
  decimalesRejillaAproximada,
  esPrecisionUbicacion,
  radioVistaPreviaKm,
  redondearComoLaBase,
  textoTamanoAproximado,
} from "./ubicacion-publica";
import { zonaPublica } from "./apple-geocoder";

test("la rejilla aproximada sigue a VICINO_MAPA_RPC y falla cerrado en 1 km", () => {
  assert.equal(decimalesRejillaAproximada(undefined), 2);
  assert.equal(decimalesRejillaAproximada(""), 2);
  assert.equal(decimalesRejillaAproximada("v2"), 2);
  assert.equal(decimalesRejillaAproximada("v3x"), 2);
  assert.equal(decimalesRejillaAproximada(" V3 "), 3);
  assert.equal(decimalesRejillaAproximada("v4"), 3);
});

test("al publicar arranca en exacta; lo que falte se trata como aproximada", () => {
  assert.equal(PRECISION_POR_DEFECTO_AL_CREAR, "exacta");
  assert.equal(PRECISION_SI_FALTA, "aproximada");
  assert.equal(esPrecisionUbicacion("exacta"), true);
  assert.equal(esPrecisionUbicacion("aproximada"), true);
  assert.equal(esPrecisionUbicacion("Exacta"), false);
  assert.equal(esPrecisionUbicacion(null), false);
});

test("redondea como round(numeric) de Postgres: la mitad se aleja del cero", () => {
  assert.equal(redondearComoLaBase(-98.2065, 3), -98.207);
  assert.equal(redondearComoLaBase(19.0415, 3), 19.042);
  assert.equal(redondearComoLaBase(-98.205, 2), -98.21);
  assert.equal(redondearComoLaBase(-98.20637, 2), -98.21);
  assert.ok(Number.isNaN(redondearComoLaBase(Number.NaN, 2)));
  assert.deepEqual(centroAproximado(19.04138, -98.20637, 3), [19.041, -98.206]);
  assert.deepEqual(centroAproximado(19.04138, -98.20637, 2), [19.04, -98.21]);
});

test("la vista previa dibuja una celda de su tamano", () => {
  assert.ok(radioVistaPreviaKm(3) < 0.1 && radioVistaPreviaKm(2) >= 0.75);
  assert.equal(textoTamanoAproximado(3), "unos 100 m");
  assert.equal(textoTamanoAproximado(2), "alrededor de 1 km");
});

test("la etiqueta aproximada es colonia y ciudad, nunca calle, numero ni codigo postal", () => {
  assert.equal(zonaPublica({ subLocality: "Centro", locality: "Puebla" }), "Centro, Puebla");
  assert.equal(zonaPublica({ subLocality: null, locality: "San Andrés Cholula" }), "San Andrés Cholula");
  assert.equal(zonaPublica({ subLocality: "Puebla", locality: "Puebla" }), "Puebla");
  assert.equal(zonaPublica({ locality: null, administrativeArea: "Puebla" }), "Puebla");
  assert.equal(zonaPublica({}), "");
});
