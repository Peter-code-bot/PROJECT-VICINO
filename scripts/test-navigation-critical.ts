import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { load } from "./test-frontend-routes";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const userId = "00000000-0000-4000-8000-000000000001";
const sellerId = "00000000-0000-4000-8000-000000000002";
const chatId = "00000000-0000-4000-8000-000000000003";
function client(transport: (url: URL, options: RequestInit) => Promise<Response>, user: string | null = userId) {
  const sdk = createClient("https://synthetic.invalid", "synthetic", {
    accessToken: async () => "synthetic",
    global: { fetch: (url: string, options: RequestInit) => transport(new URL(url), options) },
  });
  return { from: sdk.from.bind(sdk), rpc: sdk.rpc.bind(sdk), auth: { getUser: async () => ({ data: { user: user ? { id: user } : null }, error: null }) } };
}
function json(data: unknown) { return Response.json(data); }

test("layout launches lazy legal RPC before the profile query completes", async () => {
  let release!: () => void;
  const profileGate = new Promise<void>(resolve => { release = resolve; });
  const started: string[] = [];
  const sdk = client(async url => {
    const operation = url.pathname.split("/").at(-1)!;
    started.push(operation);
    if (operation === "profiles") { await profileGate; return json({ nombre: "Synthetic", es_vendedor: false, has_seen_onboarding: true }); }
    return json([]);
  });
  const page = await load(path.join(web, "app/(marketplace)/layout.tsx"), sdk);
  const render = page.default({ children: null });
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.ok(started.includes("profiles"));
    assert.ok(started.includes("avisos_legales_pendientes"), "legal RPC must start while profile is unresolved");
  } finally { release(); }
  await render;
});

test("guest layout still requests legal notices", async () => {
  const started: string[] = [];
  const sdk = client(async url => { started.push(url.pathname); return json([]); }, null);
  const page = await load(path.join(web, "app/(marketplace)/layout.tsx"), sdk);
  await page.default({ children: null });
  assert.deepEqual(started, ["/rest/v1/rpc/avisos_legales_pendientes"]);
});

test("chat RSC renders latest messages without any receipt write or prefetch side effect", async () => {
  const operations: string[] = [];
  const sdk = client(async (url, options) => {
    operations.push(`${options.method}:${url.pathname}`);
    if (url.pathname.endsWith("/chats")) return json({ id: chatId, comprador_id: userId, vendedor_id: sellerId, deleted_at_comprador: "2026-09-01T00:00:00Z", comprador: null, vendedor: null, ultimo_producto: null });
    if (url.pathname.endsWith("/messages")) {
      assert.equal(url.searchParams.get("order"), "created_at.desc,id.desc");
      assert.equal(url.searchParams.get("created_at"), "gt.2026-09-01T00:00:00Z");
      return json([{ id: "new", created_at: "2026-09-08T00:00:01Z" }, { id: "old", created_at: "2026-09-08T00:00:00Z" }]);
    }
    return json([]);
  });
  const page = await load(path.join(web, "app/(marketplace)/chat/[id]/page.tsx"), sdk);
  const result = await page.default({ params: Promise.resolve({ id: chatId }), searchParams: Promise.resolve({}) }) as { props: { initialMessages: Array<{ id: string }> } };
  assert.deepEqual(Array.from(result.props.initialMessages, message => message.id), ["old", "new"]);
  assert.ok(operations.every(operation => operation.startsWith("GET:")), operations.join(","));
  assert.equal(operations.length, 3);
});

