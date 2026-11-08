import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../../lib/pruebas/cargar-real";

// Ruta del minimapa (GEO-PUB-EXACT). Autoriza con la RLS del usuario y SOLO
// despues lee el dato autorizado con el cliente admin; la imagen se centra en
// ese dato (punto exacto o celda); ETag + no-cache para que mover el pin o
// revocar la exacta deje de servir la imagen anterior sin pagar otro snapshot.

type Ruta = typeof import("./route");
const ID = "11111111-1111-4111-8111-111111111111";
const BYTES = new Uint8Array([137, 80, 78, 71]).buffer;

interface Opciones {
  sesion?: boolean;
  visible?: boolean;
  ubicacion?: Record<string, unknown> | null;
  errorRpc?: { code: string; message: string } | null;
}

async function cargar(o: Opciones = {}) {
  const rpc: Array<{ nombre: string; args: Record<string, unknown> }> = [];
  const snapshots: Array<{ zona: { lat: number; lng: number }; oscuro: boolean; encuadre?: string }> = [];
  const visible = o.visible === false ? null : { id: ID, updated_at: "2026-11-08T00:00:00Z" };
  const consultaUsuario = {
    select: () => consultaUsuario, eq: () => consultaUsuario, neq: () => consultaUsuario,
    maybeSingle: async () => ({ data: visible, error: null }),
  };
  const admin = {
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      rpc.push({ nombre, args });
      return o.errorRpc ? { data: null, error: o.errorRpc } : { data: o.ubicacion ?? null, error: null };
    },
    from: () => {
      // Camino de antes (migracion pendiente): ubicacion_geo en EWKB hex.
      const c = { select: () => c, eq: () => c, neq: () => c, is: () => c,
        maybeSingle: async () => ({ data: { ubicacion_geo: "0101000020E61000008C4AEA04348D58C0ED0DBE30990A3340" }, error: null }) };
      return c;
    },
  };
  const ruta = await cargarReal<Ruta>("app/api/products/[id]/location-map/route.ts", {
    stubs: {
      "@/lib/supabase/server": { createClient: async () => ({ from: () => consultaUsuario }) },
      "@/lib/supabase/admin": { createAdminClient: () => admin },
      "@/lib/session-auth": { usuarioOInvitado: async () => (o.sesion === false ? null : { id: "00000000-0000-4000-8000-000000000002" }) },
      "@/lib/rate-limit": { productMapRateLimit: null, enforce: async () => ({ ok: true }), getClientIp: () => "203.0.113.9" },
      "@/lib/geo/product-map-snapshot": {
        ENCUADRE_ZONA: "0.025,0.09", ENCUADRE_CERCANO: "0.006,0.0216",
        productMapSnapshot: async (zona: { lat: number; lng: number }, oscuro: boolean, encuadre?: string) => {
          snapshots.push({ zona, oscuro, encuadre });
          return BYTES;
        },
      },
      "@sentry/nextjs": sentryEspia(),
    },
  });
  return { ruta, rpc, snapshots };
}

const pedir = (ruta: Ruta, cabeceras: Record<string, string> = {}, tema = "light") =>
  ruta.GET(new Request(`https://vicinomarket.com/api/products/${ID}/location-map?theme=${tema}&v=r3`, { headers: cabeceras }),
    { params: Promise.resolve({ id: ID }) });

const EXACTA = { disponible: true, precision: "exacta", revision: 3, decimales: 2, lat: 19.04138, lng: -98.20637 };
const APROXIMADA = { disponible: true, precision: "aproximada", revision: 0, decimales: 2, lat: 19.04, lng: -98.21 };

test("sin sesion: 401 y no se lee nada privilegiado", async () => {
  const f = await cargar({ sesion: false, ubicacion: EXACTA });
  const r = await pedir(f.ruta);
  assert.equal(r.status, 401);
  assert.equal(f.rpc.length, 0);
});

