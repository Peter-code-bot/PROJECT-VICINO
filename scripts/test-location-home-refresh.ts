/** Real HomeSession, SessionDataProvider/cache, preview, ZoneCard, sheet and
 * storage. SDK/geocoder, Auth subscription and transport are controlled seams. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const web = path.resolve(__dirname, "../apps/web"), req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, expect } = req("@playwright/test");

async function main() {
  const mocks: Record<string, string> = {
    "next/navigation": `const router={refresh:()=>window.f.refreshes++,prefetch:()=>{},push:()=>{}};export const useRouter=()=>router;export const usePathname=()=>'/';const params=new URLSearchParams();export const useSearchParams=()=>params;`,
    "next/link": `import React from 'react';export default function Link({children,prefetch,...props}){return <a {...props}>{children}</a>;}`,
    "next/image": `import React from 'react';export default function Image({fill,priority,...props}){return <img {...props}/>;}`,
    "next/dynamic": `import React,{lazy,Suspense} from 'react';export default function dynamic(load){const C=lazy(load);return props=><Suspense fallback={null}><C {...props}/></Suspense>;}`,
    "next-themes": `export const useTheme=()=>({resolvedTheme:'light'});`,
    "@/lib/supabase/client": `export const createClient=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}});`,
    "@/lib/geo/cobertura": `export const useReglaCobertura=()=>({modo:'pais'});`,
    "@/lib/geo/apple-geocoder": `export const reverseGeocodeWithApple=async()=>({name:'Zona',fullName:'Zona, México'});`,
    "@/lib/geo/location-search": `export const clasificarResultado=p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=14.5&&p.lat<=32.8?'ok':'coordenadas';export const searchLocations=async()=>({results:[]});export const resolveLocationCoordinates=async p=>p;`,
    "@/lib/haptics": `export const hapticSelection=async()=>{};export const hapticLight=hapticSelection,hapticMedium=hapticSelection;`,
    "./change-location-map": `import React,{useEffect} from 'react';export default function Map({lat,lng,onMove}){useEffect(()=>{window.f.mapMounts++;},[]);return <div data-testid="map"><output>{lat},{lng}</output><button onClick={()=>onMove(19.07238,-98.22414)}>Elegir punto</button></div>;}`,
    "@/components/shared/loading-skeletons": `import React from 'react';export const SkeletonRejilla=()=> <p data-testid="home-skeleton">Cargando publicaciones</p>;`,
  };
  // Unrelated feed content is outside this lifecycle regression.
  for (const [module, names] of Object.entries({
    "@/components/home/home-category-order": ["HomeCategoryOrder"],
    "@/components/home/guest-auth-cta": ["GuestAuthCta"],
    "@/components/home/guest-home-feeds": ["GuestRequestsFeed", "GuestCommunitiesFeed"],
    "@/components/home/product-carousel": ["ProductCarousel"],
    "@/components/home/mas-productos": ["MasProductos"],
    "@/components/shared/location-bar": ["LocationBar"],
    "@/components/home/following-rail": ["FollowingRail"],
    "@/components/home/store-post": ["StorePost"],
    "@/components/solicitudes/solicitudes-feed": ["SolicitudesFeed"],
    "@/components/shared/follow-button": ["FollowButton"],
    "@/components/shared/catalog-query-state": ["CatalogQueryState"],
    "@/components/comunidades/comunidades-feed": ["ComunidadesFeed"],
  })) mocks[module] = names.map(name => `export const ${name}=()=>null;`).join("\n");
  const result = await esbuild.build({ stdin: { resolveDir: web, loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {HomeSession} from './app/(marketplace)/home-session';
    import {SessionDataProvider} from './components/layout/session-data-provider';
    import {readLocation} from './lib/geo/location-storage';
    const f=window.f;
    const value=()=>({feed:'parati',user:{id:'fixture-user'},userLat:readLocation()?.lat??null,userLng:readLocation()?.lng??null,validRadius:readLocation()?.radius??10000,hasLocation:true,viewerUniversity:null,universityProducts:[],universityCarousels:[],categoryCarousels:[],all:[],nearbyStores:[],followingPosts:[],followedStoresData:[],feedResultado:{failure:null},cercaDeTiResultado:{products:[]},comunidades:{},noFollows:true});
    window.fetch=(url,options)=>{if(String(url).startsWith('/api/session/home'))return new Promise(resolve=>{f.requests.push({url,resolve});});return Promise.resolve(new Response('',{status:503}));};
    f.success=index=>f.requests[index].resolve(new Response(JSON.stringify({userId:'fixture-user',value:value()}),{headers:{'Content-Type':'application/json'}}));
    f.fail=index=>f.requests[index].resolve(new Response('',{status:503}));
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail)=>f.gps.push({ok,fail})}});
    createRoot(document.getElementById('root')).render(<SessionDataProvider userId="fixture-user" revision="fixture"><HomeSession ranking={null}/></SessionDataProvider>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "boundaries", setup(build: any) {
    build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
  } }] });
  const cssDir = path.join(web, ".next/static/css");
  const css = readdirSync(cssDir).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(cssDir, file), "utf8")).join("\n");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const viewport of [{ width: 375, height: 812 }, { width: 1280, height: 900 }]) {
      const page = await browser.newPage({ viewport });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.addInitScript("window.__name=(value)=>value;");
      const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", (route: any) => route.request().isNavigationRequest()
        ? route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
        : route.abort());
      await page.goto("https://location-lifecycle.invalid/");
      await page.evaluate(() => {
        (window as any).f = { requests: [], refreshes: 0, mapMounts: 0, gps: [] };
        document.cookie = "vicino_location=19.040,-98.200; path=/";
        document.cookie = "vicino_radius=10000; path=/";
        localStorage.setItem("vicino_last_location", JSON.stringify({lat:19.04,lng:-98.2,radius:10000,name:"Anterior"}));
        localStorage.setItem("vicino_recent_locations", JSON.stringify([
          {lat:19.4331,lng:-99.1331,name:"Centro",fullName:"Centro, Ciudad de México",timestamp:3},
          {lat:19.4334,lng:-99.1334,name:"Centro duplicado",fullName:"Centro duplicado, CDMX",timestamp:2},
          {lat:19.0431,lng:-98.2031,name:"Centro",fullName:"Centro, Puebla",timestamp:1},
        ]));
      });
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: result.outputFiles[0].text });
      await expect.poll(() => page.evaluate(() => (window as any).f.requests.length)).toBe(1);
      await page.evaluate(() => (window as any).f.success(0));
      await expect(page.locator('[data-navigation-ready]')).toBeVisible();
      await page.getByRole("button", { name: /^Cambiar ubicación:/ }).click();
      const dialog = page.getByRole("dialog", { name: "Cambiar ubicación" });
      await expect(dialog).toBeVisible();
      await expect(page.getByText("Centro, Ciudad de México", {exact:true})).toBeVisible();
      await expect(page.getByText("Centro duplicado, CDMX", {exact:true})).toHaveCount(0);
      await expect(page.getByText("Centro, Puebla", {exact:true})).toBeVisible();
      await page.evaluate(() => { (window as any).f.dialog = document.querySelector('[role="dialog"]'); });
      await page.getByRole("button", { name: "Elegir punto", exact: true }).click();
      await expect(page.getByTestId("home-skeleton")).toBeVisible();
      await expect(dialog).toBeVisible();
      assert.equal(await page.evaluate(() => (window as any).f.dialog === document.querySelector('[role="dialog"]')), true);
      await expect.poll(() => page.evaluate(() => (window as any).f.requests.length)).toBe(2);
      await page.evaluate(() => (window as any).f.fail(1));
      await expect(page.getByText("No se pudo actualizar. Intenta de nuevo.", {exact:false})).toBeVisible();
      assert.equal(await page.evaluate(() => (window as any).f.dialog === document.querySelector('[role="dialog"]')), true);
      await dialog.getByRole("combobox").selectOption("25000");
      await expect.poll(() => page.evaluate(() => (window as any).f.requests.length)).toBe(3);
      await dialog.getByRole("textbox").focus();
      await page.evaluate(() => (window as any).f.success(2));
      await expect(page.locator('[data-navigation-ready]')).toBeVisible();
      await expect(dialog.getByRole("textbox")).toBeFocused();
      assert.equal(await page.evaluate(() => (window as any).f.dialog === document.querySelector('[role="dialog"]')), true);
      assert.equal(await page.evaluate(() => (window as any).f.mapMounts), 1);
      assert.equal(await page.evaluate(() => (window as any).f.refreshes), 2);
      await page.getByRole("button", {name:"Listo",exact:true}).click();
      await expect(dialog).toHaveCount(0);
      assert.equal(await page.evaluate(() => (window as any).f.refreshes), 2);
      // A later GPS callback must not replace a newer recent selection.
      await page.getByRole("button", { name: /^Cambiar ubicación:/ }).click();
      await page.getByRole("button", { name: /Usar mi ubicación actual/ }).click();
      await page.getByRole("button", { name: /Centro, Puebla/ }).click();
      await expect.poll(() => page.evaluate(() => (window as any).f.requests.length)).toBe(4);
      await page.evaluate(() => (window as any).f.gps[0].ok({coords:{latitude:19.433,longitude:-99.133,accuracy:50}}));
      assert.equal(await page.evaluate(() => document.cookie.includes("vicino_location=19.043,-98.203")), true);
      assert.equal(await page.evaluate(() => (window as any).f.refreshes), 3);
      await page.evaluate(() => (window as any).f.success(3));
      await expect(dialog).toBeVisible();
      await page.getByRole("button", {name:"Listo",exact:true}).click();
      await expect(dialog).toHaveCount(0);
      assert.equal(await page.evaluate(() => (window as any).f.refreshes), 3);
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}: real cache.drop → skeleton → error → reload keeps sheet/map mounted; each change has one refresh; Listo is idempotent; canonical recents show full names and auto-apply; late GPS cannot replace recent; reduced motion`);
      await page.close();
    }
  } finally { await browser.close(); }
  console.log("Location home lifecycle: 2/2 PASS; real session cache/storage, controlled transport/SDK/Auth");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
