/**
 * getMoreFeedProducts (el «Más productos» del inicio) ya no recibe el punto del
 * cliente: lo lee de la cookie con el lector unico del servidor. Se prueba la
 * accion REAL, con Supabase, Upstash y next/headers simulados.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal } from "../pruebas/cargar-real";

type Acciones = typeof import("../../app/(marketplace)/actions");
type Llamada = { tipo: "rpc"; nombre: string; args: Record<string, unknown> } | { tipo: "from"; tabla: string };

// Datos sinteticos: un cursor valido y el centro generico de una ciudad.
const CURSOR = "2026-10-01T12:00:00Z|00000000-0000-4000-8000-000000000001";
const CENTRO = "19.0414,-98.2063";

async function cargar(cookies: Record<string, string>) {
  const llamadas: Llamada[] = [];
  const leidas: string[] = [];
  const supabase = {
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ tipo: "rpc", nombre, args });
      return { data: [], error: null };
    },
    from: (tabla: string) => {
      llamadas.push({ tipo: "from", tabla });
      const cadena = {
        select: () => cadena, eq: () => cadena, or: () => cadena, order: () => cadena,
        limit: async () => ({ data: [], error: null }),
      };
      return cadena;
    },
  };
  const acciones = await cargarReal<Acciones>("app/(marketplace)/actions.ts", { stubs: {
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/rate-limit": { readHeavyRateLimit: null, getClientIp: () => "203.0.113.7", enforce: async () => ({ ok: true }) },
    "next/headers": {
      headers: async () => new Headers(),
      cookies: async () => ({ get: (nombre: string) => {
        leidas.push(nombre);
        return Object.hasOwn(cookies, nombre) ? { name: nombre, value: cookies[nombre] } : undefined;
      } }),
    },
  } });
  return { acciones, llamadas, leidas };
}

test("con zona pide la RPC con el punto y el radio de la cookie, redondeados por el lector", async () => {
  const f = await cargar({ vicino_location: CENTRO, vicino_radius: "25000" });
  const resultado = await f.acciones.getMoreFeedProducts(CURSOR, 30, true);
  assert.equal(resultado.error, undefined);
  assert.deepEqual(f.llamadas, [{ tipo: "rpc", nombre: "search_nearby_products_v4", args: {
    user_lat: 19.041, user_lng: -98.206, radius_meters: 25000,
    cursor_time: "2026-10-01T12:00:00Z", cursor_id: "00000000-0000-4000-8000-000000000001",
    result_limit: 30, sort_by_distance: false,
  } }]);
});

test("firma vieja (lat, lng numericos): su presencia pide la zona y sus valores se ignoran", async () => {
  const f = await cargar({ vicino_location: CENTRO });
  await f.acciones.getMoreFeedProducts(CURSOR, 30, 25.5 as unknown as boolean, -100.3);
  const [llamada] = f.llamadas;
  assert.equal(llamada?.tipo, "rpc");
  assert.equal(llamada?.tipo === "rpc" && llamada.args.user_lat, 19.041);
  assert.equal(llamada?.tipo === "rpc" && llamada.args.user_lng, -98.206);
});

test("sin bandera, con un solo numero o con un valor que no es booleano: sin zona y sin leer la cookie", async () => {
  for (const args of [[], [false], [19.5], ["true"], [null]] as unknown[][]) {
    const f = await cargar({ vicino_location: CENTRO });
    await (f.acciones.getMoreFeedProducts as (...a: unknown[]) => Promise<unknown>)(CURSOR, 30, ...args);
    assert.deepEqual(f.llamadas, [{ tipo: "from", tabla: "products_services" }], JSON.stringify(args));
    assert.deepEqual(f.leidas, [], JSON.stringify(args));
  }
});

test("con la bandera pero sin zona valida (borrada, basura o fuera del area): sigue sin zona", async () => {
  const casos: Array<Record<string, string>> = [{}, { vicino_location: "basura" }, { vicino_location: "40.000,-120.000" }];
  for (const cookies of casos) {
    const f = await cargar(cookies);
    await f.acciones.getMoreFeedProducts(CURSOR, 30, true);
    assert.deepEqual(f.llamadas, [{ tipo: "from", tabla: "products_services" }], JSON.stringify(cookies));
  }
});
