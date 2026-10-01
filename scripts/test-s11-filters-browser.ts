/** Actual React filters in Chrome; only Next navigation and suggestions are seams.
 * These are isolated UI checks, not production or physical-device acceptance. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const web = path.resolve(__dirname, "../apps/web");
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const postcss = req(req.resolve("postcss", { paths: [req.resolve("@tailwindcss/postcss")] }));
const tailwind = req("@tailwindcss/postcss");
const { chromium, expect } = req("@playwright/test");

async function main() {
  const mocks: Record<string, string> = {
    "next/navigation": `import React,{createContext,useContext,useMemo,useState} from 'react';import {flushSync} from 'react-dom';
      const Context=createContext(null);
      export function Provider({children}) {
        const [params,setParams]=useState(()=>new URLSearchParams(window.f.initial));
        window.f.setParams=q=>flushSync(()=>setParams(new URLSearchParams(q)));
        const router=useMemo(()=>({push:url=>new Promise(resolve=>{window.f.requested.push(url);window.f.pending.push({url,resolve});})}),[]);
        return <Context.Provider value={{params,router}}>{children}</Context.Provider>;
      }
      export const useRouter=()=>useContext(Context).router;
      export const useSearchParams=()=>useContext(Context).params;`,
    "@/hooks/use-search-suggestions": `export const useSearchSuggestions=()=>({suggestions:[],loading:false});`,
  };
  const bundle = await esbuild.build({
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {Provider,useSearchParams} from 'next/navigation';
      import {SearchFilters} from './app/(marketplace)/buscar/search-filters';import {DiscoveryFilters} from './components/shared/discovery-filters';
      function Harness(){const params=useSearchParams();const [value,setValue]=useState({categories:[],tipo:'',priceMin:'',priceMax:'',nearby:false,radiusMeters:10000});
        if(window.f.mode==='map')return <DiscoveryFilters value={value} multipleCategories showDistance onApply={next=>{window.f.applied.push(next);setValue(next);}}/>;
        return <SearchFilters viewerUniversity={window.f.university} initialQuery={params.get('q')??undefined} initialCategory={params.get('category')??undefined}
          initialTipo={params.get('tipo')??undefined} initialPriceMin={params.get('price_min')??undefined} initialPriceMax={params.get('price_max')??undefined} initialSort={params.get('sort')??undefined}/>;}
      const root=createRoot(document.getElementById('root'));root.render(<Provider><Harness/></Provider>);
      window.f.confirm=i=>{const n=window.f.pending[i];window.f.setParams(n.url.split('?')[1]??'');n.resolve();};
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "navigation-boundary", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  const cssPath = path.join(web, "app/globals.css");
  const css = (await postcss([tailwind({ base: web })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let passed = 0;
  try {
    for (const viewport of [{ width: 320, height: 812 }, { width: 375, height: 812 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", (route: any) => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main style="padding:16px;max-width:600px;margin:auto"><div id="root"></div></main></body></html>' })
        : route.abort());
      async function mount(initial = "q=cafe&page=3&lat=19.0400&lng=-98.2100&radio=5000", extra = {}) {
        await page.goto("https://s11-filters.invalid/buscar");
        await page.evaluate(({ initial, extra }) => {
          (window as any).f = { initial, university: "Universidad de prueba", mode: "search", requested: [], pending: [], applied: [], ...extra };
        }, { initial, extra });
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await expect(page.getByTestId("discovery-filters-trigger")).toBeVisible();
      }
      const pass = (name: string) => { passed++; console.log(`PASS ${viewport.width}: ${name}`); };

      await mount();
      await page.getByTestId("discovery-filters-trigger").click();
      await page.getByRole("button", { name: "Servicios", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Precio mínimo" }).fill("100");
      await page.getByRole("spinbutton", { name: "Precio máximo" }).fill("500");
      await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("price_desc");
      assert.deepEqual(await page.evaluate(() => (window as any).f.requested), []);
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId("discovery-filters-trigger")).toBeFocused();
      await page.getByTestId("discovery-filters-trigger").click();
      await expect(page.getByRole("spinbutton", { name: "Precio mínimo" })).toHaveValue("");
      await expect(page.getByRole("button", { name: "Todo", exact: true })).toHaveAttribute("aria-pressed", "true");
      pass("draft and Cancel make no navigation; reopening discards edits and restores focus");

      await page.getByRole("button", { name: "Servicios", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Precio mínimo" }).fill("500");
      await page.getByRole("spinbutton", { name: "Precio máximo" }).fill("100");
      await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeDisabled();
      await expect(page.getByRole("alert")).toBeVisible();
      await page.getByRole("spinbutton", { name: "Precio máximo" }).fill("900");
      await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("price_desc");
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      const atomic = new URL(await page.evaluate(() => (window as any).f.requested[0]), "https://s11-filters.invalid");
      assert.equal(atomic.searchParams.get("q"), "cafe");
      assert.equal(atomic.searchParams.get("tipo"), "servicio");
      assert.equal(atomic.searchParams.get("price_min"), "500");
      assert.equal(atomic.searchParams.get("price_max"), "900");
      assert.equal(atomic.searchParams.get("sort"), "price_desc");
      assert.equal(atomic.searchParams.has("page"), false);
      assert.equal(await page.evaluate(() => (window as any).f.requested.length), 1);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("vicino_location_updated", { detail: null })));
      const concurrent = new URL(await page.evaluate(() => (window as any).f.requested[1]), "https://s11-filters.invalid");
      assert.equal(concurrent.searchParams.get("price_min"), "500");
      assert.equal(concurrent.searchParams.get("sort"), "price_desc");
      assert.equal(concurrent.searchParams.has("lat"), false);
      assert.equal(concurrent.searchParams.has("lng"), false);
      assert.equal(concurrent.searchParams.has("radio"), false);
      await page.evaluate(() => (window as any).f.confirm(1));
      await page.evaluate(() => (window as any).f.pending[0].resolve());
      pass("invalid range blocked; one atomic Apply; zone clear preserves pending filters and removes legacy GPS");

      const search = page.getByRole("searchbox", { name: "Buscar en VICINO" });
      await search.fill("nuevo");
      await search.press("Enter");
      await page.evaluate(() => (window as any).f.confirm(2));
      await expect(search).toHaveValue("nuevo");
      await page.evaluate(() => (window as any).f.setParams("q=cafe"));
      await expect(search).toHaveValue("cafe");
      await page.evaluate(() => (window as any).f.setParams("q=nuevo"));
      await expect(search).toHaveValue("nuevo");
      pass("search draft stays aligned with server props across Back and Forward");

      await mount("q=libros&category=universidad&subcategory=tecnologia&sort=price_asc");
      await page.getByTestId("discovery-filters-trigger").click();
      await expect(page.getByRole("combobox", { name: "Categoría en tu universidad" })).toHaveValue("tecnologia");
      await page.getByRole("button", { name: "Todas", exact: true }).click();
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      const university = new URL(await page.evaluate(() => (window as any).f.requested[0]), "https://s11-filters.invalid");
      assert.equal(university.searchParams.has("category"), false);
      assert.equal(university.searchParams.has("subcategory"), false);
      assert.equal(university.searchParams.get("sort"), "price_asc");
      pass("university subcategory survives opening and clears when selecting all categories");

      await mount("", { university: null });
      await page.getByTestId("discovery-filters-trigger").click();
      await expect(page.getByRole("button", { name: "Universidad", exact: true })).toBeDisabled();
      await expect(page.getByText("Universidad requiere una universidad verificada en tu cuenta.")).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const applyBox = await page.getByRole("button", { name: "Aplicar", exact: true }).boundingBox();
      assert.ok(applyBox && applyBox.height >= 48 && applyBox.y + applyBox.height <= viewport.height);
      await page.keyboard.press("Escape");
      await expect(page.getByTestId("discovery-filters-trigger")).toBeFocused();
      pass("membership unavailable, keyboard close, footer reachable and no horizontal overflow");

      await mount("", { mode: "map" });
      await page.getByTestId("discovery-filters-trigger").click();
      await page.locator("[data-categoria-slug]").nth(0).click();
      await page.locator("[data-categoria-slug]").nth(1).click();
      await page.getByRole("checkbox", { name: "Limitar al radio elegido" }).check();
      await page.getByRole("slider", { name: "Radio de búsqueda en kilómetros" }).fill("25");
      assert.deepEqual(await page.evaluate(() => (window as any).f.applied), []);
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      const mapFilters = await page.evaluate(() => (window as any).f.applied[0]);
      assert.equal(mapFilters.categories.length, 2);
      assert.equal(mapFilters.nearby, true);
      assert.equal(mapFilters.radiusMeters, 25000);
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await expect.poll(() => page.getByTestId("discovery-filters-trigger").evaluate((element: Element) => getComputedStyle(element).backgroundColor)).toBe("rgb(18, 18, 18)");
      await expect.poll(() => page.getByTestId("discovery-filters-trigger").evaluate((element: Element) => getComputedStyle(element).color)).toBe("rgb(244, 241, 235)");
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.getByTestId("discovery-filters-trigger").click();
      assert.equal(await page.getByRole("dialog").evaluate((element: Element) => getComputedStyle(element).animationName), "none");
      pass("map multi-category/distance draft applies once; black selection and reduced motion in dark theme");
      await expect(page.getByRole("button", { name: "Todo", exact: true }).locator("[data-selected-indicator]")).toBeVisible();
      await page.getByRole("button", { name: "Servicios", exact: true }).click();
      await expect(page.getByRole("button", { name: "Servicios", exact: true }).locator("[data-selected-indicator]")).toBeVisible();
      await expect(page.getByRole("button", { name: "Todo", exact: true }).locator("[data-selected-indicator]")).toHaveCount(0);
      await page.getByRole("button", { name: "Todas", exact: true }).click();
      await expect(page.getByRole("button", { name: "Todas", exact: true }).locator("[data-selected-indicator]")).toBeVisible();
      pass("dark selection has a visible check independent of the identical charcoal backgrounds");
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`S11 filters: ${passed}/${passed} PASS; actual components, controlled navigation`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
