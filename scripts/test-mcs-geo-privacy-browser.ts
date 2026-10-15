/** Real picker + DeliveryMap; SDK/map boundaries are synthetic, no accounts or network.
 * pnpm exec tsx scripts/test-mcs-geo-privacy-browser.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PUBLIC_LOCATION_FALLBACK } from "../packages/shared/src/utils/public-location-label";

const requireWeb = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] }));
const { chromium, expect } = requireWeb("@playwright/test");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));

async function main() {
  const mocks: Record<string, string> = {
    "next/dynamic": `import React from 'react';export default ()=>props=><button onClick={()=>props.onMapClick(...window.geo.point)}>Mover punto</button>;`,
    "@/hooks/use-mapkit": `export const useMapKit=()=>({isReady:true,isAvailable:true});`,
    "@/lib/geo/cobertura": `export const useReglaCobertura=()=>({modo:'pais'});`,
    "@/lib/geo/apple-geocoder": `export const reverseGeocodeWithApple=(lat,lng,signal)=>new Promise((resolve,reject)=>window.geo.lookups.push({lat,lng,signal,resolve,reject}));`,
    "@/lib/geo/location-search": `export const clasificarResultado=()=> 'ok';
      export const searchLocations=async q=>({results:[{id:q,name:q,fullName:q,lat:25.68661234,lng:-100.31611234}],outOfCoverage:false});
      export const resolveLocationCoordinates=async s=>s;`,
  };
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
      import LocationPicker from './components/map/location-picker';import DeliveryMap from './components/map/delivery-map';
      const f=window.geo={lookups:[],point:[19.04141234,-98.20631234],gps:[],values:[]};
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>f.gps.push(ok)}});
      function Harness({delivery}){const [value,setValue]=useState(null);const change=v=>{f.values.push(v);setValue(v);};
        return <>{delivery?<DeliveryMap initialLat={19.04} initialLng={-98.2} onRadiusChange={()=>{}} onLocationChange={(lat,lng,address)=>change({lat,lng,address})}/>:
          <LocationPicker initialLat={19.04} initialLng={-98.2} allowGeolocation onChange={change}/>}
          <output>{value?.address??'sin selección'}</output>
          <input type='hidden' name='ubicacion' value={value?.address??''}/><input type='hidden' name='ubicacion_lat' value={value?.lat??''}/><input type='hidden' name='ubicacion_lng' value={value?.lng??''}/></>;
      }
      const root=createRoot(document.getElementById('root'));let key=0;f.mount=(delivery=false)=>flushSync(()=>root.render(<Harness key={++key} delivery={delivery}/>));f.mount();`,
      resolveDir: web, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "geo-sdk-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 375, height: 812 }]) {
      const page = await browser.newPage({ viewport });
      await page.route("**/*", (route: any) => route.abort());
      await page.setContent('<html lang="es"><body><div id="root"></div></body></html>');
      await page.addScriptTag({ content: bundle.outputFiles[0].text });
      const label = page.locator('input[name="ubicacion"]');
      const lat = page.locator('input[name="ubicacion_lat"]');
      const lng = page.locator('input[name="ubicacion_lng"]');
      const count = () => page.evaluate(() => (window as any).geo.lookups.length);

      // Immediate submit through the real legacy adapter, then transport failure.
      await page.evaluate(() => (window as any).geo.mount(true));
      await page.getByRole("button", { name: "Mover punto" }).click();
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);
      await expect(lat).toHaveValue("19.04141234");
      await expect(lng).toHaveValue("-98.20631234");
      await expect.poll(count).toBe(1);
      await page.evaluate(() => (window as any).geo.lookups[0].reject(new Error("synthetic geocoder failure")));
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);

      // Two in-flight reverse lookups deliberately resolve in the wrong order.
      await page.getByRole("button", { name: "Mover punto" }).click();
      await expect.poll(count).toBe(2);
      await page.evaluate(() => { (window as any).geo.point = [19.05251234, -98.21251234]; });
      await page.getByRole("button", { name: "Mover punto" }).click();
      await expect.poll(count).toBe(3);
      assert.equal(await page.evaluate(() => (window as any).geo.lookups[1].signal.aborted), true);
      await page.evaluate(() => (window as any).geo.lookups[1].resolve({ fullName: "Dirección anterior" }));
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);
      await expect(lat).toHaveValue("19.05251234");
      await page.evaluate(() => (window as any).geo.lookups[2].resolve({ fullName: "Centro, Puebla" }));
      await expect(label).toHaveValue("Centro, Puebla");

      // MapKit itself can resolve only to a coordinate string; keep the fallback.
      await page.getByRole("button", { name: "Mover punto" }).click();
      await expect.poll(count).toBe(4);
      await page.evaluate(() => (window as any).geo.lookups[3].resolve({ fullName: "19.0525, -98.2125, CP 72000" }));
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);

      // Search and GPS share the safe label, without changing the private point.
      await page.evaluate(() => (window as any).geo.mount());
      await page.getByRole("button", { name: "Usar mi ubicación" }).click();
      await page.evaluate(() => (window as any).geo.gps[0]({ coords: { latitude: 19.06123456, longitude: -98.30123456 } }));
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);
      await expect(lat).toHaveValue("19.06123456");
      await expect.poll(count).toBe(5);
      await page.getByRole("textbox").fill("Ciudad 2000");
      await page.getByRole("button", { name: "Ciudad 2000", exact: true }).click();
      await page.evaluate(() => (window as any).geo.lookups[4].resolve({ fullName: "GPS anterior" }));
      await expect(label).toHaveValue("Ciudad 2000");
      await expect(lat).toHaveValue("25.68661234");
      await expect(lng).toHaveValue("-100.31611234");
      await page.getByRole("button", { name: "Usar mi ubicación" }).click();
      await page.getByRole("textbox").fill("2 de Abril, Puebla");
      await page.getByRole("button", { name: "2 de Abril, Puebla", exact: true }).click();
      await page.evaluate(() => (window as any).geo.gps[1]({ coords: { latitude: 19.09, longitude: -98.09 } }));
      await expect(label).toHaveValue("2 de Abril, Puebla");
      await page.getByRole("textbox").fill("19.0414, -98.2063");
      await page.getByRole("button", { name: "19.0414, -98.2063", exact: true }).click();
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);

      // Empty/timeout geocoder results also leave a savable selected point.
      await page.getByRole("button", { name: "Mover punto" }).click();
      await expect.poll(count).toBe(6);
      await page.evaluate(() => (window as any).geo.lookups[5].resolve(null));
      await expect(label).toHaveValue(PUBLIC_LOCATION_FALLBACK);
      await expect(lat).toHaveValue("19.05251234");

      // Removing a point cancels a pending lookup, even if the SDK replies later.
      await page.getByRole("button", { name: "Mover punto" }).click();
      await expect.poll(count).toBe(7);
      await page.getByRole("button", { name: "Quitar ubicación" }).click();
      await page.evaluate(() => (window as any).geo.lookups[6].resolve({ fullName: "Respuesta después de quitar" }));
      await expect(label).toHaveValue("");
      await expect(lat).toHaveValue("");
      console.log(`PASS ${viewport.width}x${viewport.height}: immediate/failure/null, out-of-order, SDK coordinate label, GPS, search, numeric locality, clear; private point unchanged`);
      await page.close();
    }
  } finally { await browser.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
