import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionCache } from "../apps/web/lib/session-cache";
import { productMapZone } from "../apps/web/lib/geo/product-map-zone";
import { publicProduct } from "../apps/web/lib/public-product";

const key = "/api/session/chats";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function response(value: unknown, userId = "a") { return Response.json({ userId, value }); }

test("cached visits are immediate and concurrent reads are deduplicated", async () => {
  let requests = 0;
  const pending = deferred<Response>();
  const cache = new SessionCache("a", async () => { requests++; return pending.promise; });
  const first = cache.load(key); const second = cache.load(key);
  assert.equal(requests, 1);
  pending.resolve(response(["chat"])); await Promise.all([first, second]);
  for (let n = 0; n < 20; n++) { await cache.load(key); assert.deepEqual(cache.snapshot(key).data, ["chat"]); }
  assert.equal(requests, 1);
});
test("failed refresh retains usable data and exposes a retry error", async () => {
  let fail = false;
  const cache = new SessionCache("a", async () => fail ? new Response(null, { status: 503 }) : response(["chat"]));
  await cache.load(key); fail = true;
  await cache.load(key, true);
  assert.deepEqual(cache.snapshot(key).data, ["chat"]);
  assert.ok(cache.snapshot(key).error);
  fail = false; await cache.load(key, true); assert.equal(cache.snapshot(key).error, undefined);
});
test("expired data remain visible while one foreground reconciliation runs", async () => {
  const pending = deferred<Response>(); let calls = 0;
  const cache = new SessionCache("a", async () => ++calls === 1 ? response(["old"]) : pending.promise);
  await cache.load(key);
  cache.snapshot(key).updatedAt = Date.now() - 600_000;
  const unsubscribe = cache.subscribe(key, () => {});
  cache.refreshActive(); cache.refreshActive();
  assert.deepEqual(cache.snapshot(key).data, ["old"]); assert.equal(calls, 2);
  pending.resolve(response(["new"])); await cache.load(key);
  assert.deepEqual(cache.snapshot(key).data, ["new"]); unsubscribe();
});
test("invalidation rejects stale in-flight results, including stale unauthorized responses", async () => {
  const old = deferred<Response>(); let calls = 0; let invalid = 0;
  const cache = new SessionCache("a", async () => ++calls === 1 ? old.promise : response(["fresh"]), () => invalid++);
  const first = cache.load(key); cache.invalidate(); await cache.load(key);
  old.resolve(new Response(null, { status: 401 })); await first;
  assert.deepEqual(cache.snapshot(key).data, ["fresh"]); assert.equal(invalid, 0);
});
test("logout aborts transport and cannot repopulate private state", async () => {
  const pending = deferred<Response>(); let signal: AbortSignal | undefined;
  const cache = new SessionCache("a", async (_, options) => { signal = options?.signal as AbortSignal; return pending.promise; });
  cache.ui.set("scroll", 42); const request = cache.load(key); cache.clear();
  assert.ok(signal?.aborted); assert.equal(cache.ui.size, 0);
  pending.resolve(response(["private"])); await request;
  assert.equal(cache.snapshot(key).data, undefined);
  assert.equal(new SessionCache("b").snapshot(key).data, undefined);
});
test("response from another account clears the entire cache", async () => {
  let invalid = 0;
  const cache = new SessionCache("a", async () => response(["private-b"], "b"), () => invalid++);
  await cache.load(key); assert.equal(cache.snapshot(key).data, undefined); assert.equal(invalid, 1);
});
test("different locations never borrow each other's feed", async () => {
  const cache = new SessionCache("a", async () => response(["zone-one"]));
  await cache.load("/api/session/home#zone-one");
  assert.equal(cache.snapshot("/api/session/home#zone-two").data, undefined);
});
test("confirmed hide removes a row immediately and cancels old refreshes", async () => {
  const pending = deferred<Response>(); let calls = 0;
  const cache = new SessionCache("a", async () => ++calls === 1 ? response(["a", "b"]) : pending.promise);
  await cache.load(key);
  cache.mutate<string[]>(key, rows => rows.filter(id => id !== "a"));
  assert.deepEqual(cache.snapshot(key).data, ["b"]);
  pending.resolve(response(["b"])); await cache.load(key);
});
function point(lat: number, lng: number, little = true) {
  const buffer = Buffer.alloc(25); buffer[0] = little ? 1 : 0;
  if (little) { buffer.writeUInt32LE(0x20000001, 1); buffer.writeUInt32LE(4326, 5); buffer.writeDoubleLE(lng, 9); buffer.writeDoubleLE(lat, 17); }
  else { buffer.writeUInt32BE(0x20000001, 1); buffer.writeUInt32BE(4326, 5); buffer.writeDoubleBE(lng, 9); buffer.writeDoubleBE(lat, 17); }
  return buffer.toString("hex");
}
test("map zone uses a stable coarse cell, in either PostGIS byte order", () => {
  for (const little of [true, false]) {
    assert.deepEqual(productMapZone(point(19.04321, -98.20765, little)), { lat: 19.04, lng: -98.21 });
    assert.deepEqual(productMapZone(point(19.04111, -98.20666, little)), { lat: 19.04, lng: -98.21 });
  }
  for (const invalid of [null, "", "POINT(0 0)", "00", point(NaN, 10), point(91, 10)]) assert.equal(productMapZone(invalid), null);
});
test("public product projection strips raw geometry and unrelated fields at runtime", () => {
  const product = publicProduct({ id: "p", titulo: "Producto", ubicacion: "Puebla", ubicacion_geo: point(19.041, -98.2), lat: 19.041, lng: -98.2, profiles: { secret: "private" } });
  const encoded = JSON.stringify(product);
  assert.equal(product.ubicacion, "Puebla");
  for (const token of ["ubicacion_geo", "lat", "lng", "secret", "profiles"]) assert.equal(Object.hasOwn(product, token), false);
  assert.ok(!encoded.includes("19.041"));
});
