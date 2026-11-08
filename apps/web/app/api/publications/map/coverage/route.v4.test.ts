import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../../../../lib/pruebas/cargar-real";

// La ruta del mapa con search_map_publications_v4 (GEO-PUB-EXACT): la rejilla
// aproximada la pone el servidor segun VICINO_MAPA_RPC, nunca el cliente; si v4
// falta (migracion pendiente) se cae a la RPC de siempre para esa rejilla; y el
// punto exacto de una celda llega al navegador porque el contrato lo declara.

type Ruta = typeof import("./route");

const CELDA_EXACTA = { x: -98206, y: 19041, count: 1, seller_count: 1, punto: { lat: 19.04138, lng: -98.20637 } };
const RESPUESTA = {
  query_key: "a".repeat(32), projection_version: 2, as_of: "2026-11-08T00:00:00Z",
  features: [{ id: "cell:1:-98206:19041", public_lat: 19.04138, public_lng: -98.20637, count: 1, seller_count: 1,
    bounds: { west: -98.20637, south: 19.04138, east: -98.20637, north: 19.04138 }, precision: "exacta" }],
  listings: [], total: 1, seller_total: 1, list_total: 0, next_cursor: null, list_seller_total: 0,
  revision: "b".repeat(32), cells: [CELDA_EXACTA], next_cell_cursor: null, complete: true,
};

interface Llamada { nombre: string; args: { p_request: Record<string, unknown> } }

async function cargar(opciones: { faltaV4?: boolean } = {}) {
  const llamadas: Llamada[] = [];
  const cliente = {
    rpc: (nombre: string, args: Llamada["args"]) => {
      llamadas.push({ nombre, args });
      const resultado = nombre === "search_map_publications_v4" && opciones.faltaV4
        ? { data: null, error: { code: "PGRST202", message: "Could not find the function" } }
        : { data: RESPUESTA, error: null };
      return { abortSignal: async () => resultado };
    },
  };
  const sentry = sentryEspia();
  const ruta = await cargarReal<Ruta>("app/api/publications/map/coverage/route.ts", {
    stubs: {
      "@/lib/supabase/server": { createClient: async () => cliente },
      "@/lib/session-auth": { usuarioOInvitado: async () => ({ id: "00000000-0000-4000-8000-000000000001" }) },
      "@/lib/rate-limit": { readHeavyRateLimit: null, enforce: async () => ({ ok: true }), getClientIp: () => "203.0.113.7" },
      "@sentry/nextjs": sentry,
    },
  });
  return { ruta, llamadas, sentry };
}

function peticion(): Request {
  return new Request("https://vicinomarket.com/api/publications/map/coverage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "overview", query: { bounds: { west: -98.3, south: 18.95, east: -98.1, north: 19.15 } }, coverage_center: null }),
  });
}

async function conVariable<T>(valor: string | undefined, fn: () => Promise<T>): Promise<T> {
  const antes = process.env.VICINO_MAPA_RPC;
  if (valor === undefined) delete process.env.VICINO_MAPA_RPC; else process.env.VICINO_MAPA_RPC = valor;
  try { return await fn(); } finally {
    if (antes === undefined) delete process.env.VICINO_MAPA_RPC; else process.env.VICINO_MAPA_RPC = antes;
  }
}

test("sin la variable llama a v4 con la rejilla de 1 km y el punto exacto llega al cliente", async () => {
  const f = await cargar();
  const r = await conVariable(undefined, () => f.ruta.POST(peticion()));
  assert.equal(r.status, 200);
  assert.deepEqual(f.llamadas.map((l) => l.nombre), ["search_map_publications_v4"]);
  assert.equal(f.llamadas[0]?.args.p_request.rejilla, 2);
  const cuerpo = await r.json();
  assert.deepEqual(cuerpo.cells[0].punto, CELDA_EXACTA.punto);
  assert.equal(cuerpo.features[0].precision, "exacta");
});

test("con VICINO_MAPA_RPC=v3 la rejilla aproximada es la de ~110 m", async () => {
  const f = await cargar();
  await conVariable("v3", () => f.ruta.POST(peticion()));
  assert.equal(f.llamadas[0]?.args.p_request.rejilla, 3);
});

test("el cliente no puede elegir la rejilla: la peticion estricta la rechaza", async () => {
  const f = await cargar();
  const conRejilla = new Request("https://vicinomarket.com/api/publications/map/coverage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "overview", query: { bounds: { west: -98.3, south: 18.95, east: -98.1, north: 19.15 } }, coverage_center: null, rejilla: 3 }),
  });
  const r = await f.ruta.POST(conRejilla);
  assert.equal(r.status, 400);
  assert.equal(f.llamadas.length, 0);
});

test("si v4 no existe cae a v2 (1 km) o a v3 (110 m), sin la clave rejilla, y avisa una vez", async () => {
  const sinVariable = await cargar({ faltaV4: true });
  const r = await conVariable(undefined, () => sinVariable.ruta.POST(peticion()));
  assert.equal(r.status, 200);
  assert.deepEqual(sinVariable.llamadas.map((l) => l.nombre), ["search_map_publications_v4", "search_map_publications_v2"]);
  assert.equal("rejilla" in (sinVariable.llamadas[1]?.args.p_request ?? {}), false);
  assert.equal(sinVariable.sentry.captureMessage.llamadas.length, 1);
  const conVariableV3 = await cargar({ faltaV4: true });
  await conVariable("v3", () => conVariableV3.ruta.POST(peticion()));
  assert.equal(conVariableV3.llamadas[1]?.nombre, "search_map_publications_v3");
});
