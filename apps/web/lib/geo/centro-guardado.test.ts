import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { centroDesdeCookie, centroGuardadoSinLeer, leerCentroGuardado, suscribirCentroGuardado } from "./centro-guardado";

const descriptores = Object.fromEntries(["document", "window"].map((clave) => [clave, Object.getOwnPropertyDescriptor(globalThis, clave)]));
afterEach(() => {
  for (const [clave, descriptor] of Object.entries(descriptores)) {
    if (descriptor) Object.defineProperty(globalThis, clave, descriptor);
    else Reflect.deleteProperty(globalThis, clave);
  }
});

test("lee el centro de la cookie entre otras, con el mismo parseo que readLocation", () => {
  assert.deepEqual(centroDesdeCookie("sb-auth=x; vicino_location=19.041,-98.206; vicino_radius=10000"), { lat: 19.041, lng: -98.206 });
  assert.deepEqual(centroDesdeCookie("vicino_location=19.063%2C-98.306"), { lat: 19.063, lng: -98.306 });
});

test("devuelve el MISMO objeto mientras el valor crudo no cambie (getSnapshot estable)", () => {
  const primero = centroDesdeCookie("vicino_location=19.041,-98.206; a=1");
  // Cambia otra cookie (p. ej. la de sesion al refrescarse): el centro no cambia de identidad.
  assert.equal(centroDesdeCookie("vicino_location=19.041,-98.206; a=2"), primero);
  const otro = centroDesdeCookie("vicino_location=19.063,-98.306");
  assert.notEqual(otro, primero);
  assert.deepEqual(otro, { lat: 19.063, lng: -98.306 });
});

test("sin cookie, vacia, basura o mal codificada: null", () => {
  for (const cookie of ["", "a=1", "vicino_location=", "vicino_location=basura", "vicino_location=%E0%A4%A", "vicino_location=91,-98"]) {
    assert.equal(centroDesdeCookie(cookie), null, cookie);
  }
});

test("el servidor y la hidratacion no conocen el centro: undefined, distinto de «sin zona»", () => {
  assert.equal(centroGuardadoSinLeer(), undefined);
});

test("sin document o con cookies bloqueadas no lanza", () => {
  Reflect.deleteProperty(globalThis, "document");
  assert.equal(leerCentroGuardado(), null);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get cookie(): string { throw new Error("bloqueada"); } } });
  assert.equal(leerCentroGuardado(), null);
});

test("la suscripcion escucha el aviso de cambio de zona y se puede quitar", () => {
  const oyentes = new Map<string, Set<() => void>>();
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    addEventListener: (tipo: string, fn: () => void) => { if (!oyentes.has(tipo)) oyentes.set(tipo, new Set()); oyentes.get(tipo)!.add(fn); },
    removeEventListener: (tipo: string, fn: () => void) => { oyentes.get(tipo)?.delete(fn); },
  } });
  let avisos = 0;
  const quitar = suscribirCentroGuardado(() => { avisos++; });
  oyentes.get("vicino_location_updated")?.forEach((fn) => fn());
  assert.equal(avisos, 1);
  quitar();
  assert.equal(oyentes.get("vicino_location_updated")?.size, 0);
});
