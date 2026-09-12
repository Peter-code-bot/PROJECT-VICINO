import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createRequire } from 'node:module';
import { crearInicializadorSentry, crearObservadorRutas, categoriaRuta } from '../apps/web/lib/observability/sentry-nativo';
type Modules = Awaited<ReturnType<Parameters<typeof crearInicializadorSentry>[0]>>;

function fixture(failInit = false) {
  let calls = 0;
  let client: object | undefined;
  let complete!: () => void;
  let options: Record<string, unknown> = {};
  const modules = [
    { init: (opts: Record<string, unknown>, initialize: (opts: object) => void) => { calls++; options = opts; complete = () => initialize(opts); } },
    { getClient: () => client, init: () => { if (failInit) throw new Error('synthetic'); client = {}; }, browserTracingIntegration: (opts: object) => ({ name: 'BrowserTracing', options: opts }) },
  ] as unknown as Modules;
  return { modules, calls: () => calls, options: () => options, complete: () => complete() };
}

test('20 invocaciones concurrentes y remontaje producen una sola inicializacion', async () => {
  const f = fixture();
  let imports = 0;
  const bootstrap = crearInicializadorSentry(async () => { imports++; return f.modules; });
  const results = Array.from({ length: 20 }, () => bootstrap.init());
  await nextTurn();
  assert.equal(f.calls(), 1); assert.equal(imports, 1);
  assert.equal(bootstrap.estado().state, 'initializing');
  assert.equal(bootstrap.estado().jsClient, false);
  f.complete();
  for (const state of await Promise.all(results)) assert.equal(state.state, 'ready');
  await bootstrap.init(true);
  assert.equal(f.calls(), 1);
  assert.equal(bootstrap.estado().nativeBridge, 'unverified');
  assert.equal(f.options().sampleRate, 1);
  assert.equal(f.options().tracesSampleRate, 1);
});

test('import fallido capturado, un unico reintento explicito', async () => {
  let imports = 0;
  const bootstrap = crearInicializadorSentry(async () => { imports++; throw new Error('synthetic'); });
  assert.equal((await bootstrap.init()).state, 'failed');
  await bootstrap.init();
  assert.equal(imports, 1);
  await bootstrap.init(true); await bootstrap.init(true);
  assert.equal(imports, 2);
});

test('fallo sincrono del cliente y puente bloqueado no reinicializan parcialmente', async (t) => {
  const f = fixture(true);
  const bootstrap = crearInicializadorSentry(async () => f.modules);
  const result = bootstrap.init(); await nextTurn(); f.complete();
  assert.equal((await result).state, 'failed');
  await bootstrap.init(true); assert.equal(f.calls(), 1);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const blocked = fixture();
  const slow = crearInicializadorSentry(async () => blocked.modules);
  const wait = slow.init(); await nextTurn();
  t.mock.timers.tick(5_000);
  assert.equal((await wait).state, 'failed');
  await slow.init(true); assert.equal(blocked.calls(), 1);
  blocked.complete();
  assert.equal(slow.estado().state, 'ready');
  assert.equal((await slow.init()).state, 'ready');
});

test('10 route commits; cancelacion, timeout, query no medida; sin rutas sensibles', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const spans: Array<{ options: unknown; attrs: Record<string, unknown>; ends: number }> = [];
  const observer = crearObservadorRutas(() => ({ startInactiveSpan(options) {
    const span = { options, attrs: {} as Record<string, unknown>, ends: 0 };
    spans.push(span);
    return { setAttribute: (name: string, value: unknown) => { span.attrs[name] = value; }, end: () => { span.ends++; } } as ReturnType<Modules[1]['startInactiveSpan']>;
  } }));
  for (let i = 0; i < 10; i++) {
    observer.start(`/chat/synthetic-private-${i}?secret=never-log`, '/');
    observer.commit(`/chat/synthetic-private-${i}`);
  }
  assert.equal(spans.length, 10);
  assert.ok(spans.every((s) => s.ends === 1 && s.attrs.result === 'committed' && typeof s.attrs['native.route_commit_ms'] === 'number'));
  assert.ok(!JSON.stringify(spans).includes('synthetic-private'));
  assert.ok(!JSON.stringify(spans).includes('secret'));
  assert.equal(observer.start('/buscar?q=never-log', '/buscar'), 'unmeasured_query');
  observer.start('/perfil', '/'); observer.start('/seller', '/');
  assert.equal(spans[10].attrs.result, 'cancelled');
  t.mock.timers.tick(30_000);
  assert.equal(spans[11].attrs.result, 'timeout');
  assert.equal(spans[11].attrs['native.route_commit_ms'], undefined);
  observer.dispose();
  assert.ok(spans.every((s) => s.ends === 1));
  assert.equal(categoriaRuta('/chat/123'), 'chat_detail');
});

test('SDK React 10.43 real: un error y diez transacciones mediante transporte de pruebas', async () => {
  const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
  const react = require('@sentry/react') as Modules[1];
  const envelopes: Array<unknown> = [];
  const transport = () => ({ send: async (envelope: unknown) => { envelopes.push(envelope); return { statusCode: 200 }; }, flush: async () => true });
  const native = { init: (options: Parameters<Modules[0]['init']>[0], callback: NonNullable<Parameters<Modules[0]['init']>[1]>) => callback({
    ...options, dsn: 'https://synthetic@synthetic.invalid/7', release: 'synthetic-release', dist: 'synthetic-dist', transport,
  }) } as unknown as Modules[0];
  const bootstrap = crearInicializadorSentry(async () => [native, react]);
  assert.equal((await bootstrap.init()).state, 'ready');
  try {
    react.captureException(new Error('synthetic-error'));
    const routes = crearObservadorRutas(() => react);
    for (let i = 0; i < 10; i++) { routes.start(`/chat/private-${i}?token=synthetic`, '/'); routes.commit(`/chat/private-${i}`); }
    await react.flush(2_000);
    const items = (envelopes as Array<[unknown, Array<[{type: string}, {release: string; dist: string; transaction?: string; contexts?: object} ]>]>).flatMap((e) => e[1]);
    assert.equal(items.filter((item) => item[0].type === 'event').length, 1);
    const transactions = items.filter((item) => item[0].type === 'transaction');
    assert.equal(transactions.length, 10);
    for (const [, event] of items.filter((item) => ['transaction', 'event'].includes(item[0].type))) {
      assert.equal(event.release, 'synthetic-release'); assert.equal(event.dist, 'synthetic-dist');
    }
    assert.ok(!JSON.stringify(transactions).includes('private-'));
    assert.ok(!JSON.stringify(transactions).includes('token='));
    const web = require('@sentry/nextjs') as { getClient: () => unknown };
    assert.equal(web.getClient(), undefined);
  } finally { await react.close(1_000); }
});
