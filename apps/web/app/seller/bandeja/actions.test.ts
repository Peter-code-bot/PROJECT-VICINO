import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, espia, sentryEspia } from "../../../lib/pruebas/cargar-real";
import { CODIGO_RESPUESTA_INESPERADA, CODIGO_SIN_CONFIGURAR, MENSAJE_SIN_CONFIRMAR } from "../../../lib/whatsapp/presentacion";

type Acciones = typeof import("./actions");

const NEGOCIO = "00000000-0000-4000-8000-00000000000a";
const CONV = "11111111-1111-4111-8111-111111111111";
const MENSAJE = "22222222-2222-4222-8222-222222222222";
const WAMID = "wamid.ENVIADO0000000000000000000";
const PREPARADO = { mensaje_id: MENSAJE, phone_number_id: "123456789012345", wa_id: "5215512345678", texto: "Hola" };

type Envio =
  | { ok: true; wamid: string }
  | { ok: false; codigo: number | null; detalle: string; mensajeUsuario: string; sinConfirmar: boolean };

interface Opciones {
  bandera?: string;
  token?: string | null;
  userId?: string | null;
  permitir?: boolean;
  rpc?: Record<string, { data?: unknown; error?: { code?: string; message?: string } }>;
  envio?: Envio;
  canal?: { phone_number_id: string } | null;
}

async function cargar(o: Opciones = {}) {
  process.env.NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP = o.bandera ?? "1";
  if (o.token === null) delete process.env.WHATSAPP_ACCESS_TOKEN;
  else process.env.WHATSAPP_ACCESS_TOKEN = o.token ?? "TOKEN-DE-PRUEBA";
  delete process.env.WHATSAPP_GRAPH_VERSION;

  const llamadas: Array<{ name: string; args: unknown }> = [];
  const cubetas: string[] = [];
  const envios: Array<{ config: unknown; envio: unknown }> = [];
  const lecturas: unknown[] = [];
  const revalidadas = espia<[string]>();
  const sentry = sentryEspia();

  const acciones = await cargarReal<Acciones>("app/seller/bandeja/actions.ts", {
    stubs: {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: o.userId === null ? null : { id: o.userId ?? NEGOCIO } } }) },
          rpc: async (name: string, args: unknown) => {
            llamadas.push({ name, args });
            const r = o.rpc?.[name];
            return { data: r && "data" in r ? r.data : null, error: r?.error ?? null };
          },
          from: () => ({
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: o.canal === undefined ? { phone_number_id: "123456789012345" } : o.canal, error: null }) }),
            }),
          }),
        }),
      },
      "@/lib/rate-limit": {
        whatsappEnvioRateLimit: null,
        readHeavyRateLimit: null,
        enforce: async (_l: unknown, cubeta: string) => {
          cubetas.push(cubeta);
          return o.permitir === false ? { ok: false, error: "Demasiadas solicitudes." } : { ok: true };
        },
      },
      "@/lib/whatsapp/graph": {
        enviarTextoWhatsApp: async (config: unknown, envio: unknown) => {
          envios.push({ config, envio });
          return o.envio ?? { ok: true, wamid: WAMID };
        },
        marcarLeidoWhatsApp: async (_config: unknown, datos: unknown) => {
          lecturas.push(datos);
          return { ok: true, codigo: null, detalle: null };
        },
      },
      "next/cache": { revalidatePath: revalidadas },
      "@sentry/nextjs": sentry,
    },
  });
  return { acciones, llamadas, cubetas, envios, lecturas, revalidadas, sentry };
}

const preparadoOk = { preparar_envio_whatsapp: { data: PREPARADO }, cerrar_envio_whatsapp: { data: true } };
const cerrarDe = (f: Awaited<ReturnType<typeof cargar>>) => f.llamadas.filter((l) => l.name === "cerrar_envio_whatsapp");

test("con la bandera apagada la accion no hace nada", async () => {
  const f = await cargar({ bandera: "0" });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.deepEqual(r, { ok: false, error: "La bandeja de WhatsApp no está disponible." });
  assert.equal(f.llamadas.length, 0);
});

test("entrada invalida (texto vacio, id que no es uuid, clave extra) no llega a la base", async () => {
  const f = await cargar();
  assert.deepEqual(await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "   " }), { ok: false, error: "Escribe un mensaje." });
  assert.equal((await f.acciones.responderWhatsApp({ conversacionId: "123", texto: "Hola" })).ok, false);
  assert.equal((await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola", extra: 1 })).ok, false);
  assert.equal((await f.acciones.responderWhatsApp(null)).ok, false);
  assert.equal(f.llamadas.length, 0);
});

