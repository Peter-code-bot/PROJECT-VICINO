// Ejecuta las Server Actions reales con Auth/DB/cache simulados. Sin red.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const web = path.resolve(__dirname, "../apps/web");
const requireWeb = Module.createRequire(path.join(web, "package.json"));
const ts = requireWeb("typescript");
const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
let state;

function reset(overrides = {}) {
  state = {
    userId: USER_ID, rateOk: true, error: null, revalidated: [], writes: [], reports: [],
    record: { id: PRODUCT_ID, creador_id: USER_ID, tipo: "producto", categoria: "comida", slug: "producto-prueba", estatus: "disponible", descripcion: "Texto anterior", estado: "bueno" },
    ...overrides,
  };
  return state;
}
class Query {
  constructor(table) { this.table = table; this.filters = []; this.op = "select"; }
  select() { return this; }
  eq(key, value) { this.filters.push([key, value, true]); return this; }
  neq(key, value) { this.filters.push([key, value, false]); return this; }
  in(key, values) { this.values = values; return this; }
  update(patch) { this.op = "update"; this.patch = patch; return this; }
  insert(patch) { this.op = "insert"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  async single() { return this.result(); }
  async maybeSingle() { return this.result(); }
  then(resolve, reject) { return Promise.resolve(this.result()).then(resolve, reject); }
  result() {
    if (this.table === "categories") return { data: (this.values ?? []).map((slug, i) => ({ id: i + 1, slug })), error: null };
    if (this.table !== "products_services") return { data: [], error: null };
    if (state.error) return { data: null, error: state.error };
    if (this.op === "insert") {
      state.writes.push({ ...this.patch });
      state.record = { id: PRODUCT_ID, slug: "producto-prueba", estado: null, ...this.patch };
      return { data: state.record, error: null };
    }
    const matches = state.record && this.filters.every(([key, value, equal]) => equal ? state.record[key] === value : state.record[key] !== value);
    if (!matches) return { data: null, error: null };
    if (this.op === "update") {
      state.writes.push({ ...this.patch });
      state.record = { ...state.record, ...this.patch };
    }
    return { data: state.record, error: null };
  }
}
const mocks = {
  "next/navigation": {
    RedirectType: { replace: "replace", push: "push" },
    redirect(destination, type = "push") {
      const error = new Error("Test navigation");
      error.digest = `NEXT_REDIRECT;${type};${destination};303;`;
      error.destination = destination; error.type = type;
      throw error;
    },
  },
  "@/lib/revalidate-session": { revalidatePath: async (destination) => state.revalidated.push(destination) },
  "@sentry/nextjs": { captureException: (error) => state.reports.push(error) },
  "@/lib/supabase/server": { createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.userId ? { id: state.userId } : null } }) },
    from: (table) => new Query(table), rpc: async () => ({ error: null }),
  }) },
  "@/lib/rate-limit": { writeRateLimit: {}, enforce: async () => ({ ok: state.rateOk, error: "Demasiadas solicitudes" }) },
  "@/lib/media/cleanup": { cleanupRemovedMedia: async () => {} },
  "@/lib/video-thumbnail": { VIDEO_EXT_RE: /\.mp4$/i },
};
const loaded = new Map();
function loadTs(filename) {
  if (loaded.has(filename)) return loaded.get(filename).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = new Module(filename);
  loaded.set(filename, mod);
  mod.filename = filename;
  mod.require = (name) => {
    if (mocks[name]) return mocks[name];
    if (name === "@vicino/shared") return loadTs(path.resolve(__dirname, "../packages/shared/src/validators/product.ts"));
    if (name.startsWith(".")) return loadTs(path.resolve(path.dirname(filename), name.endsWith(".ts") ? name : `${name}.ts`));
    return requireWeb(name);
  };
  mod._compile(compiled, filename);
  return mod.exports;
}
const actions = loadTs(path.join(web, "app/(marketplace)/vender/actions.ts"));
async function invoke(name, ...args) {
  try { return await actions[name](...args); }
  catch (error) { if (error.digest?.startsWith("NEXT_REDIRECT")) return { redirect: error.destination, type: error.type }; throw error; }
}
function form(fields) { const data = new FormData(); for (const [key, value] of Object.entries(fields)) data.set(key, String(value)); return data; }

