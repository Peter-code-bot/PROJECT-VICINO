// Dedicated Real Next.js Integration Test for R3 (V01)
// Starts the Next.js production server and tests real browser navigation,
// iOS synthetic bridge duplicate clicks, history stack count, visual loading feedback,
// and navigation idempotency.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const req = createRequire(resolve(web, 'package.json'));
const { chromium, webkit } = req('@playwright/test');
const fixture = resolve(web, 'test-results/plan29-next');
const nextBin = req.resolve('next/dist/bin/next');

const port = 4205;
const url = `http://127.0.0.1:${port}`;
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };

console.log(`Starting Next.js server on port ${port}...`);
const server = spawn(process.execPath, [nextBin, 'start', '-p', String(port)], {
  cwd: fixture,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});

server.stdout.on('data', b => {
  const line = b.toString().trim();
  if (line) console.log('[Next.js]', line);
});
server.stderr.on('data', b => {
  const line = b.toString().trim();
  if (line) console.error('[Next.js err]', line);
});

// Wait for server to be ready
let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise(r => setTimeout(r, 250));
}

if (!ready) {
  server.kill();
  throw new Error(`Next.js server failed to respond on ${url} within 10 seconds`);
}
console.log(`Next.js server is ready at ${url}`);

const results = [];
function record(name, pass, details = '') {
  results.push({ name, pass, details });
  console.log(pass ? `[PASS] ${name}` : `[FAIL] ${name}: ${details}`);
  if (!pass) throw new Error(`Integration test failed: ${name} - ${details}`);
}

try {
  for (const [engineName, driver] of [['chromium', chromium], ['webkit', webkit]]) {
    console.log(`\nTesting engine: ${engineName}...`);
    const browser = await driver.launch();

    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);

      // Step 1: Navigate to home origin
      await page.goto(url);
      await page.getByRole('heading', { name: 'Origen' }).waitFor();
      record(`[${engineName}] Home page loaded`, true);

      // Step 2: Measure history before click
      const historyBefore = await page.evaluate(() => history.length);

      // Step 3: Burst click simulating iOS Capacitor bridge duplicate click (3 rapid clicks)
      console.log(`[${engineName}] Dispatching 3 rapid burst clicks on #nav-vender...`);
      await page.locator('#nav-vender').evaluate(el => {
        el.click();
        el.click();
        el.click();
      });

      // Step 4: Verify visual feedback portal appears immediately
      const feedback = page.locator('[data-navigation-feedback="sell"]').first();
      await feedback.waitFor({ state: 'attached', timeout: 3000 });
      const feedbackText = await feedback.textContent();
      record(`[${engineName}] Visual feedback badge appeared: "${feedbackText.trim()}"`, feedbackText.includes('Abriendo publicación…'));

      // Step 5: Wait for destination page to render
      await page.getByRole('heading', { name: 'Formulario sintético listo' }).waitFor();
      record(`[${engineName}] Reached /vender destination route`, true);

      // Step 6: Verify route and interactive elements
      assert.equal(new URL(page.url()).pathname, '/vender');
      await page.getByLabel('Título').fill('Empirical test title');
      record(`[${engineName}] Form input is interactive`, true);

      // Step 7: Verify history stack only increased by EXACTLY 1 despite 3 burst clicks
      const historyAfter = await page.evaluate(() => history.length);
      record(
        `[${engineName}] History increased by exactly 1 (before=${historyBefore}, after=${historyAfter})`,
        historyAfter === historyBefore + 1,
        `expected ${historyBefore + 1}, got ${historyAfter}`
      );

      // Step 8: Click #nav-vender AGAIN while already on /vender
      console.log(`[${engineName}] Clicking #nav-vender while already on /vender...`);
      await page.locator('#nav-vender').click();
      await page.waitForTimeout(200);
      const historyOnVender = await page.evaluate(() => history.length);
      record(
        `[${engineName}] Clicking #nav-vender while on /vender did not duplicate history (history=${historyOnVender})`,
        historyOnVender === historyAfter
      );

      // Step 9: Use browser back button to return to Origen
      await page.goBack();
      await page.getByRole('heading', { name: 'Origen' }).waitFor();
      record(`[${engineName}] Browser Back cleanly returns to Origen without loop`, true);

      // Step 10: Aggressive 5-burst click in fresh page
      const freshPage = await browser.newPage();
      freshPage.setDefaultTimeout(15000);
      await freshPage.goto(url);
      await freshPage.getByRole('heading', { name: 'Origen' }).waitFor();
      const historyFreshBefore = await freshPage.evaluate(() => history.length);
      console.log(`[${engineName}] Dispatching 5-burst clicks on #nav-vender in fresh page...`);
      await freshPage.locator('#nav-vender').evaluate(el => {
        for (let i = 0; i < 5; i++) el.click();
      });
      await freshPage.getByRole('heading', { name: 'Formulario sintético listo' }).waitFor();
      const historyFreshAfter = await freshPage.evaluate(() => history.length);
      record(
        `[${engineName}] 5-burst click created exactly 1 history entry (before=${historyFreshBefore}, after=${historyFreshAfter})`,
        historyFreshAfter === historyFreshBefore + 1,
        `expected ${historyFreshBefore + 1}, got ${historyFreshAfter}`
      );
      await freshPage.close();

      await page.close();
    } finally {
      await browser.close();
    }
  }

  console.log('\n==========================================');
  console.log(`ALL ${results.length} REAL NEXT.JS INTEGRATION TESTS PASSED!`);
  console.log('==========================================');

} finally {
  console.log('Shutting down Next.js test server...');
  server.kill('SIGTERM');
}