test("sin sesion o con el freno cerrado no se prepara nada", async () => {
  const sinSesion = await cargar({ userId: null });
  assert.deepEqual(await sinSesion.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" }), { ok: false, error: "Necesitas iniciar sesión." });
  const frenado = await cargar({ permitir: false });
  assert.deepEqual(await frenado.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" }), { ok: false, error: "Demasiadas solicitudes." });
  assert.deepEqual(frenado.cubetas, [`wa-envio:${NEGOCIO}`]);
  assert.equal(frenado.llamadas.length, 0);
});

test("el flujo completo: preparar -> enviar con el token del servidor -> cerrar con el wamid -> revalidar", async () => {
  const f = await cargar({ rpc: preparadoOk });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "  Hola  " });
  assert.deepEqual(r, { ok: true, mensajeId: MENSAJE });
  assert.deepEqual(f.llamadas, [
    { name: "preparar_envio_whatsapp", args: { p_conversacion_id: CONV, p_texto: "Hola" } },
    { name: "cerrar_envio_whatsapp", args: { p_mensaje_id: MENSAJE, p_wamid: WAMID } },
  ]);
  assert.equal(f.envios.length, 1);
  assert.deepEqual(f.envios[0]?.envio, { phoneNumberId: "123456789012345", waId: "5215512345678", texto: "Hola" });
  assert.deepEqual(f.envios[0]?.config, { token: "TOKEN-DE-PRUEBA", version: "v27.0", baseUrl: "https://graph.facebook.com" });
  assert.deepEqual(f.revalidadas.llamadas.map((l) => l[0]).sort(), ["/seller/bandeja", `/seller/bandeja/${CONV}`]);
  assert.equal(f.sentry.captureException.llamadas.length + f.sentry.captureMessage.llamadas.length, 0);
});

test("los errores del RPC con mensaje propio (ventana cerrada, pausado, ajena) se muestran tal cual y sin Sentry", async () => {
  const mensaje = "La ventana de 24 horas cerró: WhatsApp solo permite responder dentro de las 24 horas siguientes al último mensaje del cliente. Espera a que te vuelva a escribir.";
  const f = await cargar({ rpc: { preparar_envio_whatsapp: { error: { code: "55000", message: mensaje } } } });
  assert.deepEqual(await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" }), { ok: false, error: mensaje });
  assert.equal(f.envios.length, 0);
  assert.equal(f.sentry.captureException.llamadas.length, 0);

  const ajena = await cargar({ rpc: { preparar_envio_whatsapp: { error: { code: "P0002", message: "No se encontró la conversación." } } } });
  assert.deepEqual(await ajena.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" }), { ok: false, error: "No se encontró la conversación." });
});

test("un error inesperado del RPC da un mensaje generico y va a Sentry", async () => {
  const f = await cargar({ rpc: { preparar_envio_whatsapp: { error: { code: "XX000", message: "boom" } } } });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /No se pudo enviar/);
  assert.equal(f.sentry.captureException.llamadas.length, 1);
});

test("si preparar devuelve una forma inesperada con id, el mensaje se cierra como fallido con el codigo propio y se avisa", async () => {
  const f = await cargar({ rpc: { preparar_envio_whatsapp: { data: { mensaje_id: MENSAJE, raro: true } }, cerrar_envio_whatsapp: { data: true } } });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /error interno/);
  assert.deepEqual(cerrarDe(f)[0]?.args, { p_mensaje_id: MENSAJE, p_error_codigo: CODIGO_RESPUESTA_INESPERADA, p_error_detalle: "preparar_envio_whatsapp devolvio una forma inesperada" });
  assert.equal(f.envios.length, 0);
  assert.equal(f.sentry.captureMessage.llamadas.length, 1);

  const sinId = await cargar({ rpc: { preparar_envio_whatsapp: { data: { nada: true } } } });
  await sinId.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.equal(cerrarDe(sinId).length, 0);
});

test("si Meta rechaza, el mensaje queda 'fallido' con el codigo y se le dice a la persona por que", async () => {
  const envio: Envio = { ok: false, codigo: 131047, detalle: "HTTP 400: (#131047) Re-engagement message", mensajeUsuario: "Pasaron más de 24 horas...", sinConfirmar: false };
  const f = await cargar({ rpc: preparadoOk, envio });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.deepEqual(r, { ok: false, error: envio.mensajeUsuario });
  assert.deepEqual(cerrarDe(f)[0]?.args, { p_mensaje_id: MENSAJE, p_error_codigo: 131047, p_error_detalle: envio.detalle });
  // 131047 es del dia a dia: no es un incidente.
  assert.equal(f.sentry.captureMessage.llamadas.length, 0);

  const token = await cargar({ rpc: preparadoOk, envio: { ...envio, codigo: 190, mensajeUsuario: "El token..." } });
  await token.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.equal(token.sentry.captureMessage.llamadas.length, 1);
});

test("un envio SIN CONFIRMAR (red, tiempo agotado, 2xx sin id) NO se cierra: queda pendiente, se avisa y no se invita a reenviar", async () => {
  const envio: Envio = { ok: false, codigo: null, detalle: "tiempo de espera agotado", mensajeUsuario: MENSAJE_SIN_CONFIRMAR, sinConfirmar: true };
  const f = await cargar({ rpc: preparadoOk, envio });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.deepEqual(r, { ok: false, error: MENSAJE_SIN_CONFIRMAR });
  assert.equal(cerrarDe(f).length, 0, "no se llama a cerrar_envio");
  assert.equal(f.sentry.captureMessage.llamadas.length, 1);
  assert.deepEqual(f.revalidadas.llamadas.map((l) => l[0]).sort(), ["/seller/bandeja", `/seller/bandeja/${CONV}`]);
});

