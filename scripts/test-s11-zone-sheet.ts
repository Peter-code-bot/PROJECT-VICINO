/** Real ZoneCard and location sheet in Chromium; SDK, GPS and persistence are controlled boundaries. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
const web = path.resolve(__dirname, "../apps/web"), requireWeb = createRequire(path.join(web, "package.json"));
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] }));
const { chromium, expect } = requireWeb("@playwright/test");
async function main() {
  const mocks: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({refresh:()=>window.fixture.refreshes++});",
    "next/dynamic": "import React,{lazy,Suspense} from 'react';export default function dynamic(load){const Component=lazy(load);return props=><Suspense fallback={null}><Component {...props}/></Suspense>;}",
    "@/hooks/useGeolocation": "export const useGeolocation=()=>({state:{status:'success',position:window.fixture.saved},setManualPosition:position=>window.fixture.writes.push(position)});",
    "@/lib/geo/apple-geocoder": "export const reverseGeocodeWithApple=async(lat,lng)=>{window.fixture.geocodes.push({lat,lng});return {name:'Zona de prueba',fullName:'Zona de prueba, México'};};",
    "@/lib/geo/cobertura": "export const useReglaCobertura=()=>null;",
    "@/lib/geo/location-search": "export const clasificarResultado=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=14.5&&p.lat<=32.8&&p.lng>=-118.5&&p.lng<=-86.5?'ok':'fuera-de-mexico';export const searchLocations=async()=>({results:[]});export const resolveLocationCoordinates=async()=>null;",
    "@/lib/haptics": "export const hapticSelection=async()=>{};",
    "./change-location-map": "import React from 'react';export default function Map({lat,lng}){return <div data-testid='draft-map' data-lat={lat} data-lng={lng}>Mapa de prueba</div>;}",
  };
  const result = await esbuild.build({ stdin: { resolveDir: web, loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ZoneCard} from './components/home/zone-card';
    function App(){const [override,setOverride]=useState({lat:19.04,lng:-98.21});window.fixture.setOverride=setOverride;return <ZoneCard positionOverride={override} hayUbicacionEnServidor resolveName={false}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "boundaries", setup(b: any) {
    b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a: any) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: web }));
  } }] });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    // tsx preserves function names with this helper in serialized evaluate callbacks.
    await page.addInitScript("window.__name = (value) => value;");
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/*", (route: any) => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><body><div id='root'></div></body></html>" }) : route.abort());
    await page.goto("https://s11-fixture.invalid");
    await page.evaluate(() => {
      (window as any).fixture = { saved: { lat: 17.99, lng: -92.928, name: "Villahermosa", fullName: "Villahermosa, México", radius: 25000 }, writes: [], geocodes: [], refreshes: 0 };
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => failure({ code: 1 }) }, configurable: true });
    });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    const zone = page.getByRole("button", { name: /^Cambiar ubicación:/ });
    await expect(zone).toBeVisible(); assert.equal(await page.evaluate(() => (window as any).fixture.geocodes.length), 0);
    await zone.click(); await expect(page.getByRole("dialog", { name: "Cambiar ubicación" })).toBeVisible();
    await expect(page.getByTestId("draft-map")).toHaveAttribute("data-lat", "19.04");
    await expect(page.getByTestId("draft-map")).toHaveAttribute("data-lng", "-98.21");
    assert.equal(await page.evaluate(() => (window as any).fixture.writes.length), 0);
    console.log("PASS explicit URL center A opens editor at A while saved B stays unmodified");
    await page.getByRole("button", { name: "Usar mi ubicación actual" }).click();
    await expect(page.getByText("Permiso de ubicación denegado")).toBeVisible();
    await expect(page.getByTestId("draft-map")).toHaveAttribute("data-lat", "19.04");
    assert.equal(await page.evaluate(() => (window as any).fixture.writes.length), 0);
    assert.equal(await page.evaluate(() => (window as any).fixture.saved.lat), 17.99);
    console.log("PASS denied GPS preserves draft A and persisted B");
    await page.getByRole("button", { name: "Aplicar ubicación", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Cambiar ubicación" })).toHaveCount(0);
    const writes = await page.evaluate(() => (window as any).fixture.writes);
    assert.equal(writes.length, 1); assert.equal(writes[0].lat, 19.04); assert.equal(writes[0].lng, -98.21); assert.equal(writes[0].radius, 25000);
    console.log("PASS Apply is the only persistence action and retains the buyer radius");
    await page.evaluate(() => (window as any).fixture.setOverride(undefined)); await zone.click();
    await expect(page.getByTestId("draft-map")).toHaveAttribute("data-lat", "17.99");
    await expect(page.getByTestId("draft-map")).toHaveAttribute("data-lng", "-92.928");
    await expect(page.getByRole("button", { name: "Cerrar", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => (window as any).fixture.writes.length), 1);
    assert.deepEqual(errors, []);
    console.log("PASS callers without override retain the original saved-location behavior");
    console.log("S11 zone editor: 4/4 PASS; controlled SDK/GPS/geocoder/persistence");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
