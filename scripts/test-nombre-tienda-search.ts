/** Real SearchPage/ProductCard with local query projections; no Auth, HTTP or real accounts. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(__dirname, "..");
const web = path.join(root, "apps/web");
const requireWeb = createRequire(path.join(web, "package.json"));
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] }));
const React = requireWeb("react");
const { renderToStaticMarkup } = requireWeb("react-dom/server");
const store = { nombre: "Alex Cabrera", es_vendedor: true, seller_type: "business", nombre_negocio: "Creed", trust_level: "nuevo", average_rating: 0, reviews_count: 0 };
type Profile = Omit<typeof store, "nombre_negocio"> & { nombre_negocio: string | null };
type Params = { q?: string; category?: string; page?: string; tipo?: string; price_min?: string; price_max?: string; sort?: string; lat?: string; lng?: string; radio?: string };
type Call = { table: string; rpc: boolean; input?: Record<string, unknown>; select: string; filters: [string, unknown][]; orders: [string, unknown][]; range?: [number, number]; executed: boolean };

function fixture(profile: Profile, canonicalRpcName = "Creed") {
  const calls: Call[] = [];
  const products = Array.from({ length: 21 }, (_, index) => ({ id: `synthetic-${index}`, titulo: "Playera YoungLa", precio: 1099, imagen_principal: null, categoria: "ropa", slug: `playera-${index}`, precio_negociable: false, modo_precio: "fijo", created_at: "2026-10-03T12:00:00Z", ventas_count: 0, product_categories: [] }));
  function query(table: string, rpc = false, input?: Record<string, unknown>) {
    const call: Call = { table, rpc, input, select: "", filters: [], orders: [], executed: false };
    calls.push(call);
    const builder = {
      select(columns: string) { call.select = columns; return builder; },
      throwOnError() { return builder; },
      limit() { return builder; },
      eq(column: string, value: unknown) { call.filters.push([column, value]); return builder; },
      in(column: string, value: unknown) { call.filters.push([column, value]); return builder; },
      or(value: string) { call.filters.push(["or", value]); return builder; },
      gte(column: string, value: unknown) { call.filters.push([`gte:${column}`, value]); return builder; },
      lte(column: string, value: unknown) { call.filters.push([`lte:${column}`, value]); return builder; },
      order(column: string, options: unknown) { call.orders.push([column, options]); return builder; },
      range(first: number, last: number) { call.range = [first, last]; return builder; },
      maybeSingle() { call.executed = true; return Promise.resolve({ data: { id: "synthetic-category" }, error: null }); },
      then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) {
        call.executed = true;
        if (table === "profiles") return Promise.resolve({ data: [], error: null }).then(resolve, reject);
        if (table === "product_categories") {
          const primary = call.filters.some(([column, value]) => column === "is_primary" && value === true);
          return Promise.resolve({ data: primary ? products.map(product => ({ product_id: product.id })) : [], error: null }).then(resolve, reject);
        }
        // Model PostgREST: omitted profile columns never reach the renderer.
        const columns = /profiles!inner\(([^)]+)\)/.exec(call.select)?.[1].split(",").map(column => column.trim()) ?? [];
        const projected = Object.fromEntries(Object.entries(profile).filter(([column]) => columns.includes(column)));
        const rows = products.map(product => ({ ...product, profiles: rpc ? { nombre: canonicalRpcName, trust_level: "nuevo", average_rating: 0, reviews_count: 0 } : projected }));
        return Promise.resolve({ data: call.range ? rows.slice(call.range[0], call.range[1] + 1) : rows, count: rows.length, error: null }).then(resolve, reject);
      },
    };
    return builder;
  }
  return { calls, client: { from: (table: string) => query(table), rpc: (name: string, input: Record<string, unknown>) => query(name, true, input) } };
}

const external = ["@/lib/supabase/server", "next/headers", "@/lib/session-auth", "@/lib/university-data", "./search-filters", "@sentry/nextjs", "@/hooks/use-favorite", "next/link", "next/image"];
const bundled = esbuild.build({ entryPoints: [path.join(web, "app/(marketplace)/buscar/page.tsx")], bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), packages: "external", external, logLevel: "silent" });

async function renderSearch(profile: Profile, params: Params = {}, canonicalRpcName = "Creed") {
  const f = fixture(profile, canonicalRpcName);
  const anchor = ({ children, href, prefetch: _prefetch, ...props }: any) => React.createElement("a", { ...props, href }, children);
  const image = ({ fill: _fill, priority: _priority, ...props }: any) => React.createElement("img", props);
  const mocks: Record<string, unknown> = {
    "@/lib/supabase/server": { createClient: async () => f.client },
    "next/headers": { cookies: async () => ({ get: () => undefined }) },
    "@/lib/session-auth": { usuarioOInvitado: async () => ({ id: "synthetic-viewer" }) },
    "@/lib/university-data": { getViewerUniversity: async () => null, getUniversitySellerIds: async () => [] },
    "./search-filters": { SearchFilters: () => null },
    "@sentry/nextjs": { captureException: (error: unknown) => { throw new Error("Unexpected query failure", { cause: error }); } },
    "@/hooks/use-favorite": { useFavorite: () => ({ isFavorite: false, isPending: false, toggle() {} }) },
    "next/link": { __esModule: true, default: anchor },
    "next/image": { __esModule: true, default: image },
  };
  const module = { exports: {} as { default: (props: { searchParams: Promise<Params> }) => Promise<unknown> } };
  new vm.Script((await bundled).outputFiles[0].text).runInNewContext({ module, exports: module.exports, require: (name: string) => Object.hasOwn(mocks, name) ? mocks[name] : requireWeb(name), console, process, setTimeout, clearTimeout, URL, URLSearchParams, crypto });
  const html = renderToStaticMarkup(await module.exports.default({ searchParams: Promise.resolve(params) }));
  return { ...f, html };
}

test("SearchPage without location projects store identity into the real product cards", async () => {
  for (const [profile, expected] of [
    [store, "Creed"],
    [{ ...store, nombre_negocio: "Creed Nueva" }, "Creed Nueva"],
    [{ ...store, es_vendedor: false }, "Alex Cabrera"],
    [{ ...store, seller_type: "casual" }, "Alex Cabrera"],
    [{ ...store, nombre_negocio: null }, "Tienda"],
    [{ ...store, nombre_negocio: " \t\n " }, "Tienda"],
  ] as const) {
    const result = await renderSearch(profile);
    assert.ok(result.html.includes(expected), `Visible card must show ${expected}`);
    if (expected !== "Alex Cabrera") assert.ok(!result.html.includes("Alex Cabrera"));
    const query = result.calls.find(call => call.executed && call.table === "products_services")!;
    assert.ok(query && !query.rpc);
    for (const column of ["es_vendedor", "seller_type", "nombre_negocio"]) assert.ok(query.select.includes(column));
    assert.deepEqual(query.range, [0, 19]);
  }
});

test("fallback category/page/price/type filters remain intact after a store rename", async () => {
  const result = await renderSearch({ ...store, nombre_negocio: "Creed Nueva" }, { q: "Playera", category: "ropa", page: "2", tipo: "producto", price_min: "100", price_max: "2000", sort: "price_asc" });
  assert.ok(result.html.includes("Creed Nueva"));
  assert.ok(!result.html.includes("Alex Cabrera"));
  const query = result.calls.find(call => call.executed && call.table === "products_services")!;
  assert.equal(query.rpc, false);
  assert.ok(query.filters.some(([column, value]) => column === "estatus" && value === "disponible"));
  assert.ok(query.filters.some(([column, value]) => column === "tipo" && value === "producto"));
  assert.ok(query.filters.some(([column, value]) => column === "gte:precio" && value === 100));
  assert.ok(query.filters.some(([column, value]) => column === "lte:precio" && value === 2000));
  assert.ok(query.filters.some(([column, value]) => column === "id" && Array.isArray(value) && value.length === 21));
  assert.ok(query.filters.some(([column, value]) => column === "or" && String(value).includes("titulo.ilike.")));
  const category = result.calls.find(call => call.executed && call.table === "categories")!;
  assert.ok(category.filters.some(([column, value]) => column === "slug" && value === "ropa"));
  assert.match(result.html, /Página 2 de 2/);
});

test("nearby SearchPage preserves canonical RPC identity and its location/filter contract", async () => {
  const result = await renderSearch(store, { q: "Playera", lat: "19.4326", lng: "-99.1332", radio: "5000", page: "2", tipo: "producto", price_min: "100", sort: "price_desc" });
  assert.ok(result.html.includes("Creed"));
  assert.ok(!result.html.includes("Alex Cabrera"));
  const query = result.calls.find(call => call.executed && call.rpc)!;
  assert.equal(query.table, "search_nearby_products_v4");
  assert.equal(query.input?.user_lat, 19.4326);
  assert.equal(query.input?.user_lng, -99.1332);
  assert.equal(query.input?.radius_meters, 5000);
  assert.equal(query.input?.search_term, "Playera");
  assert.equal(query.input?.sin_limite, true);
  assert.deepEqual(query.range, [20, 39]);
  assert.ok(query.orders.some(([column]) => column === "precio"));
  assert.ok(!result.calls.some(call => call.executed && call.table === "products_services"));
});
