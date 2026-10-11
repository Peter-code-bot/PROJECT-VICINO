import assert from "node:assert/strict";
import test from "node:test";
import { exentaDeConfirmacionLegal, legalStateSchema, rutaConfirmacionCuenta } from "./confirmacion-legal";

test("documentos distintos y estado coherente son necesarios para confirmar", () => {
  const documents = [{ documento: "terminos", version: "1.1", confirmada: true }, { documento: "aviso", version: "2.2", confirmada: true }];
  assert.equal(legalStateSchema.safeParse({ confirmed: true, documents }).success, true);
  for (const invalid of [
    { confirmed: true, documents: [documents[0], documents[0]] },
    { confirmed: true, documents: [documents[0], { ...documents[1], confirmada: false }] },
    { confirmed: true, documents: [documents[0], { ...documents[1], version: "" }] },
    { confirmed: true, documents: [] },
  ]) assert.equal(legalStateSchema.safeParse(invalid).success, false);
});

test("legales, baja, recuperación y callbacks siguen accesibles sin confirmación", () => {
  for (const path of ["/terminos", "/privacidad?desde=registro", "/eliminar-cuenta", "/confirmar-cuenta?next=%2F",
    "/auth/callback-server", "/callback", "/forgot-password", "/reset-password?token=local", "/logout", "/cuenta-eliminada"])
    assert.equal(exentaDeConfirmacionLegal(path), true, path);
  for (const path of ["/", "/bienvenida", "/completar-perfil/usuario", "/perfil", "/vender", "/privacidad-maliciosa"])
    assert.equal(exentaDeConfirmacionLegal(path), false, path);
});

test("retorno del gate es local y no entra en bucle consigo mismo", () => {
  assert.equal(rutaConfirmacionCuenta("/bienvenida?next=%2Fbuscar"), "/confirmar-cuenta?next=%2Fbienvenida%3Fnext%3D%252Fbuscar");
  for (const unsafe of ["https://externo.example", "//externo.example", "/login", "/confirmar-cuenta?next=/vender"])
    assert.equal(rutaConfirmacionCuenta(unsafe), "/confirmar-cuenta?next=%2F");
});
