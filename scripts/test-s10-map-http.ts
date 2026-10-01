/** Read-only integration through Next and the installed PostgREST RPC. No fixtures. */
import assert from 'node:assert/strict';
import { mapQuerySchema, mapResultSchema, MAP_AREA, CATEGORIES } from '../packages/shared/src';
const base = process.env.S10_BASE_URL || 'http://localhost:3000';
assert.ok(['http://localhost:3000', 'https://vicinomarket.com'].includes(base), 'Unexpected test destination');
const query = mapQuerySchema.parse({ bounds: MAP_AREA });
let passed = 0;
async function test(name: string, run: () => Promise<void>) {
  await run(); passed++; console.log('PASS ' + name);
}
async function request(input: unknown) {
  return fetch(base + '/api/publications/map', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(20_000) });
}
async function search(input: unknown) {
  const response = await request(input);
  assert.equal(response.status, 200, 'Map API should return a usable catalogue');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.ok(response.headers.get('vary')?.toLowerCase().includes('cookie'));
  const raw = await response.json();
  const forbidden = new Set(['ubicacion_geo', 'ubicacion_mapa', 'direccion', 'address', 'distance_meters', 'exact_lat', 'exact_lng']);
  const inspect = (value: unknown) => {
    if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) { assert.ok(!forbidden.has(key), 'Private field returned'); inspect(item); }
  };
  inspect(raw);
  return mapResultSchema.parse(raw);
}
async function main() {
  const all = await search(query);
  await test('real catalogue, bounded markers/cards and complete aggregate counts', async () => {
    assert.ok(all.total > 0); assert.ok(all.features.length <= 300); assert.ok(all.listings.length <= 30);
    assert.equal(all.features.reduce((n, feature) => n + feature.count, 0), all.total);
    assert.equal(all.list_total, all.total); assert.ok(all.seller_total > 0);
  });
  await test('real cursor covers catalogue without repeating listings', async () => {
    const ids = new Set(all.listings.map(item => item.id)); let page = all; let pages = 1;
    while (page.next_cursor) {
      assert.ok(pages++ < 10, 'Live catalogue too large for this bounded smoke');
      page = await search({ ...query, cursor: page.next_cursor });
      for (const item of page.listings) { assert.ok(!ids.has(item.id)); ids.add(item.id); }
    }
    assert.equal(ids.size, all.total);
  });
  await test('selecting a real group retains area totals and filters its cards', async () => {
    const feature = all.features[0]; const selected = await search({ ...query, cell_id: feature.id });
    assert.equal(selected.total, all.total); assert.equal(selected.list_total, feature.count);
    assert.ok(selected.listings.every(item => item.cell_id === feature.id));
  });
  await test('real type/category/price filters and empty result', async () => {
    const item = all.listings.find(item => item.precio !== null && CATEGORIES.some(category => category.slug === item.categoria));
    assert.ok(item, 'Expected a catalogue item with a supported category and price');
    const filtered = await search({ ...query, tipo: item.tipo, categories: [item.categoria], price_min: item.precio, price_max: item.precio });
    assert.ok(filtered.listings.some(candidate => candidate.id === item.id));
    assert.ok(filtered.listings.every(candidate => candidate.tipo === item.tipo && candidate.precio === item.precio));
    const empty = await search({ ...query, q: 's10-no-result-9ed312' });
    assert.equal(empty.total, 0); assert.equal(empty.features.length, 0); assert.equal(empty.listings.length, 0);
  });
  await test('buyer nearby radius through the real API', async () => {
    const feature = all.features[0]; const nearby = await search({ ...query, mode: 'nearby', center: { lat: feature.public_lat, lng: feature.public_lng }, radius_meters: 10_000 });
    assert.ok(nearby.total > 0); assert.ok(nearby.total <= all.total);
  });
  await test('invalid and oversized HTTP input refused', async () => {
    assert.equal((await request({ ...query, radius_meters: 0 })).status, 400);
    assert.equal((await request({ ...query, q: 'x'.repeat(9000) })).status, 413);
  });
  await test('page enabled and linked from search', async () => {
    const page = await fetch(base + '/mapa', { signal: AbortSignal.timeout(20_000) }); assert.equal(page.status, 200);
    const html = await page.text(); assert.ok(html.includes('Lo que hay cerca')); assert.ok(!html.includes('Estamos preparando el mapa'));
    const searchPage = await fetch(base + '/buscar?q=gomitas', { signal: AbortSignal.timeout(20_000) });
    assert.ok((await searchPage.text()).includes('Ver publicaciones en el mapa'));
  });
  console.log(`S10 HTTP: ${passed}/${passed} PASS; ${all.total} eligible catalogue rows; anonymous real HTTP, no dedicated account/device acceptance`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
