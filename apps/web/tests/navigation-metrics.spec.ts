import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
const requireLocal = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] }));
type Fixture = Window & { navigationFixture: { ready: (kind: string, token: string) => void; reset: () => void } };
let script: string;
test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const router = `import React,{createContext,useContext,useState} from 'react';
    const Context=createContext(0);let update;
    export function Provider({children}){const [value,setValue]=useState(0);update=()=>setValue(v=>v+1);return React.createElement(Context.Provider,{value},children);}
    export const usePathname=()=>{useContext(Context);return location.pathname;};
    export const useSearchParams=()=>{useContext(Context);return new URLSearchParams(location.search);};
    export const navigate=href=>{history.pushState(null,'',href);update();};`;
  const result = await esbuild.build({
    stdin: { contents: `import React,{Suspense,useState} from 'react';import {createRoot} from 'react-dom/client';
      import {Provider,navigate} from 'next/navigation';import {NavigationMetrics} from './components/layout/navigation-metrics';
      window.navigationFixture={};function App(){const [marker,setMarker]=useState({kind:'home',token:'initial'});const [identity,setIdentity]=useState(0);
        window.navigationFixture.ready=(kind,token)=>setMarker({kind,token});window.navigationFixture.reset=()=>setIdentity(v=>v+1);
        return <Provider><Suspense fallback={null}><NavigationMetrics key={identity}/></Suspense>
          <a id="go" href="/perfil" onClick={event=>{event.preventDefault();navigate(event.currentTarget.href);}}>Navigate</a>
          <div data-navigation-kind={marker.kind} data-navigation-ready={marker.token}>Core content</div>
        </Provider>;}
      createRoot(document.getElementById('root')).render(<App/>);`, loader: "tsx", resolveDir: web },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "local-router", setup(build: {
      onResolve: (options: object, callback: () => unknown) => void;
      onLoad: (options: object, callback: () => unknown) => void;
    }) {
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: "router", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: router, loader: "js", resolveDir: web }));
    } }],
  });
  script = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().url() === "http://localhost/"
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("http://localhost/");
  await page.addScriptTag({ content: script });
  await expect.poll(() => page.evaluate(() => Boolean(window.__vicinoNavigationMetrics))).toBe(true);
});
test("URL commit alone is insufficient; a new core marker finishes the sample", async ({ page }) => {
  await page.getByRole("link", { name: "Navigate" }).click();
  await expect(page).toHaveURL("http://localhost/perfil");
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => window.__vicinoNavigationMetrics!())).toEqual([]);
  await page.evaluate(() => (window as Fixture).navigationFixture.ready("profile", "new-profile"));
  await expect.poll(() => page.evaluate(() => window.__vicinoNavigationMetrics!().length)).toBe(1);
  const sample = await page.evaluate(() => window.__vicinoNavigationMetrics!()[0]);
  expect(sample.result).toBe("ready");
  expect(sample.core_dom_ms!).toBeGreaterThan(sample.route_commit_ms!);
  expect(sample.feedback_ms).toBeNull();
});
test("query-only navigation requires a fresh marker and exported data never contains the query", async ({ page }) => {
  await page.locator("#go").evaluate(node => node.setAttribute("href", "/buscar?q=secret%20person"));
  await page.getByRole("link").click();
  await page.evaluate(() => (window as Fixture).navigationFixture.ready("search", "search-one"));
  await expect.poll(() => page.evaluate(() => window.__vicinoNavigationMetrics!().length)).toBe(1);
  await page.locator("#go").evaluate(node => node.setAttribute("href", "/buscar?q=secret%20address"));
  await page.getByRole("link").click();
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.__vicinoNavigationMetrics!().length)).toBe(1);
  await page.evaluate(() => (window as Fixture).navigationFixture.ready("search", "search-two"));
  await expect.poll(() => page.evaluate(() => window.__vicinoNavigationMetrics!().length)).toBe(2);
  expect(await page.evaluate(() => JSON.stringify(window.__vicinoNavigationMetrics!()))).not.toMatch(/secret|person|address|q=/);
  await page.evaluate(() => (window as Fixture).navigationFixture.reset());
  await expect.poll(() => page.evaluate(() => window.__vicinoNavigationMetrics!().length)).toBe(0);
});
