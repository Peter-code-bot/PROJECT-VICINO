/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] }));
let script: string;
let css: string;
test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const mocks: Record<string, string> = {
    "next/dynamic": `import React from 'react';export default ()=>props=><button onClick={()=>props.onMapClick(19.04,-98.20)}>Mover punto</button>;`,
    "next-themes": `export const useTheme=()=>({resolvedTheme:window.fixture.theme});`,
    "@/hooks/use-mapkit": `export const useMapKit=()=>({isReady:true,isAvailable:true,retryWaitSeconds:0});`,
    "@/lib/geo/apple-geocoder": `export const reverseGeocodeWithApple=async()=>({fullName:'Puebla, México'});`,
    "@/lib/geo/location-search": `export const clasificarResultado=()=> 'ok';
      export const searchLocations=async q=>({results:[{id:q,name:q,fullName:q,lat:19.05,lng:-98.21}],outOfCoverage:false});
      export const resolveLocationCoordinates=async s=>s;`,
  };
  const result = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import LocationPicker from './components/map/location-picker';
      import {LocationBanner} from './components/product/location-banner';
      window.fixture={theme:'light',render:()=>{},gps:null,denied:null};
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail)=>{window.fixture.gps=ok;window.fixture.denied=fail;}}});
      const root=createRoot(document.getElementById('root'));
      function Picker(){const [value,setValue]=useState(null);return <><LocationPicker allowGeolocation onChange={setValue}/><output>{value?.address??'sin selección'}</output></>;}
      window.fixture.render=(mode='picker',available=true,theme='light')=>{window.fixture.theme=theme;document.documentElement.classList.toggle('dark',theme==='dark');root.render(mode==='picker'?<Picker/>:<div style={{maxWidth:640,margin:'20px auto'}}>{['mobile','desktop'].map(layout=><div className={layout==='mobile'?'md:hidden':'hidden md:block'} key={layout}><LocationBanner layout={layout} available={available} productId="00000000-0000-4000-8000-000000000001" version={theme} ubicacion="Puebla, México"/></div>)}</div>);};`, loader: "tsx", resolveDir: web },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "location-fixture", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  script = result.outputFiles[0].text;
  const cssDir = path.join(web, '.next/static/css');
  css = readdirSync(cssDir).filter(file=>file.endsWith('.css')).map(file=>readFileSync(path.join(cssDir,file),'utf8')).join('\n');
});
test.beforeEach(async ({ page }) => {
  await page.route('http://localhost:3000/phase-fixture', route=>route.fulfill({contentType:'text/html',body:'<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'}));
  await page.goto('/phase-fixture');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
});
test('manual community center works with denied GPS, late GPS cannot overwrite it, clear cancels reverse lookup', async ({page}) => {
  await page.evaluate(()=> (window as any).fixture.render());
  await page.getByRole('button',{name:'Usar mi ubicación'}).click();
  await page.evaluate(()=> (window as any).fixture.denied({code:1}));
  await expect(page.locator('p[role=status]')).toContainText('Puedes buscar');
  await page.getByRole('button',{name:'Usar mi ubicación'}).click();
  await page.getByRole('textbox').fill('Cholula');
  await page.getByRole('button',{name:'Cholula',exact:true}).click();
  await page.evaluate(()=> (window as any).fixture.gps({coords:{latitude:19.01,longitude:-98.1}}));
  await expect(page.locator('output')).toHaveText('Cholula');
  await expect(page.getByRole('slider')).toHaveCount(0);
  await page.getByRole('button',{name:'Mover punto'}).click();
  await page.getByRole('button',{name:'Quitar ubicación'}).click();
  await expect(page.locator('output')).toHaveText('sin selección');
  await page.waitForTimeout(900);
  await expect(page.locator('output')).toHaveText('sin selección');
});
test('one lazy minimap per viewport, themed approximate circle and no coordinates in its URL', async ({page},info) => {
  const requests:string[]=[];
  await page.route('**/api/products/*/location-map?*',route=>{requests.push(route.request().url());return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="360"><rect width="1280" height="360" fill="#e6e9e3"/><path d="M0 70L1280 220M200 0L440 360M600 0L760 360" stroke="white" stroke-width="20"/></svg>'});});
  await page.evaluate(()=> (window as any).fixture.render('map'));
  await expect(page.getByRole('img')).toHaveCount(1);
  await expect(page.locator('section:visible span[aria-hidden]')).toHaveCount(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toMatch(/lat|lng|signature|teamId|keyId/);
  const box=await page.getByRole('img').boundingBox();
  expect(box!.width/box!.height).toBeCloseTo(32/9,1);
  await page.screenshot({path:info.outputPath('location-light.png')});
  await page.evaluate(()=> (window as any).fixture.render('map',true,'dark'));
  await expect.poll(()=>requests.length).toBe(2);
  expect(requests[1]).toContain('theme=dark');
  await page.screenshot({path:info.outputPath('location-dark.png')});
});
test('missing location and failed map retain locality without fabricating a point',async ({page})=>{
  await page.route('**/api/products/*/location-map?*',route=>route.fulfill({status:503}));
  await page.evaluate(()=> (window as any).fixture.render('map',false));
  await expect(page.getByText('Puebla, México').filter({visible:true})).toBeVisible();
  await expect(page.getByRole('img')).toHaveCount(0);
  await page.evaluate(()=> (window as any).fixture.render('map',true));
  await expect(page.getByText('Mapa no disponible')).toBeVisible();
  await expect(page.locator('section:visible span[aria-hidden]')).toHaveCount(0);
});
