import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Run the actual adapter against a bridge double; no codec/device claims from this suite.
const source = await readFile(new URL('../lib/media/native-video.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/^import .*;\r?\n/gm, '').replace('export async function', 'async function');
const id = 'f975a2cc-f405-4f3d-8ca3-f201af63cafa';
const make = ({ available = true, writeError, result = {}, abortOnWrite, fetchError, beginGate, abortOnFinish } = {}) => {
  const calls = [], chunks = [];
  let progress;
  const bridge = {
    begin: async () => { calls.push('begin'); await beginGate; return { id }; },
    addListener: async (_event, fn) => { progress = fn; return { remove: async () => calls.push('remove') }; },
    writeChunk: async (chunk) => {
      chunks.push(chunk); calls.push('write'); abortOnWrite?.();
      if (writeError) throw new Error('bridge failed');
    },
    finish: async () => {
      calls.push('finish'); progress?.({ id, progress: 0.5 });
      if (abortOnFinish) { abortOnFinish(); throw new Error('native cancellation'); }
      return { uri: `file:///private/cache/vicino-video/${id}/output.mp4`, size: 1024, duration: 9, ...result };
    },
    cancel: async () => calls.push('cancel'),
  };
  const adapter = new Function('Capacitor', 'registerPlugin', 'VIDEO_INPUT_MAX_BYTES', 'VIDEO_MAX_SECONDS', 'VIDEO_OUTPUT_MAX_BYTES', 'fetch',
    compiled + '\nreturn compressNativeVideo;')(
      { isNativePlatform: () => true, isPluginAvailable: () => available, convertFileSrc: (uri) => { calls.push('convert'); return uri; } },
      () => bridge, 200 * 1024 * 1024, 10, 10 * 1024 * 1024,
      async () => {
        calls.push('fetch'); if (fetchError) throw new Error('read failed');
        return { ok: true, blob: async () => new Blob([new Uint8Array(1024)]) };
      },
    );
  return { adapter, calls, chunks };
};
const input = new File([new Uint8Array(500_001)], 'portrait.MOV', { type: 'video/quicktime' });

{
  const controller = new AbortController();
  const test = make({ abortOnFinish: () => controller.abort() });
  await assert.rejects(test.adapter(input, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(test.calls.at(-1), 'cancel');
}
{
  let release;
  const test = make({ beginGate: new Promise(resolve => { release = resolve; }) });
  const pending = test.adapter(input);
  await assert.rejects(test.adapter(input), /otro video/);
  release();
  await pending;
  assert.equal((await test.adapter(input)).size, 1024); // lock released after cleanup
}
{
  const test = make({ available: false });
  assert.equal(await test.adapter(input), null);
  assert.deepEqual(test.calls, []);
}
{
  const test = make(); const progress = [];
  const output = await test.adapter(input, { onProgress: p => progress.push(p) });
  assert.equal(output.name, 'portrait.mp4'); assert.equal(output.type, 'video/mp4'); assert.equal(output.size, 1024);
  assert.equal(test.chunks.length, 3);
  let offset = 0;
  for (const chunk of test.chunks) {
    const bytes = Buffer.from(chunk.data, 'base64');
    assert.ok(bytes.length <= 192 * 1024); assert.equal(chunk.offset, offset); offset += bytes.length;
  }
  assert.equal(offset, input.size); assert.equal(progress.at(-1), 1);
  assert.deepEqual(test.calls.slice(-2), ['remove', 'cancel']);
}
for (const result of [
  { size: 10 * 1024 * 1024 + 1 }, { size: 1000 }, { duration: 10.01 }, { duration: NaN },
  { uri: 'https://example.com/video.mp4' }, { uri: 'file:///etc/output.mp4' },
]) {
  const test = make({ result });
  await assert.rejects(test.adapter(input));
  assert.equal(test.calls.at(-1), 'cancel');
}
for (const failure of [{ writeError: true }, { fetchError: true }]) {
  const test = make(failure);
  await assert.rejects(test.adapter(input));
  assert.equal(test.calls.at(-1), 'cancel');
}
{
  const controller = new AbortController();
  const test = make({ abortOnWrite: () => controller.abort() });
  await assert.rejects(test.adapter(input, { signal: controller.signal }), { name: 'AbortError' });
  assert.ok(!test.calls.includes('finish')); assert.equal(test.calls.at(-1), 'cancel');
}
{
  const test = make();
  const oversized = { size: 200 * 1024 * 1024 + 1 };
  await assert.rejects(test.adapter(oversized));
  assert.deepEqual(test.calls, []);
}
console.log('native-video adapter: 15 scenarios passed (bounded chunks, validation, failure, abort, cleanup, concurrency)');
