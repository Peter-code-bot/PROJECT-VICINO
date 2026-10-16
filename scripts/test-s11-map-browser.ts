/** Real S11 React UI, coverage/listings hooks, validators and request client.
 * Apple SDK, transport and location lookup are controlled boundaries.
 * These browser fixtures do not replace real PostGIS/Apple/device acceptance. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const web = path.resolve(__dirname, '../apps/web');
const req = createRequire(path.join(web, 'package.json'));
const esbuild = req(req.resolve('esbuild', { paths: [req.resolve('tsx')] }));
const { chromium, expect } = req('@playwright/test');

async function main() {
  const mocks: Record<string, string> = {
    'next/link': `import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}`,
    'next/image': `import React from 'react';export default function Image({fill,sizes,...props}){return <img {...props}/>;}`,
    'next/dynamic': `import React,{lazy,Suspense} from 'react';export default function dynamic(load){const C=lazy(load);return p=><Suspense fallback={null}><C {...p}/></Suspense>;}`,
    'next-themes': `export const useTheme=()=>({resolvedTheme:window.f.theme});`,
    '@/hooks/use-mapkit': `export const useMapKit=()=>({isReady:!window.f.loading,isAvailable:window.f.available,mapkit:window.f.sdk,retry:()=>{window.f.available=true;window.f.redraw();},retryWaitSeconds:0});`,
    '@/components/layout/session-data-provider': `import {useState} from 'react';export function useSessionUI(key,initial){const [ui,setUI]=useState(()=>window.f.ui[key]??initial);return [ui,v=>{window.f.ui[key]=v;setUI(v);}];}`,
    '@/hooks/useGeolocation': `export const useGeolocation=()=>({state:{status:'idle'},request:()=>{window.f.gps++;}});`,
    '@/hooks/use-reverse-geocode': `export function useReverseGeocode(p){if(p)window.f.geocode++;return {name:null};}`,
    '@/components/home/change-location-sheet': `import React from 'react';export function ChangeLocationSheet({open,onClose}){return open?<div role="dialog"><button onClick={()=>{window.dispatchEvent(new CustomEvent('vicino_location_updated',{detail:{lat:19.09,lng:-98.19,radius:10000}}));onClose();}}>Aplicar zona de prueba</button></div>:null;}`,
    '@/lib/geo/location-search': `export const clasificarResultado=()=> 'ok';export const searchLocations=async()=>({results:[]});export const resolveLocationCoordinates=async s=>s;`,
    '@/lib/geo/cobertura': `export const useReglaCobertura=()=>({});`,
    '@/lib/geo/apple-geocoder': `export const reverseGeocodeWithApple=async()=>({name:'Zona sintética',fullName:'Zona sintética, México'});`,
  };
  mocks['./change-location-sheet'] = mocks['@/components/home/change-location-sheet'];
  const bundle = await esbuild.build({ stdin: { resolveDir: web, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {MapExplorer} from './app/(marketplace)/mapa/map-explorer';
    import {mapQuerySchema,MAP_AREA} from '@vicino/shared';import LocationPicker from './components/map/location-picker';
    const f=window.f;
    class Coordinate{constructor(latitude,longitude){Object.assign(this,{latitude,longitude});}}
    class Span{constructor(latitudeDelta,longitudeDelta){Object.assign(this,{latitudeDelta,longitudeDelta});}}
    class Region{constructor(center,span){Object.assign(this,{center,span});}}
    class Marker{constructor(coordinate,opts){this.coordinate=coordinate;this.opts={...opts};this.events={};this._selected=opts.selected??false;}addEventListener(t,cb){this.events[t]=cb;}removeEventListener(t,cb){if(this.events[t]===cb)delete this.events[t];}
      get selected(){return this._selected;}set selected(v){const changed=this._selected!==v;this._selected=v;if(changed&&v)this.events.select?.();}
      get color(){return this.opts.color;}set color(v){this.opts.color=v;if(this.button)this.button.style.background=v;}
      get title(){return this.opts.title;}set title(v){this.opts.title=v;}
      get accessibilityLabel(){return this.opts.accessibilityLabel;}set accessibilityLabel(v){this.opts.accessibilityLabel=v;this.button?.setAttribute('aria-label',v);}
      get glyphText(){return this.opts.glyphText;}set glyphText(v){this.opts.glyphText=v;if(this.button)this.button.textContent=v;}}
    class Map{static ColorSchemes={Dark:'dark',Light:'light'};constructor(node,opts){this.node=node;this.region=opts.region;this.events={};this.markers=[];this.recenters=0;f.maps.push(this);node.dataset.testid='sdk-map';node.style.background='repeating-linear-gradient(33deg,transparent 0 80px,#d0ddce 82px 86px,transparent 88px 160px),#ecede3';}
      addEventListener(t,cb){this.events[t]=cb;}setRegionAnimated(r){this.region=r;this.recenters++;this.events['region-change-end']?.({});}
      addAnnotation(m){this.markers.push(m);const b=document.createElement('button');b.textContent=m.opts?.glyphText??'Punto';b.setAttribute('aria-label',m.opts?.title??'Punto');b.dataset.marker='true';Object.assign(b.style,{position:'absolute',left:'52%',top:'48%',borderRadius:'50%',background:m.opts?.color??'#1F5A4E',color:'white',width:'44px',height:'44px'});b.onclick=()=>{m.selected=true;};m.button=b;this.node.append(b);}
      removeAnnotation(m){m.button?.remove();this.markers=this.markers.filter(x=>x!==m);}convertPointOnPageToCoordinate(){return f.point;}addOverlay(o){f.overlays.push(o);}removeOverlay(){}destroy(){this.destroyed=true;this.node.replaceChildren();}}
    f.sdk={Map,Coordinate,CoordinateSpan:Span,CoordinateRegion:Region,MarkerAnnotation:Marker,CircleOverlay:class{constructor(c,r){this.radius=r;}},Style:class{},FeatureVisibility:{Adaptive:'a',Hidden:'h'}};
    f.map=()=>f.maps.filter(m=>!m.destroyed).at(-1);
    f.camera=(lat=19.05,lng=-98.22,span=.12)=>{const m=f.map();m.region=new Region(new Coordinate(lat,lng),new Span(span,span));m.events['region-change-end']?.({});};
    const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
    f.result=r=>{const total=f.remoteTotal??35,second=!!r.query.cursor,empty=r.query.q==='sin resultados'||!!f.remoteEmpty;return {query_key:'a'.repeat(32),revision:f.revision??'b'.repeat(32),projection_version:1,as_of:'2026-09-30',
      features:empty?[]:[{id:'cell:1:-9823:1904',public_lat:19.04,public_lng:-98.23,count:total,seller_count:3,bounds:{west:-98.23,south:19.04,east:-98.23,north:19.04}}],
      total:empty?0:total,seller_total:empty?0:3,list_total:r.action==='listings'&&!empty?total:0,list_seller_total:r.action==='listings'&&!empty?3:0,
      listings:r.action==='listings'&&!empty?Array.from({length:second?Math.max(0,total-30):Math.min(30,total)},(_,i)=>({id:uid(i+(second?31:1)),titulo:'Publicación '+(i+(second?31:1)),slug:'publicacion-'+i,categoria:'comida',precio:i<2?null:80+i,modo_precio:i===0?'cotizacion':i===1?'reservacion':'precio',tipo:'producto',imagen_principal:null,creador_id:uid(99),vendedor_nombre:'Negocio de prueba',cell_id:r.query.cell_id,seller_listing_count:total,created_at:'2026-09-30T12:00:00Z'})):[],
      next_cursor:r.action==='listings'&&!empty&&!second?{key:'a'.repeat(32),id:uid(30),created_at:'2026-09-30T12:00:00Z'}:null,
      cells:r.action==='cells'&&!empty?[{x:-9823,y:1904,count:total,seller_count:3}]:[],next_cell_cursor:null,complete:r.action==='cells'||empty};};
    const originalResult=f.result;
    f.result=r=>{const result=originalResult(r);if(f.refiningZones&&r.action!=='listings'){
      const cells=Array.from({length:320},(_,i)=>({x:-9832+i%20,y:1894+Math.floor(i/20),count:1,seller_count:1}));
      result.total=320;result.seller_total=320;
      if(r.action==='cells'){result.cells=r.cell_cursor?cells.slice(300):cells.slice(0,300);result.next_cell_cursor=r.cell_cursor?null:{x:cells[299].x,y:cells[299].y};result.complete=!!r.cell_cursor;}
    }return result;};
    window.fetch=async(url,opts)=>{const r=JSON.parse(opts.body);const item={url,r,aborted:false},payload=f.result(r),fail=f.fail||(f.failCoverage&&r.action!=='listings');f.requests.push(item);opts.signal.addEventListener('abort',()=>item.aborted=true);if((f.holdCoverage&&r.action!=='listings')||(f.holdListings&&r.action==='listings'))await new Promise(resolve=>{(f.held??=[]).push(resolve);});else await new Promise(resolve=>setTimeout(resolve,r.query.q==='antigua'?1200:20));return new Response(JSON.stringify(fail?{error:'Fallo sintético recuperable'}:payload),{status:fail?503:200,headers:{'Content-Type':'application/json'}});};
    const initial=mapQuerySchema.parse({bounds:f.national?MAP_AREA:{west:-98.32,south:18.94,east:-98.10,north:19.15}});
    function Harness(){const [tick,setTick]=useState(0);f.redraw=()=>setTick(n=>n+1);
      if(location.pathname==='/picker')return <LocationPicker initialLat={19.04} initialLng={-98.21} initialRadius={5} onRadiusChange={n=>f.radiusWrites.push(n)} showRadiusControl={false} showRadiusPreview={f.circle} onChange={p=>f.locationWrites.push(p)}/>;
      return f.mounted?<MapExplorer key={f.session} viewerScope={f.viewer} initialQuery={initial} initialCenter={f.national?null:{lat:19.04,lng:-98.21}}/>:null;
    }
    createRoot(document.getElementById('root')).render(<Harness/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [{ name: 'boundaries', setup(b: any) { b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'mock' } : undefined); b.onLoad({ filter: /.*/, namespace: 'mock' }, (a: any) => ({ contents: mocks[a.path], loader: 'tsx', resolveDir: web })); } }] });
  const postcss = createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
  const cssFile = path.join(web, 'app/globals.css');
  const { css } = await postcss([req('@tailwindcss/postcss')({ base: web })]).process(readFileSync(cssFile, 'utf8'), { from: cssFile });
  if (process.argv.includes('--serve-fixture')) {
    const port = Number(process.env.S11_FIXTURE_PORT ?? 4182);
    const fixture = { maps: [], overlays: [], requests: [], gps: 0, geocode: 0, ui: {}, session: 'a', viewer: 'guest', theme: 'light', available: true, mounted: true, radiusWrites: [], locationWrites: [] };
    const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mapa F02 - datos simulados</title><link rel="stylesheet" href="/fixture.css"><body><aside style="padding:12px;border-bottom:1px solid #bbb"><strong>Datos simulados. SDK y transporte locales; no representa Apple Maps.</strong><div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"><button class="discovery-control" onclick="scenario(1)">Una publicación</button><button class="discovery-control" onclick="scenario(35)">Grupo de 35</button><button class="discovery-control" onclick="scenario(120)">Grupo de 120</button><button class="discovery-control" onclick="toggleTheme()">Claro / oscuro</button></div></aside><div id="root"></div><script>window.f=${JSON.stringify(fixture)};function scenario(count){const f=window.f;f.remoteTotal=count;f.revision=String(count%10).repeat(32);window.dispatchEvent(new CustomEvent('vicino:data-invalidated',{detail:'/api/products'}));}function toggleTheme(){const f=window.f;f.theme=f.theme==='dark'?'light':'dark';document.documentElement.classList.toggle('dark',f.theme==='dark');f.redraw();}</script><script src="/fixture.js"></script></body></html>`;
    const server = createServer((request, response) => {
      if (request.url === '/fixture.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' }); response.end(bundle.outputFiles[0].text); }
      else if (request.url === '/fixture.css') { response.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' }); response.end(css); }
      else if (request.url === '/' || request.url === '/mapa') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html); }
      else { response.writeHead(404); response.end(); }
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    console.log('S11 fixture: http://127.0.0.1:' + port + '/mapa; datos simulados, CSS real, sin servicios remotos.');
    return;
  }
  const out = path.join(web, 'test-results/s11'); mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); let passed = 0;
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport }); const page = await context.newPage(); page.setDefaultTimeout(8000); const errors: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.route('**/*', async (route: any) => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' }) : route.abort());
      const pass = (name: string) => { passed++; console.log('PASS ' + viewport.width + ' ' + name); };
      async function mount(route = '/mapa', extra = {}) { await page.goto('https://s11.invalid' + route); await page.evaluate(extra => { (window as any).f = { maps: [], overlays: [], requests: [], gps: 0, geocode: 0, ui: {}, session: 'a', viewer: 'guest', theme: 'light', available: true, mounted: true, radiusWrites: [], locationWrites: [], ...extra }; }, extra); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text }); }
      await mount(); try { await expect(page.getByText('35 publicaciones · 3 vendedores', { exact: true })).toBeVisible(); } catch (error) { console.error(JSON.stringify({ errors, fixture: await page.evaluate(() => ({ text: document.body.innerText, requests: (window as any).f.requests })) }, null, 2)); throw error; } await expect.poll(() => page.evaluate(() => (window as any).f.requests.some((r: any) => r.r.action === 'cells'))).toBe(true);
      await expect(page.locator('article')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Filtros', exact: true })).toHaveCount(1); assert.equal(await page.evaluate(() => (window as any).f.gps), 0); assert.equal(await page.evaluate(() => (window as any).f.geocode), 0); assert.equal(await page.evaluate(() => (window as any).f.maps.length), 1); pass('no permanent products or duplicate filters; one SDK; no GPS/geocode');
      const initialCalls = await page.evaluate(() => (window as any).f.requests.length); await page.evaluate(async() => { const f = (window as any).f; f.savedMarker=f.map().markers[0];for(let i=0;i<20;i++){f.camera(19.05+i*.0001,-98.22,i%2?.07:.15);await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));}}); await page.waitForTimeout(550); assert.equal(await page.evaluate(() => (window as any).f.requests.length), initialCalls); assert.equal(await page.evaluate(() => (window as any).f.maps.length), 1); assert.equal(await page.evaluate(()=>(window as any).f.map().markers[0]===(window as any).f.savedMarker),true); pass('20 pan/zoom events retain the same annotation and make zero new publication API calls');
      await page.locator('[data-marker]').first().click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('article')).toHaveCount(30); await expect(page.getByRole('dialog')).toContainText('35 publicaciones · 3 vendedores'); await page.getByRole('button', { name: 'Ver más publicaciones', exact: true }).click(); await expect(page.locator('article')).toHaveCount(35);
      const detailCalls = await page.evaluate(() => (window as any).f.requests.filter((r: any) => r.r.action === 'listings').length); await page.evaluate(() => (window as any).f.camera(19.05, -98.22, .05)); await page.waitForTimeout(450); assert.equal(await page.evaluate(() => (window as any).f.requests.filter((r: any) => r.r.action === 'listings').length), detailCalls); pass('pin drawer loads 30, cursor appends 5, group remains frozen on camera');
      await page.getByRole('button', { name: 'Cerrar publicaciones', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('article')).toHaveCount(0); assert.equal(await page.locator('[data-marker]').first().evaluate(el => document.activeElement === el), true); pass('X closes and returns focus to the retained pin without opening the keyboard');
      const zonesToggle = page.getByRole('button', { name: 'Ver zonas (1)', exact: true });
      await expect(zonesToggle).toBeVisible(); await expect(zonesToggle).toHaveAttribute('aria-expanded','false');
      const zonesRegion = page.getByRole('region', { name: 'Zonas del mapa', exact: true });
      const accessiblePoint = page.getByRole('button', { name: 'Zona 1 · 35 publicaciones', exact: true });
      assert.equal(await zonesRegion.evaluate(el=>el.getBoundingClientRect().width<2),true);
      await zonesToggle.click(); await expect(page.getByRole('button',{name:'Ocultar zonas (1)',exact:true})).toHaveAttribute('aria-expanded','true');
      await expect(accessiblePoint).toBeVisible(); assert.equal(await zonesRegion.evaluate(el=>el.getBoundingClientRect().width>100),true);
      const listingsBeforeArea = await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='listings').length);
      await page.getByRole('button',{name:'Ver área de la zona 1',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>(window as any).f.map().region.span.longitudeDelta)).toBe(.015);
      const framed = await page.evaluate(()=>{const r=(window as any).f.map().region;return {lat:r.center.latitude,lng:r.center.longitude,latSpan:r.span.latitudeDelta,lngSpan:r.span.longitudeDelta};});
      assert.ok(Math.abs(framed.lat-19.04)<1e-8 && Math.abs(framed.lng+98.23)<1e-8);
      assert.ok(framed.latSpan>=.013 && framed.lngSpan>=.013,'frame contains the full public cell and margin');
      await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('article')).toHaveCount(0);
      assert.equal(await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='listings').length),listingsBeforeArea);
      pass('visible zone list toggles and public area framing opens no detail or listings query');
      await accessiblePoint.click(); await expect(page.getByRole('dialog',{name:'Publicaciones en esta zona',exact:true})).toBeVisible();
      await expect(page.locator('article')).toHaveCount(30);
      const listSelection = await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='listings').at(-1).r);
      assert.deepEqual(listSelection.coverage_center,{lat:19.04,lng:-98.21}); assert.equal(listSelection.revision,'b'.repeat(32)); assert.equal(listSelection.query.q,''); assert.equal(listSelection.query.cell_id,'cell:1:-9823:1904');
      await expect(page.getByText('Cotización', { exact: true })).toBeVisible(); await expect(page.getByText('Reservación', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Ver más publicaciones', exact: true }).click(); await expect(page.locator('article')).toHaveCount(35);
      await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); assert.equal(await accessiblePoint.evaluate(el=>document.activeElement===el),true);
      pass('visible list selection preserves query, revision and coverage context; Escape returns focus');
      await page.getByRole('button',{name:'Ocultar zonas (1)',exact:true}).click();
      await expect(page.getByRole('button',{name:'Ver zonas (1)',exact:true})).toHaveAttribute('aria-expanded','false');
      assert.equal(await zonesRegion.evaluate(el=>el.getBoundingClientRect().width<2),true);
      await accessiblePoint.focus(); await expect(accessiblePoint).toBeVisible(); await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible(); await expect(page.locator('article')).toHaveCount(30);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      await expect(page.getByRole('dialog')).toHaveCount(0); assert.equal(await accessiblePoint.evaluate(el=>document.activeElement===el),true);
      pass('closed zone list retains the focus-only keyboard alternative and native Back/Escape focus return');
      await page.getByRole('searchbox').focus();await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=true;f.camera(19.05,-98.22,2);});await expect.poll(()=>page.evaluate(()=>(window as any).f.held?.length??0)).toBe(1);await expect(page.locator('[data-marker]')).toHaveCount(1);await page.locator('[data-marker]').first().click();await expect(page.locator('article')).toHaveCount(30);assert.deepEqual(await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='listings').at(-1).r.coverage_center),{lat:19.04,lng:-98.21});await page.keyboard.press('Escape');await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=false;f.held.splice(0).forEach((resolve:any)=>resolve());});await expect(page.getByText('35 publicaciones · 3 vendedores',{exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action!=='listings').at(-1).r.coverage_center),null);pass('camera handoff retains points and selected drawer uses their original coverage context');
      await page.getByRole('button', { name: 'Filtros', exact: true }).click(); const beforeDraft = await page.evaluate(() => (window as any).f.requests.length); await page.getByRole('button', { name: 'Productos', exact: true }).click(); await page.waitForTimeout(420); assert.equal(await page.evaluate(() => (window as any).f.requests.length), beforeDraft); await page.getByRole('button', { name: 'Aplicar', exact: true }).click(); await expect.poll(() => page.evaluate(() => (window as any).f.requests.at(-1).r.query.tipo)).toBe('producto'); assert.equal(new URL(page.url()).searchParams.get('tipo'), 'producto'); pass('filter draft does not query; apply persists URL');
      await page.evaluate(() => { const f = (window as any).f; f.camera(19.05, -98.22, 2); }); await expect.poll(() => page.evaluate(() => (window as any).f.requests.at(-1).r.coverage_center)).toBe(null); await page.evaluate(() => (window as any).f.camera(19.05, -98.22, .1)); await expect.poll(() => page.evaluate(() => (window as any).f.requests.at(-1).r.coverage_center?.lat)).toBe(19.05); assert.equal(await page.evaluate(() => (window as any).f.maps.length), 1); pass('regional wide zoom uses complete overview and refines again');
      await page.evaluate(() => { history.pushState(history.state, '', '/mapa?q=desde%20historial&tipo=servicio&price_min=50'); history.pushState(history.state, '', '/mapa?q=otra'); history.back(); }); await expect(page.getByRole('searchbox')).toHaveValue('desde historial'); await expect.poll(() => page.evaluate(() => (window as any).f.requests.at(-1).r.query.tipo)).toBe('servicio'); await expect.poll(() => page.evaluate(() => (window as any).f.requests.at(-1).r.query.price_min)).toBe(50); pass('Back restores URL filters instead of stale mounted state');
      await page.evaluate(() => { (window as any).f.theme = 'dark'; document.documentElement.classList.add('dark'); (window as any).f.redraw(); }); await expect.poll(() => page.evaluate(() => (window as any).f.map().colorScheme)).toBe('dark'); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.locator('[data-marker]').first().click(); await expect(page.getByRole('dialog')).toBeVisible(); await page.screenshot({ path: path.join(out, 'map-drawer-dark-' + viewport.width + '.png'), fullPage: false }); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); pass('dark and reduced-motion drawer close');
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.locator('[data-marker]').first().click(); await expect(page.getByRole('dialog')).toBeVisible(); await expect.poll(()=>page.getByRole('dialog').evaluate(el=>getComputedStyle(el).transform)).toBe('none'); const handle = page.getByRole('button', { name: 'Cerrar o deslizar hacia abajo las publicaciones', exact: true }); const box = await handle.boundingBox(); assert.ok(box); await page.mouse.move(box.x + box.width / 2, box.y + 12); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + 175, { steps: 12 }); await page.mouse.up(); await expect(page.getByRole('dialog')).toHaveCount(0); pass('dragging the settled sheet handle dismisses downward');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('vicino_location_updated', { detail: null }))); await expect(page.getByRole('button', { name: 'Activar ubicación', exact: true })).toBeVisible(); await expect.poll(() => page.evaluate(() => (window as any).f.requests.at(-1).r.coverage_center)).toBe(null); assert.equal(await page.evaluate(() => (window as any).f.map().region.span.longitudeDelta), 32); pass('clearing location returns to Mexico without invented preference');
      await page.locator('[data-marker]').first().click(); await expect(page.locator('article')).toHaveCount(30); await page.evaluate(() => { const f = (window as any).f; f.remoteEmpty = true; f.revision = 'c'.repeat(32); document.dispatchEvent(new Event('visibilitychange')); }); await expect(page.getByText('Ya no hay publicaciones en esta zona', { exact: true })).toBeVisible(); await expect(page.locator('article')).toHaveCount(0); await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); pass('visible drawer revalidates changed revision and removes expired cards');
      await mount();await expect(page.locator('[data-marker]')).toHaveCount(1);await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=true;});await page.getByRole('searchbox').fill('nuevo filtro');await expect(page.locator('[data-marker]')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).f.held?.length??0)).toBe(1);await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=false;f.held.splice(0).forEach((resolve:any)=>resolve());});await expect(page.locator('[data-marker]')).toHaveCount(1);pass('filter change purges incompatible points while its coverage is loading');
      await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=true;window.dispatchEvent(new CustomEvent('vicino:data-invalidated',{detail:'/api/session'}));});await expect(page.locator('[data-marker]')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).f.held?.length??0)).toBe(1);await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=false;f.held.splice(0).forEach((resolve:any)=>resolve());});await expect(page.locator('[data-marker]')).toHaveCount(1);pass('data invalidation purges retained layer before reloading');
      await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=true;f.viewer='account-2';f.redraw();});await expect(page.locator('[data-marker]')).toHaveCount(0);await expect.poll(()=>page.evaluate(()=>(window as any).f.held?.length??0)).toBe(1);await page.evaluate(()=>{const f=(window as any).f;f.holdCoverage=false;f.held.splice(0).forEach((resolve:any)=>resolve());});await expect(page.locator('[data-marker]')).toHaveCount(1);pass('viewer changes cannot display retained points from the previous scope');
      await mount(); await expect(page.locator('[data-marker]')).toHaveCount(1);
      await page.evaluate(() => { const f = (window as any).f; f.failCoverage = true; f.camera(19.05, -98.22, 2); });
      await expect(page.getByRole('alert')).toContainText('Fallo sintético recuperable');
      await expect(page.getByText('35 publicaciones · 3 vendedores', { exact: true })).toBeVisible();
      await expect(page.locator('[data-marker]')).toHaveCount(1);
      await page.locator('[data-marker]').click(); await expect(page.locator('article')).toHaveCount(30);
      assert.deepEqual(await page.evaluate(() => (window as any).f.requests.filter((r: any) => r.r.action === 'listings').at(-1).r.coverage_center), { lat: 19.04, lng: -98.21 });
      await page.keyboard.press('Escape');
      await page.evaluate(() => { (window as any).f.failCoverage = false; });
      await page.getByRole('button', { name: 'Reintentar publicaciones', exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByText('35 publicaciones · 3 vendedores', { exact: true })).toBeVisible();
      await page.locator('[data-marker]').click(); await expect(page.locator('article')).toHaveCount(30);
      assert.equal(await page.evaluate(() => (window as any).f.requests.filter((r: any) => r.r.action === 'listings').at(-1).r.coverage_center), null);
      await page.keyboard.press('Escape'); pass('failed coverage retains the original context, ends pending and retry recovers the new context');

      await page.evaluate(() => { const f = (window as any).f; f.holdCoverage = true; f.camera(19.05, -98.22, .1); });
      await expect.poll(() => page.evaluate(() => (window as any).f.held?.length ?? 0)).toBe(1);
      assert.equal(await page.evaluate(() => { const f = (window as any).f, old = f.requests.at(-1); window.dispatchEvent(new CustomEvent('vicino:data-invalidated', { detail: '/api/products' })); f.remoteTotal = 42; f.revision = 'c'.repeat(32); f.holdCoverage = false; f.held.splice(0).forEach((resolve: any) => resolve()); return old.aborted; }), true);
      await expect(page.getByText('42 publicaciones · 3 vendedores', { exact: true })).toBeVisible();
      await expect(page.locator('[data-marker]')).toHaveText('42');
      pass('same-cycle invalidation aborts late coverage before it can restore the old generation or cache');

      await page.evaluate(() => { (window as any).f.holdListings = true; }); await page.locator('[data-marker]').click();
      await expect.poll(() => page.evaluate(() => (window as any).f.held?.length ?? 0)).toBe(1);
      assert.equal(await page.evaluate(() => { const f = (window as any).f, old = f.requests.filter((r: any) => r.r.action === 'listings').at(-1); window.dispatchEvent(new CustomEvent('vicino:data-invalidated', { detail: '/api/products' })); f.remoteEmpty = true; f.revision = 'd'.repeat(32); f.holdListings = false; f.held.splice(0).forEach((resolve: any) => resolve()); return old.aborted; }), true);
      await expect(page.getByText('Ya no hay publicaciones en esta zona', { exact: true })).toBeVisible(); await expect(page.locator('article')).toHaveCount(0);
      await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape');
      pass('same-cycle invalidation aborts late detail and expired cards never return');

      await mount('/mapa', { available: false }); await expect(page.getByRole('link', { name: 'Ver publicaciones de esta zona', exact: true })).toBeVisible(); await expect(page.locator('article')).toHaveCount(0); pass('SDK failure preserves accessible catalog link');
      await mount('/picker', { circle: false }); await expect(page.locator('[data-testid="sdk-map"]')).toBeVisible(); await expect(page.getByRole('slider')).toHaveCount(0); assert.equal(await page.evaluate(() => (window as any).f.overlays.length), 0); await page.evaluate(() => { const f = (window as any).f; f.point = { latitude: 19.06, longitude: -98.22 }; f.map().events['single-tap']({ pointOnPage: { x: 1, y: 1 } }); }); await expect.poll(() => page.evaluate(() => (window as any).f.locationWrites.at(-1)?.lat)).toBe(19.06); assert.deepEqual(await page.evaluate(() => (window as any).f.radiusWrites), []); assert.equal(await page.evaluate(() => (window as any).f.map().recenters), 0); pass('publication preview hides circle/control, preserves pin and saved radius contract');
      await mount('/picker'); await expect.poll(() => page.evaluate(() => (window as any).f.overlays.at(-1)?.radius)).toBe(5000); pass('other pickers retain their default radius preview');
      await mount('/mapa',{refiningZones:true});
      await expect.poll(()=>page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='cells').length)).toBe(2);
      await expect.poll(()=>page.evaluate(()=>(window as any).f.map().markers.length)).toBe(80);
      await page.getByRole('button',{name:'Ver zonas (80)',exact:true}).click();
      const coarseIds=await page.evaluate(()=>(window as any).f.map().markers.map((marker:any)=>marker.coordinate));
      const detailsBeforeRefine=await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='listings').length);
      await page.getByRole('button',{name:'Ver área de la zona 1',exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>(window as any).f.map().markers.length)).toBeLessThan(80);
      const focusedToggle=page.getByRole('button',{name:/Ocultar zonas \(\d+\)/});
      await expect(focusedToggle).toBeFocused(); await expect(page.getByRole('dialog')).toHaveCount(0);
      assert.equal(await page.evaluate(()=>(window as any).f.requests.filter((r:any)=>r.r.action==='listings').length),detailsBeforeRefine);
      assert.notDeepEqual(await page.evaluate(()=>(window as any).f.map().markers.map((marker:any)=>marker.coordinate)),coarseIds);
      await expect(page.getByRole('button',{name:'Zona 1 · 1 publicación',exact:true})).toBeVisible();
      pass('area refinement replaces coarse group IDs with single public cells and preserves focus on the zone toggle');
      if (viewport.width === 390) {
        await page.setViewportSize({width:320,height:844});
        for (const count of [120,1234567890]) for (const theme of ['light','dark']) {
          await mount('/mapa',{remoteTotal:count,theme});
          await page.evaluate(theme=>{document.documentElement.style.fontSize='200%';document.documentElement.classList.toggle('dark',theme==='dark');},theme);
          await expect(page.locator('[data-marker]')).toHaveCount(1);
          await page.getByRole('button',{name:'Ver zonas (1)',exact:true}).click();
          const zoneRow = page.getByRole('button',{name:'Zona 1 · '+count+' publicaciones',exact:true});
          await expect(zoneRow).toBeVisible();
          const metrics = await zoneRow.evaluate(button=>{const row=button.parentElement!,area=row.querySelector('[aria-label="Ver área de la zona 1"]')!,b=button.getBoundingClientRect(),r=row.getBoundingClientRect(),a=area.getBoundingClientRect();return {buttonScroll:button.scrollWidth,buttonWidth:button.clientWidth,rowScroll:row.scrollWidth,rowWidth:row.clientWidth,left:r.left,right:r.right,buttonRight:b.right,areaRight:a.right,viewport:innerWidth};});
          assert.ok(metrics.buttonScroll<=metrics.buttonWidth+1,'zone text overflows at 320px / 200% / '+theme+' / '+count+': '+JSON.stringify(metrics));
          assert.ok(metrics.rowScroll<=metrics.rowWidth+1 && metrics.left>=-1 && metrics.right<=metrics.viewport+1 && metrics.areaRight<=metrics.viewport+1,'zone actions overflow at 320px / 200%: '+JSON.stringify(metrics));
          pass('320px 200% font '+theme+' zone '+count+' keeps text and both actions within the viewport');
        }
      }
      assert.deepEqual(errors, []); await context.close();
    }
  } finally { await browser.close(); }
  console.log('S11 map browser: ' + passed + '/' + passed + ' PASS; controlled SDK and transport');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
