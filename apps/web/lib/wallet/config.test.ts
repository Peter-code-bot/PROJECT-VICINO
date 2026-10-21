import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal } from "../pruebas/cargar-real";

type Config = typeof import("./config");

const PEM = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";

test("normalizarPem acepta PEM literal, PEM con \\n escapados y PEM en base64; rechaza basura", async () => {
  const { normalizarPem } = await cargarReal<Config>("lib/wallet/config.ts");
  assert.equal(normalizarPem(PEM), PEM);
  assert.equal(normalizarPem(PEM.replace(/\n/g, "\\n")), PEM);
  assert.equal(normalizarPem(Buffer.from(PEM).toString("base64")), PEM);
  assert.equal(normalizarPem("   "), undefined);
  assert.equal(normalizarPem("no-es-un-pem"), undefined);
  assert.equal(normalizarPem(undefined), undefined);
});

test("sin variables no hay proveedores; con las de un proveedor, solo ese", async () => {
  const { configWallet } = await cargarReal<Config>("lib/wallet/config.ts");
  const vacio = configWallet({ NEXT_PUBLIC_SITE_URL: "https://vicinomarket.com/" });
  assert.equal(vacio.apple, null);
  assert.equal(vacio.google, null);
  assert.equal(vacio.siteUrl, "https://vicinomarket.com");

  const soloGoogle = configWallet({
    GOOGLE_WALLET_ISSUER_ID: "3388000000012345678",
    GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: "wallet@proyecto.iam.gserviceaccount.com",
    GOOGLE_WALLET_PRIVATE_KEY: PEM.replace("CERTIFICATE", "PRIVATE KEY"),
  });
  assert.equal(soloGoogle.apple, null);
  assert.equal(soloGoogle.google?.issuerId, "3388000000012345678");
  assert.equal(soloGoogle.siteUrl, "https://vicinomarket.com");

  // Apple a medias (sin WWDR) no se enciende: un pase sin cadena no lo acepta iOS.
  const appleAMedias = configWallet({
    APPLE_WALLET_PASS_TYPE_ID: "pass.com.vicinomarket.lealtad",
    APPLE_WALLET_TEAM_ID: "ABCDE12345",
    APPLE_WALLET_SIGNER_CERT: PEM,
    APPLE_WALLET_SIGNER_KEY: PEM,
  });
  assert.equal(appleAMedias.apple, null);
  const apple = configWallet({
    APPLE_WALLET_PASS_TYPE_ID: "pass.com.vicinomarket.lealtad",
    APPLE_WALLET_TEAM_ID: "ABCDE12345",
    APPLE_WALLET_SIGNER_CERT: PEM,
    APPLE_WALLET_SIGNER_KEY: PEM,
    APPLE_WALLET_WWDR_CERT: Buffer.from(PEM).toString("base64"),
    APPLE_WALLET_SIGNER_KEY_PASSPHRASE: "",
  });
  assert.equal(apple.apple?.passTypeId, "pass.com.vicinomarket.lealtad");
  assert.equal(apple.apple?.wwdr, PEM);
  assert.equal(apple.apple?.signerKeyPassphrase, undefined);
  // Un issuer no numerico es un error de configuracion, no un proveedor encendido.
  assert.equal(configWallet({ GOOGLE_WALLET_ISSUER_ID: "abc", GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL: "x@y", GOOGLE_WALLET_PRIVATE_KEY: PEM }).google, null);
});
