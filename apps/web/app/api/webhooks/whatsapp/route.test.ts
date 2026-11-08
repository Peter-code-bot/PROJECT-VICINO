import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../../../lib/pruebas/cargar-real";
import { firmarCuerpoWebhook } from "../../../../lib/whatsapp/firma";
import { LIMITE_CUERPO_WEBHOOK_BYTES } from "../../../../lib/whatsapp/presentacion";

type Ruta = typeof import("./route");

const URL_BASE = "https://vicinomarket.com/api/webhooks/whatsapp";
const VERIFY = "tokendeverificaciondeprueba0123456789";
const SECRETO = "app-secret-0123456789abcdef";
const CUERPO =
  '{"object":"whatsapp_business_account","entry":[{"id":"987654321098765","changes":[{"field":"messages","value":{"messaging_product":"whatsapp","metadata":{"display_phone_number":"15550253483","phone_number_id":"123456789012345"},"contacts":[{"profile":{"name":"Cliente \\u00d1o\\u00f1o"},"wa_id":"5215512345678"}],"messages":[{"from":"5215512345678","id":"wamid.HBgLNTIxNTUxMjM0NTY3OBUCABIYFjNFQjBDMUM3NkY4NkNBNjhBQjQ4RjMA","timestamp":"1762617600","type":"text","text":{"body":"Hola, \\u00bfhay pan?"}}]}}]}]}';
const RESUMEN_OK = { duplicado: false, nuevos: 1, estados: 0, estados_sin_mensaje: 0, sin_canal: 0, ignorados: 0 };
const FIRMA_OK = { "x-hub-signature-256": firmarCuerpoWebhook(CUERPO, SECRETO) };

interface Entorno {
  verify?: string;
  /** null = sin WHATSAPP_APP_SECRET en el servidor. Por defecto esta. */
  secreto?: string | null;
  rpc?: { data?: unknown; error?: { code?: string; message?: string } };
  permitir?: boolean;
}

async function cargar(opciones: Entorno = {}) {
  if (opciones.verify) process.env.WHATSAPP_VERIFY_TOKEN = opciones.verify;
  else delete process.env.WHATSAPP_VERIFY_TOKEN;
  if (opciones.secreto === null) delete process.env.WHATSAPP_APP_SECRET;
  else process.env.WHATSAPP_APP_SECRET = opciones.secreto ?? SECRETO;

  const llamadas: Array<{ name: string; args: unknown }> = [];
  const cubetas: string[] = [];
  const sentry = sentryEspia();
  const ruta = await cargarReal<Ruta>("app/api/webhooks/whatsapp/route.ts", {
    stubs: {
      "@/lib/supabase/sin-sesion": {
        createClientSinSesion: () => ({
          rpc: async (name: string, args: unknown) => {
            llamadas.push({ name, args });
            return { data: opciones.rpc?.data ?? RESUMEN_OK, error: opciones.rpc?.error ?? null };
          },
        }),
      },
      "@/lib/rate-limit": {
        webhookWhatsAppRateLimit: null,
        getClientIp: (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
        check: async (_limite: unknown, cubeta: string) => {
          cubetas.push(cubeta);
          return { success: opciones.permitir !== false };
        },
      },
      "@sentry/nextjs": sentry,
    },
  });
  return { ruta, llamadas, cubetas, sentry };
}

const post = (cuerpo: string, cabeceras: Record<string, string> = {}) =>
  new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "31.13.64.1, 10.0.0.1", ...cabeceras },
    body: cuerpo,
  });

test("GET: sin WHATSAPP_VERIFY_TOKEN responde 503 (nada que comparar)", async () => {
  const { ruta } = await cargar();
  const r = await ruta.GET(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1158201444`));
  assert.equal(r.status, 503);
});

test("GET: con el token correcto devuelve el challenge tal cual, en texto plano y 200", async () => {
  const { ruta } = await cargar({ verify: VERIFY });
  const r = await ruta.GET(new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444`));
  assert.equal(r.status, 200);
  assert.equal(await r.text(), "1158201444");
  assert.match(r.headers.get("content-type") ?? "", /^text\/plain/);
  assert.equal(r.headers.get("cache-control"), "no-store");
});

test("GET: token distinto, modo distinto, sin challenge o challenge raro -> 403", async () => {
  const { ruta } = await cargar({ verify: VERIFY });
  const casos = [
    `?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1`,
    `?hub.mode=unsubscribe&hub.verify_token=${VERIFY}&hub.challenge=1`,
    `?hub.mode=subscribe&hub.verify_token=${VERIFY}`,
    `?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=${encodeURIComponent("<script>")}`,
    ``,
  ];
  for (const c of casos) {
    const r = await ruta.GET(new Request(`${URL_BASE}${c}`));
    assert.equal(r.status, 403, c);
  }
});

test("POST: sin firma 401 y no se toca la base", async () => {
  const { ruta, llamadas } = await cargar();
  const r = await ruta.POST(post(CUERPO));
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0);
});

test("POST: sin WHATSAPP_APP_SECRET en el servidor responde 503, avisa a Sentry y no lee ni manda nada a la base", async () => {
  const { ruta, llamadas, sentry } = await cargar({ secreto: null });
  const r = await ruta.POST(post(CUERPO, FIRMA_OK));
  assert.equal(r.status, 503);
  assert.equal(llamadas.length, 0);
  assert.equal(sentry.captureMessage.llamadas.length, 1);
  assert.match(String(sentry.captureMessage.llamadas[0]?.[0]), /WHATSAPP_APP_SECRET/);
});

