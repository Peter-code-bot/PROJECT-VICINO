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
        import { useMapKit, loadMapKitScript } from './hooks/use-mapkit';
        function Probe() {
          const state = useMapKit();
          return React.createElement('div', null,
            React.createElement('p', {id:'status'}, !state.isReady ? 'loading' : state.isAvailable ? 'available' : 'unavailable'),
            React.createElement('p', {id:'reason'}, state.failure?.reason ?? 'none'),
            React.createElement('button', {onClick:state.retry, disabled:state.retryWaitSeconds > 0}, 'Reintentar'));
        }
        const root = createRoot(document.getElementById('root'));
        window.start = async () => { await loadMapKitScript(true); flushSync(() => root.render(React.createElement(Probe))); };
        window.triggerAuth = () => new Promise(resolve => window.mapkit.callback(token => {window.tokens.push(token); resolve(token);}));`,
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
      name: "sentry-stub",
      setup(build: {
        onResolve: (options: { filter: RegExp }, callback: (args: { path: string }) => object) => void;
        onLoad: (options: { filter: RegExp; namespace: string }, callback: () => object) => void;
      }) {
        build.onResolve({ filter: /^@sentry\/nextjs$/ }, ({ path: file }) => ({ path: file, namespace: "test-stub" }));
        build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({ contents: "export const captureMessage = () => {};", loader: "js" }));
      },
    }],
  });
  browserScript = result.outputFiles[0].text;
});

test("un 429 durante refresco termina el callback y permite reautorizar MapKit", async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: browserScript });
  await page.evaluate(() => {
    const w = window as unknown as {
      tokens: string[];
      responses: Array<() => Promise<Response>>;
      mapkit: { init: (options: { authorizationCallback: (done: (token: string) => void) => void }) => void; callback?: (done: (token: string) => void) => void; inits: number };
      start: () => Promise<void>;
    };
    w.tokens = [];
    w.responses = [
      async () => new Response(JSON.stringify({ token: "first" }), { status: 200 }),
      async () => new Response(JSON.stringify({ error: "limited" }), { status: 429, headers: { "Retry-After": "1" } }),
      async () => new Response(JSON.stringify({ token: "recovered" }), { status: 200 }),
    ];
    w.mapkit = {
      inits: 0,
      init(options) { this.callback = options.authorizationCallback; this.inits++; },
    };
    window.fetch = () => w.responses.shift()!();
  });
  await page.evaluate(() => (window as unknown as { start: () => Promise<void> }).start());
  await expect(page.locator("#status")).toHaveText("available");
  const first = await page.evaluate(() => (window as unknown as { triggerAuth: () => Promise<string> }).triggerAuth());
  expect(first).toBe("first");
  const failed = await page.evaluate(() => (window as unknown as { triggerAuth: () => Promise<string> }).triggerAuth());
  expect(failed).toBe("");
  await expect(page.locator("#status")).toHaveText("unavailable");
  await expect(page.locator("#reason")).toHaveText("rate_limited");
  await expect(page.getByRole("button", { name: "Reintentar" })).toBeEnabled({ timeout: 3000 });
  await page.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.locator("#status")).toHaveText("available");
  expect(await page.evaluate(() => {
    const w = window as unknown as { mapkit: { inits: number }; tokens: string[] };
    return { inits: w.mapkit.inits, tokens: w.tokens };
  })).toEqual({ inits: 2, tokens: ["first", ""] });
});
