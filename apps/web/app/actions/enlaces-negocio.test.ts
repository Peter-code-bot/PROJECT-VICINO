import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../lib/pruebas/cargar-real";

type Acciones = typeof import("./enlaces-negocio");
const VENDEDOR = "00000000-0000-4000-8000-000000000001";
const COMPRADOR = "00000000-0000-4000-8000-000000000002";

async function cargar(
  opciones: { userId?: string | null; data?: unknown; error?: object; permitir?: boolean } = {},
) {
  const llamadas: Array<{ name: string; args: unknown }> = [];
  const cubetas: string[] = [];
  const sentry = sentryEspia();
  const acciones = await cargarReal<Acciones>("app/actions/enlaces-negocio.ts", {
    stubs: {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: {
            getUser: async () => ({
              data: { user: opciones.userId === null ? null : { id: opciones.userId ?? COMPRADOR } },
            }),
          },
          rpc: async (name: string, args: unknown) => {
            llamadas.push({ name, args });
            return { data: opciones.data ?? true, error: opciones.error ?? null };
          },
        }),
      },
      "@/lib/rate-limit": {
        clicEnlaceRateLimit: null,
        getClientIp: (h: Headers) => h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
        enforce: async (_limite: unknown, cubeta: string) => {
          cubetas.push(cubeta);
          return opciones.permitir === false ? { ok: false, error: "Demasiadas solicitudes." } : { ok: true };
        },
      },
      "next/headers": { headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) },
      "@sentry/nextjs": sentry,
    },
  });
  return { acciones, llamadas, cubetas, sentry };
}

test("un clic valido llama al RPC con negocio y canal, y devuelve lo que el RPC decidio", async () => {
  const f = await cargar({ data: true });
  const r = await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "whatsapp" });
  assert.deepEqual(r, { registrado: true });
  assert.deepEqual(f.llamadas, [
    { name: "registrar_clic_enlace_negocio", args: { p_vendedor_id: VENDEDOR, p_canal: "whatsapp" } },
  ]);
  // Con sesion, la cubeta del freno es el usuario, no la IP.
  assert.deepEqual(f.cubetas, [`clic:${COMPRADOR}`]);
  assert.equal(f.sentry.captureException.llamadas.length, 0);
});

test("el RPC puede decir que no conto (dueno, canal sin configurar, freno): se respeta sin error", async () => {
  const f = await cargar({ data: false });
  const r = await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "instagram" });
  assert.deepEqual(r, { registrado: false });
  assert.equal(f.llamadas.length, 1);
  assert.equal(f.sentry.captureException.llamadas.length, 0);
});

test("sin sesion, la cubeta del freno es la primera IP de x-forwarded-for", async () => {
  const f = await cargar({ userId: null, data: true });
  const r = await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "google_maps" });
  assert.deepEqual(r, { registrado: true });
  assert.deepEqual(f.cubetas, ["clic-ip:203.0.113.9"]);
  // El RPC NO recibe nada de quien toca: solo el negocio y el canal.
  assert.deepEqual(Object.keys((f.llamadas[0]?.args ?? {}) as object).sort(), ["p_canal", "p_vendedor_id"]);
});

test("entrada invalida (canal desconocido, id que no es uuid, clave extra, basura) no llega al RPC", async () => {
  const f = await cargar();
  assert.deepEqual(await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "tiktok" }), { registrado: false });
  assert.deepEqual(await f.acciones.registrarClicEnlaceNegocio({ vendedorId: "123", canal: "whatsapp" }), { registrado: false });
  assert.deepEqual(await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "whatsapp", extra: 1 }), { registrado: false });
  assert.deepEqual(await f.acciones.registrarClicEnlaceNegocio(null), { registrado: false });
  assert.deepEqual(await f.acciones.registrarClicEnlaceNegocio("whatsapp"), { registrado: false });
  assert.equal(f.llamadas.length, 0);
  assert.equal(f.cubetas.length, 0);
});

test("con el freno cerrado no se llama al RPC", async () => {
  const f = await cargar({ permitir: false });
  assert.deepEqual(await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "google_resenas" }), { registrado: false });
  assert.equal(f.llamadas.length, 0);
});

test("un error del RPC se reporta a Sentry con el canal y no se propaga al cliente", async () => {
  const f = await cargar({ error: { code: "XX000", message: "boom" } });
  const r = await f.acciones.registrarClicEnlaceNegocio({ vendedorId: VENDEDOR, canal: "google_resenas" });
  assert.deepEqual(r, { registrado: false });
  assert.equal(f.sentry.captureException.llamadas.length, 1);
  const [capturado, contexto] = f.sentry.captureException.llamadas[0] ?? [];
  assert.deepEqual(capturado, { code: "XX000", message: "boom" });
  assert.deepEqual((contexto as { tags?: Record<string, string> })?.tags, {
    action: "registrarClicEnlaceNegocio",
    canal: "google_resenas",
  });
});
