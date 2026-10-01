/** Run AFTER approved S11 installation. Anonymous read-only Next -> installed RPC integration; no fixtures. */
import assert from "node:assert/strict";
import { MAP_AREA, CATEGORIES, mapQuerySchema, mapCoverageResultSchema, type MapCoverageRequest, type MapCoverageResult, type MapQuery } from "../packages/shared/src";
import { coverageBounds } from "../apps/web/lib/geo/map-coverage";

const destination = new URL(process.env.S11_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:3000");
const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname);
assert.ok(!destination.username && !destination.password && destination.pathname === "/" && !destination.search && !destination.hash, "Use an origin, without credentials, path or query");
assert.ok((loopback && ["http:", "https:"].includes(destination.protocol)) || (destination.origin === "https://vicinomarket.com"), "Only loopback or the VICINO production origin is allowed");
const base = destination.origin;
const country = mapQuerySchema.parse({ bounds: MAP_AREA });
const MAX_CALLS = 80, MAX_LISTING_PAGES = 20, MAX_CELL_PAGES = 36;
let calls = 0, passed = 0, skipped = 0, lastRequest = 0;
const forbidden = new Set(["ubicacion_geo", "ubicacion_mapa", "ubicacion", "direccion", "address", "distance_meters", "exact_lat", "exact_lng", "lat", "lng"]);
function inspectPrivacy(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) { assert.ok(!forbidden.has(key), `Private field returned: ${key}`); inspectPrivacy(item); }
}
function requestBody(action: MapCoverageRequest["action"], query: MapQuery = country, center: MapCoverageRequest["coverage_center"] = null, revision: string | null = null): MapCoverageRequest {
  return { action, query, coverage_center: center, revision, cell_cursor: null };
}
async function request(input: unknown, raw = false) {
  assert.ok(++calls <= MAX_CALLS, "Read-only smoke request budget exhausted; no completeness claim");
  // Sequential cadence stays below the 60/min/IP quota, including a cold first call.
  const delay = Math.max(0, 1100 - (Date.now() - lastRequest));
  if (delay) await new Promise(resolve => setTimeout(resolve, delay));
  lastRequest = Date.now();
  return fetch(base + "/api/publications/map/coverage", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? input as string : JSON.stringify(input),
    cache: "no-store", signal: AbortSignal.timeout(20_000), redirect: "error",
  });
}
function privateHeaders(response: Response) {
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.ok(response.headers.get("vary")?.toLowerCase().includes("cookie"));
}
async function search(input: MapCoverageRequest): Promise<MapCoverageResult> {
  const response = await request(input); privateHeaders(response);
  assert.equal(response.status, 200, response.status === 409 ? "Live data changed during the coherent smoke; restart it" : "Installed coverage API must be available");
  const raw: unknown = await response.json(); inspectPrivacy(raw); return mapCoverageResultSchema.parse(raw);
}
async function test(name: string, run: () => Promise<void | boolean>) {
  if (await run() === false) { skipped++; console.log("SKIP " + name + ": live catalogue has no suitable row; not credited"); }
  else { passed++; console.log("PASS " + name); }
}
async function allListings(input: MapCoverageRequest, expected: number) {
  let page = await search(input), pages = 1; const ids = new Set<string>();
  for (;;) {
    assert.equal(page.list_total, expected); assert.equal(page.listings.length <= 30, true);
    if (input.revision) assert.equal(page.revision, input.revision);
    for (const item of page.listings) { assert.ok(!ids.has(item.id), "A listing occurred twice across keyset pages"); ids.add(item.id); }
    if (!page.next_cursor) break;
    assert.ok(++pages <= MAX_LISTING_PAGES, "Live catalogue exceeds the bounded listing smoke; no completeness claim");
    page = await search({ ...input, revision: page.revision, query: { ...input.query, cursor: page.next_cursor } });
  }
  assert.equal(ids.size, expected); return ids;
}
async function main() {
  const national = await search(requestBody("overview"));
  await test("real national overview is complete, bounded and excludes eager publication cards", async () => {
    assert.equal(national.features.reduce((n, feature) => n + feature.count, 0), national.total);
    assert.equal(national.listings.length, 0); assert.equal(national.cells.length, 0); assert.equal(national.complete, false);
    assert.ok(national.features.length <= 300); assert.ok(national.seller_total <= national.total);
  });
  await test("national publication keyset covers every eligible row without duplicates", async () => {
    await allListings(requestBody("listings", country, null, national.revision), national.total);
  });
  await test("one actual stable group has coherent counts and distinct sellers", async () => {
    if (!national.features.length) return false;
    const feature = national.features[0]!;
    const input = requestBody("listings", { ...country, cell_id: feature.id }, null, national.revision);
    const detail = await search(input);
    assert.equal(detail.list_total, feature.count); assert.equal(detail.list_seller_total, feature.seller_count);
    assert.ok(detail.listings.every(item => item.cell_id === feature.id));
    await allListings(input, feature.count);
  });
  await test("local 50 km public cells page to completion in one consistent revision", async () => {
    // A feature centroid is public; no private product coordinate or buyer GPS is obtained.
    const feature = national.features[0];
    const center = feature ? { lat: feature.public_lat, lng: feature.public_lng } : { lat: 24, lng: -102.5 };
    const query = { ...country, bounds: coverageBounds(center) };
    const overview = await search(requestBody("overview", query, center));
    assert.ok(overview.total <= national.total);
    let cursor: MapCoverageRequest["cell_cursor"] = null, pages = 0, count = 0;
    const cells = new Set<string>(), cursors = new Set<string>();
    let actualPoint: { lat: number; lng: number } | null = null;
    do {
      assert.ok(++pages <= MAX_CELL_PAGES, "Cell smoke budget exhausted; no completeness claim");
      const page = await search({ ...requestBody("cells", query, center, overview.revision), cell_cursor: cursor });
      assert.equal(page.revision, overview.revision); assert.equal(page.total, overview.total);
      assert.equal(page.features.length, 0); assert.equal(page.listings.length, 0); assert.ok(page.cells.length <= 300);
      for (const cell of page.cells) {
        actualPoint ??= { lat: cell.y / 100, lng: cell.x / 100 };
        const key = `${cell.x}:${cell.y}`; assert.ok(!cells.has(key), "Duplicate public cell"); cells.add(key); count += cell.count;
      }
      cursor = page.next_cell_cursor; assert.equal(page.complete, cursor === null);
      if (cursor) { const key = JSON.stringify(cursor); assert.ok(!cursors.has(key), "Cell cursor did not progress"); cursors.add(key); }
    } while (cursor);
    assert.equal(count, overview.total); console.log(`INFO local coverage: ${cells.size} public cells, ${pages} pages, ${count} publications`);
    const check = await search(requestBody("check", query, center, overview.revision));
    assert.equal(check.revision, overview.revision); assert.equal(check.total, overview.total);
    if (actualPoint) {
      const nearbyQuery = mapQuerySchema.parse({ ...country, bounds: coverageBounds(actualPoint), mode: "nearby", center: actualPoint, radius_meters: 10000 });
      const nearby = await search(requestBody("overview", nearbyQuery, actualPoint));
      assert.ok(nearby.total > 0 && nearby.total <= national.total);
    } else console.log("INFO local coverage is empty: nearby positive-membership assertion was not exercised");
  });
  await test("real type/price/category filters retain their membership", async () => {
    const detail = await search(requestBody("listings"));
    const item = detail.listings.find(item => item.precio !== null && ["producto", "servicio"].includes(item.tipo) && CATEGORIES.some(category => category.slug === item.categoria));
    if (item) {
      const filteredQuery = mapQuerySchema.parse({ ...country, tipo: item.tipo, categories: [item.categoria], price_min: item.precio, price_max: item.precio });
      const overview = await search(requestBody("overview", filteredQuery));
      assert.ok(overview.total > 0);
      const filtered = await search(requestBody("listings", filteredQuery, null, overview.revision));
      assert.ok(filtered.listings.every(row => row.tipo === item.tipo && row.precio === item.precio));
      assert.ok(filtered.total <= national.total);
    } else return false;
  });
  await test("an empty search returns zero counts without false points or cards", async () => {
    const empty = await search(requestBody("overview", { ...country, q: "s11-no-result-42b7c911" }));
    assert.equal(empty.total, 0); assert.equal(empty.features.length, 0); assert.equal(empty.listings.length, 0);
  });
  await test("invalid, oversized, malformed and stale requests fail privately", async () => {
    for (const [input, raw, status] of [
      [{ ...requestBody("cells"), coverage_center: null }, false, 400],
      [{ ...requestBody("overview"), query: { ...country, radius_meters: 0 } }, false, 400],
      [{ ...requestBody("overview"), private_field: "must not reach SQL" }, false, 400],
      ["{", true, 400], ["x".repeat(8193), true, 413],
      [{ ...requestBody("listings"), revision: national.revision === "0".repeat(32) ? "1".repeat(32) : "0".repeat(32) }, false, 409],
    ] as const) {
      const response = await request(input, raw); privateHeaders(response); assert.equal(response.status, status);
      const error: unknown = await response.json(); inspectPrivacy(error);
      assert.ok(!JSON.stringify(error).includes("search_map_publications_v2"), "Internal SQL identifier leaked");
    }
  });
  console.log(`S11 HTTP: ${passed} PASS, ${skipped} SKIP; ${national.total} eligible national rows; ${calls} read-only requests; anonymous integration excludes account/device acceptance`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
