/** Real sheet, hooks and storage; GPS, Apple and search transport are controlled. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, ".."), web = path.join(root, "apps/web");
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, webkit, expect } = req("@playwright/test");
const baseline = process.env.LOCATION_BASELINE === "1";
const baselineRef = process.env.LOCATION_BASELINE_REF ?? "cdeec46";
const engine = process.env.TEST_BROWSER === "webkit" ? "webkit" : "chromium";
const mocks: Record<string, string> = {
  "./change-location-map": `export default function Map(){return null;}`,
  "next/dynamic": `import React from 'react';export default function dynamic(){return function Map({lat,lng,onMove}){return <div style={{height:200}}><output data-testid="map-point">{lat},{lng}</output><button onClick={()=>onMove(19.08,-98.23)}>Elegir punto</button></div>}}`,
  "@/lib/geo/cobertura": `export const useReglaCobertura=()=>({modo:'pais'});`,
  "@/lib/haptics": `export const hapticSelection=async()=>{};`,
  "@/lib/geo/apple-geocoder": `export async function reverseGeocodeWithApple(lat,lng,signal){const f=window.f;const label={name:'Dirección GPS',fullName:'Dirección GPS, Puebla'};if(f.labels==='pending')return new Promise(resolve=>f.labelsPending.push({resolve,signal}));if(f.labels==='slow'){f.labelStarted=performance.now();await new Promise(resolve=>setTimeout(resolve,4000));f.labelFinished=performance.now()}return label;}`,
  "@/lib/geo/location-search": `export const clasificarResultado=p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=14.5&&p.lat<=32.8?'ok':'coordenadas';export async function searchLocations(query){window.f.searchCalls++;if(window.f.search==='pending')return new Promise(resolve=>window.f.searchPending.push({query,resolve}));if(window.f.search==='throw')throw new Error('offline');if(window.f.search==='error')return {results:[],outOfCoverage:false,error:'unavailable'};return {results:[],outOfCoverage:false}};export const resolveLocationCoordinates=async p=>p;`,
};

async function main() {
  const bundle = await esbuild.build({ stdin: { resolveDir: web, loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ChangeLocationSheet} from './components/home/change-location-sheet';
    import {useGeolocation} from './hooks/useGeolocation';
    function App(){const [open,setOpen]=useState(false);const {state}=useGeolocation();return <><button data-testid="open" onClick={()=>setOpen(true)}>Abrir ubicación</button><output data-testid="active-name">{state.status==='success'?state.position.name:''}</output><ChangeLocationSheet open={open} onClose={()=>setOpen(false)}/></>}
    window.addEventListener('vicino_location_updated',()=>{window.f.changes++;window.f.appliedAt=performance.now()});
    window.addEventListener('vicino_location_label_updated',()=>{window.f.namedAt=performance.now()});
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail)=>window.f.gps.push({ok,fail})}});
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "controlled-seams", setup(build: any) {
    build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "tsx", resolveDir: web }));
    build.onLoad({filter:/change-location-sheet\.tsx$/}, args => {
      const contents = baseline ? execFileSync('git',['show',baselineRef+':apps/web/components/home/change-location-sheet.tsx'],{cwd:root,encoding:'utf8'}) : readFileSync(args.path,'utf8');
      return {contents:contents.replace('  const reducedMotion = useReducedMotion();','  window.f.sheetRenders++;\n  const reducedMotion = useReducedMotion();'),loader:'tsx',resolveDir:path.join(web,'components/home')};
    });
  } }] });
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const { css } = await postcss([req("@tailwindcss/postcss")({ base: web })]).process(readFileSync(path.join(web, "app/globals.css"), "utf8"), { from: path.join(web, "app/globals.css") });
  const browser = await (engine === "webkit" ? webkit : chromium).launch({headless:true});
  const metrics: Record<string, unknown> = { engine, baseline, controlledTransport:true };
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await page.addInitScript("window.__name=(value)=>value;");
    const errors: string[] = []; page.on('pageerror',(error:Error)=>errors.push(error.message));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.route('**/*',(route:any)=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div></html>`}):route.abort());
    const reset = async () => {
      await page.goto('https://location-fluidez.invalid/');
      await page.evaluate(()=>{
        (window as any).f={labels:'instant',labelsPending:[],search:'empty',searchCalls:0,searchPending:[],gps:[],changes:0,sheetRenders:0};
        document.cookie='vicino_location=19.040,-98.200; path=/';document.cookie='vicino_radius=10000; path=/';
        localStorage.setItem('vicino_last_location',JSON.stringify({lat:19.04,lng:-98.2,radius:10000,name:'Anterior',fullName:'Anterior, Puebla'}));
        localStorage.setItem('vicino_recent_locations',JSON.stringify([{lat:19.043,lng:-98.203,name:'Reciente',fullName:'Reciente, Puebla',timestamp:1}]));
      });
      await page.addScriptTag({content:bundle.outputFiles[0].text});
      await expect(page.getByTestId('active-name')).toHaveText('Anterior');
    };
    const dialog = () => page.getByRole('dialog',{name:'Cambiar ubicación'});
    const open = async () => {await page.getByTestId('open').click();await expect(dialog().getByRole('button',{name:'Listo',exact:true})).toBeEnabled();};
    const gps = async () => {await dialog().getByRole('button',{name:/Usar mi ubicación actual/}).click();await page.evaluate(()=>{(window as any).f.gpsReturnedAt=performance.now();(window as any).f.gps.at(-1).ok({coords:{latitude:19.07238,longitude:-98.22414,accuracy:50}})});};
    const cookie = () => page.evaluate(()=>document.cookie);
    await reset();
    const opening: number[] = [], typing: number[] = [];
    const renderedBefore=await page.evaluate(()=>(window as any).f.sheetRenders);
    for(let i=0;i<20;i++) {
      opening.push(await page.evaluate(()=>new Promise<number>((resolve,reject)=>{
        const started=performance.now();const timeout=setTimeout(()=>{observer.disconnect();reject(new Error('open timeout'))},2000);
        const inspect=()=>{const button=document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Listo"]');if(button&&!button.disabled){observer.disconnect();clearTimeout(timeout);requestAnimationFrame(()=>resolve(performance.now()-started))}};
        const observer=new MutationObserver(inspect);observer.observe(document.body,{childList:true,subtree:true,attributes:true});document.querySelector<HTMLButtonElement>('[data-testid="open"]')!.click();inspect();
      })));
      typing.push(await page.evaluate(()=>new Promise<number>((resolve,reject)=>{
        const started=performance.now();const timeout=setTimeout(()=>{observer.disconnect();reject(new Error('input timeout'))},2000);
        const inspect=()=>{if(document.querySelector('[role="dialog"] svg.animate-spin')){observer.disconnect();clearTimeout(timeout);requestAnimationFrame(()=>resolve(performance.now()-started))}};
        const observer=new MutationObserver(inspect);observer.observe(document.body,{childList:true,subtree:true,attributes:true});const input=document.querySelector<HTMLInputElement>('[role="dialog"] input')!;input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Centro');input.dispatchEvent(new Event('input',{bubbles:true}));inspect();
      })));
      await page.keyboard.press('Escape');await expect(dialog()).toHaveCount(0);
    }
    const summary = (values:number[]) => {const sorted=[...values].sort((a,b)=>a-b);return {samples:values.length,p50:Math.round(sorted[Math.floor(sorted.length*.5)]!*10)/10,p95:Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*.95)-1)]!*10)/10};};
    metrics.openMs=summary(opening);metrics.typingMs=summary(typing);metrics.rendersFor20OpenTypeClose=await page.evaluate(()=>(window as any).f.sheetRenders)-renderedBefore;
    await reset();await open();await page.evaluate(()=>{(window as any).f.labels='slow'});
    await gps();
    await expect.poll(cookie,{timeout:7000}).toContain('vicino_location=19.072,-98.224');
    metrics.gpsToAppliedMs=Math.round(await page.evaluate(()=>(window as any).f.appliedAt-(window as any).f.gpsReturnedAt)*10)/10;
    if(!baseline){await expect(dialog().getByText('Ubicando dirección…',{exact:true})).toBeVisible();await expect(dialog().getByRole('button',{name:'Listo',exact:true})).toBeEnabled();assert.ok(Number(metrics.gpsToAppliedMs)<1000,'point applies before 4s label lookup');}
    await expect(page.getByTestId('active-name')).toHaveText('Dirección GPS',{timeout:7000});
    metrics.gpsToNamedMs=Math.round(await page.evaluate(()=>((window as any).f.namedAt??(window as any).f.appliedAt)-(window as any).f.gpsReturnedAt)*10)/10;
    assert.equal(await page.evaluate(()=>(window as any).f.changes),1);
    if(baseline){console.log('BASELINE '+JSON.stringify(metrics));return;}
    console.log('PASS GPS applies before delayed name, all hook consumers update, one location event');
    await dialog().getByRole('button',{name:'Listo',exact:true}).click();await expect(dialog()).toHaveCount(0);await open();await expect(dialog().getByRole('textbox')).toHaveValue('');await expect(dialog().getByText('Dirección GPS, Puebla',{exact:true})).toBeVisible();
    console.log('PASS confirmation and reopen preserve enriched recent without extra refresh');
    await reset();await open();await page.evaluate(()=>{(window as any).f.labels='pending'});await gps();
    await expect.poll(cookie).toContain('19.072,-98.224');await dialog().getByRole('combobox').selectOption('25000');
    await page.evaluate(()=>{for(const item of (window as any).f.labelsPending)item.resolve({name:'Con radio nuevo',fullName:'Con radio nuevo, Puebla'})});
    await expect(page.getByTestId('active-name')).toHaveText('Con radio nuevo');assert.ok((await cookie()).includes('vicino_radius=25000'));
    console.log('PASS label enrichment preserves a radius changed while pending');
    for(const action of ['recent','close','map']){
      await reset();await open();await page.evaluate(()=>{(window as any).f.labels='pending'});await gps();await expect.poll(cookie).toContain('19.072,-98.224');
      if(action==='recent')await dialog().getByRole('button',{name:/Reciente, Puebla/}).click();else if(action==='map')await dialog().getByRole('button',{name:'Elegir punto'}).click();else await page.keyboard.press('Escape');
      const kept=await cookie();await page.evaluate(async()=>{for(const item of (window as any).f.labelsPending)item.resolve({name:'Nombre tardío',fullName:'Nombre tardío'});await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
      assert.equal(await cookie(),kept);await expect(page.getByTestId('active-name')).not.toHaveText('Nombre tardío');
    }
    console.log('PASS late labels after recent, map selection and closing cannot overwrite state');
    await reset();await open();await page.evaluate(()=>{(window as any).f.labels='pending'});await gps();await expect.poll(cookie).toContain('19.072,-98.224');
    await expect(dialog().getByRole('textbox')).toHaveValue('Mi ubicación');await dialog().getByRole('textbox').fill('Texto conservado');await page.evaluate(()=>{for(const item of (window as any).f.labelsPending)item.resolve({name:'Nuevo nombre',fullName:'Nuevo nombre'})});await expect(dialog().getByRole('textbox')).toHaveValue('Texto conservado');
    await reset();await open();await dialog().getByRole('button',{name:/Usar mi ubicación actual/}).click();await page.evaluate(()=>{(window as any).f.gps.at(-1).fail({code:1})});await expect(dialog().getByText('Permiso de ubicación denegado')).toBeVisible();assert.ok((await cookie()).includes('19.040,-98.200'));
    console.log('PASS typed search survives enrichment; denied GPS preserves previous zone');
    for(const code of [2,3]){
      await reset();await open();await dialog().getByRole('button',{name:/Usar mi ubicación actual/}).click();await page.evaluate(code=>{(window as any).f.gps.at(-1).fail({code})},code);
      await expect(dialog().getByText(code===2?'Ubicación no disponible':'Tiempo de espera agotado',{exact:true})).toBeVisible();assert.ok((await cookie()).includes('19.040,-98.200'));
    }
    await reset();await open();await dialog().getByRole('button',{name:/Usar mi ubicación actual/}).click();await page.evaluate(()=>{(window as any).f.gps.at(-1).ok({coords:{latitude:52,longitude:8,accuracy:50}})});await expect(dialog().getByText('La ubicación debe estar en México y tener un radio válido.')).toBeVisible();assert.ok((await cookie()).includes('19.040,-98.200'));
    await reset();await open();await page.evaluate(()=>{const cookie=Object.getOwnPropertyDescriptor(Document.prototype,'cookie')!;Object.defineProperty(document,'cookie',{get:()=>cookie.get!.call(document),set:()=>{},configurable:true})});await gps();await expect(dialog().getByText('No se pudo guardar la ubicación. Tu ubicación anterior sigue activa. Intenta de nuevo.')).toBeVisible();assert.ok((await cookie()).includes('19.040,-98.200'));assert.equal(await page.evaluate(()=>(window as any).f.changes),0);
    console.log('PASS GPS unavailable, timeout, invalid point and rejected persistence retain prior zone');
    await reset();await open();await page.evaluate(()=>{(window as any).f.labels='pending'});await gps();await page.evaluate(()=>{for(const item of (window as any).f.labelsPending)item.resolve(null)});await expect(dialog().getByText(/No pudimos obtener la dirección/)).toBeVisible();assert.ok((await cookie()).includes('19.072,-98.224'));
    console.log('PASS failed name lookup keeps applied GPS and offers clear feedback');
    for(const failure of ['error','throw']){
      await reset();await open();await page.evaluate(mode=>{(window as any).f.search=mode},failure);await dialog().getByRole('textbox').fill('Centro');await expect(dialog().getByText('Buscando…',{exact:true})).toBeVisible();await expect(dialog().getByText('No pudimos buscar. Intenta de nuevo.',{exact:true})).toBeVisible();await expect(dialog().getByRole('textbox')).toHaveValue('Centro');
      await page.evaluate(()=>{(window as any).f.search='empty'});await dialog().getByRole('button',{name:'Reintentar búsqueda'}).click();await expect(dialog().getByText('No encontramos lugares. Prueba con otra zona o dirección.',{exact:true})).toBeVisible();assert.ok((await cookie()).includes('19.040,-98.200'));
    }
    console.log('PASS provider failure and thrown transport error differ from empty; retry preserves query/zone');
    await reset();await open();await page.evaluate(()=>{(window as any).f.search='pending'});await dialog().getByRole('textbox').fill('Primera');await expect.poll(()=>page.evaluate(()=>(window as any).f.searchPending.length)).toBe(1);await dialog().getByRole('textbox').fill('Segunda');await expect.poll(()=>page.evaluate(()=>(window as any).f.searchPending.length)).toBe(2);
    await page.evaluate(()=>{(window as any).f.searchPending[1].resolve({results:[],outOfCoverage:false})});await expect(dialog().getByText(/No encontramos lugares/)).toBeVisible();await page.evaluate(async()=>{(window as any).f.searchPending[0].resolve({results:[{id:'old',name:'Obsoleto'}],outOfCoverage:false});await new Promise(resolve=>requestAnimationFrame(resolve))});await expect(dialog().getByText('Obsoleto',{exact:true})).toHaveCount(0);
    assert.deepEqual(errors,[]);console.log('PASS stale search response ignored; no runtime errors');
    console.log('METRICS '+JSON.stringify(metrics));
  } finally {
    await browser.close();
    if(process.env.LOCATION_EVIDENCE){mkdirSync(process.env.LOCATION_EVIDENCE,{recursive:true});writeFileSync(path.join(process.env.LOCATION_EVIDENCE,`location-${engine}-${baseline?'before':'after'}.json`),JSON.stringify(metrics,null,2));}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