test("si la RLS no deja ver la publicacion: 404 y no se lee nada privilegiado", async () => {
  const f = await cargar({ visible: false, ubicacion: EXACTA });
  assert.equal((await pedir(f.ruta)).status, 404);
  assert.equal(f.rpc.length, 0);
});

test("exacta: imagen centrada en el punto elegido, encuadre cercano, ETag con la revision y no-cache", async () => {
  const f = await cargar({ ubicacion: EXACTA });
  const r = await pedir(f.ruta, {}, "dark");
  assert.equal(r.status, 200);
  assert.deepEqual(f.rpc, [{ nombre: "ubicacion_publica_de_publicacion", args: { p_product_id: ID, p_decimales: 2 } }]);
  assert.deepEqual(f.snapshots, [{ zona: { lat: 19.04138, lng: -98.20637 }, oscuro: true, encuadre: "0.006,0.0216" }]);
  assert.equal(r.headers.get("ETag"), '"u3-exacta-2-d"');
  assert.equal(r.headers.get("Cache-Control"), "private, no-cache");
  assert.equal(r.headers.get("Content-Type"), "image/png");
  // Nada de coordenadas en las cabeceras.
  assert.ok(![...r.headers.values()].some((v) => v.includes("19.04") || v.includes("98.20")));
});

test("aproximada con la rejilla de 1 km: el encuadre de siempre y la rejilla que pide el servidor", async () => {
  const f = await cargar({ ubicacion: APROXIMADA });
  const antes = process.env.VICINO_MAPA_RPC;
  process.env.VICINO_MAPA_RPC = "v3";
  try {
    await pedir(f.ruta);
  } finally {
    if (antes === undefined) delete process.env.VICINO_MAPA_RPC; else process.env.VICINO_MAPA_RPC = antes;
  }
  assert.equal(f.rpc[0]?.args.p_decimales, 3);
  assert.equal(f.snapshots[0]?.encuadre, "0.025,0.09");
});

test("con el mismo ETag responde 304 sin pedir otra imagen a Apple", async () => {
  const f = await cargar({ ubicacion: EXACTA });
  const r = await pedir(f.ruta, { "if-none-match": '"u3-exacta-2-l"' });
  assert.equal(r.status, 304);
  assert.equal(f.snapshots.length, 0);
  assert.equal(r.headers.get("ETag"), '"u3-exacta-2-l"');
});

test("si la revision cambio (pin movido o exacta revocada), el ETag viejo ya no sirve", async () => {
  const f = await cargar({ ubicacion: { ...EXACTA, precision: "aproximada", revision: 4, lat: 19.04, lng: -98.21 } });
  const r = await pedir(f.ruta, { "if-none-match": '"u3-exacta-2-l"' });
  assert.equal(r.status, 200);
  assert.deepEqual(f.snapshots[0]?.zona, { lat: 19.04, lng: -98.21 });
});

test("sin ubicacion: 404 location_missing", async () => {
  const f = await cargar({ ubicacion: { disponible: false, precision: "aproximada", revision: 0, decimales: 2 } });
  const r = await pedir(f.ruta);
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, "location_missing");
});

test("con la migracion pendiente (funcion ausente) usa el camino de antes, celda de 1 km", async () => {
  const f = await cargar({ errorRpc: { code: "PGRST202", message: "Could not find the function" } });
  const r = await pedir(f.ruta);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("Cache-Control"), "private, max-age=86400");
  assert.equal(f.snapshots[0]?.encuadre, undefined);
  const { lat, lng } = f.snapshots[0]!.zona;
  assert.equal(Math.round(lat * 100), lat * 100);
  assert.equal(Math.round(lng * 100), lng * 100);
});

test("otro error de la base: 503, sin imagen", async () => {
  const f = await cargar({ errorRpc: { code: "57014", message: "canceling statement" } });
  assert.equal((await pedir(f.ruta)).status, 503);
  assert.equal(f.snapshots.length, 0);
});
