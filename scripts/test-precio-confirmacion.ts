import assert from "node:assert/strict";
import { test } from "node:test";
import { importeVenta, precioFijo, totalPrecioFijo } from "../apps/web/lib/chat/precio-confirmacion";
import type { ProductoChat } from "../apps/web/lib/chat/producto-activo";

const product: ProductoChat = {
  id: "20000000-0000-4000-8000-000000000001", titulo: "Producto", precio: 12800,
  modo_precio: "precio", precio_negociable: false, creador_id: "seller",
  imagen_principal: null, estatus: "disponible", is_hidden: false,
};

test("fixed policy follows canonical price mode and negotiability", () => {
  assert.equal(precioFijo(product), true);
  assert.equal(precioFijo({ ...product, precio_negociable: true }), false);
  for (const modo_precio of ["cotizacion", "reservacion", "fijo", ""]) {
    assert.equal(precioFijo({ ...product, modo_precio }), false);
  }
  assert.equal(precioFijo(null), false);
});

test("quantity multiplies cents once and preserves decimal currency", () => {
  assert.equal(totalPrecioFijo(12800, "1"), 12800);
  assert.equal(totalPrecioFijo(12800, "2"), 25600);
  assert.equal(totalPrecioFijo(.1, "3"), .3);
  assert.equal(totalPrecioFijo(61.05, "3"), 183.15);
  assert.equal(totalPrecioFijo(99_999_999, "1"), 99_999_999);
  assert.equal(totalPrecioFijo(.01, "9999"), 99.99);
});

test("invalid catalog/quantity and overflowing totals never become a zero price", () => {
  for (const price of [null, 0, -1, NaN, Infinity, 1.001, 100_000_000]) {
    assert.equal(totalPrecioFijo(price, "1"), null);
  }
  for (const quantity of ["", "0", "-1", "1.5", "10000", "NaN", "Infinity"]) {
    assert.equal(totalPrecioFijo(10, quantity), null);
  }
  assert.equal(totalPrecioFijo(99_999_999, "2"), null);
});

test("MXN display is formatted independently of the editable/manual contract", () => {
  assert.equal(importeVenta(12800), "$12,800");
  assert.equal(importeVenta(183.15), "$183.15");
  assert.equal(importeVenta(.3), "$0.3");
});