test("markAsRead verifies session and membership before the SECURITY DEFINER RPC", async () => {
  for (const scenario of ["guest", "outsider", "participant"]) {
    const calls: string[] = [];
    const sdk = client(async url => {
      calls.push(url.pathname);
      if (url.pathname.endsWith("/chats")) return json({ comprador_id: scenario === "outsider" ? sellerId : userId, vendedor_id: sellerId });
      return new Response(null, { status: 204 });
    }, scenario === "guest" ? null : userId);
    const loaded = await load(path.join(web, "app/(marketplace)/chat/actions.ts"), sdk, {
      "@vicino/shared": "export const {sendMessageSchema,getOrCreateChatSchema,markChatReadSchema,createSaleConfirmationSchema,confirmSaleSchema,cancelSaleSchema,formatPrice}=globalThis.__testShared;",
      "@/lib/rate-limit": "export const writeRateLimit=null;export const chatReadRateLimit=null;export const enforce=async()=>({ok:true});",
    });
    const action = loaded as unknown as { markAsRead: (id: string) => Promise<{ ok: boolean; status: number }> };
    const result = await action.markAsRead(chatId);
    assert.equal(result.status, scenario === "guest" ? 401 : scenario === "outsider" ? 404 : 200);
    assert.equal(calls.some(url => url.endsWith("/mark_messages_as_read")), scenario === "participant");
  }
});

test("chat messages return while confirmation seed is unresolved and recover from its failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sdk = client(async url => {
    if (url.pathname.endsWith("/chats")) return json({ id: chatId, comprador_id: userId, vendedor_id: sellerId });
    if (url.pathname.endsWith("/sale_confirmations")) {
      await gate;
      return Response.json({ message: "synthetic unavailable" }, { status: 503 });
    }
    return json([{ id: "latest-message" }]);
  });
  const page = await load(path.join(web, "app/(marketplace)/chat/[id]/page.tsx"), sdk);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      page.default({ params: Promise.resolve({ id: chatId }), searchParams: Promise.resolve({}) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("messages blocked by confirmations")), 1000); }),
    ]) as { props: { initialMessages: Array<{ id: string }>; salesSeed: Promise<{ ok: boolean }> } };
    assert.equal(result.props.initialMessages[0].id, "latest-message");
    release();
    assert.equal((await result.props.salesSeed).ok, false);
  } finally { clearTimeout(timer); release(); }
});

test("receipt POST rejects cross-origin before executing the authenticated action", async () => {
  const loaded = await load(path.join(web, "app/api/chat/read/route.ts"), {}, {
    "@/app/(marketplace)/chat/actions": "export const markAsRead=async()=>{throw new Error('should not run')};",
  });
  const route = loaded as unknown as { POST: (request: Request) => Promise<Response> };
  const result = await route.POST(new Request("https://synthetic.invalid/api/chat/read", { method: "POST", headers: { origin: "https://other.invalid" }, body: JSON.stringify({ chatId }) }));
  assert.equal(result.status, 403);
  assert.equal(result.headers.get("cache-control"), "no-store");
});

const productPage = path.join(web, "app/(marketplace)/[categoria]/[slug]/page.tsx");
const productMocks = { "@sentry/nextjs": "export const captureMessage=()=>{};export const captureException=()=>{};" };

test("product core returns while reviews and coupons are unresolved; RSC never counts a view", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const operations: string[] = [];
  const sdk = client(async (url, options) => {
    operations.push(`${options.method}:${url.pathname}`);
    if (url.pathname.endsWith("/products_services")) return json({ id: chatId, slug: "synthetic", titulo: "Synthetic", categoria: "hogar", creador_id: sellerId, profiles: { id: sellerId } });
    if (url.pathname.endsWith("/reviews") || url.pathname.endsWith("/coupons")) await gate;
    return json([]);
  }, null);
  const loaded = await load(productPage, sdk, productMocks);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      loaded.default({ params: Promise.resolve({ slug: "synthetic", categoria: "hogar" }) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("core blocked by supplementary data")), 1000); }),
    ]) as { props: { children: Array<{ props?: { children?: { props: { extras: Promise<unknown>; product: { titulo: string } } } } }> } };
    const mobile = result.props.children.find(child => child?.props?.children?.props?.extras)?.props?.children;
    assert.equal(mobile?.props.product.titulo, "Synthetic");
    assert.ok(operations.some(op => op.endsWith("/reviews")));
    assert.ok(operations.some(op => op.endsWith("/coupons")));
    assert.ok(operations.every(op => op.startsWith("GET:")));
    release();
    await mobile?.props.extras;
  } finally { clearTimeout(timer); release(); }
});

