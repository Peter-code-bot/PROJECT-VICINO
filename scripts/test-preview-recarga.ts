/** Politica de recarga del preview del mapa (Fase 1 de docs/PLAN-ANDROID-2026-10-03.md).
 * Logica pura: la caducidad no es un fallo, y un fallo solo se reintenta una vez al volver. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decidirRecarga, previewNoDisponible, crearPresupuesto, resolverRecarga, MAX_RECARGAS_AUTOMATICAS,
} from "../apps/web/lib/geo/map-preview-recarga";

const base = { visible: true, online: true, reintentoUsado: false, restantes: 6 } as const;

test("la caducidad visible y con red se recarga sola, venga de donde venga el aviso", () => {
  for (const evento of ["estado", "volver", "red"] as const) {
    assert.equal(decidirRecarga({ ...base, status: "expired", evento }), "caducada");
  }
});

test("oculta o sin red no gasta una peticion: espera a volver", () => {
  assert.equal(decidirRecarga({ ...base, status: "expired", evento: "estado", visible: false }), null);
  assert.equal(decidirRecarga({ ...base, status: "expired", evento: "estado", online: false }), null);
  assert.equal(decidirRecarga({ ...base, status: "error", evento: "volver", visible: false }), null);
});

test("un fallo NO se reintenta en el acto: solo al volver a la app o al recuperar la red", () => {
  assert.equal(decidirRecarga({ ...base, status: "error", evento: "estado" }), null);
  assert.equal(decidirRecarga({ ...base, status: "error", evento: "volver" }), "reintento");
  assert.equal(decidirRecarga({ ...base, status: "error", evento: "red" }), "reintento");
});

test("un fallo se reintenta una sola vez; despues queda el boton", () => {
  assert.equal(decidirRecarga({ ...base, status: "error", evento: "volver", reintentoUsado: true }), null);
});

test("sin presupuesto no hay peticiones automaticas de ningun tipo", () => {
  assert.equal(decidirRecarga({ ...base, status: "expired", evento: "estado", restantes: 0 }), null);
  assert.equal(decidirRecarga({ ...base, status: "error", evento: "volver", restantes: 0 }), null);
});

test("los estados sanos o en curso nunca disparan peticiones", () => {
  for (const status of ["empty", "pending", "ready"] as const) {
    for (const evento of ["estado", "volver", "red"] as const) {
      assert.equal(decidirRecarga({ ...base, status, evento }), null);
    }
  }
});

test("la caducidad solo se pinta como 'no disponible' cuando ya no se puede recargar sola", () => {
  assert.equal(previewNoDisponible("expired", 3), false);
  assert.equal(previewNoDisponible("expired", 0), true);
  assert.equal(previewNoDisponible("error", 3), true);
  for (const status of ["empty", "pending", "ready"] as const) assert.equal(previewNoDisponible(status, 0), false);
});

test("el presupuesto se agota en el maximo y no baja de cero", () => {
  const presupuesto = crearPresupuesto(2);
  assert.equal(presupuesto.restantes(), 2);
  assert.equal(presupuesto.consumir(), true); assert.equal(presupuesto.consumir(), true);
  assert.equal(presupuesto.consumir(), false); assert.equal(presupuesto.restantes(), 0);
});

test("el maximo es 6 recargas seguidas sin nadie mirando (media hora de inicio olvidado)", () => {
  assert.equal(MAX_RECARGAS_AUTOMATICAS, 6);
  assert.equal(crearPresupuesto().restantes(), 6);
});

const vivo = { visible: true, online: true, reintentoUsado: false } as const;

test("un inicio olvidado en pantalla se queda sin presupuesto a las 6 caducidades", () => {
  const presupuesto = crearPresupuesto();
  for (let i = 0; i < 6; i++) assert.equal(resolverRecarga({ ...vivo, status: "expired", evento: "estado" }, presupuesto), "caducada");
  assert.equal(resolverRecarga({ ...vivo, status: "expired", evento: "estado" }, presupuesto), null);
  assert.equal(presupuesto.restantes(), 0);
});

test("volver a la app repone el presupuesto: quien entra y sale muchas veces nunca ve el error", () => {
  const presupuesto = crearPresupuesto(2);
  presupuesto.consumir(); presupuesto.consumir();
  for (let vuelta = 0; vuelta < 10; vuelta++) {
    assert.equal(resolverRecarga({ ...vivo, status: "expired", evento: "volver" }, presupuesto), "caducada");
  }
});

test("volver con la app oculta o la red no reponen nada", () => {
  const presupuesto = crearPresupuesto(1); presupuesto.consumir();
  assert.equal(resolverRecarga({ ...vivo, status: "expired", evento: "volver", visible: false }, presupuesto), null);
  assert.equal(resolverRecarga({ ...vivo, status: "expired", evento: "red" }, presupuesto), null);
  assert.equal(presupuesto.restantes(), 0);
});

test("resolverRecarga no gasta presupuesto cuando no hay nada que pedir", () => {
  const presupuesto = crearPresupuesto(1);
  assert.equal(resolverRecarga({ ...vivo, status: "pending", evento: "volver" }, presupuesto), null);
  assert.equal(resolverRecarga({ ...vivo, status: "error", evento: "estado" }, presupuesto), null);
  assert.equal(presupuesto.restantes(), 1);
});
