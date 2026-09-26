/** Real React consumers and AppleMapContainer in Chrome. Apple SDK, GPS, Auth
 * and geocoder are controlled boundaries; no production accounts or network. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';
const web = path.resolve(__dirname, '../apps/web');
const requireWeb = createRequire(path.join(web, 'package.json'));
const esbuild = requireWeb(requireWeb.resolve('esbuild', { paths: [requireWeb.resolve('tsx')] }));
const { chromium, expect } = requireWeb('@playwright/test');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
async function main() {
  const mocks: Record<string, string> = {
    'next/dynamic': `import React,{Suspense,lazy} from 'react';export default function dynamic(load,options){const C=lazy(load);return props=><Suspense fallback={options?.loading?React.createElement(options.loading):null}><C {...props}/></Suspense>;}`,
    'next-themes': `export const useTheme=()=>({resolvedTheme:window.f.theme});`,
    'next/navigation': `const router={refresh:()=>window.f.refreshes++,push:p=>window.f.pushes.push(p)};export const useRouter=()=>router;`,
    '@/hooks/use-mapkit': `export const useMapKit=()=>({isReady:true,isAvailable:true,mapkit:window.f.sdk,retryWaitSeconds:0});`,
    '@/hooks/useGeolocation': `export const STORAGE_KEY='synthetic-location';const setManualPosition=p=>window.f.writes.push(p);export const useGeolocation=()=>({state:window.f.geo,setManualPosition,setRadius:()=>{throw new Error('radius must be atomic');}});`,
    '@/lib/geo/apple-geocoder': `export const reverseGeocodeWithApple=async()=>({name:'Puebla sintética',fullName:'Puebla sintética, México'});`,
    '@/lib/geo/location-search': `export {clasificarResultado} from ${JSON.stringify(path.join(web, 'lib/geo/location-search.ts'))};
      export const searchLocations=async q=>({results:[{id:q,name:q,fullName:q,lat:19.08,lng:-98.24}],outOfCoverage:false});
      export const resolveLocationCoordinates=async s=>window.f.holdResolve?new Promise(resolve=>window.f.resolve=()=>resolve(s)):s;`,
    '@/components/profile/avatar-inline-upload': `export const AvatarInlineUpload=()=>null;`,
    '@/app/(marketplace)/perfil/actions': `export const completeOnboarding=async()=>({});`,
    './actions': `export const guardarPasoOnboarding=async()=>({});`,
  };
  const bundle = await esbuild.build({ stdin: { resolveDir: web, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {ChangeLocationSheet} from './components/home/change-location-sheet';
    import LocationPicker from './components/map/location-picker';
    import CentroMap from './components/comunidades/admin/centro-map';
    import {CompletarPerfil} from './app/(onboarding)/completar-perfil/completar-perfil';
    import {LocationBanner} from './components/product/location-banner';
    const f=window.f;
    class Coordinate {constructor(latitude,longitude){Object.assign(this,{latitude,longitude});}}
    class Region {constructor(center,span){Object.assign(this,{center,span});}}
    class Span {constructor(latitudeDelta,longitudeDelta){Object.assign(this,{latitudeDelta,longitudeDelta});}}
    class Marker {constructor(coordinate){this.coordinate=coordinate;this.events={};}addEventListener(type,cb){this.events[type]=cb;}}
    class Map {static ColorSchemes={Dark:'dark',Light:'light'};constructor(node,options){this.events={};this.region=options.region;this.recenters=0;f.maps.push(this);node.dataset.testid='mapkit-canvas';}
      addEventListener(t,cb){this.events[t]=cb;}convertPointOnPageToCoordinate(){return f.point;}
      setRegionAnimated(region){this.region=region;this.recenters++;}addAnnotation(m){this.marker=m;}removeAnnotation(){}addOverlay(){}removeOverlay(){}destroy(){this.destroyed=true;}}
    f.sdk={Map,Coordinate,CoordinateRegion:Region,CoordinateSpan:Span,MarkerAnnotation:Marker,CircleOverlay:class{},Style:class{},FeatureVisibility:{Adaptive:'adaptive',Hidden:'hidden'}};
    f.map=()=>f.maps.filter(m=>!m.destroyed).at(-1);
    f.tap=(lat,lng)=>{f.point=new Coordinate(lat,lng);f.map().events['single-tap']({pointOnPage:{x:1,y:1}});};
    f.drag=(lat,lng)=>{const m=f.map().marker;m.coordinate=new Coordinate(lat,lng);m.events['drag-end']();};
    Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(ok,fail)=>f.gps.push({ok,fail})}});
    function Harness(){const [open,setOpen]=useState(true),[value,setValue]=useState(null),[tick,setTick]=useState(0);
      f.setOpen=setOpen;f.redraw=()=>setTick(n=>n+1);
      if(location.pathname==='/sheet')return <><button onClick={()=>setOpen(true)}>Abrir</button><ChangeLocationSheet open={open} onClose={()=>setOpen(false)}/></>;
      if(location.pathname==='/profile')return <CompletarPerfil pasoInicial="ubicacion" nombreInicial="Prueba" bioInicial="Prueba" fotoInicial="" interesesIniciales={[]}/>;
      if(location.pathname==='/preview')return <div className="preview">{['mobile','desktop'].map(layout=><div key={layout} className={layout==='mobile'?'md:hidden':'hidden md:block'}><LocationBanner layout={layout} available={f.available} productId="00000000-0000-4000-8000-000000000001" version={f.version} ubicacion="Puebla, México"/></div>)}</div>;
      if(location.pathname==='/center')return <CentroMap lat={value?.lat??19.04} lng={value?.lng??-98.2} vista={{lat:19.04,lng:-98.2}} onMove={(lat,lng)=>setValue({lat,lng})}/>;
      return <><LocationPicker initialLat={19.04} initialLng={-98.2} allowGeolocation onChange={v=>{f.selections.push(v);setValue(v);}}/><output>{JSON.stringify(value)}</output></>;
    }
    f.unmount=()=>root.unmount();const root=createRoot(document.getElementById('root'));root.render(<Harness/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' }, plugins: [{ name: 'boundaries', setup(b: any) {
      b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'mock' }, (a: any) => ({ contents: mocks[a.path], loader: 'tsx', resolveDir: web }));
    } }] });
  const cssDir = path.join(web, '.next/static/css');
  const css = readdirSync(cssDir).filter(f => f.endsWith('.css')).map(f => readFileSync(path.join(cssDir, f), 'utf8')).join('\n');
  const out = path.join(web, 'test-results/s05'); mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let passed = 0;
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1000 });
      const page = await context.newPage(); page.setDefaultTimeout(7000);
      const errors: string[] = [], unexpected: string[] = [], requests: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(e.message));
      let responseStatus = 200, responseCode = '', retryAfter = '1';
      await page.route('**/*', async (route: any) => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === 'https://s05.invalid' && request.isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root" style="max-width:640px;margin:auto;padding:20px"></div></body></html>' });
        if (url.origin === 'https://s05.invalid' && url.pathname.includes('/location-map')) {
          requests.push(url.href); return route.fulfill(responseStatus === 200 ? { contentType: 'image/png', body: png } : { status: responseStatus, contentType: 'application/json', headers: { 'Retry-After': retryAfter }, body: JSON.stringify({ code: responseCode }) });
        }
        unexpected.push(url.href); await route.abort();
      });
      async function mount(route: string, extra: object = {}) {
        requests.length = 0; await page.goto('https://s05.invalid' + route);
        await page.evaluate((extra: any) => { (window as any).f = { maps: [], gps: [], writes: [], selections: [], pushes: [], refreshes: 0, theme: 'light', available: true, version: '1', geo: { status: 'success', position: { lat: 19.04, lng: -98.2, radius: 10000, name: 'Anterior', fullName: 'Anterior' } }, ...extra }; }, extra);
        await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
        if (route !== '/preview') {
          try { await expect.poll(() => page.evaluate(() => !!(window as any).f.map?.())).toBe(true); }
          catch (error) { console.error('Harness errors:', errors, await page.locator('body').innerText()); throw error; }
        }
      }
      async function writes() { return page.evaluate(() => (window as any).f.writes); }
      async function pin(lat = 19.09, lng = -98.25) { await page.evaluate(([lat,lng]: number[]) => (window as any).f.tap(lat,lng), [lat,lng]); await expect.poll(() => page.evaluate(() => (window as any).f.map().marker.coordinate.latitude)).toBe(lat); }
      const pass = (name: string) => { passed++; console.log('PASS', viewport.width, name); };

      for (const route of ['/sheet', '/profile']) {
        await mount(route, { geo: { status: 'loading' } });
        await page.evaluate(() => { const f=(window as any).f;f.geo={status:'success',position:{lat:19.3,lng:-98.1,radius:5000,name:'Guardada'}};f.redraw(); });
        await expect.poll(() => page.evaluate(() => (window as any).f.map().marker.coordinate.latitude)).toBe(19.3);
        await pin();
        await page.evaluate(() => { const f=(window as any).f;f.geo={status:'success',position:{lat:19.4,lng:-98.2,radius:10000,name:'Externa'}};f.redraw(); });
        await expect.poll(() => page.evaluate(() => (window as any).f.map().marker.coordinate.latitude)).toBe(19.09);
        assert.deepEqual(await writes(), []); pass(route + ': late cached position loads without overwriting an edited draft');
      }

      await mount('/sheet');
      await page.evaluate(() => { const f=(window as any).f;f.map().region.span.latitudeDelta=.001; });
      await pin(); await page.locator('select').selectOption('25000');
      assert.deepEqual(await writes(), []);
      assert.equal(await page.evaluate(() => (window as any).f.map().recenters), 0);
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir', exact: true }).click();
      await expect(page.locator('select')).toHaveValue('10000');
      await expect.poll(() => page.evaluate(() => (window as any).f.map().marker.coordinate.latitude)).toBe(19.04);
      assert.deepEqual(await writes(), []); pass('cancel discards pin/radius and restores previous selection; zoom preserved');

      await pin(); await page.locator('select').selectOption('5000');
      await page.getByRole('button', { name: 'Aplicar ubicación' }).click();
      await expect.poll(async () => (await writes()).length).toBe(1);
      assert.equal((await writes())[0].radius, 5000); assert.equal((await writes())[0].lat, 19.09);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('vicino_recent_locations')!)[0].lat), 19.09);
      pass('apply atomically persists selected location/radius once');

      await mount('/sheet');
      await page.getByRole('button', { name: /Usar mi ubicación actual/ }).click();
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir', exact: true }).click();
      await page.evaluate(() => (window as any).f.gps[0].ok({ coords: { latitude: 19.12, longitude: -98.22 } }));
      await pin(19.08, -98.23); await page.getByRole('button', { name: 'Aplicar ubicación' }).click();
      assert.equal((await writes())[0].lat, 19.08); pass('GPS from closed session cannot commit after reopen');

      await mount('/sheet', { holdResolve: true });
      await page.getByPlaceholder('Buscar zona, colonia o dirección…').fill('Lugar pendiente');
      await page.getByRole('button', { name: 'Lugar pendiente' }).click();
      await expect.poll(() => page.evaluate(() => !!(window as any).f.resolve)).toBe(true);
      await pin(); await page.evaluate(() => (window as any).f.resolve());
      await page.getByRole('button', { name: 'Aplicar ubicación' }).click();
      assert.equal((await writes())[0].lat, 19.09); pass('late address resolution cannot overwrite newer pin');

      await mount('/sheet');
      await page.evaluate(() => (window as any).f.drag(40,-74));
      await expect.poll(() => page.evaluate(() => (window as any).f.map().marker.coordinate.latitude)).toBe(19.04);
      await page.getByRole('button', { name: /Usar mi ubicación actual/ }).click();
      await page.evaluate(() => (window as any).f.gps[0].fail({code:1}));
      await expect(page.getByText('Permiso de ubicación denegado')).toBeVisible();
      assert.deepEqual(await writes(), []); pass('invalid drag restores marker; denied GPS preserves location');
      await page.screenshot({ path: path.join(out, `sheet-${viewport.width}.png`) });

      for (const route of ['/picker','/center','/profile']) {
        await mount(route); await pin();
        assert.equal(await page.evaluate(() => (window as any).f.map().recenters), 0);
        assert.equal(await page.evaluate(() => (window as any).f.maps.length), 1);
        assert.deepEqual(await writes(), []);
        if (route === '/profile') {
          await page.getByRole('button', { name: 'Entrar a VICINO' }).click();
          await expect.poll(async () => (await writes()).length).toBe(1);
          assert.equal((await writes())[0].lat, 19.09);
        }
        pass(route + ': pin preserves zoom, persistence belongs to consumer confirmation');
      }
      await mount('/profile', { holdResolve: true });
      await page.getByPlaceholder('Busca tu colonia, municipio o código postal…').fill('Consulta vieja');
      await page.getByRole('button', { name: 'Consulta vieja' }).click();
      await expect.poll(() => page.evaluate(() => !!(window as any).f.resolve)).toBe(true);
      await page.getByRole('button', { name: 'Borrar búsqueda' }).click();
      await pin(); await page.evaluate(() => (window as any).f.resolve());
      await page.getByRole('button', { name: 'Entrar a VICINO' }).click();
      assert.equal((await writes())[0].lat, 19.09); pass('onboarding ignores cleared late result');

      await mount('/picker');
      await page.getByRole('button', { name: 'Usar mi ubicación', exact: true }).click();
      await page.evaluate(() => (window as any).f.gps[0].ok({coords:{latitude:19.12,longitude:-98.22}}));
      await expect.poll(() => page.evaluate(() => (window as any).f.map().recenters)).toBe(1);
      await pin(); assert.equal(await page.evaluate(() => (window as any).f.map().recenters), 1);
      pass('explicit GPS recenters once; subsequent tap preserves zoom');

      responseStatus=200; await mount('/preview');
      await expect(page.getByRole('img')).toHaveCount(1);
      await expect(page.locator('section:visible span[aria-hidden]')).toHaveCount(1);
      assert.equal(requests.length,1); assert.ok(!/lat|lng|signature|teamId/.test(requests[0]));
      await page.evaluate(()=>{(window as any).f.theme='dark';(window as any).f.redraw();});
      await expect.poll(()=>requests.length).toBe(2);
      assert.ok(requests[1].includes('theme=dark')); pass('one protected PNG per active layout/theme');

      responseStatus=404; responseCode='location_missing'; await mount('/preview');
      await expect(page.getByText('Esta publicación no tiene una ubicación disponible.')).toBeVisible();
      await expect(page.getByRole('button',{name:/Reintentar/})).toHaveCount(0);
      await expect(page.getByRole('img')).toHaveCount(0); pass('missing location has no retry or fabricated map');

      responseStatus=429; retryAfter='1'; await mount('/preview');
      await expect(page.getByRole('button',{name:'Reintentar en 1 s'})).toBeDisabled();
      await expect(page.getByRole('button',{name:'Reintentar mapa'})).toBeEnabled();
      assert.equal(requests.length,1); responseStatus=200;
      await page.getByRole('button',{name:'Reintentar mapa'}).click();
      await expect(page.locator('section:visible span[aria-hidden]')).toHaveCount(1);
      assert.equal(requests.length,2); pass('429 respects delay and recovers only after manual retry');

      responseStatus=503; await mount('/preview');
      await expect(page.getByText('No se pudo cargar el mapa. Intenta de nuevo.')).toBeVisible();
      await expect(page.locator('section:visible span[aria-hidden]')).toHaveCount(0);
      await page.screenshot({path:path.join(out,`preview-error-${viewport.width}.png`)});
      pass('provider failure is recoverable and retains locality');
      assert.deepEqual(errors,[]); assert.deepEqual(unexpected,[]);
      await context.close();
    }
  } finally { await browser.close(); }
  console.log(`S05 browser: ${passed}/${passed} PASS; SDK/GPS/transport simulated, no remote writes.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
