/** S12 Search/Filters/location flow in Chrome using the actual components,
 * storage, GPS callbacks and location validation. Only navigation, MapKit,
 * reverse geocoding and coverage transport are controlled boundaries.
 * This does not certify production, MapKit rendering or physical devices. */
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
const cookiePoint = { lat: 19.041, lng: -98.206, radius: 10000 };
const changedPoint = { lat: 19.072, lng: -98.224 };

async function main() {
  const mocks: Record<string, string> = {
    "next/navigation": `import React,{createContext,useContext,useMemo,useState} from 'react';import {flushSync} from 'react-dom';
      import {readLocation} from '@/lib/geo/location-storage';
      const Context=createContext(null);
      export function Provider({children}) {
        const [snapshot,setSnapshot]=useState(()=>({params:new URLSearchParams(window.f.initial),stored:readLocation()}));
        window.f.setParams=q=>flushSync(()=>setSnapshot({params:new URLSearchParams(q),stored:readLocation()}));
        const router=useMemo(()=>({refresh:()=>{window.f.refreshes++;},push:url=>new Promise(resolve=>{
          window.f.requested.push(url);window.f.pending.push({url,resolve});})}),[]);
        return <Context.Provider value={{...snapshot,router}}>{children}</Context.Provider>;
      }
      export const useRouter=()=>useContext(Context).router;
      export const useSearchParams=()=>useContext(Context).params;
      export const useServerStored=()=>useContext(Context).stored;`,
    "next/dynamic": `import React,{lazy,Suspense} from 'react';export default function dynamic(factory,options){
      const Component=lazy(factory);return props=><Suspense fallback={options?.loading?.()??null}><Component {...props}/></Suspense>;}`,
    "./change-location-map": `import React,{useEffect} from 'react';export default function MapBoundary({lat,lng,onMove}){
      useEffect(()=>{window.f.mapMounts++;},[]);return <div data-testid="location-map-boundary" style={{height:140,padding:16}}>
        <output data-testid="location-center">{lat},{lng}</output>
        <button type="button" onClick={()=>onMove(19.072,-98.224)} style={{display:'block',minHeight:48}}>Elegir punto de prueba</button>
      </div>;}`,
    "@/hooks/use-search-suggestions": `export const useSearchSuggestions=()=>({suggestions:[],loading:false});`,
    "@/lib/geo/cobertura": `export const useReglaCobertura=()=>({modo:'pais'});`,
    "@/lib/geo/apple-geocoder": `export async function reverseGeocodeWithApple(){window.f.geocodes++;return {name:'Zona de prueba',fullName:'Zona de prueba, México'};}`,
    "@/hooks/use-mapkit": `export async function loadMapKitScript(){window.f.sdkLoads++;return false;}`,
    "@/lib/haptics": `export async function hapticSelection(){}`,
  };
  const bundle = await esbuild.build({
    stdin: { resolveDir: web, loader: "tsx", contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {Provider,useSearchParams,useServerStored} from 'next/navigation';
      import {SearchFilters} from './app/(marketplace)/buscar/search-filters';
      import {DiscoveryFilters} from './components/shared/discovery-filters';
      import {parseCoordinates} from './lib/geo/location-storage';import {parseRadiusCookie} from './lib/geo/radius';
      function Harness(){const params=useSearchParams(),stored=useServerStored();
        const [value,setValue]=useState({categories:[],tipo:'',priceMin:'',priceMax:'',nearby:false,radiusMeters:10000});
        if(window.f.mode==='map')return <DiscoveryFilters value={value} multipleCategories showDistance onApply={next=>{window.f.applied.push(next);setValue(next);}}/>;
        const urlPoint=params.get('lat')&&params.get('lng')?parseCoordinates(params.get('lat')+','+params.get('lng')):null;
        const point=urlPoint??stored;
        const position=point?{...point,radius:parseRadiusCookie(urlPoint?params.get('radio')??undefined:String(stored?.radius??10000))}:null;
        return <SearchFilters viewerUniversity={window.f.university} initialPosition={position}
          initialQuery={params.get('q')??undefined} initialCategory={params.get('category')??undefined}
          initialTipo={params.get('tipo')??undefined} initialPriceMin={params.get('price_min')??undefined}
          initialPriceMax={params.get('price_max')??undefined} initialSort={params.get('sort')??undefined}/>;}
      createRoot(document.getElementById('root')).render(<Provider><Harness/></Provider>);
      window.f.confirm=i=>{const n=window.f.pending[i];window.f.setParams(n.url.split('?')[1]??'');n.resolve();};
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_COVERAGE_RADIUS_KM": "undefined" },
    plugins: [{ name: "external-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  const cssPath = path.join(web, "app/globals.css");
  const css = (await postcss([tailwind({ base: web })]).process(readFileSync(cssPath, "utf8"), { from: cssPath })).css;
  const searchPage = readFileSync(path.join(web, "app/(marketplace)/buscar/page.tsx"), "utf8");
  assert.equal(searchPage.includes("LocationMapPreview"), false);
  assert.equal(searchPage.includes("isPublicationMapEnabled"), false);
  console.log("PASS SSR consumer: Search has no preview import/render or feature-gated snapshot consumer");
  let passed = 1;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const viewport of [{ width: 320, height: 812 }, { width: 375, height: 812 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      const errors: string[] = [];
      const external: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", (route: any) => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main style="padding:16px;max-width:600px;margin:auto"><div id="root"></div><button id="outside" style="min-height:48px">Fuera del panel</button></main></body></html>' });
        external.push(route.request().url());
        return route.abort();
      });
      async function mount(initial = "q=cafe&category=tecnologia&tipo=producto&page=3&lat=19.0500&lng=-98.2000&radio=5000", extra = {}, saved: typeof cookiePoint | null = cookiePoint) {
        await page.goto("https://s12-filters.invalid/buscar");
        await page.evaluate(({ initial, extra, saved }) => {
          document.cookie = "vicino_location=; path=/; max-age=0";
          document.cookie = "vicino_radius=; path=/; max-age=0";
          localStorage.clear();
          if (saved) {
            document.cookie = `vicino_location=${saved.lat},${saved.lng}; path=/`;
            document.cookie = `vicino_radius=${saved.radius}; path=/`;
            localStorage.setItem("vicino_last_location", JSON.stringify(saved));
          }
          const f = (window as any).f = { initial, university: "Universidad de prueba", mode: "search", requested: [], pending: [], applied: [], refreshes: 0, mapMounts: 0, sdkLoads: 0, geocodes: 0, gpsCalls: 0, locationEvents: 0, gpsMode: "deny", ...extra };
          Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition(success: any, failure: any) {
            f.gpsCalls++;
            if (f.gpsMode === "deny") failure({ code: 1 });
            else f.resolveGps = () => success({ coords: { latitude: 19.08, longitude: -98.25, accuracy: 20 } });
          } } });
          window.addEventListener("vicino_location_updated", () => { f.locationEvents++; });
        }, { initial, extra, saved });
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await expect(page.getByTestId("discovery-filters-trigger")).toBeVisible();
      }
      const pass = (name: string) => { passed++; console.log(`PASS ${viewport.width}: ${name}`); };
      const snapshot = () => page.evaluate(() => ({ cookie: document.cookie, mirror: localStorage.getItem("vicino_last_location"), events: (window as any).f.locationEvents, requested: (window as any).f.requested, refreshes: (window as any).f.refreshes }));
      const openFilters = () => page.getByTestId("discovery-filters-trigger").click();
      async function openLocation() {
        await page.getByRole("button", { name: "Cambiar ubicación", exact: true }).click();
        await expect(page.getByRole("dialog", { name: "Cambiar ubicación", exact: true })).toBeVisible();
        await expect(page.getByTestId("location-center")).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
      }
      async function returnWithEscape() {
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog", { name: "Filtros", exact: true })).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(1);
        await expect(page.getByRole("button", { name: "Cambiar ubicación", exact: true })).toBeFocused();
      }

      await mount();
      assert.equal(await page.evaluate(() => (window as any).f.mapMounts + (window as any).f.gpsCalls + (window as any).f.geocodes + (window as any).f.sdkLoads), 0);
      await expect(page.getByRole("searchbox", { name: "Buscar en VICINO" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cambiar ubicación", exact: true })).toHaveCount(0);
      await openFilters();
      const locationBox = await page.getByRole("button", { name: "Cambiar ubicación", exact: true }).boundingBox();
      assert.ok(locationBox && locationBox.height >= 48);
      await page.getByRole("button", { name: "Servicios", exact: true }).click();
      await page.getByRole("spinbutton", { name: "Precio mínimo" }).fill("100");
      await page.getByRole("spinbutton", { name: "Precio máximo" }).fill("900");
      await page.getByRole("combobox", { name: "Ordenar por" }).selectOption("price_desc");
      const before = await snapshot();
      await openLocation();
      await expect(page.getByTestId("location-center")).toHaveText("19.05,-98.2");
      await expect.poll(() => page.evaluate(() => {
        const sheet = document.querySelector('[role="dialog"][aria-label="Cambiar ubicación"]');
        return Boolean(sheet?.contains(document.activeElement));
      })).toBe(true);
      await page.evaluate(() => document.getElementById("outside")!.focus());
      assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Cambiar ubicación"]')?.contains(document.activeElement)), true);
      const tabTargets = await page.getByRole("dialog").evaluate((dialog: Element) => [...dialog.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex='0']")].filter((element) => element.getClientRects().length > 0).length);
      for (let i = 0; i < tabTargets + 2; i++) await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"][aria-label="Cambiar ubicación"]')?.contains(document.activeElement)), true);
      await returnWithEscape();
      assert.deepEqual(await snapshot(), before);
      await expect(page.getByRole("spinbutton", { name: "Precio mínimo" })).toHaveValue("100");
      await expect(page.getByRole("button", { name: "Servicios", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("combobox", { name: "Ordenar por" })).toHaveValue("price_desc");
      pass("Search mounts no map/GPS; one dialog; URL center/radius wins; focus trapped; Escape retains filter draft without writes");

      await openLocation();
      await page.getByRole("button", { name: /Usar mi ubicación actual/ }).click();
      await expect(page.getByText("Permiso de ubicación denegado", { exact: true })).toBeVisible();
      assert.equal(await page.evaluate(() => (window as any).f.gpsCalls), 1);
      await returnWithEscape();
      assert.deepEqual(await snapshot(), before);
      await expect(page.getByRole("spinbutton", { name: "Precio mínimo" })).toHaveValue("100");
      pass("denied GPS remains local and returns to unchanged filters, cookie, URL and pagination");

      await openLocation();
      await page.getByRole("button", { name: "Elegir punto de prueba", exact: true }).click();
      await expect(page.getByRole("button", { name: "Aplicar ubicación", exact: true })).toBeVisible();
      assert.deepEqual(await snapshot(), before);
      await returnWithEscape();
      assert.deepEqual(await snapshot(), before);
      await openLocation();
      await expect(page.getByTestId("location-center")).toHaveText("19.05,-98.2");
      await page.evaluate(() => { (window as any).f.gpsMode = "defer"; });
      await page.getByRole("button", { name: /Usar mi ubicación actual/ }).click();
      await returnWithEscape();
      await page.evaluate(() => (window as any).f.resolveGps());
      await expect(page.getByRole("button", { name: "Cambiar ubicación", exact: true })).toBeFocused();
      assert.deepEqual(await snapshot(), before);
      pass("pin edit is deferred; canceled edits and late GPS callback never replace the saved zone");

      await openLocation();
      await page.getByRole("button", { name: "Elegir punto de prueba", exact: true }).click();
      await page.getByRole("dialog").getByRole("combobox").selectOption("25000");
      await page.getByRole("button", { name: "Aplicar ubicación", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Filtros", exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Cambiar ubicación", exact: true })).toBeFocused();
      const saved = await snapshot();
      assert.equal(saved.events, 1);
      const mirror = JSON.parse(saved.mirror!);
      assert.equal(mirror.lat, changedPoint.lat);
      assert.equal(mirror.lng, changedPoint.lng);
      assert.equal(mirror.radius, 25000);
      assert.equal(saved.requested.length, 1);
      const locationUrl = new URL(saved.requested[0], "https://s12-filters.invalid");
      assert.equal(locationUrl.searchParams.get("q"), "cafe");
      assert.equal(locationUrl.searchParams.get("category"), "tecnologia");
      assert.equal(locationUrl.searchParams.get("tipo"), "producto");
      for (const key of ["lat", "lng", "radio", "page"]) assert.equal(locationUrl.searchParams.has(key), false);
      await expect(page.getByRole("spinbutton", { name: "Precio mínimo" })).toHaveValue("100");
      await page.evaluate(() => (window as any).f.confirm(0));
      await expect(page.getByRole("button", { name: "Aplicar", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      const filterUrl = new URL(await page.evaluate(() => (window as any).f.requested[1]), "https://s12-filters.invalid");
      assert.equal(filterUrl.searchParams.get("q"), "cafe");
      assert.equal(filterUrl.searchParams.get("category"), "tecnologia");
      assert.equal(filterUrl.searchParams.get("tipo"), "servicio");
      assert.equal(filterUrl.searchParams.get("price_min"), "100");
      assert.equal(filterUrl.searchParams.get("price_max"), "900");
      assert.equal(filterUrl.searchParams.get("sort"), "price_desc");
      assert.equal(filterUrl.searchParams.has("lat"), false);
      assert.equal(filterUrl.searchParams.has("page"), false);
      assert.equal(await page.evaluate(() => (window as any).f.requested.length), 2);
      await page.evaluate(() => (window as any).f.confirm(1));
      await expect(page.getByTestId("discovery-filters-trigger")).toBeFocused();
      pass("explicit location Apply writes once, clears old URL override/page; filter draft applies atomically afterward");

      await mount("q=cafe&page=3");
      await openFilters();
      await page.getByRole("spinbutton", { name: "Precio mínimo" }).fill("123");
      await openLocation();
      await page.getByRole("button", { name: "Elegir punto de prueba", exact: true }).click();
      await page.getByRole("button", { name: "Aplicar ubicación", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Filtros", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cancelar", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await openFilters();
      await expect(page.getByRole("spinbutton", { name: "Precio mínimo" })).toHaveValue("");
      await openLocation();
      await expect(page.getByTestId("location-center")).toHaveText("19.072,-98.224");
      assert.equal(await page.evaluate(() => (window as any).f.locationEvents), 1);
      assert.deepEqual(await page.evaluate(() => (window as any).f.requested), []);
      await returnWithEscape();
      pass("Cancel discards only the filter draft after a separately confirmed zone; saved zone immediately seeds reopening");

      await mount("", {}, null);
      await page.evaluate(() => document.documentElement.classList.add("dark"));
      await openFilters();
      await expect(page.getByText("Todo México", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Universidad", exact: true })).toBeEnabled();
      const emptyBefore = await snapshot();
      await openLocation();
      await expect(page.getByRole("button", { name: "Cerrar", exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Cerrar", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Filtros", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cambiar ubicación", exact: true })).toBeFocused();
      assert.deepEqual(await snapshot(), emptyBefore);
      assert.equal(await page.evaluate(() => (window as any).f.gpsCalls), 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      const applyBox = await page.getByRole("button", { name: "Aplicar", exact: true }).boundingBox();
      assert.ok(applyBox && applyBox.height >= 48 && applyBox.y + applyBox.height <= viewport.height);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByTestId("discovery-filters-trigger")).toBeFocused();
      assert.equal(await page.evaluate(() => document.body.style.overflow), "");
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY), "visible");
      pass("no zone stays Todo México without automatic persistence; dark layout/footer and scroll/focus recover after closing");

      await mount("", { mode: "map" });
      await openFilters();
      await expect(page.getByRole("button", { name: "Cambiar ubicación", exact: true })).toHaveCount(0);
      await page.locator("[data-categoria-slug]").nth(0).click();
      await page.locator("[data-categoria-slug]").nth(1).click();
      await page.getByRole("checkbox", { name: "Limitar al radio elegido" }).check();
      await page.getByRole("slider", { name: "Radio de búsqueda en kilómetros" }).fill("25");
      assert.deepEqual(await page.evaluate(() => (window as any).f.applied), []);
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      const mapValues = await page.evaluate(() => (window as any).f.applied[0]);
      assert.equal(mapValues.categories.length, 2);
      assert.equal(mapValues.radiusMeters, 25000);
      assert.equal(mapValues.nearby, true);
      pass("optional Search location action does not alter Map multi-category/distance Apply");
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`S12 filters: ${passed}/${passed} PASS; actual components/storage, controlled navigation/MapKit`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
