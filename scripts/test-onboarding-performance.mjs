// Production-mode component benchmark against a local fixture server, no Auth or remote data.
// node scripts/test-onboarding-performance.mjs <fixture-url> <baseline|candidate>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const req = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = req("@playwright/test");
const base = process.argv[2] ?? "http://127.0.0.1:4179";
assert.match(base, /^http:\/\/127\.0\.0\.1:\d+$/);
const label = process.argv[3] ?? "candidate";
assert.match(label, /^(baseline|candidate)$/);
const browser = await chromium.launch();
const output = resolve("apps/web/test-results/onboarding-performance");
await mkdir(output, { recursive: true });
const results = [];
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  await page.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  for (const scenario of [
    { name: "warm-optional-ack50", ackDelay: 50, cpu: 1 },
    { name: "warm-optional-ack600", ackDelay: 600, cpu: 1 },
    { name: "warm-optional-cpu4-ack50", ackDelay: 50, cpu: 4 },
  ]) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: scenario.cpu });
    const samples = [];
    for (let index = 0; index < 100; index++) {
      await page.goto(`${base}/completar-perfil/nombre?ackDelay=${scenario.ackDelay}`);
      await page.getByRole("heading", { name: "¿Cómo te llamas?", exact: true }).waitFor();
      // Wait for restoration/hydration; timing starts at the actual click.
      await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
      const sample = await page.evaluate(() => new Promise(resolveSample => {
        const start = performance.now(); let feedback = null; let usable = null;
        const observe = () => {
          const next = document.querySelector("h1")?.textContent === "Agrega tu foto";
          if (feedback === null && (next || document.querySelector('section[aria-busy="true"]'))) feedback = performance.now() - start;
          if (next && usable === null) {
            const skip = [...document.querySelectorAll("footer button")].find(button => button.textContent.trim() === "Omitir");
            if (skip && !skip.disabled) usable = performance.now() - start;
          }
          const ack = window.__fixture.trace.find(item => item.action === "ack" && item.at >= start);
          if (usable !== null && (ack || !window.__fixture.metricAware)) {
            resolveSample({ feedback, usable, ack: ack ? ack.at - start : usable }); return;
          }
          if (performance.now() - start > 5000) { resolveSample({ error: "transition/ACK timeout" }); return; }
          requestAnimationFrame(observe);
        };
        const skip = [...document.querySelectorAll("footer button")].find(button => button.textContent.trim() === "Omitir");
        skip.click(); observe();
      }));
      assert(!sample.error, sample.error); samples.push(sample);
    }
    await cdp.detach();
    const summary = { label, ...scenario, count: samples.length,
      feedback: { p50: percentile(samples.map(value => value.feedback), .5), p95: percentile(samples.map(value => value.feedback), .95) },
      nextUsable: { p50: percentile(samples.map(value => value.usable), .5), p95: percentile(samples.map(value => value.usable), .95) },
      ack: { p50: percentile(samples.map(value => value.ack), .5), p95: percentile(samples.map(value => value.ack), .95) }, samples };
    results.push(summary);
    console.log(JSON.stringify({ ...summary, samples: undefined }));
  }
  // Reproduce/check the final Back case under resolved notifications.
  for (const mode of ["granted", "denied", "no-nativo"]) {
    await page.goto(`${base}/completar-perfil/listo?push=${mode}`);
    await page.getByRole("button", { name: "Regresar", exact: true }).click();
    await page.waitForTimeout(500);
    const actual = new URL(page.url()).pathname;
    console.log(JSON.stringify({ label, scenario: `final-back-${mode}`, route: actual }));
    if (label === "candidate") assert.equal(actual, "/completar-perfil/ubicacion");
  }
  assert.deepEqual(errors, []);
  await page.close();
} finally {
  await browser.close();
  await writeFile(resolve(output, `${label}.json`), JSON.stringify({ scope: "local production-mode components with controlled Server Action ACK delay; not authenticated/device or full Next network performance", results }, null, 2));
}
