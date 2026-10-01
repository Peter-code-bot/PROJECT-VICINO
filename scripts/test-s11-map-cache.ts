/** Pure S11 coverage helpers; transport fixtures are synthetic, without DB/SDK. */
import assert from "node:assert/strict";
import {
  mapCoverageRequestSchema, mapCoverageResultSchema, mapQuerySchema,
  type MapCell, type MapCoverageRequest, type MapCoverageResult,
} from "../packages/shared/src/validators/publications-map";
import {
  cachedCoverage, clearCoverages, CoverageError, coverageIsLimited,
  MAX_COVERAGE_BYTES, MAX_COVERAGE_CELLS, preloadCoverage,
  requestCoverage, saveCoverage, serializedBytes,
} from "../apps/web/lib/geo/coverage-client";
import {
  clusterMapCells, coverageBounds, coverageContains, coverageQuery, publicDistance,
} from "../apps/web/lib/geo/map-coverage";

const center = { lat: 19.04, lng: -98.21 };
const query = mapQuerySchema.parse({ bounds: { west: -98.3, south: 18.9, east: -98.1, north: 19.2 } });
const revision = "a".repeat(32);
const originalFetch = globalThis.fetch;
let passed = 0;
type RequestRecord = { input: MapCoverageRequest; signal: AbortSignal | null | undefined };

function result(total = 650, patch: Partial<MapCoverageResult> = {}): MapCoverageResult {
  return {
    query_key: "b".repeat(32), projection_version: 1, as_of: "2026-10-01T03:00:00Z",
    features: total > 0 ? [{ id: "cell:16:-613:119", public_lat: center.lat, public_lng: center.lng, count: total, seller_count: 1,
      bounds: { west: -98.21, east: -98.21, south: 19.04, north: 19.04 } }] : [],
    listings: [], total, seller_total: total ? 1 : 0, list_total: 0, list_seller_total: 0,
    next_cursor: null, cells: [], next_cell_cursor: null, complete: false, revision, ...patch,
  };
}
function cells(count: number, offset = 0): MapCell[] {
  return Array.from({ length: count }, (_, n) => {
    const i = n + offset;
    return { x: -9800 + Math.floor(i / 100), y: 1900 + i % 100, count: 1, seller_count: 1 };
  });
}
function cursorFor(items: MapCell[]) {
  const last = items.at(-1);
  return last ? { x: last.x, y: last.y } : null;
}
function mockTransport(reply: (input: MapCoverageRequest, index: number, record: RequestRecord) => Response | Promise<Response>) {
  const requests: RequestRecord[] = [];
  globalThis.fetch = async (_url, init) => {
    const input = mapCoverageRequestSchema.parse(JSON.parse(String(init?.body)));
    const record = { input, signal: init?.signal };
    const index = requests.push(record) - 1;
    return reply(input, index, record);
  };
  return requests;
}
function json(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(data, { status, headers });
}
function pagedTransport(total: number) {
  return mockTransport((input, index) => {
    assert.equal(input.action, "cells");
    assert.equal(input.revision, revision);
    assert.deepEqual(input.coverage_center, center);
    const offset = index * 300;
    const page = cells(Math.min(300, total - offset), offset);
    if (index) assert.deepEqual(input.cell_cursor, cursorFor(cells(300, offset - 300)));
    else assert.equal(input.cell_cursor, null);
    return json(result(total, { cells: page, complete: offset + page.length === total, next_cell_cursor: offset + page.length === total ? null : cursorFor(page) }));
  });
}
async function check(name: string, run: () => void | Promise<void>) {
  await run();
  passed++;
  console.log(`PASS ${name}`);
}
function coverageError(status?: number) {
  return (error: unknown) => error instanceof CoverageError && (status === undefined || error.status === status);
}

