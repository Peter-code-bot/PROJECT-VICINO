/**
 * Estructura del .pkpass con una cadena AUTOFIRMADA creada con openssl en el
 * momento. Prueba que el pase se arma y se firma; NO prueba que Apple lo
 * acepte (eso exige el certificado real del Pass Type ID y un iPhone).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { cargarReal } from "../../pruebas/cargar-real";
import type { SnapshotMembresia } from "@/lib/lealtad/esquemas";

type Pase = typeof import("./pase");

const snapshot: SnapshotMembresia = {
  membership: {
    id: "10000000-0000-4000-8000-000000000001",
    public_id: "vl_0123456789abcdef0123456789abcdef",
    status: "activa",
    sellos_disponibles: 3,
    sellos_totales: 8,
    premios_canjeados: 1,
    wallet_version: 4,
    version_aceptada: 2,
    created_at: "2026-10-20T00:00:00+00:00",
  },
  program: {
    id: "20000000-0000-4000-8000-000000000001",
    nombre: "Tarjeta Strudel",
    premio: "1 café americano",
    meta_sellos: 5,
    condiciones: null,
    color: "#1F5A4E",
    plantilla: "sellos",
    status: "activo",
    version_actual: 2,
  },
  cliente: { id: "30000000-0000-4000-8000-000000000001", nombre: "Beto" },
  negocio: { id: "40000000-0000-4000-8000-000000000001", nombre: "Café Strudel", foto: null },
};

function cadenaAutofirmada(): { wwdr: string; signerCert: string; signerKey: string } | null {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
  } catch {
    return null;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "vicino-pase-"));
  try {
    const run = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
    run(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", "ca.key", "-out", "ca.pem", "-days", "2", "-subj", "/CN=WWDR de prueba"]);
    run(["req", "-newkey", "rsa:2048", "-nodes", "-keyout", "signer.key", "-out", "signer.csr", "-subj", "/CN=Pass Type ID: pass.test.vicino/OU=ABCDE12345"]);
    run(["x509", "-req", "-in", "signer.csr", "-CA", "ca.pem", "-CAkey", "ca.key", "-CAcreateserial", "-out", "signer.pem", "-days", "2"]);
    return {
      wwdr: readFileSync(path.join(dir, "ca.pem"), "utf8"),
      signerCert: readFileSync(path.join(dir, "signer.pem"), "utf8"),
      signerKey: readFileSync(path.join(dir, "signer.key"), "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("textoProgreso y hexARgb", async () => {
  const pase = await cargarReal<Pase>("lib/wallet/apple/pase.ts");
  assert.equal(pase.textoProgreso(3, 5), "3 de 5");
  assert.equal(pase.textoProgreso(-1, 5), "0 de 5");
  assert.equal(pase.hexARgb("#1F5A4E"), "rgb(31, 90, 78)");
  assert.equal(pase.hexARgb("rojo"), "rgb(31, 90, 78)", "un color invalido cae a la marca");
});

test("los campos del pase: progreso canonico, premio, titular, condiciones por defecto", async () => {
  const pase = await cargarReal<Pase>("lib/wallet/apple/pase.ts");
  const campos = pase.camposDelPase(snapshot);
  assert.deepEqual(campos.header, [{ key: "sellos", label: "SELLOS", value: "3 de 5" }]);
  assert.equal(campos.primary[0]?.value, "1 café americano");
  assert.equal(campos.secondary[0]?.value, "Beto");
  assert.equal(campos.auxiliary[0]?.value, "2 sellos");
  assert.equal(campos.back[1]?.value, "Sin condiciones adicionales.");
  const listo = pase.camposDelPase({ ...snapshot, membership: { ...snapshot.membership, sellos_disponibles: 5 } });
  assert.equal(listo.auxiliary[0]?.label, "LISTO");
});

test("arma y firma un storeCard con cadena autofirmada (estructura, no aceptacion de Apple)", async (t) => {
  const cadena = cadenaAutofirmada();
  if (!cadena) {
    t.skip("sin openssl en esta maquina");
    return;
  }
  const pase = await cargarReal<Pase>("lib/wallet/apple/pase.ts");
  const datos = {
    config: { passTypeId: "pass.test.vicino", teamId: "ABCDE12345", ...cadena },
    snapshot,
    serialNumber: `vicino-${snapshot.membership.id}`,
    authenticationToken: "a".repeat(64),
    siteUrl: "https://vicinomarket.com",
  };
  const crudo = pase.armarPaseApple(datos).getAsRaw();
  for (const nombre of ["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "logo.png"]) {
    assert.ok(crudo[nombre], `falta ${nombre}`);
  }
  const json = JSON.parse(crudo["pass.json"]!.toString("utf8"));
  assert.equal(json.formatVersion, 1);
  assert.equal(json.passTypeIdentifier, "pass.test.vicino");
  assert.equal(json.teamIdentifier, "ABCDE12345");
  assert.equal(json.serialNumber, `vicino-${snapshot.membership.id}`);
  assert.equal(json.webServiceURL, "https://vicinomarket.com/api/wallet/apple");
  assert.equal(json.authenticationToken, "a".repeat(64));
  assert.equal(json.backgroundColor, "rgb(31, 90, 78)");
  assert.equal(json.logoText, "Café Strudel");
  assert.equal(json.sharingProhibited, true);
  assert.equal(json.storeCard.headerFields[0].value, "3 de 5");
  assert.equal(json.storeCard.primaryFields[0].value, "1 café americano");
  assert.equal(json.barcodes[0].message, snapshot.membership.public_id);
  assert.equal(json.barcodes[0].format, "PKBarcodeFormatQR");
  const texto = JSON.stringify(json);
  assert.ok(!texto.includes(snapshot.cliente.id) && !texto.includes(snapshot.negocio.id), "ningun id interno viaja en el pase");
  const manifest = JSON.parse(crudo["manifest.json"]!.toString("utf8"));
  assert.ok(manifest["pass.json"] && manifest["icon.png"], "el manifest lista los archivos");

  const archivo = pase.construirPaseApple(datos);
  assert.equal(archivo.subarray(0, 2).toString("latin1"), "PK", "es un zip");
});