test("sin WHATSAPP_ACCESS_TOKEN en el servidor no se intenta enviar: el mensaje se cierra como fallido con el codigo propio y se avisa", async () => {
  const f = await cargar({ rpc: preparadoOk, token: null });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.error, /no está configurado/);
  assert.ok(!/WHATSAPP_/.test(r.error), "el nombre de la variable no llega a la persona");
  assert.equal(f.envios.length, 0);
  assert.deepEqual(cerrarDe(f)[0]?.args, { p_mensaje_id: MENSAJE, p_error_codigo: CODIGO_SIN_CONFIGURAR, p_error_detalle: "Servidor sin WHATSAPP_ACCESS_TOKEN" });
  assert.equal(f.sentry.captureMessage.llamadas.length, 1);
});

test("si cerrar falla despues de un envio aceptado, el resultado sigue siendo ok (el mensaje SI salio) y Sentry lo sabe", async () => {
  const f = await cargar({ rpc: { preparar_envio_whatsapp: { data: PREPARADO }, cerrar_envio_whatsapp: { error: { code: "57P01", message: "caida" } } } });
  const r = await f.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.deepEqual(r, { ok: true, mensajeId: MENSAJE });
  assert.equal(f.sentry.captureException.llamadas.length, 1);

  const noEncontrado = await cargar({ rpc: { preparar_envio_whatsapp: { data: PREPARADO }, cerrar_envio_whatsapp: { data: false } } });
  const r2 = await noEncontrado.acciones.responderWhatsApp({ conversacionId: CONV, texto: "Hola" });
  assert.deepEqual(r2, { ok: true, mensajeId: MENSAJE });
  assert.equal(noEncontrado.sentry.captureMessage.llamadas.length, 1);
});

test("marcar leida: pone a cero en la base y manda la confirmacion de lectura con el numero del negocio", async () => {
  const f = await cargar({ rpc: { marcar_leida_conversacion_whatsapp: { data: "wamid.ULTIMOENTRANTE00000000000" } } });
  assert.deepEqual(await f.acciones.marcarLeidaWhatsApp({ conversacionId: CONV }), { ok: true });
  assert.deepEqual(f.llamadas, [{ name: "marcar_leida_conversacion_whatsapp", args: { p_conversacion_id: CONV } }]);
  assert.deepEqual(f.lecturas, [{ phoneNumberId: "123456789012345", wamid: "wamid.ULTIMOENTRANTE00000000000" }]);
  assert.deepEqual(f.revalidadas.llamadas, [["/seller/bandeja"]]);
  assert.deepEqual(f.cubetas, [`wa-leida:${NEGOCIO}`]);
});

test("marcar leida: sin entrantes, sin token o sin canal no habla con Meta; entrada invalida no toca la base; errores del RPC a Sentry salvo 42501", async () => {
  const sinEntrantes = await cargar({ rpc: { marcar_leida_conversacion_whatsapp: { data: null } } });
  assert.deepEqual(await sinEntrantes.acciones.marcarLeidaWhatsApp({ conversacionId: CONV }), { ok: true });
  assert.equal(sinEntrantes.lecturas.length, 0);

  const sinToken = await cargar({ token: null, rpc: { marcar_leida_conversacion_whatsapp: { data: "wamid.ULTIMOENTRANTE00000000000" } } });
  assert.deepEqual(await sinToken.acciones.marcarLeidaWhatsApp({ conversacionId: CONV }), { ok: true });
  assert.equal(sinToken.lecturas.length, 0);

  const sinCanal = await cargar({ canal: null, rpc: { marcar_leida_conversacion_whatsapp: { data: "wamid.ULTIMOENTRANTE00000000000" } } });
  assert.deepEqual(await sinCanal.acciones.marcarLeidaWhatsApp({ conversacionId: CONV }), { ok: true });
  assert.equal(sinCanal.lecturas.length, 0);

  const invalida = await cargar();
  assert.deepEqual(await invalida.acciones.marcarLeidaWhatsApp({ conversacionId: "x" }), { ok: false });
  assert.equal(invalida.llamadas.length, 0);

  const caida = await cargar({ rpc: { marcar_leida_conversacion_whatsapp: { error: { code: "XX000", message: "boom" } } } });
  assert.deepEqual(await caida.acciones.marcarLeidaWhatsApp({ conversacionId: CONV }), { ok: false });
  assert.equal(caida.sentry.captureException.llamadas.length, 1);

  const sinSesionRpc = await cargar({ rpc: { marcar_leida_conversacion_whatsapp: { error: { code: "42501", message: "Necesitas iniciar sesión." } } } });
  assert.deepEqual(await sinSesionRpc.acciones.marcarLeidaWhatsApp({ conversacionId: CONV }), { ok: false });
  assert.equal(sinSesionRpc.sentry.captureException.llamadas.length, 0);
});
