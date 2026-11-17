import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { firmaWebhookValida, firmarCuerpoWebhook, igualesEnTiempoConstante } from "./firma";

const SECRETO = "app-secret-de-prueba-0123456789";
// Como lo manda Meta: JSON compacto con lo no ASCII escapado.
const CUERPO =
  '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","messages":[{"text":{"body":"Hola, \\u00bfhay pan?"}}]}}]}]}';

test("firmar produce sha256=<64 hex> igual al HMAC-SHA256 del cuerpo crudo", () => {
  const firma = firmarCuerpoWebhook(CUERPO, SECRETO);
  assert.match(firma, /^sha256=[0-9a-f]{64}$/);
  assert.equal(firma.slice(7), createHmac("sha256", SECRETO).update(CUERPO, "utf8").digest("hex"));
  // Vector conocido: HMAC-SHA256 de cadena vacia con llave vacia.
  assert.equal(firmarCuerpoWebhook("", ""), "sha256=b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad");
});

test("acepta la firma correcta, con hex y prefijo en mayusculas (como el RPC: lower + btrim) y con espacios", () => {
  const firma = firmarCuerpoWebhook(CUERPO, SECRETO);
  assert.equal(firmaWebhookValida(CUERPO, firma, SECRETO), true);
  assert.equal(firmaWebhookValida(CUERPO, firma.toUpperCase().replace("SHA256=", "sha256="), SECRETO), true);
  // El RPC ingerir_webhook_whatsapp hace lower(btrim(p_firma)): aqui se acepta lo mismo.
  assert.equal(firmaWebhookValida(CUERPO, firma.toUpperCase(), SECRETO), true);
  assert.equal(firmaWebhookValida(CUERPO, `  ${firma}  `, SECRETO), true);
});

test("rechaza cuerpo alterado, otro secreto, sin prefijo, largo incorrecto y vacios", () => {
  const firma = firmarCuerpoWebhook(CUERPO, SECRETO);
  assert.equal(firmaWebhookValida(CUERPO + " ", firma, SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO.replace("pan", "pam"), firma, SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO, firma, "otro-secreto"), false);
  assert.equal(firmaWebhookValida(CUERPO, firma.slice(7), SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO, "sha256=" + firma.slice(7, 70), SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO, "sha256=zz" + firma.slice(9), SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO, null, SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO, undefined, SECRETO), false);
  assert.equal(firmaWebhookValida(CUERPO, firma, null), false);
  assert.equal(firmaWebhookValida(CUERPO, firma, ""), false);
});

test("la firma es de los bytes exactos: el mismo JSON reserializado ya no coincide", () => {
  const firma = firmarCuerpoWebhook(CUERPO, SECRETO);
  const reserializado = JSON.stringify(JSON.parse(CUERPO));
  assert.notEqual(reserializado, CUERPO);
  assert.equal(firmaWebhookValida(reserializado, firma, SECRETO), false);
});

test("igualesEnTiempoConstante compara cadenas completas", () => {
  assert.equal(igualesEnTiempoConstante("token-de-prueba", "token-de-prueba"), true);
  assert.equal(igualesEnTiempoConstante("token-de-prueba", "token-de-pruebA"), false);
  assert.equal(igualesEnTiempoConstante("token", "token-largo"), false);
  assert.equal(igualesEnTiempoConstante("", ""), true);
});
