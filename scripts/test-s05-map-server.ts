/** Real route + geometry/parser; DB and Apple transport are synthetic boundaries. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import { mapPreviewError } from '../apps/web/lib/geo/map-preview-error';
const web = path.resolve(__dirname, '../apps/web');
const requireWeb = createRequire(path.join(web, 'package.json'));
const esbuild = requireWeb(requireWeb.resolve('esbuild', { paths: [requireWeb.resolve('tsx')] }));
const id = '00000000-0000-4000-8000-000000000001';
const point = Buffer.alloc(25);
point.writeUInt8(1); point.writeUInt32LE(0x20000001, 1); point.writeUInt32LE(4326, 5);
point.writeDoubleLE(-98.206345, 9); point.writeDoubleLE(19.041456, 17);
let bundle: Promise<string>;
async function fixture(options: any = {}) {
  const calls: any[] = [], captures: string[] = [];
  const state = { calls, captures, rate: options.rate ?? true,
    client(admin: boolean) {
      calls.push(admin ? 'admin' : 'rls');
      const result = admin ? { data: options.concurrent ? null : { ubicacion_geo: options.missing ? null : point.toString('hex') }, error: options.locationError ?? null }
        : { data: options.hidden ? null : { id, updated_at: 'version-1' }, error: options.readError ?? null };
      const chain: any = { maybeSingle: async () => result };
      for (const method of ['from', 'select', 'eq', 'neq', 'is']) chain[method] = (...args: any[]) => { calls.push([admin, method, ...args]); return chain; };
      return chain;
    },
    snapshot(zone: any, dark: boolean) { calls.push(['snapshot', zone, dark]); if (options.providerError) throw new Error('SECRET_SIGNED_URL'); return new Uint8Array([137,80,78,71]).buffer; },
  };
  bundle ??= (async () => {
    const mocks: Record<string, string> = {
      'server-only': 'export {};',
      '@/lib/supabase/server': 'export const createClient=async()=>globalThis.state.client(false);',
      '@/lib/supabase/admin': 'export const createAdminClient=()=>globalThis.state.client(true);',
      '@/lib/geo/product-map-snapshot': 'export const productMapSnapshot=async(...args)=>globalThis.state.snapshot(...args);',
      '@/lib/rate-limit': 'export const getClientIp=()=>"synthetic";export const productMapRateLimit={};export const enforce=async()=>({ok:globalThis.state.rate});',
      '@sentry/nextjs': 'export const captureException=e=>globalThis.state.captures.push(e.message);',
    };
    const result = await esbuild.build({ entryPoints: [path.join(web, 'app/api/products/[id]/location-map/route.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
      tsconfig: path.join(web, 'tsconfig.json'), plugins: [{ name: 'transport', setup(b: any) {
        b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'mock' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'mock' }, (a: any) => ({ contents: mocks[a.path], loader: 'js' }));
      } }] }); return result.outputFiles[0].text;
  })();
  const module = { exports: {} as any };
  new vm.Script(await bundle).runInNewContext({ module, exports: module.exports, require: requireWeb, state, Buffer, Response, URL, console });
  return { calls, captures, get: (productId = id) => module.exports.GET(new Request('https://s05.invalid/map?theme=dark'), { params: Promise.resolve({ id: productId }) }) };
}
test('invalid ID and invisible publication never read privileged geometry', async () => {
  for (const invalid of [true, false]) {
    const f = await fixture({ hidden: true }), res = await f.get(invalid ? 'bad' : id);
    assert.equal(res.status, 404); assert.deepEqual(await res.json(), { code: 'not_available' });
    assert.ok(!f.calls.includes('admin'));
  }
});
for (const [label, options, status, code] of [
  ['RLS read error', { readError: 'SECRET_DB_ERROR' }, 503, 'temporarily_unavailable'],
  ['geometry read error', { locationError: 'SECRET_GEOMETRY' }, 503, 'temporarily_unavailable'],
  ['no location', { missing: true }, 404, 'location_missing'],
  ['concurrent edit', { concurrent: true }, 409, 'location_changed'],
  ['provider unavailable', { providerError: true }, 503, 'temporarily_unavailable'],
  ['shared rate limit', { rate: false }, 429, 'rate_limited'],
] as const) test(label + ': classified private error without upstream detail', async () => {
  const f = await fixture(options), res = await f.get();
  assert.equal(res.status, status); assert.deepEqual(await res.json(), { code });
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(!JSON.stringify(f.captures).includes('SECRET'));
  if (status === 429) { assert.equal(res.headers.get('Retry-After'), '60'); assert.equal(f.calls.length, 0); }
});
test('authorized snapshot receives only approximate cell; client receives PNG, never geometry', async () => {
  const f = await fixture(), res = await f.get();
  assert.equal(res.status, 200); assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('Cache-Control'), 'private, max-age=86400');
  const call = f.calls.find(x => Array.isArray(x) && x[0] === 'snapshot');
  assert.equal(call[1].lat, 19.04); assert.equal(call[1].lng, -98.21); assert.equal(call[2], true);
  assert.ok(f.calls.some(x => Array.isArray(x) && x[0] === true && x[1] === 'eq' && x[2] === 'updated_at' && x[3] === 'version-1'));
  assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [137,80,78,71]);
});
test('per-process rate floor still limits requests when shared limit allows', async () => {
  const f = await fixture();
  for (let i = 0; i < 20; i++) assert.equal((await f.get()).status, 200);
  const res = await f.get(); assert.equal(res.status, 429); assert.equal(res.headers.get('Retry-After'), '60');
  assert.equal(f.calls.filter(x => x === 'admin').length, 20);
});
test('public retry semantics preserve Retry-After and never display unknown error text', () => {
  assert.equal(mapPreviewError(404, 'location_missing').retryable, false);
  assert.equal(mapPreviewError(404, 'SECRET').message, 'Mapa no disponible para esta publicación.');
  assert.equal(mapPreviewError(429).delay, 60);
  assert.equal(mapPreviewError(429, '', '2').delay, 2);
  assert.equal(mapPreviewError(429, '', 'invalid').delay, 60);
  assert.ok(mapPreviewError(503, '', new Date(Date.now() + 60_000).toUTCString()).delay >= 59);
  assert.ok(!mapPreviewError(503, 'SECRET').message.includes('SECRET'));
});
