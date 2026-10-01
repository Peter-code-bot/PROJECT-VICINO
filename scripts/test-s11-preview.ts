/** Real preview/cache/parser code. Apple and the shared quota are transport fixtures. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { MapPreviewCache, type MapPreviewInput } from "../apps/web/lib/geo/map-preview-cache";
import { parseCoordinates } from "../apps/web/lib/geo/location-storage";

const web = path.resolve(__dirname, "../apps/web");
const requireWeb = createRequire(path.join(web, "package.json"));
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] }));
const input: MapPreviewInput = { center: { lat: 19.041, lng: -98.206 }, theme: "dark" };
function cacheFixture(ttl = 300_000, failure = false) {
  let count = 0; const revoked: string[] = [], signals: AbortSignal[] = [];
  const cache = new MapPreviewCache({
    fetch: (async (_url: unknown, request: RequestInit) => {
      count++; signals.push(request.signal as AbortSignal);
      return new Response(failure ? "unavailable" : new Uint8Array([137, 80, 78, 71]), { status: failure ? 503 : 200, headers: { "Content-Type": failure ? "application/json" : "image/png" } });
    }) as typeof fetch,
    createURL: () => `blob:preview-${count}`, revokeURL: url => revoked.push(url), now: () => Date.now(),
  }, ttl);
  return { cache, revoked, signals, count: () => count };
}

test("Home and Search share both the pending request and the loaded Blob", async () => {
  const f = cacheFixture(); f.cache.activateContext("viewer-a", "dark");
  const a = f.cache.load("same-zone", input), b = f.cache.load("same-zone", input);
  assert.equal(a, b); assert.equal(await a, await b); assert.equal(f.count(), 1);
  await f.cache.load("same-zone", input); assert.equal(f.count(), 1);
  f.cache.clear(); assert.equal(f.revoked.length, 1);
});

test("theme and viewer changes purge URLs and cannot reuse the previous session", async () => {
  const f = cacheFixture(); f.cache.activateContext("viewer-a", "dark");
  await f.cache.load("zone", input); f.cache.activateContext("viewer-b", "dark");
  assert.equal(f.revoked.length, 1); assert.equal(f.cache.snapshot("zone").status, "empty");
  await f.cache.load("zone", input); f.cache.activateContext("viewer-b", "light");
  assert.equal(f.revoked.length, 2); f.cache.clear();
});

test("expiry removes the displayed URL, notifies consumers, and makes no automatic request", async () => {
  const f = cacheFixture(20); const statuses: string[] = [];
  const stop = f.cache.subscribe("zone", () => statuses.push(f.cache.snapshot("zone").status));
  await f.cache.load("zone", input); await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(f.cache.snapshot("zone").status, "expired"); assert.equal(f.cache.snapshot("zone").url, null);
  assert.equal(f.revoked.length, 1); assert.ok(statuses.includes("expired")); assert.equal(f.count(), 1);
  stop(); f.cache.clear();
});

test("a provider failure is remembered across navigation until explicit retry", async () => {
  const f = cacheFixture(300_000, true);
  await assert.rejects(f.cache.load("zone", input)); await assert.rejects(f.cache.load("zone", input));
  assert.equal(f.count(), 1); assert.equal(f.cache.snapshot("zone").status, "error");
  await assert.rejects(f.cache.load("zone", input, true)); assert.equal(f.count(), 2); f.cache.clear();
});

test("cache capacity revokes evicted images and does not accumulate more than four resources", async () => {
  const f = cacheFixture();
  for (let i = 0; i < 5; i++) await f.cache.load(String(i), input);
  assert.equal(f.revoked.length, 1); assert.equal(f.cache.snapshot("0").status, "empty");
  f.cache.clear(); assert.equal(f.revoked.length, 5);
});

test("clearing a pending request cannot resurrect its late response", async () => {
  let resolve!: (response: Response) => void, created = 0;
  const cache = new MapPreviewCache({ fetch: (() => new Promise<Response>(r => { resolve = r; })) as typeof fetch,
    createURL: () => { created++; return "blob:stale"; }, revokeURL: () => {}, now: () => Date.now() });
  const pending = cache.load("zone", input); cache.clear();
  resolve(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "Content-Type": "image/png" } }));
  await assert.rejects(pending); assert.equal(created, 0); assert.equal(cache.snapshot("zone").status, "empty");
});

let routeBundle: Promise<string>;
async function routeFixture({ limited = false, providerError = false } = {}) {
  const calls: unknown[] = [];
  const state = { calls, limited, snapshot(center: unknown, dark: boolean) {
    calls.push({ center, dark }); if (providerError) throw new Error("SIGNED_PROVIDER_SECRET");
    return new Uint8Array([137, 80, 78, 71]).buffer;
  } };
  routeBundle ??= (async () => {
    const mocks: Record<string, string> = {
      "@/lib/geo/region-map-snapshot": "export const regionMapSnapshot=async(...args)=>globalThis.state.snapshot(...args);",
      "@/lib/rate-limit": "export const readHeavyRateLimit=null;export const getClientIp=h=>h.get('x-real-ip')||'test';export const enforce=async()=>({ok:!globalThis.state.limited});",
    };
    const result = await esbuild.build({ entryPoints: [path.join(web, "app/api/map-preview/route.ts")], bundle: true, write: false, platform: "node", format: "cjs", tsconfig: path.join(web, "tsconfig.json"),
      plugins: [{ name: "transport", setup(b: any) {
        b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : undefined);
        b.onLoad({ filter: /.*/, namespace: "mock" }, (a: any) => ({ contents: mocks[a.path], loader: "js" }));
      } }] }); return result.outputFiles[0].text;
  })();
  const module = { exports: {} as any };
  new vm.Script(await routeBundle).runInNewContext({ module, exports: module.exports, require: requireWeb, state, Response, URL, TextDecoder, console });
  return { calls, post: (value: unknown = input, raw = false) => module.exports.POST(new Request("https://preview.invalid/api/map-preview", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? value as string : JSON.stringify(value),
  })) };
}

