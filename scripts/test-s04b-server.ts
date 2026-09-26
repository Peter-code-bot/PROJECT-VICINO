/** Real Server Actions bundled in memory; only Auth/DB/rate/cache boundaries
 * are simulated. This file never loads env files or makes a network request. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";

const web = path.resolve(__dirname, "../apps/web");
const localRequire = createRequire(path.join(web, "package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] }));
const A = "00000000-0000-4000-8000-000000000001";
const B = "00000000-0000-4000-8000-000000000002";
const C = "00000000-0000-4000-8000-000000000003";
const chatId = "10000000-0000-4000-8000-000000000001";
const productId = "20000000-0000-4000-8000-000000000001";
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const saleId = "40000000-0000-4000-8000-000000000001";
const product = { id: productId, titulo: "Mesa", precio: 25, modo_precio: "fijo", imagen_principal: null, creador_id: B, estatus: "disponible", is_hidden: false };
const input = { chatId, productId, expectedRevision: 3, idempotencyKey, precioAcordado: 25, cantidad: 1, tipoEntrega: "pickup" };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
let bundled: Promise<string> | undefined;

function fixture(options: any = {}) {
  const calls: any[] = [], invalidated: string[] = [];
  const state = { calls, invalidated, rate: options.rate ?? { ok: true }, client: {
    auth: { getUser: async () => {
      calls.push(["auth"]);
      if (options.authThrows) throw new Error("offline");
      return { data: { user: options.guest ? null : { id: options.actor ?? A } }, error: options.authError ?? null };
    } },
    from: (table: string) => {
      calls.push(["from", table]);
      const response = table === "chats"
        ? { data: options.chat ?? { comprador_id: A, vendedor_id: B }, error: options.chatError ?? null }
        : { data: options.products ?? [product], error: options.productsError ?? null };
      const chain: any = {
        then: (resolve: any, reject: any) => Promise.resolve(response).then(resolve, reject),
      };
      for (const method of ["select", "eq", "in", "order", "limit", "ilike", "maybeSingle"]) {
        chain[method] = (...args: any[]) => { calls.push([method, ...args]); return chain; };
      }
      return chain;
    },
    rpc: async (name: string, args: any) => {
      calls.push(["rpc", name, args]);
      if (options.rpcThrows) throw new Error("network result unknown");
      if (options.rpcError) return { data: null, error: options.rpcError };
      if (options.rpcData !== undefined) return { data: options.rpcData, error: null };
      const data = name === "seleccionar_producto_chat" ? { product, revision: 4 }
        : name === "confirmar_venta" ? { success: true, alreadyConfirmed: false, chat_id: chatId }
          : { confirmation: { id: saleId, product_id: productId, buyer_id: A, seller_id: B }, repeated: false };
      return { data, error: null };
    },
  } };
  return state;
}

async function load(state: ReturnType<typeof fixture>) {
  if (!bundled) {
    bundled = (async () => {
      const mocks: Record<string, string> = {
        "server-only": "export {};",
        "@/lib/supabase/server": "export const createClient=async()=>globalThis.state.client;",
        "@/lib/revalidate-session": "export const revalidatePath=async(path)=>globalThis.state.invalidated.push(path);",
        "next/navigation": "export const redirect=()=>{throw new Error('unexpected redirect');};",
        "@sentry/nextjs": "export const captureException=()=>{};export const captureMessage=()=>{};",
        "@/lib/rate-limit": "export const writeRateLimit={};export const chatReadRateLimit={};export const enforce=async()=>globalThis.state.rate;",
      };
      const output = await esbuild.build({ entryPoints: [path.join(web, "app/(marketplace)/chat/actions.ts")],
        bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
        tsconfig: path.join(web, "tsconfig.json"), plugins: [{ name: "test-boundaries", setup(build: any) {
          build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
          build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js" }));
        } }],
      });
      return output.outputFiles[0].text;
    })();
  }
  const module = { exports: {} as any };
  const context = vm.createContext({ module, exports: module.exports, require: localRequire, state,
    fetch: () => { throw new Error("NETWORK_FORBIDDEN"); }, console,
  });
  new vm.Script(await bundled, { filename: "real-chat-actions.cjs" }).runInContext(context);
  return module.exports;
}

for (const [label, run] of [
  ["select", (a: any) => a.selectChatProduct({ chatId, productId, expectedRevision: 3 })],
  ["catalog", (a: any) => a.getChatProducts({ chatId })],
  ["create", (a: any) => a.createSaleConfirmation(input)],
  ["confirm", (a: any) => a.confirmSale(saleId)],
] as const) {
  test(`${label}: missing session and rate limit stop DB operations`, async () => {
    const guest = fixture({ guest: true, authError: { name: "AuthSessionMissingError" } });
    assert.equal((await run(await load(guest))).code, "UNAUTHENTICATED");
    assert.equal(guest.calls.filter(c => c[0] !== "auth").length, 0);
    const limited = fixture({ rate: { ok: false, error: "Espera" } });
    assert.equal((await run(await load(limited))).code, "RATE_LIMITED");
    assert.equal(limited.calls.filter(c => c[0] !== "auth").length, 0);
  });
  test(`${label}: Auth outage is unavailable without a DB call`, async () => {
    const f = fixture({ authThrows: true });
    assert.equal((await run(await load(f))).code, "UNAVAILABLE");
    assert.equal(f.calls.filter(c => c[0] !== "auth").length, 0);
  });
}
test("all entrypoints validate untrusted arguments before accessing Auth", async () => {
  const f = fixture(), actions = await load(f);
  for (const result of [await actions.getChatProducts({ chatId: "bad" }), await actions.selectChatProduct(null),
    await actions.createSaleConfirmation(null), await actions.confirmSale("bad")]) assert.equal(result.code, "INVALID_INPUT");
  assert.equal(f.calls.length, 0);
});
test("create enforces revision, idempotency, price cents and delivery enum", async () => {
  const f = fixture(), actions = await load(f);
  for (const changed of [{ expectedRevision: -1 }, { expectedRevision: 1.2 }, { idempotencyKey: "bad" },
    { precioAcordado: 25.001 }, { cantidad: 0 }, { tipoEntrega: "teletransportacion" }]) {
    assert.equal((await actions.createSaleConfirmation({ ...input, ...changed })).code, "INVALID_INPUT");
  }
  assert.equal(f.calls.length, 0);
});
test("catalog explicitly rejects nonparticipants including privileged sessions", async () => {
  const f = fixture({ actor: C }), actions = await load(f);
  assert.equal((await actions.getChatProducts({ chatId })).code, "NOT_AVAILABLE");
  assert.deepEqual(f.calls.filter(c => c[0] === "from"), [["from", "chats"]]);
});
test("catalog restricts owners, status, visibility and limits with literal title search", async () => {
  const f = fixture(), actions = await load(f);
  assert.deepEqual(plain((await actions.getChatProducts({ chatId, query: "  50%_\\  " })).data), [product]);
  const calls = plain(f.calls);
  assert.ok(calls.some((c: any) => JSON.stringify(c) === JSON.stringify(["in", "creador_id", [A, B]])));
  assert.ok(calls.some((c: any) => JSON.stringify(c) === JSON.stringify(["eq", "estatus", "disponible"])));
  assert.ok(calls.some((c: any) => JSON.stringify(c) === JSON.stringify(["eq", "is_hidden", false])));
  assert.ok(calls.some((c: any) => JSON.stringify(c) === JSON.stringify(["limit", 50])));
  assert.ok(calls.some((c: any) => JSON.stringify(c) === JSON.stringify(["ilike", "titulo", "%50\\%\\_\\\\% ".trim()])));
});
test("selection sends expected revision and returns authoritative shared product", async () => {
  const f = fixture(), actions = await load(f);
  assert.deepEqual(plain(await actions.selectChatProduct({ chatId, productId, expectedRevision: 3 })), { data: { product, revision: 4 } });
  assert.deepEqual(plain(f.calls.find(c => c[0] === "rpc")), ["rpc", "seleccionar_producto_chat", { p_chat_id: chatId, p_producto_id: productId, p_revision_esperada: 3 }]);
  assert.deepEqual(f.invalidated, [`/chat/${chatId}`]);
});
test("create uses single atomic RPC without client roles or separate messages", async () => {
  const f = fixture(), actions = await load(f);
  const result = await actions.createSaleConfirmation({ ...input, buyerId: C, sellerId: C });
  assert.equal(result.confirmation.id, saleId);
  assert.deepEqual(plain(f.calls.find(c => c[0] === "rpc")), ["rpc", "iniciar_confirmacion_venta", {
    p_chat_id: chatId, p_producto_id: productId, p_revision_esperada: 3, p_clave: idempotencyKey,
    p_precio: 25, p_cantidad: 1, p_tipo_entrega: "pickup",
  }]);
  assert.equal(f.calls.filter(c => c[0] === "from").length, 0);
  assert.deepEqual(f.invalidated, [`/chat/${chatId}`]);
});
for (const [code, hint, expected] of [
  ["PT409", "product_changed", "PRODUCT_CHANGED"], ["PT409", "pending_confirmation", "PENDING_CONFIRMATION"],
  ["PT409", "idempotency_conflict", "IDEMPOTENCY_CONFLICT"], ["PT409", "confirmation_closed", "CONFIRMATION_CLOSED"],
  ["PT404", "", "NOT_AVAILABLE"], ["42501", "", "FORBIDDEN"], ["22023", "", "INVALID_INPUT"],
  ["PGRST202", "", "UNAVAILABLE"],
]) {
  test(`RPC ${code}/${hint}: safe classified message without DB details`, async () => {
    const f = fixture({ rpcError: { code, hint, message: "internal database details" } });
    const result = await (await load(f)).createSaleConfirmation(input);
    assert.equal(result.code, expected); assert.doesNotMatch(result.error, /internal/);
    assert.equal(f.invalidated.length, 0);
  });
}
test("network ambiguity preserves UNAVAILABLE and forwards retry key unchanged", async () => {
  const f = fixture({ rpcThrows: true }), actions = await load(f);
  assert.equal((await actions.createSaleConfirmation(input)).code, "UNAVAILABLE");
  assert.equal((await actions.createSaleConfirmation(input)).code, "UNAVAILABLE");
  const keys = f.calls.filter(c => c[0] === "rpc").map(c => c[2].p_clave);
  assert.deepEqual(keys, [idempotencyKey, idempotencyKey]);
});
test("confirmation is a single authenticated RPC and revalidates its server chat", async () => {
  const f = fixture(), actions = await load(f);
  assert.deepEqual(plain(await actions.confirmSale(saleId)), { success: true, alreadyConfirmed: false });
  assert.deepEqual(plain(f.calls.find(c => c[0] === "rpc")), ["rpc", "confirmar_venta", { p_confirmacion_id: saleId }]);
  assert.deepEqual(f.invalidated, [`/chat/${chatId}`]);
  assert.equal(f.calls.filter(c => c[0] === "from").length, 0);
});