test("profile header and products render before slow reviews and counts; no unused purchase query", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const operations: string[] = [];
  const sdk = client(async url => {
    operations.push(url.pathname);
    if (url.pathname.endsWith("/profiles")) return json({ id: userId, nombre: "Synthetic profile", es_vendedor: true });
    if (url.pathname.endsWith("/products_services")) return json([{ id: chatId, slug: null, sort_order: 4 }]);
    await gate;
    return json([]);
  });
  const loaded = await load(path.join(web, "app/(marketplace)/perfil/page.tsx"), sdk);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const tree = await Promise.race([loaded.default({}), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("header blocked by secondary data")), 1000);
    })]) as { props: { children: Array<{ props: Record<string, any> }> } };
    const header = tree.props.children.find(node => node?.props?.profile);
    assert.equal(header?.props.profile.nombre, "Synthetic profile");
    const tabs = tree.props.children.find(node => node?.props?.productsPanel);
    const panel = tabs!.props.productsPanel.props.children;
    const products = await panel.type(panel.props);
    assert.equal(products.props.products[0].slug, null);
    assert.equal(products.props.products[0].sort_order, 4);
    assert.equal(operations.filter(op => op.endsWith("/sale_confirmations")).length, 0);
    assert.equal(operations.length, 6);
  } finally { clearTimeout(timer); release(); }
});

test("profile secondary failures expose retry panels while retaining the header", async () => {
  const sdk = client(async url => url.pathname.endsWith("/profiles")
    ? json({ id: userId, nombre: "Synthetic profile", es_vendedor: true })
    : Response.json({ message: "synthetic unavailable" }, { status: 503 }));
  const loaded = await load(path.join(web, "app/(marketplace)/perfil/page.tsx"), sdk);
  const tree = await loaded.default({}) as { props: { children: Array<{ props: Record<string, any> }> } };
  const tabs = tree.props.children.find(node => node?.props?.productsPanel);
  for (const key of ["productsPanel", "reviewsPanel"]) {
    const panel = tabs!.props[key].props.children;
    const result = await panel.type(panel.props);
    assert.ok(["publicaciones", "reseñas"].includes(result.props.label));
    assert.equal(result.props.products, undefined);
  }
});

test("product read failure is recoverable instead of a false 404", async () => {
  const sdk = client(async () => Response.json({ message: "synthetic unavailable" }, { status: 503 }), null);
  const loaded = await load(productPage, sdk, productMocks);
  await assert.rejects(loaded.default({ params: Promise.resolve({ slug: "synthetic" }) }), /No se pudo cargar el producto/);
});

test("unavailable extras retain explicit error states instead of claiming zero reviews or coupons", async () => {
  const sdk = client(async url => {
    if (url.pathname.endsWith("/products_services")) return json({ id: chatId, slug: "synthetic", titulo: "Synthetic", categoria: "hogar", creador_id: sellerId, profiles: { id: sellerId } });
    return Response.json({ message: "synthetic unavailable" }, { status: 503 });
  }, null);
  const loaded = await load(productPage, sdk, productMocks);
  const result = await loaded.default({ params: Promise.resolve({ slug: "synthetic" }) }) as { props: { children: Array<{ props?: { children?: { props: { extras: Promise<{ reviewsError?: string; couponsError?: string }> } } } }> } };
  const mobile = result.props.children.find(child => child?.props?.children?.props?.extras)?.props?.children;
  const extras = await mobile?.props.extras;
  assert.ok(extras?.reviewsError);
  assert.ok(extras?.couponsError);
});
