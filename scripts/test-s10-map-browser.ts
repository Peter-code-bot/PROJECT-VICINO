/** Real MapExplorer, PublicationMap, request hook and LocationPicker in Chrome.
 * Apple SDK, transport, location sheet and session cache are controlled seams.
 * Screenshots are local synthetic fixtures, not a live geographic acceptance. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync,readdirSync,mkdirSync } from 'node:fs';
import path from 'node:path';
const web=path.resolve(__dirname,'../apps/web'),req=createRequire(path.join(web,'package.json'));
const esbuild=req(req.resolve('esbuild',{paths:[req.resolve('tsx')]}));
const {chromium,expect}=req('@playwright/test');
async function main(){
  const mocks:Record<string,string>={
    'next/link':`import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}`,
    'next/image':`import React from 'react';export default function Image({fill,sizes,...props}){return <img {...props}/>;}`,
    'next/dynamic':`import React,{lazy,Suspense} from 'react';export default function dynamic(load){const C=lazy(load);return p=><Suspense fallback={null}><C {...p}/></Suspense>;}`,
    'next-themes':`export const useTheme=()=>({resolvedTheme:window.f.theme});`,
    '@/hooks/use-mapkit':`export const useMapKit=()=>({isReady:!window.f.loading,isAvailable:window.f.available,mapkit:window.f.sdk,retry:()=>{window.f.available=true;window.f.redraw();},retryWaitSeconds:0});`,
    '@/components/layout/session-data-provider':`import {useState} from 'react';export function useSessionUI(key,initial){const [ui,setUI]=useState(()=>window.f.ui[key]??initial);return [ui,v=>{window.f.ui[key]=v;setUI(v);}];}`,
    '@/hooks/useGeolocation':`export const useGeolocation=()=>({state:{status:'idle'},request:()=>{window.f.gps++;}});`,
    '@/components/home/change-location-sheet':`import React from 'react';export function ChangeLocationSheet({open,onClose}){return open?<div role="dialog"><button onClick={()=>{window.dispatchEvent(new CustomEvent('vicino_location_updated',{detail:{lat:19.09,lng:-98.19,radius:10000}}));onClose();}}>Aplicar zona de prueba</button></div>:null;}`,
    '@/lib/geo/location-search':`export const clasificarResultado=()=> 'ok';export const searchLocations=async()=>({results:[]});export const resolveLocationCoordinates=async s=>s;`,
    '@/lib/geo/cobertura':`export const useReglaCobertura=()=>({});`,
    '@/lib/geo/apple-geocoder':`export const reverseGeocodeWithApple=async()=>({name:'Zona sintética',fullName:'Zona sintética, México'});`,
  };
  const bundle=await esbuild.build({stdin:{resolveDir:web,loader:'tsx',contents:`
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {MapExplorer} from './app/(marketplace)/mapa/map-explorer';
    import {mapQuerySchema} from '@vicino/shared';import LocationPicker from './components/map/location-picker';
    const f=window.f;
    class Coordinate{constructor(latitude,longitude){Object.assign(this,{latitude,longitude});}}
    class Span{constructor(latitudeDelta,longitudeDelta){Object.assign(this,{latitudeDelta,longitudeDelta});}}
    class Region{constructor(center,span){Object.assign(this,{center,span});}}
    class Marker{constructor(coordinate,opts){this.coordinate=coordinate;this.opts=opts;this.events={};}addEventListener(t,cb){this.events[t]=cb;}}
    class Map{static ColorSchemes={Dark:'dark',Light:'light'};constructor(node,opts){this.node=node;this.region=opts.region;this.events={};this.markers=[];this.recenters=0;f.maps.push(this);node.dataset.testid='sdk-map';node.style.background='repeating-linear-gradient(33deg,transparent 0 80px,#d0ddce 82px 86px,transparent 88px 160px),#ecede3';}
      addEventListener(t,cb){this.events[t]=cb;}setRegionAnimated(r){this.region=r;this.recenters++;this.events['region-change-end']?.({});}
      addAnnotation(m){this.markers.push(m);const button=document.createElement('button');button.textContent=m.opts?.glyphText??'📍';button.title=m.opts?.title??'Pin';button.setAttribute('aria-label',button.title);button.dataset.marker='true';Object.assign(button.style,{position:'absolute',left:35+(this.markers.length*13)%55+'%',top:18+(this.markers.length*17)%65+'%',borderRadius:'50%',background:m.opts?.color??'#1F5A4E',color:'white',width:'42px',height:'42px',boxShadow:'0 2px 8px #8894'});button.onclick=()=>m.events.select?.();m.button=button;this.node.append(button);}
      removeAnnotation(m){m.button?.remove();this.markers=this.markers.filter(x=>x!==m);}convertPointOnPageToCoordinate(){return f.point;}addOverlay(o){f.overlays.push(o);}removeOverlay(){}destroy(){this.destroyed=true;this.node.replaceChildren();}}
    f.sdk={Map,Coordinate,CoordinateSpan:Span,CoordinateRegion:Region,MarkerAnnotation:Marker,CircleOverlay:class{constructor(c,r){this.radius=r;}},Style:class{},FeatureVisibility:{Adaptive:'a',Hidden:'h'}};
    f.map=()=>f.maps.filter(m=>!m.destroyed).at(-1);
    const uid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
    f.result=q=>{const cell=q.cell_id,second=!!q.cursor,count=cell?(cell.endsWith(':1')?15:10):35;return {query_key:'a'.repeat(32),projection_version:1,as_of:'2026-09-30',features:[1,2,3].map(n=>({id:'cell:3:-3275:'+n,public_lat:19.03+n*.01,public_lng:-98.24+n*.01,count:n===1?15:10,seller_count:1,bounds:{west:-98.23,south:19.04,east:-98.23,north:19.04}})),total:35,seller_total:3,list_total:count,listings:Array.from({length:second?5:Math.min(30,count)},(_,i)=>({id:uid(i+(second?31:1)),titulo:(q.q||'Publicación')+' '+(i+(second?31:1)),slug:'publicacion-'+i,categoria:'comida',precio:80+i,modo_precio:'fijo',tipo:'producto',imagen_principal:null,creador_id:uid(99),vendedor_nombre:'Negocio de prueba',cell_id:cell||'cell:3:-3275:1',seller_listing_count:3,created_at:'2026-09-30T12:00:00Z'})),next_cursor:!second&&!cell?{key:'a'.repeat(32),id:uid(30),created_at:'2026-09-30T12:00:00Z'}:null};};
    window.fetch=async(url,opts)=>{const q=JSON.parse(opts.body);const item={q,aborted:false};f.requests.push(item);if(f.never)return new Promise(()=>{});opts.signal.addEventListener('abort',()=>item.aborted=true);await new Promise(r=>setTimeout(r,q.q==='antigua'?1500:20));return {ok:!f.fail,json:async()=>f.fail?{error:'Fallo sintético recuperable'}:f.result(q)};};
    const initial=mapQuerySchema.parse({bounds:{west:-98.32,south:18.94,east:-98.10,north:19.15}});
    function Harness(){const [tick,setTick]=useState(0);f.redraw=()=>setTick(n=>n+1);
      if(location.pathname==='/picker')return <LocationPicker initialLat={19.04} initialLng={-98.21} initialRadius={5} onRadiusChange={n=>f.radiusWrites.push(n)} showRadiusControl={false} onChange={p=>f.locationWrites.push(p)}/>;
      return <MapExplorer key={f.session} initialQuery={initial} initialCenter={{lat:19.04,lng:-98.21}}/>;
    }
    const root=createRoot(document.getElementById('root'));f.unmount=()=>root.unmount();root.render(<Harness/>);
  `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'boundaries',setup(b:any){b.onResolve({filter:/.*/},(a:any)=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},(a:any)=>({contents:mocks[a.path],loader:'tsx',resolveDir:web}));}}]});
  const cssDir=path.join(web,'.next/static/css');const css=readdirSync(cssDir).filter(f=>f.endsWith('.css')).map(f=>readFileSync(path.join(cssDir,f),'utf8')).join('\n');
  const out=path.join(web,'test-results/s10');mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({channel:'chrome',headless:true});let passed=0;
  try{for(const viewport of [{width:390,height:844},{width:820,height:1180},{width:1280,height:900}]){
    const context=await browser.newContext({viewport});const page=await context.newPage();page.setDefaultTimeout(7000);const errors:string[]=[];
    page.on('pageerror',(e:Error)=>errors.push(e.message));
    await page.route('**/*',async(route:any)=>{if(route.request().isNavigationRequest())return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'});return route.abort();});
    async function mount(route='/mapa',extra={}){await page.goto('https://s10.invalid'+route);await page.evaluate(extra=>{(window as any).f={maps:[],overlays:[],requests:[],gps:0,ui:{},session:'a',theme:'light',available:true,radiusWrites:[],locationWrites:[],...extra};},extra);await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});}
    const pass=(name:string)=>{passed++;console.log('PASS '+viewport.width+' '+name);};
    await mount();await expect(page.getByText('35 publicaciones · 3 vendedores')).toBeVisible();await expect(page.locator('article')).toHaveCount(30);
    assert.equal(await page.evaluate(()=>(window as any).f.gps),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.equal(await page.evaluate(()=>(window as any).f.maps.length),1);pass('initial area, bounded page, no automatic GPS, no overflow');
    const activeColor=await page.getByRole('button',{name:'Todas',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor);assert.equal(activeColor,'rgb(31, 90, 78)');await page.screenshot({path:path.join(out,'map-light-'+viewport.width+'.png'),fullPage:false});
    await page.locator('[data-marker]').first().click();await expect(page.getByRole('heading',{name:'Publicaciones en este punto'})).toBeVisible();await expect(page.locator('article')).toHaveCount(15);
    await page.getByRole('button',{name:'Ver toda la zona',exact:true}).click();await expect(page.locator('article')).toHaveCount(30);
    await page.getByRole('button',{name:'Siguientes 30',exact:true}).click();await expect(page.locator('article')).toHaveCount(5);await expect(page.getByRole('heading',{name:'Publicación 31',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Primera página',exact:true}).click();await expect(page.locator('article')).toHaveCount(30);pass('point and list coherent; cursor page then first page');
    const input=page.getByRole('searchbox');await input.fill('antigua');await expect.poll(()=>page.evaluate(()=>(window as any).f.requests.some((r:any)=>r.q.q==='antigua'))).toBe(true);
    await input.fill('nueva');await expect(page.getByRole('heading',{name:'nueva 1',exact:true})).toBeVisible();await page.waitForTimeout(1700);await expect(page.getByRole('heading',{name:'nueva 1',exact:true})).toBeVisible();assert.ok(await page.evaluate(()=>(window as any).f.requests.find((r:any)=>r.q.q==='antigua').aborted));pass('late response ignored even if transport ignores abort');
    await page.getByRole('button',{name:'Cerca de mí',exact:true}).click();await page.getByRole('slider',{name:'Radio de búsqueda en kilómetros'}).fill('20');await expect.poll(()=>page.evaluate(()=>(window as any).f.requests.at(-1).q.radius_meters)).toBe(20000);
    await page.getByRole('button',{name:'Usar mi ubicación',exact:true}).click();assert.equal(await page.evaluate(()=>(window as any).f.gps),1);
    await page.getByRole('button',{name:'Cambiar zona',exact:true}).click();await page.getByRole('button',{name:'Aplicar zona de prueba',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).f.map().recenters)).toBe(1);pass('buyer radius, explicit GPS, manual zone retains one map instance');
    await page.evaluate(()=>{(window as any).f.fail=true;});await input.fill('fallo');await expect(page.getByRole('alert')).toContainText('Fallo sintético');await expect(page.locator('article')).toHaveCount(0);assert.equal(await page.locator('[data-marker]').count(),0);
    await page.evaluate(()=>{(window as any).f.fail=false;});await page.getByRole('button',{name:'Reintentar',exact:true}).click();await expect(page.locator('article')).toHaveCount(30);pass('error cannot retain stale cards or points; manual recovery');
    await page.evaluate(()=>{(window as any).f.theme='dark';document.documentElement.classList.add('dark');(window as any).f.redraw();});await expect.poll(()=>page.evaluate(()=>(window as any).f.map().colorScheme)).toBe('dark');await page.screenshot({path:path.join(out,'map-dark-'+viewport.width+'.png'),fullPage:false});pass('dark theme updates existing map');
    await mount('/mapa',{available:false,loading:true});await expect(page.getByText('Cargando mapa…',{exact:true})).toBeVisible();await page.evaluate(()=>{(window as any).f.loading=false;(window as any).f.redraw();});await expect(page.getByText('No pudimos cargar el mapa. Puedes explorar las publicaciones en la lista.')).toBeVisible();await expect(page.locator('article')).toHaveCount(30);pass('SDK failure leaves accessible listing alternative');
    await mount('/picker');await expect(page.locator('[data-testid="sdk-map"]')).toBeVisible();await expect(page.getByRole('slider')).toHaveCount(0);
    assert.equal(await page.evaluate(()=>(window as any).f.overlays.at(-1).radius),5000);
    await page.evaluate(()=>{const f=(window as any).f;f.point={latitude:19.06,longitude:-98.22};f.map().events['single-tap']({pointOnPage:{x:1,y:1}});});
    await expect.poll(()=>page.evaluate(()=>(window as any).f.locationWrites.at(-1)?.lat)).toBe(19.06);assert.deepEqual(await page.evaluate(()=>(window as any).f.radiusWrites),[]);assert.equal(await page.evaluate(()=>(window as any).f.map().recenters),0);pass('publication control hidden; original circle and pin interactions unchanged');
    if(viewport.width===390){await mount('/mapa',{never:true});await expect(page.getByRole('alert')).toContainText('La conexión tardó demasiado',{timeout:18000});await expect(page.locator('article')).toHaveCount(0);pass('hung transport stops with recoverable timeout');}assert.deepEqual(errors,[]);await context.close();
  }}finally{await browser.close();}console.log('S10 browser: '+passed+'/'+passed+' PASS; controlled SDK and transport');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
