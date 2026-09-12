import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fetchConLimite } from '../apps/web/lib/supabase/fetch-con-limite';
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { createClient } = require('@supabase/supabase-js') as typeof import('../apps/web/node_modules/@supabase/supabase-js');
const origin = 'https://synthetic.invalid';
const read = origin + '/rest/v1/messages';

test('HTTP, HEAD, 204 y cuerpo conservados; 100 respuestas sin timers', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = 0;
  for (let i = 0; i < 100; i++) {
    const status = [200, 401, 403, 500, 204][i % 5];
    const wrapped = fetchConLimite(async (_input, init) => {
      init?.signal?.addEventListener('abort', () => aborted++);
      return new Response(status === 204 ? null : '{"message":"synthetic"}', { status, headers: { 'x-test': 'kept' } });
    }, origin);
    const response = await wrapped(read);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('x-test'), 'kept');
    assert.equal(await response.text(), status === 204 ? '' : '{"message":"synthetic"}');
  }
  const head = await fetchConLimite(async () => new Response(null, { headers: { 'content-range': '0-0/8' } }), origin)(read, { method: 'HEAD' });
  assert.equal(head.body, null);
  t.mock.timers.tick(20_000);
  assert.equal(aborted, 0);
});

for (const bodyBlocked of [false, true]) test(`aborto real a 15000ms: cuerpo bloqueado=${bodyBlocked}`, async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal: AbortSignal | null | undefined;
  const wrapped = fetchConLimite(async (_input, init) => {
    signal = init?.signal;
    if (bodyBlocked) return new Response(new ReadableStream({ start(controller) {
      signal?.addEventListener('abort', () => controller.error(signal?.reason), { once: true });
    } }));
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal?.reason), { once: true }));
  }, origin);
  const result = wrapped(read);
  const rejection = assert.rejects(result, { name: 'TimeoutError', message: 'VICINO_READ_TIMEOUT' });
  await Promise.resolve();
  t.mock.timers.tick(14_999);
  assert.equal(signal?.aborted, false);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(signal?.aborted, true);
});

test('Request/init: metodo, signal null, motivo, opciones originales y limpieza', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  caller.abort(new Error('synthetic-cancel'));
  let calls = 0;
  const wrapped = fetchConLimite(async (_input, init) => { calls++; assert.equal(init?.credentials, 'include'); return new Response('ok'); }, origin);
  const request = new Request(read, { signal: caller.signal, method: 'POST', body: '{}' });
  await assert.rejects(wrapped(request, { method: 'GET', signal: caller.signal }), caller.signal.reason);
  assert.equal(calls, 0);
  await wrapped(request, { method: 'GET', signal: null, credentials: 'include' });
  assert.equal(calls, 1);
  const active = new AbortController();
  const add = t.mock.method(active.signal, 'addEventListener');
  const remove = t.mock.method(active.signal, 'removeEventListener');
  await wrapped(read, { signal: active.signal, credentials: 'include' });
  assert.equal(add.mock.callCount(), remove.mock.callCount());
  const reason = new Error('download-cancelled');
  const stalled = fetchConLimite(async (_input, init) => new Response(new ReadableStream({ start(c) {
    init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason));
  } })), origin)(new Request(read, { signal: active.signal }));
  const rejected = assert.rejects(stalled, reason);
  await Promise.resolve();
  active.abort(reason);
  await rejected;
});

test('solo lecturas verificadas: mutaciones, Auth, Storage y otros origenes delegados intactos', async () => {
  for (const [path, method, selected] of [
    ['/rest/v1/messages', 'POST', false], ['/rest/v1/messages', 'PATCH', false],
    ['/rest/v1/messages', 'DELETE', false], ['/rest/v1/rpc/mark_messages_as_read', 'POST', false],
    ['/auth/v1/user', 'GET', false], ['/storage/v1/object/file', 'GET', false],
    ['/functions/v1/function', 'GET', false], ['/rest/v1/rpc/search_nearby_products_v4', 'POST', true],
    ['https://other.invalid/rest/v1/messages', 'GET', false],
  ] as const) {
    const options = { method, headers: { 'x-test': 'kept' } };
    const input = path.startsWith('https:') ? path : origin + path;
    await fetchConLimite(async (actual, init) => {
      assert.equal(actual, input);
      assert.equal(Boolean(init?.signal), selected);
      if (!selected) assert.equal(init, options);
      assert.equal(init?.headers, options.headers);
      return new Response('[]');
    }, origin)(input, options);
  }
});

test('PostgREST real convierte timeout en {error}, tanto select como RPC', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const client = createClient(origin, 'synthetic-key', { accessToken: async () => 'synthetic-token', auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: fetchConLimite(async (_input, init) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))), origin),
  } });
  for (const query of [client.from('messages').select(), client.rpc('search_nearby_products_v4')]) {
    const response = Promise.resolve(query);
    for (let i = 0; i < 20; i++) await Promise.resolve();
    t.mock.timers.tick(15_000);
    const result = await response;
    assert.equal(result.data, null);
    assert.match(result.error?.message ?? '', /VICINO_READ_TIMEOUT/);
  }
});
