import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  consumirRestauracion,
  marcarRestauracionPendiente,
  vaciarRestauracion,
} from "./restauracion-ui";

beforeEach(() => {
  vaciarRestauracion();
});

test("sin marca no se toca el scroll: Next ya hizo el suyo", () => {
  assert.equal(consumirRestauracion("/chat"), "nada");
});

test("la marca de una navegacion de pestaña se consume una sola vez", () => {
  marcarRestauracionPendiente("/chat", 1_000);
  assert.equal(consumirRestauracion("/chat", 1_100), "restaurar");
  assert.equal(consumirRestauracion("/chat", 1_200), "nada", "el segundo montaje no vuelve a saltar");
});

test("una marca caducada sube arriba en vez de heredar el scroll anterior", () => {
  marcarRestauracionPendiente("/", 0);
  assert.equal(consumirRestauracion("/", 20_000), "arriba");
});

test("una marca hacia otra ruta sube arriba: la navegacion fue con scroll:false", () => {
  marcarRestauracionPendiente("/chat", 2_000);
  assert.equal(consumirRestauracion("/perfil", 2_100), "arriba");
  assert.equal(consumirRestauracion("/chat", 2_200), "nada", "y ya no queda nada pendiente");
});

test("vaciar borra la marca pendiente", () => {
  marcarRestauracionPendiente("/", 0);
  vaciarRestauracion();
  assert.equal(consumirRestauracion("/", 1), "nada");
});
