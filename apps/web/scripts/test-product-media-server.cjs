/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const web = path.resolve(__dirname, '..');
const requireWeb = Module.createRequire(path.join(web, 'package.json'));
const ts = requireWeb('typescript');
const sharp = requireWeb('sharp');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const mod = new Module(file); cache.set(file, mod); mod.filename = file;
  mod.require = name => {
    if (name === 'server-only') return {};
    if (name.startsWith('.')) return load(path.resolve(path.dirname(file), `${name}.ts`));
    return requireWeb(name);
  };
  mod._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, file);
  return mod.exports;
}
const { parseProductGallery, ownedProductMediaPath, validateProductGallery } = load(path.join(web, 'lib/media/validate-product-gallery.ts'));
const { readStoredMedia } = load(path.join(web, 'lib/media/read-stored-media.ts'));
const ownerId = '11111111-1111-4111-8111-111111111111';
const baseUrl = 'https://media.test.invalid';
const url = `${baseUrl}/storage/v1/object/public/product-media/${ownerId}/fixture.jpg`;
const fixture = () => sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#88aa77' } }).jpeg().toBuffer();

test('strict gallery parsing rejects malformed input without clearing existing images', () => {
  assert.deepEqual(parseProductGallery(null), []);
  assert.deepEqual(parseProductGallery('[]'), []);
  for (const raw of ['bad', '{}', '[null]', '[1]', JSON.stringify([url, url]), JSON.stringify(Array.from({ length: 6 }, (_, i) => `${url}${i}`))]) assert.throws(() => parseProductGallery(raw));
});
test('canonical owner URLs reject SSRF, foreign users, traversal, encoded and query paths', () => {
  assert.equal(ownedProductMediaPath(url, ownerId, baseUrl), `${ownerId}/fixture.jpg`);
  assert.equal(ownedProductMediaPath(url.replace('fixture.jpg', 'processed/fixture.mp4'), ownerId, baseUrl), null);
  for (const bad of [url.replace(ownerId, 'other'), `${url}?key=value`, `${url}#x`, url.replace('https:', 'http:'), url.replace('media.test.invalid', 'media.test.invalid.evil.invalid'), url.replace('fixture.jpg', '../fixture.jpg'), url.replace('fixture.jpg', '%2e%2e/fixture.jpg'), url.replace('fixture.jpg', 'a%2Fb.jpg'), url.replace('https://', 'https://user@')]) assert.equal(ownedProductMediaPath(bad, ownerId, baseUrl), null, bad);
});
test('stored images are fully decoded and checked before accepting a URL', async () => {
  const bytes = await fixture(); let requests = 0;
  await validateProductGallery({ urls: [url], ownerId, baseUrl, request: async (_url, options) => {
    requests++; assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return new Response(bytes, { headers: { 'content-type': 'image/jpeg' } });
  } });
  assert.equal(requests, 1);
  for (const [body, mime] of [[bytes.subarray(0, 300), 'image/jpeg'], [bytes, 'image/png'], [Buffer.from('fake file'), 'image/jpeg']]) {
    await assert.rejects(() => validateProductGallery({ urls: [url], ownerId, baseUrl, request: async () => new Response(body, { headers: { 'content-type': mime } }) }));
  }
});
test('server rejects oversized pixels and retained EXIF even when bytes are small', async () => {
  const large = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: 'white' } }).jpeg().toBuffer();
  const exif = await sharp(await fixture()).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  for (const bytes of [large, exif]) await assert.rejects(() => validateProductGallery({ urls: [url], ownerId, baseUrl, request: async () => new Response(bytes, { headers: { 'content-type': 'image/jpeg' } }) }));
});
test('owner legacy gallery is preserved; unowned new media is never fetched', async () => {
  let requests = 0;
  const request = async () => { requests++; throw new Error('must not fetch'); };
  await validateProductGallery({ urls: [url], existing: [url], ownerId, baseUrl, request });
  await assert.rejects(() => validateProductGallery({ urls: [url.replace(ownerId, 'other')], ownerId, baseUrl, request }));
  assert.equal(requests, 0);
});
test('bounded reads reject missing/empty/oversized bodies and dishonest content length', async () => {
  for (const response of [new Response(null, { status: 404 }), new Response(''), new Response('small', { headers: { 'content-length': '200' } }), new Response('0123456789ABCDEF', { headers: { 'content-length': '1' } })]) await assert.rejects(() => readStoredMedia(url, 10, async () => response));
});
