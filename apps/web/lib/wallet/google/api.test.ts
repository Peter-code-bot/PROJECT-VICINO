import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { cargarReal } from "../../pruebas/cargar-real";
import { verificarJwtRs256 } from "./jwt";
import type { SnapshotMembresia } from "@/lib/lealtad/esquemas";

type Api = typeof import("./api");

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
const config = { issuerId: "3388000000012345678", serviceAccountEmail: "wallet@vicino.iam.gserviceaccount.com", privateKey };
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
    condiciones: "Solo en sucursal",
    color: "#1F5A4E",
    plantilla: "sellos",
    status: "activo",
    version_actual: 2,
  },
  cliente: { id: "30000000-0000-4000-8000-000000000001", nombre: "Beto" },
  negocio: { id: "40000000-0000-4000-8000-000000000001", nombre: "Café Strudel", foto: null },
};

test("ids por programa y membresia con el prefijo del emisor", async () => {
  const api = await cargarReal<Api>("lib/wallet/google/api.ts");
  const ids = api.idsGoogle(config, snapshot.program.id, snapshot.membership.id);
  assert.equal(ids.classId, `${config.issuerId}.vicino-p-${snapshot.program.id}`);
  assert.equal(ids.objectId, `${config.issuerId}.vicino-m-${snapshot.membership.id}`);
  assert.match(ids.classId, /^[0-9]+\.[a-zA-Z0-9._-]+$/);
});

test("el objeto lleva el saldo, el QR opaco y el titular; nada de correo ni ids internos", async () => {
  const api = await cargarReal<Api>("lib/wallet/google/api.ts");
  const ids = api.idsGoogle(config, snapshot.program.id, snapshot.membership.id);
  const objeto = api.cuerpoObjetoGoogle(snapshot, ids);
  assert.equal(objeto.state, "ACTIVE");
  assert.equal(objeto.accountName, "Beto");
  assert.equal(objeto.accountId, snapshot.membership.public_id);
  assert.deepEqual(objeto.loyaltyPoints, { label: "Sellos", balance: { int: 3 } });
  assert.equal(objeto.barcode.value, snapshot.membership.public_id);
  assert.ok(!JSON.stringify(objeto).includes(snapshot.cliente.id), "el id del perfil no viaja al pase");
  const clase = api.cuerpoClaseGoogle(snapshot, ids, "https://vicinomarket.com");
  assert.equal(clase.programName, "Café Strudel · Tarjeta Strudel");
  assert.equal(clase.hexBackgroundColor, "#1F5A4E");
  assert.equal(clase.programLogo.sourceUri.uri, "https://vicinomarket.com/vicino-logo.png");
});

test("el enlace de guardado es un JWT skinny firmado por la cuenta de servicio", async () => {
  const api = await cargarReal<Api>("lib/wallet/google/api.ts");
  const url = api.enlaceGuardarGoogle(config, "3388.vicino-m-x", "https://vicinomarket.com", 1_700_000_000_000);
  assert.ok(url.startsWith("https://pay.google.com/gp/v/save/"));
  const payload = verificarJwtRs256(url.slice("https://pay.google.com/gp/v/save/".length), publicKey);
  assert.deepEqual(payload, {
    iss: config.serviceAccountEmail,
    aud: "google",
    typ: "savetowallet",
    iat: 1_700_000_000,
    origins: ["https://vicinomarket.com"],
    payload: { loyaltyObjects: [{ id: "3388.vicino-m-x" }] },
  });
});
