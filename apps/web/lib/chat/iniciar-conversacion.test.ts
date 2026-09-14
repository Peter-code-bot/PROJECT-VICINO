import assert from "node:assert/strict";
import test from "node:test";

import { claveHeredada } from "./iniciar-conversacion";

const COMPRADOR = "11111111-1111-4111-8111-111111111111";
const VENDEDOR = "22222222-2222-4222-8222-222222222222";
const PRODUCTO = "33333333-3333-4333-8333-333333333333";
const OTRO_PRODUCTO = "44444444-4444-4444-8444-444444444444";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// La columna messages.clave_idempotencia es `uuid`: un hash crudo la haria
// fallar con 22P02 en el INSERT, y eso solo se veria en produccion.
test("claveHeredada devuelve un uuid valido", () => {
  const k = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 0);
  assert.match(k, UUID);
  // Version 8 y variante RFC 4122: ningun gen_random_uuid() (v4) puede
  // colisionar con una clave derivada.
  assert.equal(k[14], "8");
  assert.ok(["8", "9", "a", "b"].includes(k[19]!));
});

// Es la garantia que sustituye a la clave ausente del enlace viejo: dos
// pulsaciones dentro de la misma hora tienen que verse como una sola.
test("la misma intencion dentro de la ventana da la misma clave", () => {
  const a = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 1_000);
  const b = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 59 * 60 * 1000);
  assert.equal(a, b);
});

// Sin este corte, un enlace viejo quedaria inservible para siempre despues
// del primer uso: el comprador no podria volver a avisar nunca.
test("pasada la ventana la clave cambia", () => {
  const a = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 0);
  const b = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 60 * 60 * 1000);
  assert.notEqual(a, b);
});

test("productos distintos no comparten clave en la misma hora", () => {
  const a = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 0);
  const b = claveHeredada(COMPRADOR, VENDEDOR, OTRO_PRODUCTO, 0);
  assert.notEqual(a, b);
});

// El indice unico es (autor_id, clave_idempotencia), asi que dos compradores
// con la misma clave no chocarian en la base; aun asi derivar claves iguales
// para personas distintas seria una fuga de informacion innecesaria.
test("compradores distintos no comparten clave", () => {
  const a = claveHeredada(COMPRADOR, VENDEDOR, PRODUCTO, 0);
  const b = claveHeredada(VENDEDOR, VENDEDOR, PRODUCTO, 0);
  assert.notEqual(a, b);
});
