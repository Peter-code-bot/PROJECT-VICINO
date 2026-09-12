import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
const requireLocal = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] }));
type Fixture = Window & { finalFixture: { calls: string[]; pauses: number } };
let script: string;
test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const mocks: Record<string, string> = {
    "next/navigation": `import React,{createContext,useContext,useState,useEffect} from 'react';
      const Context=createContext(0);const router={prefetch:href=>window.finalFixture.calls.push(href)};
      export function Provider({children}){const [v,set]=useState(0);useEffect(()=>{const original=history.pushState;const update=()=>set(v=>v+1);history.pushState=function(...args){original.apply(this,args);update()};window.addEventListener('popstate',update);return()=>{history.pushState=original;window.removeEventListener('popstate',update)}},[]);return React.createElement(Context.Provider,{value:v},children)}
      export const useSearchParams=()=>{useContext(Context);return new URLSearchParams(location.search)};
      export const usePathname=()=>{useContext(Context);return location.pathname};export const useRouter=()=>router;`,
    "next/link": "import React from 'react';export default function Link({children,...props}){return <a {...props}>{children}</a>}",
    "@/lib/haptics": "export async function hapticSelection(){}",
  };
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {Provider} from 'next/navigation';
      import {HomeCategoryOrder} from './components/home/home-category-order';import {NavigationPrefetch} from './components/layout/navigation-prefetch';import {VisibleVideo} from './components/product/visible-video';
      window.finalFixture={calls:[],pauses:0};HTMLMediaElement.prototype.pause=function(){window.finalFixture.pauses++};
      createRoot(document.getElementById('root')).render(<Provider><NavigationPrefetch authenticated/>
        <a data-tab-prefetch href="/buscar">Buscar</a><a data-tab-prefetch href="/chat?seller=x">Contacto</a>
        <HomeCategoryOrder rows={['ropa','comida'].map(slug=>({slug,name:slug,content:<div data-row={slug}><input aria-label={slug+' draft'} defaultValue="draft"/></div>}))} intro={<div data-row="intro"/>} recent={<div data-row="recent"/>} tail={null} empty={<div>empty</div>}/>
        <div id="video-container"><VisibleVideo controls style={{width:100,height:100}}/></div>
      </Provider>);`, loader: "tsx", resolveDir: web },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "fixtures", setup(build: {
      onResolve: (options: object, callback: (args: { path: string }) => unknown) => void;
      onLoad: (options: object, callback: (args: { path: string }) => unknown) => void;
    }) {
      build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: web }));
    } }],
  });
  script = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.request().url() === "http://localhost/"
    ? route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }) : route.abort());
  await page.goto("http://localhost/");
  await page.addScriptTag({ content: script });
  await expect(page.getByRole("button", { name: "ropa", exact: true })).toBeVisible();
});
test("categories reorder local slots, preserve the draft and support Back", async ({ page }) => {
  await page.getByLabel("ropa draft").fill("keep me");
  await page.getByRole("button", { name: "comida", exact: true }).click();
  await page.getByRole("button", { name: "ropa", exact: true }).click();
  await expect(page).toHaveURL(/cats=comida%2Cropa/);
  expect(await page.locator("[data-row]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-row")))).toEqual(["comida", "ropa", "intro", "recent"]);
  await expect(page.getByLabel("ropa draft")).toHaveValue("keep me");
  await page.goBack();
  await expect(page.getByRole("button", { name: "ropa", exact: true })).toHaveAttribute("aria-pressed", "false");
  expect(await page.locator("[data-row]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-row")))).toEqual(["comida", "intro", "recent", "ropa"]);
});
test("tab prefetch deduplicates intents and excludes contact query URLs", async ({ page }) => {
  await page.waitForTimeout(400);
  await page.getByRole("link", { name: "Buscar", exact: true }).dispatchEvent("pointerover");
  await page.getByRole("link", { name: "Buscar", exact: true }).dispatchEvent("focusin");
  await page.getByRole("link", { name: "Contacto" }).dispatchEvent("pointerover");
  expect(await page.evaluate(() => (window as Fixture).finalFixture.calls)).toEqual(["/buscar"]);
});
test("hidden video pauses and returning does not resume playback", async ({ page }) => {
  await page.locator("video").scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  await page.evaluate(() => { (window as Fixture).finalFixture.pauses = 0; document.getElementById("video-container")!.style.display = "none"; });
  await expect.poll(() => page.evaluate(() => (window as Fixture).finalFixture.pauses)).toBeGreaterThan(0);
  await page.evaluate(() => { document.getElementById("video-container")!.style.display = "block"; });
  expect(await page.locator("video").evaluate(video => (video as HTMLVideoElement).paused)).toBe(true);
});
