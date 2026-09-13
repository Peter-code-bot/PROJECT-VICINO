import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDistanceKm,
  esResultadoValido,
  buildDeterministicId,
} from "./location-search";

const PUEBLA_CENTER = { lat: 19.0414, lng: -98.2063 };
const CDMX = { lat: 19.4326, lng: -99.1332 };
const CHOLULA = { lat: 19.0625, lng: -98.3075 };
const BIELEFELD_GERMANY = { lat: 52.0302, lng: 8.5325 };
const GUATEMALA_CITY = { lat: 14.6349, lng: -90.5069 };

test("calculateDistanceKm calculates accurate Haversine distance", () => {
  const distCholula = calculateDistanceKm(
    PUEBLA_CENTER.lat,
    PUEBLA_CENTER.lng,
    CHOLULA.lat,
    CHOLULA.lng
  );
  assert.ok(distCholula > 10 && distCholula < 15, `Esperado ~12km, obtenido ${distCholula}`);

  const distCdmx = calculateDistanceKm(
    PUEBLA_CENTER.lat,
    PUEBLA_CENTER.lng,
    CDMX.lat,
    CDMX.lng
  );
  assert.ok(distCdmx > 95 && distCdmx < 120, `Esperado ~105km, obtenido ${distCdmx}`);

  const distAlemania = calculateDistanceKm(
    PUEBLA_CENTER.lat,
    PUEBLA_CENTER.lng,
    BIELEFELD_GERMANY.lat,
    BIELEFELD_GERMANY.lng
  );
  assert.ok(distAlemania > 9000, `Esperado >9000km, obtenido ${distAlemania}`);
});

test("esResultadoValido accepts valid places within Mexico and within distance", () => {
  const okCholula = esResultadoValido(
    { lat: CHOLULA.lat, lng: CHOLULA.lng, countryCode: "MX" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(okCholula, true);

  const okCdmx = esResultadoValido(
    { lat: CDMX.lat, lng: CDMX.lng, countryCode: "mx" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(okCdmx, true);
});

test("esResultadoValido rejects Germany (Bielefeld) outside Mexico bounding box", () => {
  const result = esResultadoValido(
    { lat: BIELEFELD_GERMANY.lat, lng: BIELEFELD_GERMANY.lng, countryCode: "DE" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(result, false);

  const resultSinPais = esResultadoValido(
    { lat: BIELEFELD_GERMANY.lat, lng: BIELEFELD_GERMANY.lng },
    PUEBLA_CENTER,
    150
  );
  assert.equal(resultSinPais, false);
});

test("esResultadoValido rejects foreign countries even if near southern border", () => {
  const resultConPais = esResultadoValido(
    { lat: GUATEMALA_CITY.lat, lng: GUATEMALA_CITY.lng, countryCode: "GT" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(resultConPais, false);

  const resultPorDistancia = esResultadoValido(
    { lat: GUATEMALA_CITY.lat, lng: GUATEMALA_CITY.lng },
    PUEBLA_CENTER,
    150
  );
  assert.equal(resultPorDistancia, false);
});

test("esResultadoValido rejects invalid, NaN or null coordinates", () => {
  assert.equal(esResultadoValido({ lat: NaN, lng: -98.2 }, PUEBLA_CENTER), false);
  assert.equal(esResultadoValido({ lat: 19.0, lng: Infinity }, PUEBLA_CENTER), false);
  assert.equal(esResultadoValido({ lat: null, lng: -98.2 }, PUEBLA_CENTER), false);
  assert.equal(esResultadoValido({ lat: undefined, lng: -98.2 }, PUEBLA_CENTER), false);
});

test("buildDeterministicId generates stable, index-independent IDs", () => {
  const id1 = buildDeterministicId(19.04141, -98.20632, "Universidad Anáhuac Puebla");
  const id2 = buildDeterministicId(19.04141, -98.20632, "Universidad Anáhuac Puebla");
  assert.equal(id1, id2);
  assert.ok(id1.startsWith("mk-19.04141--98.20632-universidad-anahuac-puebla"));
  assert.ok(!id1.includes("NaN"));
});
