import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] })) as {
  build: (options: object) => Promise<{ outputFiles: Array<{ text: string }> }>;
};

let browserScript: string;
test.beforeAll(async () => {
  const web = process.cwd();
  const result = await esbuild.build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { MasProductos } from './components/home/mas-productos';
        window.calls = []; window.observers = [];
        class Observer {
          constructor(callback) { this.callback = callback; this.active = false; }
          observe() { this.active = true; window.observers.push(this); }
          disconnect() { this.active = false; }
        }
        window.IntersectionObserver = Observer;
        window.intersect = () => window.observers.filter(o => o.active).forEach(o => o.callback([{ isIntersecting: true }]));
        window.testCall = (cursor) => { window.calls.push(cursor); return window.responses.shift()(); };
        const root = createRoot(document.getElementById('root'));
        window.mount = () => flushSync(() => root.render(React.createElement(MasProductos, { initialCursor: 'start' })));`,
      resolveDir: web,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{
      name: "isolate-feed",
      setup(build: {
        onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => object | null) => void;
        onLoad: (options: { filter: RegExp; namespace: string }, callback: (args: { path: string }) => object) => void;
      }) {
        build.onResolve({ filter: /^@\/app\/\(marketplace\)\/actions$|^@\/components\/product\/product-card$|^@vicino\/shared$/ },
          ({ path: file }) => ({ path: file, namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, ({ path: file }) => ({
          contents: file.includes("actions")
            ? "export const getMoreFeedProducts = async (cursor) => window.testCall(cursor);"
            : file.includes("product-card")
              ? "import React from 'react'; export const ProductCard = (p) => React.createElement('article', {'data-id': p.id}, p.titulo);"
              : "export const normalizeCardCategories = () => [];",
          loader: "js",
          resolveDir: web,
        }));
      },
    }],
  });
  browserScript = result.outputFiles[0].text;
});

test("Más productos conserva la frontera tras fallo y reintenta una sola vez", async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: browserScript });
  await page.evaluate(() => {
    const w = window as unknown as {
      responses: Array<() => Promise<unknown>>;
      mount: () => void;
    };
    const product = (id: string) => ({ id, titulo: id, created_at: "2026-09-01T00:00:00Z" });
    w.responses = [
      async () => ({ items: [], nextCursor: null, error: "Sin conexión" }),
      async () => ({ items: [product("p1"), product("p1")], nextCursor: "second" }),
      async () => ({ items: [product("p1"), product("p2")], nextCursor: null }),
    ];
    w.mount();
  });
  await page.evaluate(() => (window as unknown as { intersect: () => void }).intersect());
  await expect(page.getByRole("alert")).toContainText("Sin conexión");
  await page.evaluate(() => {
    const w = window as unknown as { intersect: () => void; calls: string[] };
    w.intersect();
    w.intersect();
  });
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual(["start"]);

  await page.getByRole("button", { name: "Reintentar" }).evaluate((button) => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect(page.locator("article")).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual(["start", "start"]);

  await page.evaluate(() => (window as unknown as { intersect: () => void }).intersect());
  await expect(page.locator("article")).toHaveCount(2);
  expect(await page.locator("article").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-id")))).toEqual(["p1", "p2"]);
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual(["start", "start", "second"]);
  await page.evaluate(() => (window as unknown as { intersect: () => void }).intersect());
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toHaveLength(3);
});

test("Más productos respeta la espera de cuota entregada por el servidor", async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: browserScript });
  await page.evaluate(() => {
    const w = window as unknown as {
      responses: Array<() => Promise<unknown>>;
      mount: () => void;
    };
    w.responses = [
      async () => ({ items: [], nextCursor: null, error: "Cuota excedida", code: "rate_limited", retryAfter: 0.2 }),
      async () => ({ items: [], nextCursor: null }),
    ];
    w.mount();
  });
  await page.evaluate(() => (window as unknown as { intersect: () => void }).intersect());
  await expect(page.getByRole("alert")).toContainText("Demasiadas solicitudes");
  const retry = page.getByRole("button", { name: /Reintentar/ });
  await expect(retry).toBeDisabled();
  await expect(retry).toBeEnabled({ timeout: 2500 });
  await retry.click();
  expect(await page.evaluate(() => (window as unknown as { calls: string[] }).calls)).toEqual(["start", "start"]);
});
