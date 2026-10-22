import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(webRoot, '../..');
const require = createRequire(resolve(process.env.MEDIA_TEST_DEPENDENCIES || webRoot, 'package.json'));
const ts = require('typescript');
const { chromium } = require('@playwright/test');

function findFfmpeg() {
  const runtimeDir = resolve(repoRoot, 'workers/product-media/.runtime');
  if (existsSync(runtimeDir)) {
    const candidate = resolve(runtimeDir, 'ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'ffmpeg';
}

const ffmpeg = findFfmpeg();
const workDir = mkdtempSync(join(tmpdir(), 'vicino-browser-video-'));

try {
  const mp4Path = join(workDir, 'source-1080p60-gps.mp4');
  const movPath = join(workDir, 'source-vertical.mov');
  const webmPath = join(workDir, 'source.webm');
  const overlongPath = join(workDir, 'overlong-12s.mp4');

  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=60:duration=2',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-metadata', 'location=+19.0414-098.2063/',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4Path,
  ], { stdio: 'ignore' });

  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=30:duration=1.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', movPath,
  ], { stdio: 'ignore' });

  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=1.5',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=1.5',
    '-c:v', 'libvpx', '-b:v', '500k', '-c:a', 'libopus', webmPath,
  ], { stdio: 'ignore' });

  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=12',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', overlongPath,
  ], { stdio: 'ignore' });

  const compile = relPath => ts.transpileModule(readFileSync(resolve(webRoot, relPath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const modules = {
    './product-media-policy': compile('lib/media/product-media-policy.ts'),
    './video-metadata': compile('lib/media/video-metadata.ts'),
    './browser-video': compile('lib/media/browser-video.ts'),
    mediabunny: readFileSync(resolve(webRoot, 'node_modules/mediabunny/dist/bundles/mediabunny.cjs'), 'utf8'),
  };

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('https://vicino.test/**', route =>
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>test</title>' }),
    );
    await page.goto('https://vicino.test/');

    const report = await page.evaluate(async ({ modules, fixtures }) => {
      const cache = {};
      function load(name) {
        if (cache[name]) return cache[name].exports;
        const mod = (cache[name] = { exports: {} });
        new Function('require', 'module', 'exports', modules[name])(load, mod, mod.exports);
        return mod.exports;
      }

      const { compressBrowserVideo } = load('./browser-video');
      const { readProductVideoMetadata } = load('./video-metadata');

      // 1. 1080p60 MP4 with GPS metadata -> 720p30 MP4 without GPS metadata
      const mp4File = new File([new Uint8Array(fixtures.mp4)], 'camera.mp4', { type: 'video/mp4' });
      let lastProgress = 0;
      const outMp4 = await compressBrowserVideo(mp4File, { onProgress: p => { lastProgress = p; } });
      const metaMp4 = await readProductVideoMetadata(outMp4);

      // 2. Vertical 1080x1920 silent MOV -> 720x1280 MP4
      const movFile = new File([new Uint8Array(fixtures.mov)], 'iphone.mov', { type: 'video/quicktime' });
      const outMov = await compressBrowserVideo(movFile);
      const metaMov = await readProductVideoMetadata(outMov);

      // 3. WebM VP8+Opus -> H.264+AAC MP4
      const webmFile = new File([new Uint8Array(fixtures.webm)], 'clip.webm', { type: 'video/webm' });
      const outWebm = await compressBrowserVideo(webmFile);
      const metaWebm = await readProductVideoMetadata(outWebm);

      // 4. Overlong 12s video rejected with VideoValidationError
      const overlongFile = new File([new Uint8Array(fixtures.overlong)], 'long.mp4', { type: 'video/mp4' });
      let overlongError = '';
      try {
        await compressBrowserVideo(overlongFile);
      } catch (err) {
        overlongError = `${err.name}: ${err.message}`;
      }

      // 5. Aborted signal rejects with AbortError
      const abortController = new AbortController();
      abortController.abort();
      let abortError = '';
      try {
        await compressBrowserVideo(mp4File, { signal: abortController.signal });
      } catch (err) {
        abortError = err.name;
      }

      return {
        mp4: { size: outMp4.size, type: outMp4.type, duration: metaMp4.duration, progress: lastProgress },
        mov: { size: outMov.size, name: outMov.name, type: outMov.type, duration: metaMov.duration },
        webm: { size: outWebm.size, name: outWebm.name, type: outWebm.type, duration: metaWebm.duration },
        overlongError,
        abortError,
      };
    }, {
      modules,
      fixtures: {
        mp4: Array.from(readFileSync(mp4Path)),
        mov: Array.from(readFileSync(movPath)),
        webm: Array.from(readFileSync(webmPath)),
        overlong: Array.from(readFileSync(overlongPath)),
      },
    });

    assert.equal(report.mp4.type, 'video/mp4');
    assert.equal(report.mp4.progress, 1);
    assert.ok(report.mp4.duration > 1.8 && report.mp4.duration <= 10);
    assert.equal(report.mov.name, 'iphone.mp4');
    assert.equal(report.mov.type, 'video/mp4');
    assert.ok(report.mov.duration > 1.3 && report.mov.duration <= 10);
    assert.equal(report.webm.name, 'clip.mp4');
    assert.equal(report.webm.type, 'video/mp4');
    assert.ok(report.webm.duration > 1.3 && report.webm.duration <= 10);
    assert.match(report.overlongError, /^VideoValidationError:.*10 segundos/);
    assert.equal(report.abortError, 'AbortError');
    console.log('browser-video WebCodecs: 5 scenarios passed (1080p60+GPS MP4, vertical MOV, WebM VP8/Opus, >10s rejection, abort)', report);
  } finally {
    await browser.close();
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}
