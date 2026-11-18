import assert from "node:assert/strict";
import test from "node:test";
import {
  CUENTAS_FUERA_DE_METRICAS,
  DOMINIOS_FUERA_DE_METRICAS,
  dominioDeCorreo,
  esDominioFueraDeMetricas,
  estaFueraDeMetricas,
  patronDeDominio,
  resumirComunidad,
} from "./cuentas-fuera-de-metricas";

// Cifras y correos inventados: el repositorio es publico y aqui no va ningun
// dato de produccion.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const listada = CUENTAS_FUERA_DE_METRICAS[0]!.id;
const cualquiera = "00000000-0000-4000-8000-000000000123";

test("el criterio son tres dominios de datos inventados o de prueba y cuentas sueltas por UUID", () => {
  assert.deepEqual([...DOMINIOS_FUERA_DE_METRICAS], ["mock-appstore.vicino.mx", "demo.vicino.mx", "example.com"]);
  assert.ok(CUENTAS_FUERA_DE_METRICAS.length >= 1);
  const ids = CUENTAS_FUERA_DE_METRICAS.map((cuenta) => cuenta.id.toLowerCase());
  assert.equal(new Set(ids).size, ids.length, "sin UUID repetidos");
  for (const cuenta of CUENTAS_FUERA_DE_METRICAS) {
    assert.match(cuenta.id, UUID, "las cuentas sueltas van por UUID, nunca por correo");
    assert.ok(cuenta.motivo.trim().length > 0, "cada cuenta lleva su motivo");
    assert.ok(!cuenta.motivo.includes("@"), "el motivo no lleva correos: el repositorio es publico");
  }
});

test("el dominio se compara exacto y sin importar mayusculas", () => {
  assert.equal(dominioDeCorreo(" Vendedor01@Mock-AppStore.Vicino.MX "), "mock-appstore.vicino.mx");
  assert.equal(esDominioFueraDeMetricas("vendedor01@mock-appstore.vicino.mx"), true);
  assert.equal(esDominioFueraDeMetricas("COMPRADOR@DEMO.VICINO.MX"), true);
  assert.equal(esDominioFueraDeMetricas("diagnostico@example.com"), true);
  assert.equal(esDominioFueraDeMetricas("alguien@sub.mock-appstore.vicino.mx"), false, "un subdominio no es el lote");
  assert.equal(esDominioFueraDeMetricas("alguien@vicino.mx"), false, "el dominio padre no esta excluido");
  assert.equal(esDominioFueraDeMetricas("alguien@example.com.mx"), false, "otro dominio que empieza igual cuenta");
  assert.equal(
    esDominioFueraDeMetricas("mock-appstore.vicino.mx@ejemplo.mx"),
    false,
    "el dominio va despues de la ultima arroba",
  );
  assert.equal(esDominioFueraDeMetricas("persona@ejemplo.mx"), false);
  for (const malo of [null, undefined, "", "sin-arroba", "@solo-dominio.mx", "nombre@"]) {
    assert.equal(esDominioFueraDeMetricas(malo), false);
    assert.equal(dominioDeCorreo(malo), null);
  }
});

test("una cuenta queda fuera por su UUID o por su dominio; el resto cuenta", () => {
  assert.equal(estaFueraDeMetricas({ id: listada }), true, "sin correo, el UUID basta");
  assert.equal(estaFueraDeMetricas({ id: listada.toUpperCase(), email: "otra@ejemplo.com" }), true);
  assert.equal(estaFueraDeMetricas({ id: cualquiera, email: "x@mock-appstore.vicino.mx" }), true);
  assert.equal(estaFueraDeMetricas({ id: cualquiera, email: "x@demo.vicino.mx" }), true);
  assert.equal(estaFueraDeMetricas({ id: cualquiera, email: "persona@ejemplo.mx" }), false);
  assert.equal(estaFueraDeMetricas({ id: cualquiera, email: null }), false, "sin correo ni UUID listado, cuenta");
});

test("el patron ILIKE ancla el dominio tras la arroba y escapa comodines", () => {
  assert.equal(patronDeDominio("mock-appstore.vicino.mx"), "%@mock-appstore.vicino.mx");
  assert.equal(patronDeDominio("a_b%c\\d.mx"), "%@a\\_b\\%c\\\\d.mx");
});

test("resta las cuentas fuera de metricas sin contar dos veces", () => {
  const conteo = resumirComunidad({
    totalPerfiles: 100,
    totalVendedores: 60,
    porDominio: { cuentas: 5, vendedores: 4 },
    porId: [
      { id: listada, email: "otra@ejemplo.com", es_vendedor: true },
      // Repetida y en mayusculas: es la misma cuenta.
      { id: listada.toUpperCase(), email: "otra@ejemplo.com", es_vendedor: true },
      // Listada por UUID pero ya contada por su dominio.
      { id: cualquiera, email: "lote@mock-appstore.vicino.mx", es_vendedor: true },
    ],
  });
  assert.deepEqual(conteo, { usuarios: 94, vendedores: 55, excluidas: 6, excluidasVendedoras: 5 });
});

test("una cuenta excluida sin Modo Vendedor no se resta de los vendedores", () => {
  const conteo = resumirComunidad({
    totalPerfiles: 10,
    totalVendedores: 4,
    porDominio: { cuentas: 2, vendedores: 1 },
    porId: [{ id: listada, email: null, es_vendedor: false }],
  });
  assert.deepEqual(conteo, { usuarios: 7, vendedores: 3, excluidas: 3, excluidasVendedoras: 1 });
});

test("sin cuentas por excluir, el conteo es el total y nunca baja de cero", () => {
  assert.deepEqual(
    resumirComunidad({ totalPerfiles: 5, totalVendedores: 2, porDominio: { cuentas: 0, vendedores: 0 }, porId: [] }),
    { usuarios: 5, vendedores: 2, excluidas: 0, excluidasVendedoras: 0 },
  );
  assert.deepEqual(
    resumirComunidad({ totalPerfiles: 1, totalVendedores: 0, porDominio: { cuentas: 3, vendedores: 2 }, porId: [] }),
    { usuarios: 0, vendedores: 0, excluidas: 3, excluidasVendedoras: 2 },
  );
});
