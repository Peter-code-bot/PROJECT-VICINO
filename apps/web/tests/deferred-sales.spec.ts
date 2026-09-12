import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
const requireLocal = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] }));
type Fixture = Window & { salesFixture: {
  resolve: (seed: { ok: boolean; sales?: Array<{ id: string }> }) => void;
  live: (sales: Array<{ id: string }>) => void;
  snapshot: (sales: Array<{ id: string }>) => void;
  fail: () => void;
} };
let script: string;
test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {useDeferredSales} from './hooks/use-deferred-sales';
      const f=window.salesFixture={};const seed=new Promise(resolve=>f.resolve=resolve);
      function App(){const state=useDeferredSales([],seed);f.live=state.updateLive;f.snapshot=state.applySnapshot;f.fail=state.failed;
        return <><p data-testid="messages">Messages stay usable</p><p data-testid="status">{state.status}</p><p data-testid="sales">{state.sales.map(s=>s.id).join(',')}</p></>;}
      createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: web },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
  });
  script = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  await expect(page.getByTestId("status")).toHaveText("loading");
});
test("deferred confirmations load without suspending the message surface", async ({ page }) => {
  await expect(page.getByTestId("messages")).toBeVisible();
  await page.evaluate(() => (window as Fixture).salesFixture.resolve({ ok: true, sales: [{ id: "seed" }] }));
  await expect(page.getByTestId("status")).toHaveText("ready");
  await expect(page.getByTestId("sales")).toHaveText("seed");
});
test("a late seed cannot overwrite live events or a completed recovery", async ({ page }) => {
  await page.evaluate(() => (window as Fixture).salesFixture.live([{ id: "new-live" }]));
  await expect(page.getByTestId("sales")).toHaveText("new-live");
  await page.evaluate(() => (window as Fixture).salesFixture.snapshot([{ id: "recovered" }]));
  await expect(page.getByTestId("status")).toHaveText("ready");
  await page.evaluate(() => (window as Fixture).salesFixture.resolve({ ok: true, sales: [{ id: "stale" }] }));
  await expect(page.getByTestId("sales")).toHaveText("recovered");
});
test("an unavailable seed is not treated as an empty successful result; recovery clears the error", async ({ page }) => {
  await page.evaluate(() => (window as Fixture).salesFixture.resolve({ ok: false }));
  await expect(page.getByTestId("status")).toHaveText("error");
  await expect(page.getByTestId("messages")).toBeVisible();
  await page.evaluate(() => (window as Fixture).salesFixture.snapshot([]));
  await expect(page.getByTestId("status")).toHaveText("ready");
});