async function test() {
  let cases = 0;
  async function run(name, check) { reset(); await check(); cases++; console.log(`PASA ${name}`); }
  await run("eliminar regresa a perfil y reemplaza la ficha", async () => {
    assert.deepEqual(await invoke("deleteProduct", PRODUCT_ID), { redirect: "/perfil", type: "replace" });
    assert.equal(state.record.estatus, "eliminado");
    assert.deepEqual(state.revalidated, ["/perfil", "/seller/listings"]);
  });
  await run("Mi tienda conserva su retorno explícito", async () => assert.deepEqual(await invoke("deleteProduct", PRODUCT_ID, "/seller/listings"), { redirect: "/seller/listings", type: "replace" }));
  await run("reintento tras eliminación confirmada es idempotente", async () => {
    state.record.estatus = "eliminado";
    assert.equal((await invoke("deleteProduct", PRODUCT_ID)).redirect, "/perfil");
  });
  await run("una publicación ajena no se elimina ni navega", async () => {
    state.record.creador_id = "otro";
    assert.ok((await invoke("deleteProduct", PRODUCT_ID)).error);
    assert.equal(state.writes.length, 0); assert.equal(state.revalidated.length, 0);
  });
  await run("id inexistente no comunica éxito", async () => {
    state.record = null; assert.ok((await invoke("deleteProduct", PRODUCT_ID)).error);
  });
  await run("error DB permite reintentar y oculta detalles internos", async () => {
    state.error = { code: "42501", message: "internal DB detail" };
    const result = await invoke("deleteProduct", PRODUCT_ID);
    assert.ok(result.error); assert.ok(!result.error.includes("internal")); assert.equal(state.reports.length, 1);
    assert.equal(state.revalidated.length, 0);
    state.error = null; assert.equal((await invoke("deleteProduct", PRODUCT_ID)).redirect, "/perfil");
  });
  await run("sin sesión se solicita login", async () => {
    state.userId = null; assert.equal((await invoke("deleteProduct", PRODUCT_ID)).redirect, "/login"); assert.equal(state.writes.length, 0);
  });
  await run("rate limit no escribe ni invalida", async () => {
    state.rateOk = false; assert.ok((await invoke("deleteProduct", PRODUCT_ID)).error); assert.equal(state.writes.length, 0);
  });
  await run("id y destino maliciosos se rechazan", async () => {
    assert.ok((await invoke("deleteProduct", "malformed")).error);
    assert.ok((await invoke("deleteProduct", PRODUCT_ID, "https://example.com")).error);
    assert.equal(state.writes.length, 0);
  });
  const base = { titulo: "Producto prueba", precio: 100, modo_precio: "precio", tipo: "producto", tipo_entrega: "punto_encuentro", categories: JSON.stringify([{ slug: "comida", is_primary: true }]), ubicacion_lat: 19, ubicacion_lng: -98 };
  for (const descripcion of [undefined, "", "ok"]) {
    await run(`crear con descripción ${JSON.stringify(descripcion)} y estado omitido`, async () => {
      const result = await invoke("createProduct", form({ ...base, ...(descripcion === undefined ? {} : { descripcion }) }));
      assert.equal(result.redirect, "/comida/producto-prueba");
      assert.equal(state.record.descripcion, descripcion ?? ""); assert.equal(state.record.estado, null);
    });
  }
  await run("editar vacíos limpia descripción y estado", async () => {
    const result = await invoke("updateProductFull", PRODUCT_ID, form({ descripcion: "", estado: "" }));
    assert.equal(result.redirect, "/seller/listings");
    assert.equal(state.record.descripcion, ""); assert.equal(state.record.estado, null);
  });
  await run("editar campos omitidos preserva valores", async () => {
    await invoke("updateProductFull", PRODUCT_ID, form({ titulo: "Otro titulo" }));
    assert.equal(state.record.descripcion, "Texto anterior"); assert.equal(state.record.estado, "bueno");
  });
  console.log(`${cases}/${cases} pruebas de acciones PASAN`);
}
if (require.main === module) test().catch((error) => { console.error(error); process.exitCode = 1; });
module.exports = { reset, invoke, form, PRODUCT_ID };
