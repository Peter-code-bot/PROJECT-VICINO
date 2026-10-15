/** pnpm exec tsx --test scripts/test-mcs-geo-privacy.ts */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createProductSchema, updateProductSchema } from "../packages/shared/src/validators/product";
import { CATEGORIES } from "../packages/shared/src/constants/categories";
import { containsCoordinatePair, publicLocationLabel, PUBLIC_LOCATION_FALLBACK } from "../packages/shared/src/utils/public-location-label";

const product = {
  titulo: "Mesa de prueba",
  descripcion: "Publicación sintética para comprobar la etiqueta pública",
  precio: 100,
  modo_precio: "precio",
  tipo: "producto",
  categories: [{ slug: CATEGORIES.find((category) => category.type === "producto")!.slug, is_primary: true }],
};

test("empty or coordinate labels use a readable fallback, including Apple's CP fallback", () => {
  for (const label of [undefined, null, "", "  ", "19.0414, -98.2063", "19.04141234, -98.20631234, CP 72000", "Punto (19.0414, -98.2063)"]) {
    assert.equal(publicLocationLabel(label), PUBLIC_LOCATION_FALLBACK);
  }
});

test("create and update reject a coordinate label before it can become ubicacion", () => {
  for (const ubicacion of ["19.0414, -98.2063", " 19.04141234, -98.20631234 ", "19.0414, -98.2063, CP 72000"]) {
    for (const result of [createProductSchema.safeParse({ ...product, ubicacion }), updateProductSchema.safeParse({ ubicacion })]) {
      assert.equal(result.success, false);
      if (!result.success) assert.deepEqual(result.error.issues[0]?.path, ["ubicacion"]);
    }
  }
});

test("numeric localities, street numbers, national geography and titles remain valid", () => {
  for (const ubicacion of [PUBLIC_LOCATION_FALLBACK, "2 de Abril, Puebla", "Ciudad 2000, San Luis Potosí", "31 de Octubre, Tijuana", "19 Sur 104, Puebla, CP 72000", "Cancún, Quintana Roo", "Monterrey, Nuevo León", "19, 104", "  Centro, Puebla  "]) {
    assert.equal(containsCoordinatePair(ubicacion), false);
    assert.equal(publicLocationLabel(ubicacion), ubicacion.trim());
    assert.equal(createProductSchema.safeParse({ ...product, ubicacion }).success, true);
    assert.equal(updateProductSchema.safeParse({ ubicacion }).success, true);
  }
  // This guard is scoped to the public location field, not arbitrary content.
  assert.equal(updateProductSchema.safeParse({ titulo: "Modelo 19.0414, -98.2063" }).success, true);
  assert.equal(updateProductSchema.safeParse({ titulo: "Mesa de prueba" }).success, true);
  assert.equal(createProductSchema.safeParse({ ...product, ubicacion: publicLocationLabel() }).success, true);
});
