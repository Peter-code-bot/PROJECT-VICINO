import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal } from "../pruebas/cargar-real";

type Config = typeof import("./config");

// config.ts importa "server-only": se carga con cargarReal, que lo sustituye.
const cargar = () => cargarReal<Config>("lib/whatsapp/config.ts");

test("sin token no hay configuracion de envio; con token, version por defecto o la pedida si es valida", async () => {
  const c = await cargar();
  assert.equal(c.configuracionWhatsApp({}), null);
  assert.equal(c.configuracionWhatsApp({ WHATSAPP_ACCESS_TOKEN: "   " }), null);
  assert.deepEqual(c.configuracionWhatsApp({ WHATSAPP_ACCESS_TOKEN: " tok " }), {
    token: "tok",
    version: c.VERSION_GRAPH_POR_DEFECTO,
    baseUrl: "https://graph.facebook.com",
  });
  assert.equal(c.configuracionWhatsApp({ WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_GRAPH_VERSION: "v25.0" })?.version, "v25.0");
  assert.equal(c.configuracionWhatsApp({ WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_GRAPH_VERSION: "25" })?.version, c.VERSION_GRAPH_POR_DEFECTO);
  assert.equal(c.configuracionWhatsApp({ WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_GRAPH_VERSION: "v27.0/../x" })?.version, c.VERSION_GRAPH_POR_DEFECTO);
  assert.match(c.VERSION_GRAPH_POR_DEFECTO, /^v\d{2}\.\d$/);
});

test("el verify token y el app secret exigen al menos 16 caracteres", async () => {
  const c = await cargar();
  assert.equal(c.tokenVerificacionWebhook({}), null);
  assert.equal(c.tokenVerificacionWebhook({ WHATSAPP_VERIFY_TOKEN: "corto" }), null);
  assert.equal(c.tokenVerificacionWebhook({ WHATSAPP_VERIFY_TOKEN: " token-de-verificacion-largo " }), "token-de-verificacion-largo");
  assert.equal(c.secretoAppWhatsApp({}), null);
  // Los valores se arman en ejecucion: un literal con forma de secreto junto a
  // la clave WHATSAPP_APP_SECRET lo marca el escaneo de secretos (gitleaks).
  const dieciseis = "x".repeat(16);
  const quince = "x".repeat(15);
  assert.equal(c.secretoAppWhatsApp({ WHATSAPP_APP_SECRET: dieciseis }), dieciseis);
  assert.equal(c.secretoAppWhatsApp({ WHATSAPP_APP_SECRET: quince }), null);
});
