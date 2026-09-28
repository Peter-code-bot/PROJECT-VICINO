import assert from "node:assert/strict";
import test from "node:test";
import { esRutaLegal } from "./rutas-legales";

test("las tres paginas legales y sus subrutas", () => {
  for (const r of ["/terminos", "/privacidad", "/eliminar-cuenta", "/terminos/v2"]) assert.equal(esRutaLegal(r), true, r);
});

test("nada mas: ni prefijos parecidos ni rutas normales ni vacio", () => {
  for (const r of ["", "/", "/perfil", "/terminosx", "/privacidad-extra", "/buscar", "/eliminar"]) assert.equal(esRutaLegal(r), false, r);
});