test("invalid JSON, unknown fields, out-of-country center and oversized input never reach Apple", async () => {
  const f = await routeFixture();
  assert.equal((await f.post("{", true)).status, 400);
  assert.equal((await f.post({ ...input, id: "a-publication" })).status, 400);
  assert.equal((await f.post({ ...input, center: { lat: 49, lng: -98 } })).status, 400);
  assert.equal((await f.post("x".repeat(1025), true)).status, 413); assert.equal(f.calls.length, 0);
});

test("no location sends the official Mexico region; response is private PNG without coordinates or credentials", async () => {
  const f = await routeFixture(); const response = await f.post({ center: null, theme: "light" });
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.equal(response.headers.get("Content-Type"), "image/png"); assert.equal(response.headers.get("Vary"), "Cookie");
  assert.equal(JSON.stringify(f.calls), '[{"center":null,"dark":false}]');
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
});

test("quota and provider errors return classified errors without signed URL details", async () => {
  const blocked = await routeFixture({ limited: true }); const quota = await blocked.post();
  assert.equal(quota.status, 429); assert.equal(quota.headers.get("Retry-After"), "60"); assert.equal(blocked.calls.length, 0);
  const failed = await routeFixture({ providerError: true }); const response = await failed.post();
  assert.equal(response.status, 503); assert.ok(!(await response.text()).includes("SIGNED_PROVIDER_SECRET"));
});

test("location parser refuses malformed or nonfinite cookie coordinates", () => {
  for (const value of ["19junk,-98", "Infinity,-98", "91,-98", "19,181", ",-98", "19,-98,2"]) assert.equal(parseCoordinates(value), null);
  assert.deepEqual(parseCoordinates("19.041,-98.206"), { lat: 19.041, lng: -98.206 });
});
