import assert from "node:assert/strict";
import test from "node:test";
import { MAP_AREA } from "@vicino/shared";
import { dentroDeMapArea, interpretarZonaGuardada, redondearCoordenada } from "./zona-guardada";

// Coordenadas genericas de centros urbanos (no de personas).
const CENTRO = "19.041,-98.206";

test("sin cookie, vacia o solo espacios: ausente, con el radio de la cookie", () => {
  for (const valor of [undefined, null, "", "   "]) {
    assert.deepEqual(interpretarZonaGuardada(valor, "25000"), { estado: "ausente", punto: null, radio: 25000 }, String(valor));
  }
});

test("3 decimales: valida y sin mover el punto que escribio la app", () => {
  assert.deepEqual(interpretarZonaGuardada(CENTRO, undefined), {
    estado: "valida", punto: { lat: 19.041, lng: -98.206 }, radio: 10000,
  });
});

test("4 decimales y espacios: se redondea igual que writeLocation (toFixed(3))", () => {
  assert.deepEqual(interpretarZonaGuardada(" 19.0414 , -98.2063 ", "10000").punto, { lat: 19.041, lng: -98.206 });
  assert.equal(redondearCoordenada(19.0414), Number((19.0414).toFixed(3)));
});

test("idempotente: interpretar lo ya interpretado no cambia nada", () => {
  const primera = interpretarZonaGuardada("19.04149,-98.20651", "12000");
  assert.ok(primera.punto);
  const segunda = interpretarZonaGuardada(`${primera.punto.lat},${primera.punto.lng}`, String(primera.radio));
  assert.deepEqual(segunda, primera);
});

test("el valor llega decodificado; uno todavia codificado no es un punto", () => {
  assert.equal(interpretarZonaGuardada(decodeURIComponent("19.041%2C-98.206"), null).estado, "valida");
  assert.equal(interpretarZonaGuardada("19.041%2C-98.206", null).estado, "invalida");
});

test("basura, infinitos, una sola parte o tres partes: invalida sin punto", () => {
  for (const valor of ["basura", "Infinity,-98.2", "19.04,-Infinity", "NaN,NaN", "19.041", "19.041,", ",-98.206", "19.041,-98.206,5", "91,-98", "19,-181"]) {
    const zona = interpretarZonaGuardada(valor, "10000");
    assert.equal(zona.estado, "invalida", valor);
    assert.equal(zona.punto, null, valor);
  }
});

test("un punto valido fuera de MAP_AREA se distingue de uno invalido", () => {
  assert.deepEqual(interpretarZonaGuardada("40.000,-120.000", "10000"), {
    estado: "fuera-de-area", punto: { lat: 40, lng: -120 }, radio: 10000,
  });
});

test("los bordes de MAP_AREA cuentan como dentro; un milesimo fuera ya no", () => {
  const { south, north, west, east } = MAP_AREA;
  for (const [lat, lng] of [[south, -98.2], [north, -98.2], [19.04, west], [19.04, east], [south, west], [north, east]] as const) {
    assert.equal(interpretarZonaGuardada(`${lat},${lng}`, null).estado, "valida", `${lat},${lng}`);
  }
  for (const [lat, lng] of [[south - 0.001, -98.2], [north + 0.001, -98.2], [19.04, west - 0.001], [19.04, east + 0.001]] as const) {
    assert.equal(interpretarZonaGuardada(`${lat},${lng}`, null).estado, "fuera-de-area", `${lat},${lng}`);
  }
  assert.equal(dentroDeMapArea({ lat: Number.NaN, lng: -98.2 }), false);
});

test("el radio se acota con parseRadiusCookie, haya punto o no", () => {
  const radios: Array<[string | undefined, number]> = [[undefined, 10000], ["25000", 25000], ["999", 1000], ["60000", 50000], ["basura", 10000]];
  for (const [crudo, esperado] of radios) {
    assert.equal(interpretarZonaGuardada(CENTRO, crudo).radio, esperado, String(crudo));
    assert.equal(interpretarZonaGuardada("basura", crudo).radio, esperado, String(crudo));
  }
});
