import assert from "node:assert/strict";
import test from "node:test";
import { mapCoverageResultSchema, MAP_AREA, type MapCell } from "@vicino/shared";
import { clusterMapLayer, puntoExactoDeCelda } from "./map-coverage";

// v4 (GEO-PUB-EXACT): una celda de una sola ubicacion exacta trae su punto en
// grados; el cliente la pinta ahi y no en el nodo de 110 m.
const UNITS = 1000;
const EXACTO = { lat: 19.04138, lng: -98.20637 };
const celdaExacta: MapCell = { x: -98206, y: 19041, count: 1, seller_count: 1, punto: EXACTO };
const celdaAproximada: MapCell = { x: -98200, y: 19040, count: 3, seller_count: 2 };
const vista = { west: -98.3, south: 18.95, east: -98.1, north: 19.15 };

test("un pin exacto se pinta en su punto y se marca como exacto", () => {
  const { features, stride } = clusterMapLayer([celdaExacta, celdaAproximada], vista, 1, UNITS);
  assert.equal(stride, 1);
  const exacta = features.find((f) => f.id === "cell:1:-98206:19041");
  const aprox = features.find((f) => f.id === "cell:1:-98200:19040");
  assert.deepEqual([exacta?.public_lat, exacta?.public_lng, exacta?.precision], [EXACTO.lat, EXACTO.lng, "exacta"]);
  assert.deepEqual(exacta?.bounds, { west: EXACTO.lng, east: EXACTO.lng, south: EXACTO.lat, north: EXACTO.lat });
  assert.deepEqual([aprox?.public_lat, aprox?.public_lng, aprox?.precision], [19.04, -98.2, undefined]);
});

test("al agrupar con otras celdas deja de ser exacto y cuenta todo", () => {
  // 200 celdas sueltas: con mas de 180 marcadores el nivel 1 no cabe y la capa
  // se queda en el nivel 2, donde la exacta comparte grupo con su vecina.
  const relleno: MapCell[] = Array.from({ length: 200 }, (_, i) => ({ x: -98400 + 2 * i, y: 19000, count: 1, seller_count: 1 }));
  const vecina: MapCell = { x: -98205, y: 19041, count: 3, seller_count: 2 };
  const amplia = { west: -98.5, south: 18.9, east: -98.0, north: 19.1 };
  const { features, stride } = clusterMapLayer([...relleno, celdaExacta, vecina], amplia, 2, UNITS);
  assert.equal(stride, 2);
  const grupo = features.find((f) => f.count === 4);
  assert.ok(grupo, JSON.stringify(features.slice(-3)));
  assert.equal(grupo.precision, undefined);
  // El promedio usa el punto exacto (publico) y el nodo de la vecina.
  assert.ok(Math.abs(grupo.public_lng - (EXACTO.lng + 3 * -98.205) / 4) < 1e-9);
});

test("un punto que no cae dentro de su celda se ignora y la celda vuelve a su nodo", () => {
  assert.equal(puntoExactoDeCelda({ ...celdaExacta, punto: { lat: 19.05, lng: -98.20637 } }, UNITS), null);
  assert.equal(puntoExactoDeCelda({ ...celdaExacta, punto: undefined }, UNITS), null);
  assert.deepEqual(puntoExactoDeCelda(celdaExacta, UNITS), EXACTO);
  // Medio punto exacto de margen por los redondeos distintos de Postgres y JS.
  assert.deepEqual(puntoExactoDeCelda({ ...celdaExacta, x: -98207, punto: { lat: 19.04138, lng: -98.2065 } }, UNITS), { lat: 19.04138, lng: -98.2065 });
  const { features } = clusterMapLayer([{ ...celdaExacta, punto: { lat: 19.2, lng: -98.20637 } }], vista, 1, UNITS);
  assert.deepEqual([features[0]?.public_lat, features[0]?.precision], [19.041, undefined]);
});

test("el contrato acepta el punto y la precision opcionales y quita lo que no declara", () => {
  const respuesta = {
    query_key: "a".repeat(32), projection_version: 2, as_of: "2026-11-08T00:00:00Z",
    features: [{ id: "cell:1:-98206:19041", public_lat: EXACTO.lat, public_lng: EXACTO.lng, count: 1, seller_count: 1,
      bounds: { west: EXACTO.lng, south: EXACTO.lat, east: EXACTO.lng, north: EXACTO.lat }, precision: "exacta", ubicacion_geo: "x" }],
    listings: [], total: 4, seller_total: 3, list_total: 0, next_cursor: null, list_seller_total: 0,
    revision: "b".repeat(32), cells: [{ ...celdaExacta, exact_lat: 19.1 }, celdaAproximada], next_cell_cursor: null, complete: true,
  };
  const r = mapCoverageResultSchema.parse(respuesta);
  assert.equal(r.features[0]?.precision, "exacta");
  assert.ok(!("ubicacion_geo" in (r.features[0] as object)));
  assert.deepEqual(r.cells[0]?.punto, EXACTO);
  assert.ok(!("exact_lat" in (r.cells[0] as object)));
  assert.equal(r.cells[1]?.punto, undefined);
  // Fuera de Mexico o con otro valor de precision, la respuesta entera se rechaza.
  assert.equal(mapCoverageResultSchema.safeParse({ ...respuesta, cells: [{ ...celdaExacta, punto: { lat: MAP_AREA.north + 1, lng: -98 } }] }).success, false);
  assert.equal(mapCoverageResultSchema.safeParse({ ...respuesta, features: [{ ...respuesta.features[0], precision: "aproximada" }] }).success, false);
});
