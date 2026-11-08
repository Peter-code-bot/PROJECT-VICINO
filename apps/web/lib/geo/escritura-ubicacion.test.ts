import assert from "node:assert/strict";
import test from "node:test";
import {
  MENSAJE_CONFIRMAR_EXACTA,
  cambiosAlEditar,
  leerEntradaUbicacion,
  mismoPunto,
  ubicacionAlCrear,
  type EntradaUbicacion,
} from "./escritura-ubicacion";

const PUNTO = { lat: 19.04138, lng: -98.20637 };
const OTRO = { lat: 19.04177, lng: -98.20691 };

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

function entrada(campos: Record<string, string>): EntradaUbicacion {
  const r = leerEntradaUbicacion(formulario(campos));
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.valor;
}

const conPunto = (p = PUNTO) => ({ ubicacion_lat: String(p.lat), ubicacion_lng: String(p.lng) });

test("lee accion, precision, confirmacion, punto, etiqueta y radio", () => {
  const e = entrada({ ...conPunto(), ubicacion_accion: "fijar", ubicacion_precision: "exacta", confirmar_ubicacion_exacta: "1", ubicacion: "Centro, Puebla", delivery_radius_km: "5" });
  assert.deepEqual(e, { accion: "fijar", precision: "exacta", confirmada: true, punto: PUNTO, quitarHeredado: false, etiqueta: "Centro, Puebla", radioKm: 5 });
});

test("un formulario anterior no trae accion ni precision: quedan en null", () => {
  const e = entrada({ ...conPunto(), remove_location: "false" });
  assert.equal(e.accion, null);
  assert.equal(e.precision, null);
  assert.equal(e.confirmada, false);
});

test("rechaza accion, precision, remove_location y coordenadas invalidas", () => {
  for (const campos of [
    { ubicacion_accion: "mover" },
    { ubicacion_precision: "casi" },
    { remove_location: "si" },
    { ubicacion_lat: "91", ubicacion_lng: "-98" },
    { ubicacion_lat: "abc", ubicacion_lng: "-98" },
  ]) {
    assert.equal(leerEntradaUbicacion(formulario(campos)).ok, false, JSON.stringify(campos));
  }
});

test("(0, 0) es 'sin seleccion' del formulario, no un punto", () => {
  assert.equal(entrada({ ubicacion_lat: "0", ubicacion_lng: "0" }).punto, null);
});

test("al publicar: exacta solo con confirmacion; sin campo, aproximada; sin punto, error", () => {
  const exacta = ubicacionAlCrear(entrada({ ...conPunto(), ubicacion_precision: "exacta", confirmar_ubicacion_exacta: "1" }));
  assert.deepEqual(exacta, { ok: true, valor: { ubicacion_geo: `SRID=4326;POINT(${PUNTO.lng} ${PUNTO.lat})`, ubicacion_precision: "exacta" } });
  assert.deepEqual(ubicacionAlCrear(entrada({ ...conPunto(), ubicacion_precision: "exacta" })), { ok: false, error: MENSAJE_CONFIRMAR_EXACTA });
  const viejo = ubicacionAlCrear(entrada(conPunto()));
  assert.ok(viejo.ok && viejo.valor.ubicacion_precision === "aproximada");
  assert.equal(ubicacionAlCrear(entrada({ ubicacion_precision: "aproximada" })).ok, false);
});

test("al editar, 'conservar' no escribe nada de la ubicacion aunque lleguen punto, etiqueta y radio", () => {
  const r = cambiosAlEditar(entrada({ ...conPunto(OTRO), ubicacion_accion: "conservar", ubicacion_precision: "exacta", ubicacion: "Otra", delivery_radius_km: "9" }), { lat: PUNTO.lat, lng: PUNTO.lng });
  assert.deepEqual(r, { ok: true, valor: {} });
});

test("'fijar' escribe punto, modo, etiqueta y radio juntos; exacta exige confirmacion", () => {
  const sinConfirmar = cambiosAlEditar(entrada({ ...conPunto(OTRO), ubicacion_accion: "fijar", ubicacion_precision: "exacta" }), null);
  assert.deepEqual(sinConfirmar, { ok: false, error: MENSAJE_CONFIRMAR_EXACTA });
  const confirmada = cambiosAlEditar(entrada({ ...conPunto(OTRO), ubicacion_accion: "fijar", ubicacion_precision: "exacta", confirmar_ubicacion_exacta: "1", ubicacion: "Centro, Puebla", delivery_radius_km: "3" }), null);
  assert.deepEqual(confirmada, { ok: true, valor: { ubicacion_geo: `SRID=4326;POINT(${OTRO.lng} ${OTRO.lat})`, ubicacion_precision: "exacta", ubicacion: "Centro, Puebla", delivery_radius_km: 3 } });
  const aproximada = cambiosAlEditar(entrada({ ...conPunto(), ubicacion_accion: "fijar", ubicacion_precision: "aproximada" }), null);
  assert.ok(aproximada.ok && aproximada.valor.ubicacion_precision === "aproximada" && !("ubicacion" in aproximada.valor));
  assert.equal(cambiosAlEditar(entrada({ ubicacion_accion: "fijar", ubicacion_precision: "aproximada" }), null).ok, false);
});

test("'quitar' (o remove_location del formulario anterior) vacia todo y deja aproximada", () => {
  const esperado = { ok: true, valor: { ubicacion_geo: null, ubicacion: null, delivery_radius_km: null, ubicacion_precision: "aproximada" } };
  assert.deepEqual(cambiosAlEditar(entrada({ ubicacion_accion: "quitar" }), null), esperado);
  assert.deepEqual(cambiosAlEditar(entrada({ remove_location: "true" }), null), esperado);
});

test("formulario anterior: mismo punto no toca nada; punto movido queda aproximado; sin punto no toca nada", () => {
  assert.deepEqual(cambiosAlEditar(entrada(conPunto()), { lat: PUNTO.lat, lng: PUNTO.lng }), { ok: true, valor: {} });
  const movido = cambiosAlEditar(entrada({ ...conPunto(OTRO), ubicacion: "Centro, Puebla" }), { lat: PUNTO.lat, lng: PUNTO.lng });
  assert.ok(movido.ok);
  assert.equal(movido.valor.ubicacion_precision, "aproximada");
  assert.equal(movido.valor.ubicacion_geo, `SRID=4326;POINT(${OTRO.lng} ${OTRO.lat})`);
  // Sin poder leer lo guardado se asume que lo movio: tambien aproximada.
  const sinGuardado = cambiosAlEditar(entrada(conPunto()), null);
  assert.ok(sinGuardado.ok && sinGuardado.valor.ubicacion_precision === "aproximada");
  assert.deepEqual(cambiosAlEditar(entrada({}), null), { ok: true, valor: {} });
});

test("mismoPunto tolera el ir y volver como texto, y nada mas", () => {
  assert.equal(mismoPunto(PUNTO, { lat: PUNTO.lat + 1e-12, lng: PUNTO.lng }), true);
  assert.equal(mismoPunto(PUNTO, { lat: PUNTO.lat + 1e-7, lng: PUNTO.lng }), false);
  assert.equal(mismoPunto(PUNTO, { lat: null, lng: null }), false);
  assert.equal(mismoPunto(null, { lat: PUNTO.lat, lng: PUNTO.lng }), false);
});
