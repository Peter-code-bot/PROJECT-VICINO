import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run from apps/web: node scripts/test-product-media-image.mjs
// MEDIA_TEST_DEPENDENCIES may point at another installed apps/web checkout.
const webRoot = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(resolve(process.env.MEDIA_TEST_DEPENDENCIES || webRoot, 'package.json'));
const ts = require('typescript');
const { chromium } = require('@playwright/test');
const sourceFiles = ['lib/media/product-media-policy.ts', 'lib/media/prepare-product-image.ts', 'lib/crop-image.ts'];
const compiled = Object.fromEntries(sourceFiles.map(path => [path.replace(/\.ts$/, ''), ts.transpileModule(readFileSync(resolve(webRoot, path), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText]));
// Verify importing policy and header helpers in Node does not require DOM globals.
const cache = {};
function load(name) {
  if (cache[name]) return cache[name].exports;
  const mod = cache[name] = { exports: {} };
  const localRequire = request => load(resolve('/', name, '..', request).replaceAll('\\', '/').replace(/^.*?:\//, '').replace(/^\//, ''));
  new Function('require', 'exports', 'module', compiled[name])(localRequire, mod.exports, mod);
  return mod.exports;
}
const policy = load('lib/media/product-media-policy');
assert.equal(policy.IMAGE_INPUT_MAX_BYTES, 25 * 1024 ** 2);
assert.equal(policy.VIDEO_MAX_SECONDS, 10);
const helpers = load('lib/media/prepare-product-image');
assert.throws(() => helpers.checkImageDimensions(10000, 6000), /50 megap/);
assert.throws(() => helpers.readProductImageHeader(new Uint8Array([1, 2, 3])), /JPG/);
console.log('PASS Node imports, shared limits, invalid header and >50MP rejection');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const report = await page.evaluate(async compiled => {
    const cache = {};
    function load(name) {
      if (cache[name]) return cache[name].exports;
      const mod = cache[name] = { exports: {} };
      const localRequire = request => {
        const parts = [...name.split('/').slice(0, -1), ...request.split('/')];
        const clean = [];
        for (const part of parts) if (part === '..') clean.pop(); else if (part !== '.') clean.push(part);
        return load(clean.join('/'));
      };
      new Function('require', 'exports', 'module', compiled[name])(localRequire, mod.exports, mod);
      return mod.exports;
    }
    const { prepareProductImage, readProductImageMetadata } = load('lib/media/prepare-product-image');
    const { getCroppedProductBlob } = load('lib/crop-image');
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    const rejects = async (work, match) => { try { await work(); } catch (error) { check(match.test(error.message), error.message); return; } throw new Error('Expected rejection'); };
    const canvas = document.createElement('canvas');
    canvas.width = 2800; canvas.height = 2400;
    const context = canvas.getContext('2d');
    const pixels = context.createImageData(canvas.width, canvas.height);
    let seed = 12345;
    for (let i = 0; i < pixels.data.length; i += 4) {
      for (let c = 0; c < 3; c++) { seed = (1664525 * seed + 1013904223) >>> 0; pixels.data[i + c] = seed >>> 24; }
      pixels.data[i + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 1));
    check(original.size >= 8 * 1024 ** 2 && original.size <= 25 * 1024 ** 2, `Expected real 8–25MiB fixture, got ${original.size}`);
    const file = new File([original], 'large.jpg', { type: 'image/jpeg' });
    const preview = await prepareProductImage(file);
    const metadata = await readProductImageMetadata(preview);
    check(Math.max(metadata.width, metadata.height) <= 2400, 'Preview not bounded');
    const url = URL.createObjectURL(preview);
    const side = Math.min(metadata.width, metadata.height);
    const cropped = await getCroppedProductBlob(url, { x: 0, y: 0, width: side, height: side });
    URL.revokeObjectURL(url);
    const output = await readProductImageMetadata(cropped);
    check(output.width === output.height && output.width <= 1200, 'Crop shape/size regression');
    check(cropped.size <= 1024 ** 2 && cropped.type === 'image/jpeg', 'Final target/type regression');
    // Insert genuine EXIF orientation=6 (rotate clockwise) into JPEG APP1.
    const exif = new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const bytes = new Uint8Array(await original.arrayBuffer());
    const oriented = await prepareProductImage(new File([bytes.slice(0,2), exif, bytes.slice(2)], 'rotated.jpg', { type:'image/jpeg' }));
    const orientedSize = await readProductImageMetadata(oriented);
    check(orientedSize.height > orientedSize.width, `EXIF orientation lost: ${JSON.stringify(orientedSize)}`);
    const encoded = new TextDecoder('latin1').decode(await oriented.arrayBuffer());
    check(!encoded.includes('Exif\0\0'), 'EXIF metadata retained');
    await rejects(() => prepareProductImage(new File([original], 'fake.png', {type:'image/png'})), /coincide/);
    await rejects(() => prepareProductImage(new File(['bad'], 'photo.heic', {type:'image/heic'})), /HEIC/);
    await rejects(() => prepareProductImage(new File([new Uint8Array(25 * 1024 ** 2 + 1)], 'too-large.jpg', {type:'image/jpeg'})), /25 MB/);
    const abort = new AbortController(); abort.abort();
    await rejects(() => prepareProductImage(file, {signal:abort.signal}), /cancelada/);
    for (const type of ['image/png', 'image/webp']) {
      const small = document.createElement('canvas'); small.width = 40; small.height = 20;
      const blob = await new Promise(resolve => small.toBlob(resolve, type));
      check((await prepareProductImage(new File([blob], 'sample', {type}))).type === 'image/jpeg', `${type} failed`);
    }
    // Force the compatibility decoder used when createImageBitmap is unavailable.
    const bitmap = window.createImageBitmap; window.createImageBitmap = undefined;
    try { check((await prepareProductImage(file)).type === 'image/jpeg', 'HTMLImageElement fallback failed'); }
    finally { window.createImageBitmap = bitmap; }
    return { originalBytes: original.size, preview: metadata, croppedBytes: cropped.size, output, orientedSize };
  }, compiled);
  console.log('PASS real Chromium canvas: large JPEG, 1200px square, <=1MiB, EXIF rotation/stripping, PNG/WebP, fallback, cancellation, MIME/HEIC/size rejection');
  console.log(JSON.stringify(report));
} finally { await browser.close(); }


