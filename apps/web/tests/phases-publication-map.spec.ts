/* eslint-disable @typescript-eslint/no-explicit-any */
// Componentes y hook reales; sólo el SDK/token de Apple y la cobertura usan fixtures.
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const { instalarMapkitFalso } = localRequire("../../scripts/staging/mapkit-falso.mjs");
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] }));
let script: string;

test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const mocks: Record<string, string> = {
    "next/dynamic": `import React,{lazy,Suspense} from 'react';export default load=>{const Component=lazy(load);return props=><Suspense fallback={<p>Cargando mapa</p>}><Component {...props}/></Suspense>;};`,
    "next-themes": `export const useTheme=()=>({resolvedTheme:'light'});`,
    "@sentry/nextjs": `export const captureMessage=()=>{};export const captureException=()=>{};`,
    "@/lib/geo/cobertura": `export const useReglaCobertura=()=>({modo:'pais',pais:'MX'});export const REGLA_FALLBACK={modo:'pais',pais:'MX'};`,
  };
  const result = await esbuild.build({
    stdin: { loader: "tsx", resolveDir: web, contents: `
      import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import DeliveryMap from './components/map/delivery-map';
      import LocationPicker from './components/map/location-picker';
      import AppleMap from './components/map/apple-map-container';
      const root=createRoot(document.getElementById('root'));
      window.probe={changes:[],gpsCalls:0};
      Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:()=>window.probe.gpsCalls++}});
      function Form({edit=false,legacy=false,deliveryDefault=false}){
        const [value,setValue]=useState(edit?{lat:20.9674,lng:-89.5926,address:'Mérida'}:null);
        const change=value=>{window.probe.changes.push(value);setValue(value);};
        const initial=edit?{initialLat:20.9674,initialLng:-89.5926}:{};
        return <form><label>Ubicación</label>{legacy?<LocationPicker {...initial} onChange={change}/>:<DeliveryMap {...initial} showMapInitially={!deliveryDefault} showRadiusControl={false} showRadiusPreview={false} onRadiusChange={()=>{}} onLocationChange={(lat,lng,address)=>change(lat&&lng?{lat,lng,address}:null)}/>}
          <input name="lat" type="hidden" value={value?.lat??''}/><input name="lng" type="hidden" value={value?.lng??''}/><output>{JSON.stringify(value)}</output></form>;
      }
      window.renderProbe=(mode='new')=>root.render(mode==='null'||mode==='undefined'?<AppleMap center={[19.04,-98.2]} markerPosition={mode==='null'?null:undefined} height={250}/>:<Form key={mode} edit={mode==='edit'} legacy={mode==='legacy'} deliveryDefault={mode==='solicitud'}/>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_COVERAGE_RADIUS_KM": '"200"' },
    plugins: [{ name: "publication-map", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    } }],
  });
  script = result.outputFiles[0].text;
});

test.beforeEach(async ({ page, context }) => {
  await instalarMapkitFalso(context);
  await page.route('http://localhost:3000/publication-map-fixture', route => route.fulfill({ contentType: 'text/html', body: '<html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div></html>' }));
  await page.goto('/publication-map-fixture');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addScriptTag({ content: script });
  expect(errors).toEqual([]);
});
async function render(page: any, mode = 'new') {
  await page.evaluate((mode: string) => (window as any).renderProbe(mode), mode);
  if (mode !== 'legacy' && mode !== 'solicitud') await expect(page.locator('[data-mapkit-falso]')).toBeVisible();
}
const pin = (page: any) => page.evaluate(() => (window as any).__mk?.pin() ?? null);
const changes = (page: any) => page.evaluate(() => (window as any).probe.changes);

test('preview inicial abarca Puebla y Cholula sin seleccionar, radio ni GPS', async ({ page }) => {
  await render(page);
  expect(await pin(page)).toBeNull();
  expect(await changes(page)).toEqual([]);
  await expect(page.locator('input[name=lat]')).toHaveValue('');
  await expect(page.locator('input[name=lng]')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Quitar ubicación' })).toHaveCount(0);
  const map = await page.evaluate(() => {
    const w = window as any, map = w.__mk.mapa();
    return { center: map.region.center, span: map.region.span, overlays: map.overlays.length, gps: w.probe.gpsCalls };
  });
  expect(map.overlays).toBe(0); expect(map.gps).toBe(0);
  expect(map.center.latitude).toBeCloseTo(19.0414);
  for (const longitude of [-98.2063, -98.306]) expect(Math.abs(longitude - map.center.longitude)).toBeLessThan(map.span.longitudeDelta / 2);
});

test('tocar y arrastrar elige punto; quitar cancela inversa y conserva mapa sin pin', async ({ page }) => {
  await render(page);
  await page.evaluate(() => (window as any).__mk.tocar(19.04, -98.2));
  await expect.poll(() => pin(page)).toEqual([19.04, -98.2]);
  await page.evaluate(() => (window as any).__mk.arrastrar(19.05, -98.21));
  await expect(page.locator('input[name=lat]')).toHaveValue('19.05');
  await page.getByRole('button', { name: 'Quitar ubicación' }).click();
  await expect(page.locator('[data-mapkit-falso]')).toBeVisible();
  expect(await pin(page)).toBeNull();
  await expect(page.locator('input[name=lat]')).toHaveValue('');
  await page.waitForTimeout(1000);
  expect(await pin(page)).toBeNull();
  await expect(page.locator('output')).toHaveText('null');
});

test('buscar fuera de Puebla centra el lugar elegido; borrar texto conserva selección', async ({ page }) => {
  await render(page);
  await page.getByPlaceholder('Busca una ubicación…').fill('Mérida');
  await page.getByRole('button', { name: /Mérida/ }).click();
  await expect.poll(() => pin(page)).toEqual([20.9674, -89.5926]);
  await page.getByRole('button', { name: 'Borrar búsqueda' }).click();
  expect(await pin(page)).toEqual([20.9674, -89.5926]);
  await expect(page.locator('input[name=lat]')).toHaveValue('20.9674');
});

test('editar conserva el punto guardado sin emitir cambios al abrir', async ({ page }) => {
  await render(page, 'edit');
  expect(await pin(page)).toEqual([20.9674, -89.5926]);
  expect(await changes(page)).toEqual([]);
  await expect(page.locator('input[name=lat]')).toHaveValue('20.9674');
});

for (const mode of ['legacy', 'solicitud']) test(`el consumidor ${mode} conserva mapa oculto al abrir y quitar`, async ({ page }) => {
  await render(page, mode);
  await expect(page.locator('[data-mapkit-falso]')).toHaveCount(0);
  await page.getByRole('textbox').fill('Mérida');
  await page.getByRole('button', { name: /Mérida/ }).click();
  await expect(page.locator('[data-mapkit-falso]')).toBeVisible();
  await page.getByRole('button', { name: 'Quitar ubicación' }).click();
  await expect(page.locator('[data-mapkit-falso]')).toHaveCount(0);
});

test('MapKit distingue null sin selección del pin central por defecto', async ({ page }) => {
  await render(page, 'undefined');
  expect(await pin(page)).toEqual([19.04, -98.2]);
  await render(page, 'null');
  await expect.poll(() => pin(page)).toBeNull();
});

test('fallo y reintento del mapa conservan ausencia de selección', async ({ page }) => {
  await page.route('**/api/mapkit/token', route => route.fulfill({ status: 429, headers: { 'Retry-After': '1' }, contentType: 'application/json', body: '{"error":"limited"}' }));
  await page.evaluate(() => (window as any).renderProbe('new'));
  const retry = page.getByRole('button', { name: /Reintentar.*mapa|Reintentar en/ });
  await expect(retry).toBeVisible();
  await expect(page.locator('input[name=lat]')).toHaveValue('');
  expect(await changes(page)).toEqual([]);
  await page.unroute('**/api/mapkit/token');
  await expect(retry).toBeEnabled({ timeout: 3000 });
  await retry.click();
  await expect(page.locator('[data-mapkit-falso]')).toBeVisible();
  expect(await pin(page)).toBeNull(); expect(await changes(page)).toEqual([]);
});
