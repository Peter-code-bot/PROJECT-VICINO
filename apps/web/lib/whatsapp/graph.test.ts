import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal } from "../pruebas/cargar-real";
import { MENSAJE_SIN_CONFIRMAR } from "./presentacion";

type Graph = typeof import("./graph");

const PHONE = "123456789012345";
const WA_ID = "5215512345678";
const WAMID = "wamid.HBgLNTIxNTUxMjM0NTY3OBUCABIYFjNFQjBDMUM3NkY4NkNBNjhBQjQ4RjMA";

interface Llamada {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: unknown;
}

// graph.ts lleva "server-only": se carga con cargarReal, que lo sustituye.
const cargar = () => cargarReal<Graph>("lib/whatsapp/graph.ts");

function clienteFalso(respuesta: { status: number; json?: unknown; texto?: string } | Error) {
  const llamadas: Llamada[] = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const headers = new Headers(init?.headers);
    llamadas.push({
      url: String(entrada),
      method: init?.method,
      headers: Object.fromEntries(headers.entries()),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    if (respuesta instanceof Error) throw respuesta;
    const cuerpo = respuesta.texto ?? JSON.stringify(respuesta.json ?? {});
    return new Response(cuerpo, {
      status: respuesta.status,
      headers: { "content-type": respuesta.texto ? "text/html" : "application/json" },
    });
  };
  const cliente = { token: "TOKEN-SECRETO", version: "v27.0", baseUrl: "https://graph.test", fetch: fetchFalso };
  return { cliente, llamadas };
}

test("un texto se manda al endpoint de Meta con el Bearer, el + en el destino y sin vista previa", async () => {
  const g = await cargar();
  const { cliente, llamadas } = clienteFalso({ status: 200, json: { messaging_product: "whatsapp", contacts: [{ input: `+${WA_ID}`, wa_id: WA_ID }], messages: [{ id: WAMID }] } });
  const r = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "  Hola, sí hay pan.  " });
  assert.deepEqual(r, { ok: true, wamid: WAMID });
  assert.equal(llamadas.length, 1);
  const [l] = llamadas;
  assert.equal(l?.url, `https://graph.test/v27.0/${PHONE}/messages`);
  assert.equal(l?.method, "POST");
  assert.equal(l?.headers.authorization, "Bearer TOKEN-SECRETO");
  assert.equal(l?.headers["content-type"], "application/json");
  assert.deepEqual(l?.body, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: `+${WA_ID}`,
    type: "text",
    text: { preview_url: false, body: "Hola, sí hay pan." },
  });
});