test("POST: una firma invalida muere en Vercel: 401 sin llamar a la base y sin Sentry (es ruido, no incidente)", async () => {
  const { ruta, llamadas, sentry } = await cargar();
  const r = await ruta.POST(post(CUERPO, { "x-hub-signature-256": "sha256=" + "0".repeat(64) }));
  assert.equal(r.status, 401);
  assert.equal(llamadas.length, 0);
  assert.equal(sentry.captureMessage.llamadas.length + sentry.captureException.llamadas.length, 0);
});

test("POST: el cuerpo crudo y la cabecera viajan EXACTOS al RPC, y se responde el resumen", async () => {
  const { ruta, llamadas, cubetas } = await cargar();
  const r = await ruta.POST(post(CUERPO, FIRMA_OK));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, ...RESUMEN_OK });
  assert.deepEqual(llamadas, [{ name: "ingerir_webhook_whatsapp", args: { p_firma: FIRMA_OK["x-hub-signature-256"], p_cuerpo: CUERPO } }]);
  // La cubeta del freno no lleva la IP en claro.
  assert.equal(cubetas.length, 1);
  assert.match(cubetas[0] ?? "", /^wa-webhook:[A-Za-z0-9_-]{22}$/);
  assert.ok(!(cubetas[0] ?? "").includes("31.13.64.1"));
});

test("POST: lo que no es un webhook no llega a la base (JSON roto 400, forma rara 400, otro objeto 200 ignorado)", async () => {
  const { ruta, llamadas } = await cargar();
  const firma = (c: string) => ({ "x-hub-signature-256": firmarCuerpoWebhook(c, SECRETO) });
  assert.equal((await ruta.POST(post("{no es json", firma("{no es json")))).status, 400);
  assert.equal((await ruta.POST(post("[1,2,3]", firma("[1,2,3]")))).status, 400);
  assert.equal((await ruta.POST(post('{"entry":[]}', firma('{"entry":[]}')))).status, 400);
  const otro = await ruta.POST(post('{"object":"page","entry":[]}', firma('{"object":"page","entry":[]}')));
  assert.equal(otro.status, 200);
  assert.deepEqual(await otro.json(), { ok: true, ignorado: true });
  assert.equal(llamadas.length, 0);
});

test("POST: un cuerpo de mas de 3 MB se rechaza con 413 (por cabecera y por bytes reales)", async () => {
  const { ruta, llamadas } = await cargar();
  const porCabecera = await ruta.POST(post(CUERPO, { ...FIRMA_OK, "content-length": String(LIMITE_CUERPO_WEBHOOK_BYTES + 1) }));
  assert.equal(porCabecera.status, 413);
  const grande = `{"object":"whatsapp_business_account","relleno":"${"x".repeat(LIMITE_CUERPO_WEBHOOK_BYTES)}"}`;
  const porBytes = await ruta.POST(post(grande, { "x-hub-signature-256": "sha256=" + "a".repeat(64) }));
  assert.equal(porBytes.status, 413);
  assert.equal(llamadas.length, 0);
});

test("POST: los codigos del RPC se traducen a HTTP y a Sentry: P0401 -> 401 (secretos distintos), 22023 -> 400, 55000 -> 503, 42501 y otros -> 500", async () => {
  const divergen = await cargar({ rpc: { error: { code: "P0401", message: "La firma no coincide." } } });
  assert.equal((await divergen.ruta.POST(post(CUERPO, FIRMA_OK))).status, 401);
  assert.equal(divergen.sentry.captureMessage.llamadas.length, 1);
  assert.match(String(divergen.sentry.captureMessage.llamadas[0]?.[0]), /Vault/);

  const cuerpoMalo = await cargar({ rpc: { error: { code: "22023", message: "El cuerpo no es JSON valido." } } });
  assert.equal((await cuerpoMalo.ruta.POST(post(CUERPO, FIRMA_OK))).status, 400);
  assert.equal(cuerpoMalo.sentry.captureMessage.llamadas.length, 1);

  const sinSecreto = await cargar({ rpc: { error: { code: "55000", message: "Falta el secreto." } } });
  assert.equal((await sinSecreto.ruta.POST(post(CUERPO, FIRMA_OK))).status, 503);
  assert.equal(sinSecreto.sentry.captureMessage.llamadas.length, 1);

  const privilegios = await cargar({ rpc: { error: { code: "42501", message: "permission denied for relation decrypted_secrets" } } });
  assert.equal((await privilegios.ruta.POST(post(CUERPO, FIRMA_OK))).status, 500);
  assert.equal(privilegios.sentry.captureException.llamadas.length, 1);

  const caida = await cargar({ rpc: { error: { code: "57P01", message: "terminating connection" } } });
  assert.equal((await caida.ruta.POST(post(CUERPO, FIRMA_OK))).status, 500);
  assert.equal(caida.sentry.captureException.llamadas.length, 1);
  assert.deepEqual((caida.sentry.captureException.llamadas[0]?.[1] as { tags?: object })?.tags, { route: "webhooks/whatsapp", codigo: "57P01" });
});

test("POST: con el freno cerrado responde 429 sin leer el cuerpo", async () => {
  const { ruta, llamadas } = await cargar({ permitir: false });
  const r = await ruta.POST(post(CUERPO, FIRMA_OK));
  assert.equal(r.status, 429);
  assert.equal(llamadas.length, 0);
});

test("POST: si el RPC devuelve una forma inesperada se responde 200 igual (Meta no debe reintentar) y se avisa", async () => {
  const { ruta, sentry } = await cargar({ rpc: { data: { raro: true } } });
  const r = await ruta.POST(post(CUERPO, FIRMA_OK));
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  assert.equal(sentry.captureMessage.llamadas.length, 1);
});
