/** Real DTO, loaders, route and SSR components; only external boundaries are simulated. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const requestId = "11111111-1111-4111-8111-111111111111";
const communityId = "22222222-2222-4222-8222-222222222222";
const postId = "33333333-3333-4333-8333-333333333333";
const date = "2026-10-04T04:00:00Z";
const request = { id: requestId, titulo: "Busco quien repare una silla", descripcion: "Para esta semana", presupuesto_max: 400, categoria: "servicios", created_at: date };
const community = { id: communityId, nombre: "Vecinos del centro", descripcion: "Noticias del barrio", miembros_count: 8, publicaciones_count: 2, ultima_publicacion_at: date };
const post = { id: postId, community_id: communityId, community_nombre: community.nombre, contenido: "Este sábado hay un mercado vecinal.", created_at: date, likes_count: 3, comentarios_count: 1 };
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const sources = new Map<string, string>();

function fixture(options: { user?: { id: string }; authError?: unknown; rate?: boolean; failedRpc?: string; returnValue?: string } = {}) {
  const calls: Array<{ name: string; args?: unknown }> = [];
  const rows: Record<string, unknown> = { home_guest_requests_preview: [request], home_guest_communities_preview: [community], home_guest_posts_preview: [post] };
  const state = {
    calls, rows, ...options,
    client: {
      auth: { getUser: async () => { calls.push({ name: "auth" }); return { data: { user: options.user ?? null }, error: options.authError ?? null }; } },
      from: (name: string) => {
        calls.push({ name: `from:${name}` });
        if (!options.user) throw new Error("Guest must not query tables");
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null, error: null }) };
        return chain;
      },
      rpc: async (name: string) => { calls.push({ name }); return { data: name === "estado_cuota_fundacion" ? {} : [], error: null }; },
    },
    admin: {
      rpc: (name: string, args: unknown) => {
        calls.push({ name, args });
        return { throwOnError: async () => {
          if (options.failedRpc === name) throw new Error("synthetic unavailable");
          assert.ok(Object.hasOwn(rows, name), name);
          return { data: rows[name] };
        } };
      },
    },
  };
  return state;
}

async function load(file: string, state: ReturnType<typeof fixture>) {
  if (!sources.has(file)) {
    const mocks: Record<string, string> = {
      "server-only": "export {};",
      "@/lib/supabase/server": "export const createClient=async()=>globalThis.state.client;",
      "@/lib/supabase/admin": "export const createAdminClient=()=>globalThis.state.admin;",
      "@sentry/nextjs": "export const captureException=()=>{};",
      "next/headers": "export const cookies=async()=>({get:name=>name==='vicino_location'?{value:'19.0414,-98.2063'}:undefined});",
      "@/lib/geo/consulta-cercanos": "export const consultarProductosCercanos=()=>{throw new Error('GUEST_GEO_FORBIDDEN');};",
      "@/lib/university-data": "export const getViewerUniversity=()=>{throw new Error('GUEST_UNIVERSITY_FORBIDDEN');};export const getUniversitySellerIds=()=>{throw new Error('GUEST_UNIVERSITY_FORBIDDEN');};",
      "@/lib/rate-limit": "export const readHeavyRateLimit={};export const getClientIp=()=> 'synthetic';export const enforce=async()=>({ok:globalThis.state.rate!==false,error:'synthetic limit'});",
    };
    const bundle = await esbuild.build({ entryPoints: [path.join(web, file)], bundle: true, platform: "node", packages: "external", format: "cjs", write: false,
      tsconfig: path.join(web, "tsconfig.json"), plugins: [{ name: "external-boundaries", setup(build: any) {
        build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js" }));
      } }] });
    sources.set(file, bundle.outputFiles[0].text);
  }
  const module = { exports: {} as any };
  new vm.Script(sources.get(file)!, { filename: file }).runInNewContext({ module, exports: module.exports, require, state, URL, URLSearchParams, Headers, Request, Response, AbortSignal, process, console,
    window: { location: { origin: "https://vicino.invalid" } }, sessionStorage: { getItem: () => state.returnValue ?? null } });
  return module.exports;
}

test("DTO allowlists remove coordinates, identity, contact, membership and media", async () => {
  const contract = await load("lib/home-guest-contract.ts", fixture());
  const extra = { lat: 19, lng: -98, ubicacion_geo: "private", buyer_profile: { nombre: "private" }, email: "private", author_id: "private", imagenes: ["private"], mi_rol: "owner" };
  assert.deepEqual(plain(contract.parseGuestRequests([{ ...request, ...extra }])), [request]);
  assert.deepEqual(plain(contract.parseGuestCommunities([{ ...community, ...extra }])), [community]);
  assert.deepEqual(plain(contract.parseGuestPosts([{ ...post, ...extra }])), [post]);
});
test("DTO rejects malformed rows and more than twelve examples", async () => {
  const contract = await load("lib/home-guest-contract.ts", fixture());
  for (const rows of [null, [{ ...request, id: "invalid" }], [{ ...request, presupuesto_max: -1 }], Array(13).fill(request)]) assert.throws(() => contract.parseGuestRequests(rows));
  assert.throws(() => contract.parseGuestPosts([{ ...post, contenido: "" }]));
  assert.throws(() => contract.parseGuestCommunities([{ ...community, miembros_count: -1 }]));
});
test("guest free text redacts email, telephone and coordinate pairs without changing ordinary amounts or dates", async () => {
  const contract = await load("lib/home-guest-contract.ts", fixture());
  const sensitive = "Escribe a prueba@example.invalid o +52 (222) 123-4567. Centro 19.0414, -98.2063";
  for (const field of ["titulo", "descripcion"]) {
    const result = contract.parseGuestRequests([{ ...request, [field]: sensitive }])[0][field];
    assert.match(result, /\[correo oculto\]/); assert.match(result, /\[teléfono oculto\]/); assert.match(result, /\[ubicación oculta\]/);
    assert.doesNotMatch(result, /example.invalid|123-4567|19\.0414|-98\.2063/);
  }
  const [sanitizedCommunity] = contract.parseGuestCommunities([{ ...community, nombre: "Contacta prueba@example.invalid", descripcion: "Tel. 2221234567" }]);
  assert.match(sanitizedCommunity.nombre, /correo oculto/); assert.match(sanitizedCommunity.descripcion, /teléfono oculto/);
  const [sanitizedPost] = contract.parseGuestPosts([{ ...post, community_nombre: "Tel. 2221234567", contenido: "lat: 19.0414 lng: -98.2063 y prueba%40example.invalid" }]);
  assert.match(sanitizedPost.community_nombre, /teléfono oculto/); assert.match(sanitizedPost.contenido, /ubicación oculta/); assert.match(sanitizedPost.contenido, /correo oculto/);
  for (const ordinary of ["Presupuesto $400 MXN, 3 ofertas", "Entrega el 2026-10-04 a las 10:00", "Rebaja del 20% esta semana", "Necesito 2 sillas y 4 cojines"]) assert.equal(contract.redactGuestPreviewText(ordinary), ordinary);
});
test("guest free text redacts encoded map query coordinates and keeps serialized field bounds", async () => {
  const contract = await load("lib/home-guest-contract.ts", fixture());
  for (const url of [
    "https://example.invalid/map?lat=19.0414&lng=-98.2063",
    "https://example.invalid/map?mlat=19.0414&mlon=-98.2063",
    "https://example.invalid/map?longitude=-98.2063&zoom=12&latitude=19.0414",
    "https://example.invalid/map?lat%3D19.0414%26lng%3D-98.2063",
    "Rebaja del 20%: https://example.invalid/map?lat%3D19.0414%26lng%3D-98.2063",
  ]) {
    const [result] = contract.parseGuestPosts([{ ...post, contenido: url }]);
    assert.doesNotMatch(result.contenido, /19\.0414|-98\.2063/);
    assert.match(result.contenido, /ubicación oculta/);
  }
  const [bounded] = contract.parseGuestRequests([{ ...request, titulo: "1.1, 2.2 ".repeat(13), descripcion: "1.1, 2.2 ".repeat(26) }]);
  assert.ok(bounded.titulo.length <= 120);
  assert.ok(bounded.descripcion.length <= 240);
});
test("DTO matches SQL codepoint bounds and redaction never cuts an emoji in half", async () => {
  const contract = await load("lib/home-guest-contract.ts", fixture());
  const atLimit = "x".repeat(239) + "🪑";
  const [validPost] = contract.parseGuestPosts([{ ...post, contenido: atLimit }]);
  assert.equal(validPost.contenido, atLimit);
  const [validRequest] = contract.parseGuestRequests([{ ...request, titulo: "x".repeat(119) + "🪑", descripcion: atLimit }]);
  assert.equal(validRequest.titulo, "x".repeat(119) + "🪑");
  assert.equal(validRequest.descripcion, atLimit);
  const [validCommunity] = contract.parseGuestCommunities([{ ...community, nombre: "x".repeat(99) + "🪑", descripcion: "🪑".repeat(240) }]);
  assert.equal(Array.from(validCommunity.descripcion).length, 240);
  assert.throws(() => contract.parseGuestPosts([{ ...post, contenido: atLimit + "x" }]));
  assert.throws(() => contract.parseGuestPosts([{ ...post, contenido: "🪑".repeat(241) }]));
  const placeholder = contract.redactGuestPreviewText("2221234567");
  const expanding = "2221234567 " + "x".repeat(238 - Array.from(placeholder).length) + "🪑x";
  const [bounded] = contract.parseGuestPosts([{ ...post, contenido: expanding }]);
  assert.equal(Array.from(bounded.contenido).length, 240);
  assert.ok(bounded.contenido.endsWith("🪑"));
});
test("auth Home return accepts the original public preview, rejects private, expired and external destinations", async () => {
  for (const [ruta, expected] of [["/?feed=solicitudes", "/?feed=solicitudes"], ["/?feed=comunidades&tab=descubrir", "/?feed=comunidades&tab=descubrir"], ["/?feed=comunidades&tab=mias", "/"], ["/?cats=comida", "/"], ["https://evil.invalid/", "/"], ["//evil.invalid/", "/"], ["/vender", "/"]]) {
    const module = await load("lib/auth/retorno-home.ts", fixture({ returnValue: JSON.stringify({ ruta, vence: Date.now() + 1000 }) }));
    assert.equal(module.leerRetornoHome(), expected, ruta);
  }
  for (const returnValue of ["invalid", JSON.stringify({ ruta: "/?feed=solicitudes", vence: Date.now() - 1 }), JSON.stringify({ ruta: "/", vence: "never" })]) {
    const module = await load("lib/auth/retorno-home.ts", fixture({ returnValue }));
    assert.equal(module.leerRetornoHome(), "/");
  }
});
for (const feed of ["solicitudes", "comunidades"] as const) {
  test(`guest ${feed}: real Home loader uses national RPCs without geo or private queries`, async () => {
    const state = fixture();
    const home = await load("lib/home-session-data.ts", state);
    const result = await home.getHomeSession({ feed });
    assert.equal(result.userId, ""); assert.equal(result.value.user, null);
    assert.equal(result.value.userLat, null); assert.equal(result.value.userLng, null); assert.equal(result.value.hasLocation, false);
    assert.equal(result.value.guestPreview.kind, feed);
    assert.deepEqual(state.calls.map(call => call.name), feed === "solicitudes"
      ? ["auth", "home_guest_requests_preview"] : ["auth", "home_guest_communities_preview", "home_guest_posts_preview"]);
    for (const call of state.calls.slice(1)) assert.deepEqual(plain(call.args), { result_limit: 12 });
    assert.equal(result.value.comunidades, null);
  });
  test(`API ${feed}: bounded guest data, no-store and success`, async () => {
    const state = fixture(); const route = await load("app/api/session/[resource]/route.ts", state);
    const response = await route.GET(new Request(`https://vicino.invalid/api/session/home?feed=${feed}`), { params: Promise.resolve({ resource: "home" }) });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal((await response.json()).value.guestPreview.kind, feed);
    assert.equal(state.calls.filter(call => call.name === "auth").length, 1);
  });
}
for (const query of ["feed=following", "feed=comunidades&tab=mias", "feed=solicitudes&cats=comida", "feed=solicitudes&feed=following", "feed=comunidades&tab=muro&tab=mias"]) {
  test(`API restricted query stops before data: ${query}`, async () => {
    const state = fixture(); const route = await load("app/api/session/[resource]/route.ts", state);
    const response = await route.GET(new Request(`https://vicino.invalid/api/session/home?${query}`), { params: Promise.resolve({ resource: "home" }) });
    assert.equal(response.status, 401); assert.deepEqual(state.calls, [{ name: "auth" }]);
  });
}
test("API rate limit stops before Auth or preview, with Retry-After", async () => {
  const state = fixture({ rate: false }); const route = await load("app/api/session/[resource]/route.ts", state);
  const response = await route.GET(new Request("https://vicino.invalid/api/session/home?feed=comunidades"), { params: Promise.resolve({ resource: "home" }) });
  assert.equal(response.status, 429); assert.equal(response.headers.get("retry-after"), "60"); assert.deepEqual(state.calls, []);
});
test("API serializes redacted guest text and drops extra RPC fields", async () => {
  const state = fixture();
  state.rows.home_guest_requests_preview = [{ ...request, titulo: "Llama 2221234567", descripcion: "prueba@example.invalid 19.0414, -98.2063", buyer_profile: { nombre: "private" }, lat: 19.0414 }];
  const route = await load("app/api/session/[resource]/route.ts", state);
  const response = await route.GET(new Request("https://vicino.invalid/api/session/home?feed=solicitudes"), { params: Promise.resolve({ resource: "home" }) });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.match(text, /teléfono oculto/); assert.match(text, /correo oculto/); assert.match(text, /ubicación oculta/);
  assert.doesNotMatch(text, /2221234567|example.invalid|19\.0414|98\.2063|buyer_profile|private/);
});
test("Auth unavailable is 503, never a guest read", async () => {
  const state = fixture({ authError: { name: "AuthRetryableFetchError", status: 503 } }); const route = await load("app/api/session/[resource]/route.ts", state);
  const response = await route.GET(new Request("https://vicino.invalid/api/session/home?feed=solicitudes"), { params: Promise.resolve({ resource: "home" }) });
  assert.equal(response.status, 503); assert.deepEqual(state.calls, [{ name: "auth" }]);
});
test("failed preview is distinguished from empty and API preserves old cached data with 503", async () => {
  const state = fixture({ failedRpc: "home_guest_requests_preview" }); const route = await load("app/api/session/[resource]/route.ts", state);
  const response = await route.GET(new Request("https://vicino.invalid/api/session/home?feed=solicitudes"), { params: Promise.resolve({ resource: "home" }) });
  assert.equal(response.status, 503); assert.match(await response.text(), /No se pudo actualizar/);
  const loader = await load("lib/home-guest-preview.ts", state);
  const result = await loader.getGuestHomePreview("solicitudes");
  assert.deepEqual(plain(result), { kind: "solicitudes", requests: [], failure: { kind: "failure" } });
});
test("authenticated communities preserve their own private RPCs and never use service previews", async () => {
  const state = fixture({ user: { id: requestId } }); const home = await load("lib/home-session-data.ts", state);
  const result = await home.getHomeSession({ feed: "comunidades" });
  assert.equal(result.userId, requestId); assert.equal(result.value.guestPreview, null);
  assert.ok(state.calls.some(call => call.name === "mis_comunidades"));
  assert.ok(!state.calls.some(call => call.name.startsWith("home_guest_")));
});

const rendering = () => esbuild.build({ stdin: { contents: `import React from 'react';import {renderToString} from 'react-dom/server';
 import {MuroSesionProvider} from './components/auth/muro-sesion';import {HomeTabs} from './components/home/home-tabs';
 import {GuestRequestsFeed,GuestCommunitiesFeed} from './components/home/guest-home-feeds';
 export const render=(kind,preview,tab='muro')=>renderToString(<MuroSesionProvider haySesion={false}><HomeTabs active={kind}/>{kind==='solicitudes'?<GuestRequestsFeed preview={preview}/>:<GuestCommunitiesFeed preview={preview} activeTab={tab}/>}</MuroSesionProvider>);`, resolveDir: web, loader: "tsx" },
  bundle: true, platform: "node", packages: "external", format: "cjs", write: false, jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
  plugins: [{ name: "render-boundaries", setup(build: any) {
    const mocks: Record<string, string> = {
      "next/navigation": "export const useRouter=()=>({push(){},refresh(){}});",
      "next/link": "import React from 'react';export default function Link({prefetch,children,...props}){return React.createElement('a',props,children);}",
      "next/image": "export default function Image(){return null;}",
      "@/lib/haptics": "export const hapticLight=async()=>{};export const hapticMedium=async()=>{};export const hapticSelection=async()=>{};",
      "@/app/(marketplace)/comunidades/actions": "export const alternarMembresia=async()=>{throw new Error('MUTATION_FORBIDDEN');};export const solicitarUnion=async()=>{throw new Error('MUTATION_FORBIDDEN');};export const cancelarSolicitudPropia=async()=>{throw new Error('MUTATION_FORBIDDEN');};",
    };
    build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
  } }] }).then((bundle: any) => {
    const module = { exports: {} as { render: (kind: string, preview: unknown, tab?: string) => string } };
    new vm.Script(bundle.outputFiles[0].text).runInNewContext({ module, exports: module.exports, require, URL, URLSearchParams });
    return module.exports.render;
  });

test("guest SSR tabs are public previews; following remains login", async () => {
  const html = (await rendering())("solicitudes", { kind: "solicitudes", requests: [request], failure: null });
  assert.match(html, /href="\/\?feed=solicitudes"/); assert.match(html, /href="\/\?feed=comunidades"/);
  assert.match(html, /href="\/login\?next=%2F%3Ffeed%3Dfollowing"/);
  assert.match(html, /Vista previa pública/); assert.match(html, /Busco quien repare una silla/);
  assert.match(html, new RegExp(`href="/login\\?next=%2Fsolicitudes%2F${requestId}"`));
  assert.doesNotMatch(html, /Activa tu ubicación|A 0 m|buyer_profile|private/);
});
test("guest SSR community discovery uses public cards without roles or distances", async () => {
  const html = (await rendering())("comunidades", { kind: "comunidades", communities: [community], posts: [post], communityFailure: null, postFailure: null }, "descubrir");
  assert.match(html, /Vecinos del centro/); assert.match(html, new RegExp(`href="/login\\?next=%2Fcomunidades%2F${communityId}"`));
  assert.doesNotMatch(html, /A 0 m|>admin<|>mod<|Unirse/);
});
test("guest SSR public posts link to private detail with pending safe context", async () => {
  const html = (await rendering())("comunidades", { kind: "comunidades", communities: [community], posts: [post], communityFailure: null, postFailure: null });
  assert.match(html, /Este sábado hay un mercado vecinal/);
  assert.match(html, new RegExp(`href="/login\\?next=%2Fcomunidades%2F${communityId}%2Fpublicacion%2F${postId}"`));
  assert.match(html, /aria-label="Me gusta"/); assert.match(html, /aria-label="Comentar"/);
});
test("guest SSR empty preview is honest and failures are recoverable", async () => {
  const render = await rendering();
  assert.match(render("solicitudes", { kind: "solicitudes", requests: [], failure: null }), /No hay solicitudes disponibles para esta vista previa/);
  const html = render("solicitudes", { kind: "solicitudes", requests: [], failure: { kind: "failure" } });
  assert.match(html, /role="alert"/); assert.match(html, /Reintentar/); assert.doesNotMatch(html, /No hay solicitudes disponibles/);
});
test("literal percentage never defeats encoded-map redaction in real DTO, API or SSR", async () => {
  const sensitive = "Rebaja del 20%: https://example.invalid/map?lat%3D19.0414%26lng%3D-98.2063";
  const render = await rendering();
  for (const feed of ["solicitudes", "comunidades"]) {
    const state = fixture();
    state.rows.home_guest_requests_preview = [{ ...request, titulo: sensitive, descripcion: sensitive }];
    state.rows.home_guest_communities_preview = [{ ...community, nombre: sensitive, descripcion: sensitive }];
    state.rows.home_guest_posts_preview = [{ ...post, community_nombre: sensitive, contenido: sensitive }];
    const route = await load("app/api/session/[resource]/route.ts", state);
    const response = await route.GET(new Request(`https://vicino.invalid/api/session/home?feed=${feed}`), { params: Promise.resolve({ resource: "home" }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.doesNotMatch(JSON.stringify(result), /19\.0414|-98\.2063/);
    for (const tab of feed === "comunidades" ? ["muro", "descubrir"] : ["muro"]) {
      const html = render(feed, result.value.guestPreview, tab);
      assert.match(html, /Rebaja del 20%/);
      assert.match(html, /ubicación oculta/);
      assert.doesNotMatch(html, /19\.0414|-98\.2063/);
    }
  }
});