test("respondeA valido cita el mensaje; uno invalido se ignora", async () => {
  const g = await cargar();
  const ok = clienteFalso({ status: 200, json: { messages: [{ id: WAMID }] } });
  await g.enviarTextoWhatsApp(ok.cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola", respondeA: WAMID });
  assert.deepEqual((ok.llamadas[0]?.body as { context?: unknown }).context, { message_id: WAMID });

  const malo = clienteFalso({ status: 200, json: { messages: [{ id: WAMID }] } });
  await g.enviarTextoWhatsApp(malo.cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola", respondeA: "con espacios y raro" });
  assert.equal("context" in (malo.llamadas[0]?.body as object), false);
});

test("un error de Meta se traduce por codigo, conserva el detalle para Sentry y SI es un fallo confirmado", async () => {
  const g = await cargar();
  const { cliente } = clienteFalso({
    status: 400,
    json: {
      error: {
        message: "(#131047) Re-engagement message",
        type: "OAuthException",
        code: 131047,
        error_data: { messaging_product: "whatsapp", details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." },
        fbtrace_id: "AbCdEf",
      },
    },
  });
  const r = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.codigo, 131047);
  assert.equal(r.sinConfirmar, false);
  assert.match(r.mensajeUsuario, /24 horas/);
  assert.match(r.detalle, /^HTTP 400: \(#131047\) Re-engagement message \| Message failed .* \| fbtrace AbCdEf$/);
});

test("un 2xx sin identificador usable NO es un fallo reenviable: queda sin confirmar", async () => {
  const g = await cargar();
  for (const json of [{ messaging_product: "whatsapp" }, { messages: [{ id: "x".repeat(300) }] }, { messages: [{ id: "con espacios no" }] }]) {
    const { cliente } = clienteFalso({ status: 200, json });
    const r = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola" });
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.equal(r.sinConfirmar, true);
    assert.equal(r.codigo, null);
    assert.match(r.mensajeUsuario, /No lo reenvíes/);
  }
});

test("sin red y con tiempo agotado se distingue el motivo, no hay codigo y queda sin confirmar", async () => {
  const g = await cargar();
  const red = clienteFalso(new TypeError("fetch failed"));
  const r1 = await g.enviarTextoWhatsApp(red.cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola" });
  assert.deepEqual(r1, { ok: false, codigo: null, detalle: "sin respuesta de la red", mensajeUsuario: MENSAJE_SIN_CONFIRMAR, sinConfirmar: true });

  const lento = clienteFalso(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
  const r2 = await g.enviarTextoWhatsApp(lento.cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola" });
  assert.equal(r2.ok, false);
  if (r2.ok) return;
  assert.equal(r2.detalle, "tiempo de espera agotado");
  assert.equal(r2.sinConfirmar, true);
});

test("un 5xx sin JSON (HTML de un proxy) dice que WhatsApp no esta disponible, no 'revisa tu conexion'", async () => {
  const g = await cargar();
  const { cliente } = clienteFalso({ status: 502, texto: "<html>Bad Gateway</html>" });
  const r = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "Hola" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.codigo, null);
  assert.equal(r.sinConfirmar, false);
  assert.match(r.mensajeUsuario, /no está disponible en este momento \(HTTP 502\)/);
  assert.equal(r.detalle, "HTTP 502: respuesta sin detalle");
});

test("datos invalidos no llegan a la red", async () => {
  const g = await cargar();
  const { cliente, llamadas } = clienteFalso({ status: 200, json: { messages: [{ id: WAMID }] } });
  const a = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: "+52 55 1234", texto: "Hola" });
  const b = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: "abc", waId: WA_ID, texto: "Hola" });
  const c = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "x".repeat(g.TEXTO_MAXIMO_WHATSAPP + 1) });
  const d = await g.enviarTextoWhatsApp(cliente, { phoneNumberId: PHONE, waId: WA_ID, texto: "   " });
  for (const r of [a, b, c, d]) {
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.sinConfirmar, false);
  }
  assert.equal(llamadas.length, 0);
});

test("marcar como leido manda status read con el wamid, acepta el success de Meta y distingue la red", async () => {
  const g = await cargar();
  const { cliente, llamadas } = clienteFalso({ status: 200, json: { success: true } });
  const r = await g.marcarLeidoWhatsApp(cliente, { phoneNumberId: PHONE, wamid: WAMID });
  assert.deepEqual(r, { ok: true, codigo: null, detalle: null });
  assert.deepEqual(llamadas[0]?.body, { messaging_product: "whatsapp", status: "read", message_id: WAMID });

  const mal = clienteFalso({ status: 401, json: { error: { message: "Invalid OAuth access token", code: 190 } } });
  const r2 = await g.marcarLeidoWhatsApp(mal.cliente, { phoneNumberId: PHONE, wamid: WAMID });
  assert.equal(r2.ok, false);
  assert.equal(r2.codigo, 190);

  const sinRed = clienteFalso(new TypeError("fetch failed"));
  const r3 = await g.marcarLeidoWhatsApp(sinRed.cliente, { phoneNumberId: PHONE, wamid: WAMID });
  assert.deepEqual(r3, { ok: false, codigo: null, detalle: "sin respuesta de la red" });
});