async function main() {
  try {
    await check("real result validator strips private/unexpected fields and accepts bounded public cells", async () => {
      mockTransport(() => json({ ...result(), cells: [{ ...cells(1)[0], seller_id: "private-fixture", exact_lat: 19.04001 }], exact_geo: "private-fixture" }));
      const data = await requestCoverage({ action: "overview", query, coverage_center: center, revision: null, cell_cursor: null }, new AbortController().signal);
      assert.equal(Object.hasOwn(data, "exact_geo"), false);
      assert.equal(Object.hasOwn(data.cells[0]!, "seller_id"), false);
      assert.equal(Object.hasOwn(data.cells[0]!, "exact_lat"), false);
      assert.ok(mapCoverageResultSchema.safeParse(data).success);
    });

    await check("650 occupied cells arrive in sequential 300-cell pages with complete overview retained", async () => {
      const requests = pagedTransport(650), first = result(), publications: MapCoverageResult[] = [];
      const completed = await preloadCoverage(query, center, first, new AbortController().signal, data => publications.push(data));
      assert.equal(requests.length, 3);
      assert.deepEqual(publications.map(data => [data.cells.length, data.complete]), [[300, false], [600, false], [650, true]]);
      assert.equal(completed.cells.reduce((sum, cell) => sum + cell.count, 0), completed.total);
      assert.equal(completed.total, first.total);
      assert.deepEqual(completed.features, first.features);
      assert.equal(completed.next_cell_cursor, null);
      assert.equal(coverageIsLimited(completed), false);
    });

    await check("different revision is rejected without publishing the changed page", async () => {
      mockTransport(() => json(result(1, { cells: cells(1), revision: "c".repeat(32), complete: true })));
      let publishes = 0;
      await assert.rejects(() => preloadCoverage(query, center, result(1), new AbortController().signal, () => publishes++), coverageError(409));
      assert.equal(publishes, 0);
    });

    await check("duplicate cells cannot create a misleading complete dataset", async () => {
      mockTransport((_input, index) => json(result(2, { cells: cells(1), complete: index > 0, next_cell_cursor: index ? null : cursorFor(cells(1)) })));
      const publications: MapCoverageResult[] = [];
      await assert.rejects(() => preloadCoverage(query, center, result(2), new AbortController().signal, data => publications.push(data)), coverageError());
      assert.equal(publications.length, 1);
      assert.equal(publications[0]!.complete, false);
    });

    await check("repeated cursor is bounded and rejected even when the server returns new cells", async () => {
      const next = { x: -9800, y: 1900 };
      const requests = mockTransport((_input, index) => json(result(3, { cells: cells(1, index), next_cell_cursor: next, complete: false })));
      const publications: MapCoverageResult[] = [];
      await assert.rejects(() => preloadCoverage(query, center, result(3), new AbortController().signal, data => publications.push(data)), coverageError());
      assert.equal(requests.length, 2);
      assert.equal(publications.length, 1);
    });

    await check("complete flag and exhausted cursor must agree in both directions", async () => {
      for (const [complete, next_cell_cursor] of [[true, { x: -9800, y: 1900 }], [false, null]] as const) {
        mockTransport(() => json(result(1, { cells: cells(1), complete, next_cell_cursor })));
        let publishes = 0;
        await assert.rejects(() => preloadCoverage(query, center, result(1), new AbortController().signal, () => publishes++), coverageError());
        assert.equal(publishes, 0);
      }
    });

    await check("final publication count must equal the sum across all occupied cells", async () => {
      mockTransport(() => json(result(2, { cells: cells(1), complete: true })));
      let publishes = 0;
      await assert.rejects(() => preloadCoverage(query, center, result(2), new AbortController().signal, () => publishes++), coverageError());
      assert.equal(publishes, 0);
    });

    await check("background/data-saver guard stops queued pages and later resumes from the last cursor", async () => {
      let allowed = true;
      const requests = mockTransport((_input, index) => {
        const items = index ? cells(50, 300) : cells(300);
        return json(result(350, { cells: items, complete: index > 0, next_cell_cursor: index ? null : cursorFor(items) }));
      });
      const partial = await preloadCoverage(query, center, result(350), new AbortController().signal, () => { allowed = false; }, () => allowed);
      assert.equal(requests.length, 1);
      assert.equal(partial.complete, false);
      assert.equal(partial.cells.length, 300);
      assert.equal(coverageIsLimited(partial), false);
      const complete = await preloadCoverage(query, center, partial, new AbortController().signal, () => {}, () => true);
      assert.deepEqual(requests[1]!.input.cell_cursor, partial.next_cell_cursor);
      assert.equal(complete.cells.length, 350);
      assert.equal(complete.complete, true);
    });

    await check("10k-cell budget preserves complete overview and labels the retained partial data as limited", async () => {
      const requests = pagedTransport(10200), first = result(10200), publications: MapCoverageResult[] = [];
      const limited = await preloadCoverage(query, center, first, new AbortController().signal, data => publications.push(data));
      assert.equal(requests.length, 34);
      assert.equal(limited.cells.length, 9900);
      assert.ok(limited.cells.length <= MAX_COVERAGE_CELLS);
      assert.equal(limited.complete, false);
      assert.equal(coverageIsLimited(limited), true);
      assert.equal(limited.total, 10200);
      assert.deepEqual(limited.features, first.features);
      assert.equal(publications.at(-1), limited);
    });

    await check("2MiB cache budget uses UTF-8 bytes and refuses an oversized response", () => {
      clearCoverages();
      assert.equal(serializedBytes("ñ"), 4);
      const usable = result(1, { complete: true, cells: cells(1) });
      saveCoverage("usable", usable, 123);
      const oversized = { ...usable, as_of: "ñ".repeat(MAX_COVERAGE_BYTES / 2) };
      assert.ok(serializedBytes(oversized) > MAX_COVERAGE_BYTES);
      saveCoverage("oversized", oversized);
      assert.equal(cachedCoverage("oversized"), undefined);
      saveCoverage("usable", oversized);
      assert.equal(cachedCoverage("usable")?.data, usable);
      assert.equal(cachedCoverage("usable")?.checkedAt, 123);
    });

    await check("LRU keeps four coverages, promotes reads, and clears all viewer data", () => {
      clearCoverages();
      for (const key of ["a", "b", "c", "d"]) saveCoverage(key, result());
      assert.ok(cachedCoverage("a"));
      saveCoverage("e", result());
      assert.equal(cachedCoverage("b"), undefined);
      for (const key of ["a", "c", "d", "e"]) assert.ok(cachedCoverage(key));
      clearCoverages();
      for (const key of ["a", "c", "d", "e"]) assert.equal(cachedCoverage(key), undefined);
    });

    await check("a cancelled preload queues zero pages", async () => {
      const requests = pagedTransport(650), abort = new AbortController();
      abort.abort();
      const first = result();
      assert.equal(await preloadCoverage(query, center, first, abort.signal, () => assert.fail("must not publish")), first);
      assert.equal(requests.length, 0);
    });

    await check("late transport response after cancellation is ignored and cannot publish or cache cells", async () => {
      let finish!: (response: Response) => void;
      const requests = mockTransport(() => new Promise<Response>(resolve => { finish = resolve; }));
      const abort = new AbortController();
      let publishes = 0;
      const pending = preloadCoverage(query, center, result(1), abort.signal, () => publishes++);
      abort.abort();
      assert.equal(requests[0]!.signal?.aborted, true);
      finish(json(result(1, { cells: cells(1), complete: true })));
      await assert.rejects(() => pending, (error: unknown) => error instanceof DOMException && error.name === "AbortError");
      assert.equal(publishes, 0);
      assert.equal(requests.length, 1);
    });

    await check("429 preserves status and clamps/defaults Retry-After without automatic retries", async () => {
      for (const [header, expected] of [["42", 42], ["999", 300], ["0", 1], ["tomorrow", 60], ["", 60]] as const) {
        const requests = mockTransport(() => json({ error: "Espera de prueba" }, 429, { "Retry-After": header }));
        await assert.rejects(() => requestCoverage({ action: "overview", query, coverage_center: center, revision: null, cell_cursor: null }, new AbortController().signal),
          (error: unknown) => error instanceof CoverageError && error.status === 429 && error.retryAfter === expected && error.message === "Espera de prueba");
        assert.equal(requests.length, 1);
      }
    });

    await check("malformed and oversized pages never pass the real response schema", async () => {
      for (const data of [result(1, { cells: [{ ...cells(1)[0]!, count: 0 }] }), result(301, { cells: cells(301) }), { ...result(), revision: "invalid" }]) {
        mockTransport(() => json(data));
        await assert.rejects(() => requestCoverage({ action: "overview", query, coverage_center: center, revision: null, cell_cursor: null }, new AbortController().signal), coverageError());
      }
    });

    await check("negative world-grid floor and entire-node counts match the server membership equation", () => {
      const occupied = Array.from({ length: 600 }, (_, index) => ({ x: -9810 + index % 30, y: 1900 + Math.floor(index / 30), count: index % 3 + 1, seller_count: 2 }));
      const full = { west: -98.10, east: -97.81, south: 19.00, north: 19.19 };
      const features = clusterMapCells(occupied, full);
      assert.ok(features.length <= 300);
      assert.ok(features.every(feature => feature.id.startsWith("cell:2:")));
      for (const feature of features) {
        const [, rawStride, rawX, rawY] = feature.id.split(":");
        const stride = Number(rawStride), nodeX = Number(rawX), nodeY = Number(rawY);
        const membership = occupied.filter(cell => Math.floor(cell.x / stride) === nodeX && Math.floor(cell.y / stride) === nodeY);
        assert.equal(feature.count, membership.reduce((sum, cell) => sum + cell.count, 0));
        assert.equal(feature.seller_count, 0, "cannot sum distinct sellers between cells");
        assert.ok(feature.public_lat >= feature.bounds.south && feature.public_lat <= feature.bounds.north);
        assert.ok(feature.public_lng >= feature.bounds.west && feature.public_lng <= feature.bounds.east);
      }
      assert.ok(features.some(feature => feature.id.startsWith("cell:2:-4905:")));
      const cut = clusterMapCells(occupied, { ...full, west: -98.095 });
      assert.deepEqual(cut.map(feature => [feature.id, feature.count]), features.map(feature => [feature.id, feature.count]));
      assert.deepEqual(clusterMapCells([], full), []);
    });

    await check("nearby buyer center/radius and filters stay fixed while camera bounds change", () => {
      const nearby = mapQuerySchema.parse({ ...query, mode: "nearby", center, radius_meters: 3000, q: "café", tipo: "servicio", price_min: 10, price_max: 200,
        cell_id: "cell:2:-4905:950", cursor: { key: "d".repeat(32), id: "10000000-0000-4000-8000-000000000001", created_at: null } });
      const cameraCenter = { lat: 19.25, lng: -98.21 };
      const canonical = coverageQuery(nearby, cameraCenter);
      const afterZoom = coverageQuery({ ...nearby, bounds: { west: -99, east: -98, south: 19, north: 20 } }, cameraCenter);
      assert.deepEqual(canonical, afterZoom);
      assert.deepEqual(canonical.center, center);
      assert.equal(canonical.radius_meters, 3000);
      assert.equal(canonical.q, "café");
      assert.equal(canonical.tipo, "servicio");
      assert.equal(canonical.price_min, 10);
      assert.equal(canonical.price_max, 200);
      assert.equal(canonical.cell_id, null);
      assert.equal(canonical.cursor, null);
      assert.deepEqual(canonical.bounds, coverageBounds(cameraCenter));
      assert.equal(coverageContains(center, { west: -98.22, east: -98.20, south: 19.03, north: 19.05 }), true);
      assert.equal(coverageContains(center, { west: -100, east: -99, south: 19, north: 20 }), false);
      assert.equal(publicDistance(center, center), 0);
      assert.equal(coverageBounds(null).west, -118.5);
    });
  } finally {
    globalThis.fetch = originalFetch;
    clearCoverages();
  }
  console.log(`S11 map cache: ${passed}/${passed} PASS; pure helpers with controlled transport`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
