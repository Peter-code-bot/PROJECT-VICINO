/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');

const baseUrl = 'https://vicino.invalid';
const scriptUrl = pathToFileURL(__filename);
const source = async relative => readFile(new URL(relative, scriptUrl), 'utf8');

function loadTs(sourceText, mocks = {}) {
  const compiled = ts.transpileModule(sourceText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  const localRequire = name => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  new Function('require', 'module', 'exports', compiled)(localRequire, mod, mod.exports);
  return mod.exports;
}

function response(status, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers) };
}

async function run() {
  const previousFetch = global.fetch;
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = baseUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = randomUUID();

  const clientFactory = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: randomUUID() } } }) } });
  const prepare = loadTs(await source('../lib/media/prepare-product-video.ts'), {
    '@/lib/supabase/client': { createClient: clientFactory },
    './native-video': { compressNativeVideo: async () => null },
    './product-media-policy': { VIDEO_INPUT_MAX_BYTES: 200 * 1024 * 1024, VIDEO_OUTPUT_MAX_BYTES: 50 * 1024 * 1024 },
    './video-metadata': { readProductVideoMetadata: async () => ({}) },
    './video-processing-actions': {
      beginProductVideoProcessing: async () => ({ error: 'unexpected fallback' }),
      queueProductVideoProcessing: async () => ({ ok: true }),
      getProductVideoProcessing: async () => ({ job: null }),
      cancelProductVideoProcessing: async () => ({ ok: true }),
    },
  });

  const file = size => new File([new Uint8Array(size)], 'clip.mp4', { type: 'video/mp4' });
  const callsFor = fetchImpl => {
    const calls = [];
    global.fetch = async (url, init = {}) => {
      calls.push({ url: String(url), init });
      return fetchImpl(String(url), init, calls.length);
    };
    return calls;
  };

  // 1. Exact 6 MiB boundary, the following byte, TUS metadata and same-origin redirect policy.
  {
    const calls = callsFor(async (_url, init, n) => n === 1
      ? response(201, { location: '/storage/v1/upload/resumable/session-one' })
      : response(204, { 'upload-offset': String(Number(new Headers(init.headers).get('upload-offset')) + init.body.size) }));
    await prepare.uploadVideoResumable(file(6 * 1024 * 1024), `test-${randomUUID()}/exact.mp4`);
    const path = `test-${randomUUID()}/chunked.mp4`;
    const chunkCalls = callsFor(async (_url, init, n) => n === 1
      ? response(201, { location: '/storage/v1/upload/resumable/session-two' })
      : response(204, { 'upload-offset': String(Number(new Headers(init.headers).get('upload-offset')) + init.body.size) }));
    await prepare.uploadVideoResumable(file(6 * 1024 * 1024 + 1), path);
    assert.equal(calls.filter(x => x.init.method === 'PATCH').length, 1);
    const patches = chunkCalls.filter(x => x.init.method === 'PATCH');
    assert.deepEqual(patches.map(x => x.init.body.size), [6 * 1024 * 1024, 1]);
    assert.ok(chunkCalls.every(x => x.init.redirect === 'error'));
    const metadata = new Headers(chunkCalls[0].init.headers).get('upload-metadata');
    assert.match(metadata, /bucketName/);
  }

  // 2. A lost PATCH response is reconciled via HEAD; retrying the same path reuses the URL without POST.
  {
    const path = `test-${randomUUID()}/resume.mp4`;
    let remoteOffset = 0;
    let patchCount = 0;
    const calls = callsFor(async (_url, init) => {
      if (init.method === 'POST') return response(201, { location: '/storage/v1/upload/resumable/session-resume' });
      if (init.method === 'PATCH') {
        patchCount++;
        remoteOffset += init.body.size;
        throw new Error('simulated lost response');
      }
      if (init.method === 'HEAD') return response(200, { 'upload-offset': String(remoteOffset) });
      throw new Error(`unexpected method ${init.method}`);
    });
    const sameFile = file(1234);
    await prepare.uploadVideoResumable(sameFile, path);
    await prepare.uploadVideoResumable(sameFile, path);
    assert.equal(patchCount, 1);
    assert.equal(calls.filter(x => x.init.method === 'POST').length, 1);
    assert.equal(calls.filter(x => x.init.method === 'HEAD').length, 2);
  }

  // 3. A server-supplied upload URL cannot move credentials to another origin.
  {
    const calls = callsFor(async () => response(201, { location: 'https://attacker.invalid/storage/v1/upload/resumable/x' }));
    await assert.rejects(prepare.uploadVideoResumable(file(20), `test-${randomUUID()}/host.mp4`), /dirección de subida no es válida/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
  }

  // 4. Failed creation surfaces a safe error and does not issue a PATCH.
  {
    const calls = callsFor(async () => response(400));
    await assert.rejects(prepare.uploadVideoResumable(file(20), `test-${randomUUID()}/bad.mp4`), /iniciar la subida/);
    assert.equal(calls.length, 1);
    const timeoutCalls = callsFor(async () => { throw new DOMException('Request timed out', 'TimeoutError'); });
    await assert.rejects(prepare.uploadVideoResumable(file(20), `test-${randomUUID()}/timeout.mp4`), { name: 'TimeoutError' });
    assert.equal(timeoutCalls.length, 1);
  }

  // 5. Expired auth and abort both stop before an upload request can proceed.
  {
    const noSession = loadTs(await source('../lib/media/prepare-product-video.ts'), {
      '@/lib/supabase/client': { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }) } }) },
      './native-video': { compressNativeVideo: async () => null },
      './product-media-policy': { VIDEO_INPUT_MAX_BYTES: 200 * 1024 * 1024, VIDEO_OUTPUT_MAX_BYTES: 50 * 1024 * 1024 },
      './video-metadata': { readProductVideoMetadata: async () => ({}) },
      './video-processing-actions': {},
    });
    let networkCalls = 0;
    global.fetch = async (_url, init) => {
      networkCalls++;
      if (init.signal.aborted) throw init.signal.reason;
      throw new Error('network must stay mocked');
    };
    await assert.rejects(noSession.uploadVideoResumable(file(20), `test-${randomUUID()}/expired.mp4`), /sesión expiró/);
    const controller = new AbortController();
    controller.abort(new DOMException('Aborted', 'AbortError'));
    await assert.rejects(prepare.prepareProductVideo(file(20), { signal: controller.signal }), { name: 'AbortError' });
    assert.equal(networkCalls, 0);
  }

  const actions = await source('../lib/media/video-processing-actions.ts');

  // The SSR client and limiter are controlled in-memory doubles; no credentials or network are used.
  function actionHarness({ enabled = 'true', userId = randomUUID(), rate = { ok: true }, reserve, read } = {}) {
    process.env.MEDIA_VIDEO_PROCESSING_ENABLED = enabled;
    const calls = { auth: 0, rpc: [], filters: [], selects: [] };
    const db = {
      rpc: async (name, args) => { calls.rpc.push({ name, args }); return reserve ?? { data: { id: randomUUID(), input_path: `${userId}/input.mp4`, status: 'uploading', user_id: userId }, error: null }; },
      from: table => ({
        select: fields => { calls.selects.push({ table, fields }); return {
          eq: (column, value) => { calls.filters.push([column, value]); return {
            eq: (secondColumn, secondValue) => { calls.filters.push([secondColumn, secondValue]); return { single: async () => read ?? { data: null, error: new Error('missing') } }; },
            single: async () => read ?? { data: null, error: new Error('missing') },
          }; },
        }; },
      }),
    };
    const createServerClient = async () => ({
      auth: { getUser: async () => { calls.auth++; return { data: { user: userId ? { id: userId } : null } }; } },
      ...db,
    });
    const loaded = loadTs(actions, {
      '@/lib/supabase/server': { createClient: createServerClient },
      '@/lib/rate-limit': { enforce: async () => rate, writeRateLimit: {} },
      './product-media-policy': { VIDEO_INPUT_MAX_BYTES: 200 * 1024 * 1024 },
    });
    return { loaded, calls, userId };
  }

  // 6. Feature gate precedes auth/client creation; malformed payloads fail schema validation.
  {
    const disabled = actionHarness({ enabled: 'false' });
    const denied = await disabled.loaded.beginProductVideoProcessing({ key: randomUUID(), size: 1, mime: 'video/mp4' });
    assert.match(denied.error, /no está disponible/);
    assert.equal(disabled.calls.auth, 0);
    const enabled = actionHarness();
    assert.match((await enabled.loaded.beginProductVideoProcessing({ key: 'invalid', size: 1, mime: 'video/mp4' })).error, /no es válido/);
    assert.equal(enabled.calls.auth, 0);
  }

  // 7. Auth and rate-limit checks prevent reservation; a mismatched owner is rejected.
  {
    const unauthenticated = actionHarness({ userId: null });
    assert.match((await unauthenticated.loaded.beginProductVideoProcessing({ key: randomUUID(), size: 10, mime: 'video/mp4' })).error, /sesión expiró/);
    assert.equal(unauthenticated.calls.rpc.length, 0);
    const limited = actionHarness({ rate: { ok: false, error: 'rate limited' } });
    assert.equal((await limited.loaded.beginProductVideoProcessing({ key: randomUUID(), size: 10, mime: 'video/mp4' })).error, 'rate limited');
    assert.equal(limited.calls.rpc.length, 0);
    const wrongOwner = actionHarness({ reserve: { data: { id: randomUUID(), input_path: 'other/input.mp4', status: 'uploading', user_id: randomUUID() }, error: null } });
    assert.match((await wrongOwner.loaded.beginProductVideoProcessing({ key: randomUUID(), size: 10, mime: 'video/mp4' })).error, /cuota/);
  }

  // 8. Read is scoped to the authenticated user and publishes only the canonical output path.
  {
    const id = randomUUID();
    const userId = randomUUID();
    const read = { data: { id, status: 'ready', output_path: `${userId}/processed/${id}.mp4`, output_size: 400, duration: 3, error_code: null }, error: null };
    const test = actionHarness({ userId, read });
    const result = await test.loaded.getProductVideoProcessing(id);
    assert.equal(result.job.url, `${baseUrl}/storage/v1/object/public/product-media/${userId}/processed/${id}.mp4`);
    assert.ok(test.calls.filters.some(([column, value]) => column === 'user_id' && value === userId));
    const invalid = actionHarness({ userId, read: { data: { ...read.data, output_path: `${userId}/elsewhere/${id}.mp4` }, error: null } });
    assert.match((await invalid.loaded.getProductVideoProcessing(id)).error, /resultado.*no es válido/);
  }

  // 9. Queue and cancel actions validate IDs and require authenticated server context before RPC.
  {
    const test = actionHarness();
    const id = randomUUID();
    assert.deepEqual(await test.loaded.queueProductVideoProcessing(id), { ok: true });
    assert.deepEqual(await test.loaded.cancelProductVideoProcessing(id), { ok: true });
    assert.deepEqual(test.calls.rpc.map(x => x.name), ['mark_product_video_uploaded', 'cancel_product_video_job']);
    assert.deepEqual(await test.loaded.queueProductVideoProcessing('bad-id'), { error: 'No pudimos confirmar la subida del video.' });
    assert.deepEqual(await test.loaded.cancelProductVideoProcessing('bad-id'), { ok: false });
    const unauthenticated = actionHarness({ userId: null });
    assert.deepEqual(await unauthenticated.loaded.queueProductVideoProcessing(id), { error: 'No pudimos confirmar la subida del video.' });
    assert.deepEqual(await unauthenticated.loaded.cancelProductVideoProcessing(id), { ok: false });
    assert.equal(unauthenticated.calls.rpc.length, 0);
  }

  // 10. A terminal failed job clears the file key so selecting that same File retries with a fresh key.
  {
    const keys = [];
    const retry = loadTs(await source('../lib/media/prepare-product-video.ts'), {
      '@/lib/supabase/client': { createClient: clientFactory },
      './native-video': { compressNativeVideo: async () => null },
      './product-media-policy': { VIDEO_INPUT_MAX_BYTES: 200 * 1024 * 1024, VIDEO_OUTPUT_MAX_BYTES: 50 * 1024 * 1024 },
      './video-metadata': { readProductVideoMetadata: async () => ({}) },
      './video-processing-actions': {
        beginProductVideoProcessing: async input => { keys.push(input.key); return { job: { id: randomUUID(), path: 'test-user/input.mp4', status: 'processing' } }; },
        queueProductVideoProcessing: async () => ({ ok: true }),
        getProductVideoProcessing: async () => ({ job: { status: 'failed' } }),
        cancelProductVideoProcessing: async () => ({ ok: true }),
      },
    });
    const selected = file(2048);
    await assert.rejects(retry.prepareProductVideo(selected), /Vuelve a seleccionarlo para reintentar/);
    await assert.rejects(retry.prepareProductVideo(selected), /Vuelve a seleccionarlo para reintentar/);
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1]);
  }

  if (previousFetch) global.fetch = previousFetch;
  else delete global.fetch;
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousAnon;
  delete process.env.MEDIA_VIDEO_PROCESSING_ENABLED;
  console.log('video upload/actions: 10 scenarios passed (TUS bounds/resume/origin/timeout/abort and server-action validation/ownership/limiting/retry)');
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
