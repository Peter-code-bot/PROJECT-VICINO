/** Real PublicationMap effects; strict simulated MapKit setters/listeners.
 * No Apple, API or DB calls. Object identity does not prove real device paint. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const web = path.resolve(__dirname, '../apps/web');
const req = createRequire(path.join(web, 'package.json'));
const esbuild = req(req.resolve('esbuild', { paths: [req.resolve('tsx')] }));
const { chromium, expect } = req('@playwright/test');

async function main() {
  const mocks: Record<string, string> = {
    'next-themes': `export const useTheme=()=>({resolvedTheme:window.f.theme});`,
    '@/hooks/use-mapkit': `export const useMapKit=()=>({isReady:!window.f.loading,isAvailable:window.f.available,mapkit:window.f.sdk,retry:()=>{},retryWaitSeconds:0});`,
  };
  const bundle = await esbuild.build({ stdin: { resolveDir: web, loader: 'tsx', contents: `
    import React,{StrictMode,useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';
    import {PublicationMap} from './components/map/publication-map';
    const f=window.f;
    class Coordinate{constructor(latitude,longitude){Object.assign(this,{latitude,longitude});}}
    class Span{constructor(latitudeDelta,longitudeDelta){Object.assign(this,{latitudeDelta,longitudeDelta});}}
    class Region{constructor(center,span){Object.assign(this,{center,span});}}
    class Marker{
      constructor(coordinate,options){this.values={coordinate,...options};this.events=new Map();this.id=f.instances.length;f.instances.push(this);}
      write(key,value){f.writes.push({id:this.id,key,value});this.values[key]=value;this.paint();}
      get coordinate(){return this.values.coordinate;}set coordinate(v){this.write('coordinate',v);}
      get color(){return this.values.color;}set color(v){this.write('color',v);}
      get title(){return this.values.title;}set title(v){this.write('title',v);}
      get accessibilityLabel(){return this.values.accessibilityLabel;}set accessibilityLabel(v){this.write('accessibilityLabel',v);}
      get glyphText(){return this.values.glyphText;}set glyphText(v){this.write('glyphText',v);}
      get selected(){return this.values.selected===true;}set selected(v){this.write('selected',v);if(v)this.emitSelect();}
      addEventListener(type,cb){const listeners=this.events.get(type)??new Set();listeners.add(cb);this.events.set(type,listeners);}
      removeEventListener(type,cb){this.events.get(type)?.delete(cb);f.listenerRemovals++;}
      paint(){if(!this.button)return;this.button.textContent=this.glyphText;this.button.setAttribute('aria-label',this.accessibilityLabel);this.button.style.background=this.color;}
      emitSelect(){for(const cb of this.events.get('select')??[])cb();}
      select(){if(this.selected)return;this.values.selected=true;this.emitSelect();}
    }
    class MapView{
      static ColorSchemes={Dark:'dark',Light:'light'};
      constructor(node,options){this.node=node;this.region=options.region;this.events={};this.markers=[];f.maps.push(this);}
      addEventListener(type,cb){this.events[type]=cb;}
      addAnnotation(marker){this.markers.push(marker);f.operations.push({kind:'add',id:marker.id,size:this.markers.length});const button=document.createElement('button');button.dataset.marker=String(marker.id);button.onclick=()=>marker.select();marker.button=button;this.node.append(button);marker.paint();}
      removeAnnotation(marker){if(!this.markers.includes(marker))throw new Error('Annotation removed twice');this.markers=this.markers.filter(m=>m!==marker);f.operations.push({kind:'remove',id:marker.id,size:this.markers.length});marker.button.remove();}
      setRegionAnimated(region){this.region=region;this.events['region-change-end']?.();}
      destroy(){if(this.destroyed)throw new Error('Map destroyed twice');this.destroyed=true;this.events={};this.node.replaceChildren();}
    }
    f.sdk={Map:MapView,Coordinate,CoordinateSpan:Span,CoordinateRegion:Region,MarkerAnnotation:Marker,FeatureVisibility:{Adaptive:'a',Hidden:'h',Visible:'v'}};
    f.map=()=>f.maps.filter(m=>!m.destroyed).at(-1);
    f.camera=(span=.08)=>{const map=f.map();map.region=new Region(new Coordinate(19.04,-98.21),new Span(span,span));map.events['region-change-end']?.();};
    f.clear=()=>{f.operations=[];f.writes=[];};
    function Harness(){const [tick,setTick]=useState(0);f.redraw=()=>setTick(++f.version);const version=f.callbackVersion;
      useEffect(()=>{f.committed=tick;},[tick]);
      return f.mounted?<div style={{height:'600px','--brand':f.theme==='dark'?'teal':'green','--discovery-selected-bg':'black'}}>
        <PublicationMap initialBounds={{west:-98.32,east:-98.10,south:18.94,north:19.15}} focus={null} features={f.features} selected={f.selected}
          onBounds={()=>{f.features=f.features.map(feature=>({...feature,bounds:{...feature.bounds}}));f.redraw();}}
          onSelect={feature=>{f.selections.push({feature,version});f.selected=feature.id;f.redraw();}}/>
      </div>:null;
    }
    createRoot(document.getElementById('root')).render(f.strict?<StrictMode><Harness/></StrictMode>:<Harness/>);
  ` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: path.join(web, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    plugins: [{ name: 'boundaries', setup(b: any) {
      b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: 'mock' } : undefined);
      b.onLoad({ filter: /.*/, namespace: 'mock' }, (a: any) => ({ contents: mocks[a.path], loader: 'tsx', resolveDir: web }));
    } }],
  });
  const browser = await chromium.launch({ channel: 'chrome', headless: true }); let passed = 0;
  try {
    for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
      const context = await browser.newContext({ viewport }); const page = await context.newPage();
      page.setDefaultTimeout(8000); const errors: string[] = []; const external: string[] = [];
      page.on('pageerror', (error: Error) => errors.push(error.message));
      await page.route('**/*', async (route: any) => {
        if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><body><div id="root"></div></body></html>' });
        external.push(route.request().url()); return route.abort();
      });
      const pass = (name: string) => { passed++; console.log('PASS ' + viewport.width + ' ' + name); };
      async function mount(strict = false) {
        await page.goto('https://s12.invalid/mapa');
        const features = [1, 35, 120].map((count, index) => ({ id: `cell:1:${-9821 - index}:1904`, count, seller_count: 1, public_lat: 19.04, public_lng: -98.21, bounds: { west: -98.21, east: -98.21, south: 19.04, north: 19.04 } }));
        await page.evaluate(({ strict, features }) => {
          (window as any).f = { features, maps: [], instances: [], operations: [], writes: [], selections: [], listenerRemovals: 0, callbackVersion: 1, selected: null, theme: 'light', available: true, mounted: true, strict, version: 0, committed: -1 };
        }, { strict, features });
        await page.addScriptTag({ content: bundle.outputFiles[0].text }); await expect(page.locator('[data-marker]')).toHaveCount(3);
      }
      const snapshot = async () => { await expect.poll(() => page.evaluate(() => { const f = (window as any).f; return f.version === f.committed; })).toBe(true); return page.evaluate(() => { const f = (window as any).f; return { maps: f.maps.length, instances: f.instances.length, operations: f.operations, writes: f.writes, ids: f.map().markers.map((m: any) => m.id) }; }); };
      await mount(); assert.equal((await snapshot()).maps, 1); pass('one map and one marker per group after initial effect');
      const original = (await snapshot()).ids;
      await page.evaluate(() => { const f = (window as any).f; f.clear(); f.camera(.15); });
      await expect.poll(() => page.evaluate(() => (window as any).f.map().region.span.longitudeDelta)).toBe(.15);
      await page.evaluate(() => (window as any).f.camera(.07));
      await expect.poll(() => page.evaluate(() => (window as any).f.map().region.span.longitudeDelta)).toBe(.07);
      assert.deepEqual(await snapshot(), { maps: 1, instances: 3, operations: [], writes: [], ids: original }); pass('camera renders and cloned features preserve objects with zero annotation operations');
      await page.locator('[data-marker]').first().click(); await expect(page.locator('[data-marker]').first()).toHaveAccessibleName(/seleccionado/);
      let state = await snapshot(); assert.equal(state.operations.length, 0); assert.equal(state.instances, 3); assert.deepEqual(state.writes.map((w: any) => w.key), ['color', 'title', 'accessibilityLabel']);
      await page.evaluate(() => { const f = (window as any).f; f.clear(); f.selected = null; f.redraw(); }); await expect(page.locator('[data-marker]').first()).not.toHaveAccessibleName(/seleccionado/);
      state = await snapshot(); assert.equal(state.operations.length, 0); assert.equal(state.instances, 3); pass('select and close update appearance without replacing annotations');
      await page.locator('[data-marker]').first().click(); await expect.poll(() => page.evaluate(() => (window as any).f.selections.length)).toBe(2);
      await page.evaluate(() => { const f = (window as any).f; f.selected = null; f.redraw(); }); await expect(page.locator('[data-marker]').first()).not.toHaveAccessibleName(/seleccionado/); pass('closing deselects the native annotation so the same pin can reopen');
      await page.evaluate(() => { const f = (window as any).f; f.clear(); f.theme = 'dark'; f.redraw(); }); await expect.poll(() => page.evaluate(() => (window as any).f.map().colorScheme)).toBe('dark');
      state = await snapshot(); assert.deepEqual(state.ids, original); assert.equal(state.operations.length, 0); assert.deepEqual(state.writes.map((w: any) => w.key), ['color', 'color', 'color']); pass('theme mutates only changed colors and retains map and markers');
      await page.evaluate(() => { const f = (window as any).f; f.clear(); f.callbackVersion = 2; f.features = f.features.map((feature: any, index: number) => index ? feature : { ...feature, count: 2, public_lat: 19.05, bounds: { ...feature.bounds, north: 19.05 } }); f.redraw(); });
      await expect(page.locator('[data-marker]').first()).toHaveText('2'); await page.locator('[data-marker]').first().click();
      const selection = await page.evaluate(() => (window as any).f.selections.at(-1)); assert.equal(selection.feature.count, 2); assert.equal(selection.feature.public_lat, 19.05); assert.equal(selection.version, 2);
      assert.equal((await snapshot()).instances, 3); assert.equal((await snapshot()).operations.length, 0); pass('selection reads the updated feature and current callback once');
      await page.evaluate(() => { const f = (window as any).f; f.retired = f.map().markers[0]; f.retiredCallback = [...f.retired.events.get('select')][0]; f.clear(); f.features = [...f.features.slice(1), { ...f.features[0], id: 'cell:1:-9824:1904' }]; f.redraw(); });
      await expect(page.locator('[data-marker="0"]')).toHaveCount(0); state = await snapshot(); assert.deepEqual(state.operations.map((o: any) => o.kind), ['add', 'remove']); assert.deepEqual(state.ids.slice(0, 2), original.slice(1));
      const before = await page.evaluate(() => (window as any).f.selections.length); await page.evaluate(() => (window as any).f.retiredCallback()); assert.equal(await page.evaluate(() => (window as any).f.selections.length), before); pass('partial replacement adds before removal and retired callbacks are inert');
      await page.evaluate(() => { const f = (window as any).f; f.clear(); f.features = [{ ...f.features[0], id: 'cell:2:-4910:952' }]; f.redraw(); });
      await expect(page.locator('[data-marker]')).toHaveCount(1); state = await snapshot(); assert.deepEqual(state.operations.map((o: any) => o.kind), ['add', 'remove', 'remove', 'remove']); assert.ok(state.operations.every((o: any) => o.size > 0)); pass('legitimate complete regroup never empties the annotation layer');
      await page.evaluate(() => { const f = (window as any).f; f.oldMap = f.map(); f.oldMarker = f.map().markers[0]; f.clear(); f.sdk = { ...f.sdk }; f.redraw(); });
      await expect.poll(() => page.evaluate(() => (window as any).f.maps.length)).toBe(2);
      assert.equal(await page.evaluate(() => (window as any).f.oldMap.destroyed), true); assert.equal(await page.evaluate(() => (window as any).f.oldMarker.events.get('select').size), 0); assert.notEqual((await snapshot()).ids[0], state.ids[0]); pass('SDK replacement disposes listeners and annotates the new map only');
      await page.evaluate(() => { const f = (window as any).f; f.oldMap = f.map(); f.clear(); f.available = false; f.redraw(); });
      await expect(page.getByText(/No pudimos cargar el mapa/)).toBeVisible(); assert.equal(await page.evaluate(() => (window as any).f.oldMap.destroyed), true);
      await page.evaluate(() => { const f = (window as any).f; f.available = true; f.redraw(); }); await expect(page.locator('[data-marker]')).toHaveCount(1); pass('SDK failure and recovery recreate only the unavailable map with clean ownership');
      await page.evaluate(() => { const f = (window as any).f; f.oldMap = f.map(); f.oldMarker = f.map().markers[0]; f.clear(); f.mounted = false; f.redraw(); });
      await expect(page.locator('[data-marker]')).toHaveCount(0); assert.equal(await page.evaluate(() => (window as any).f.oldMap.destroyed), true); assert.equal(await page.evaluate(() => (window as any).f.oldMarker.events.get('select').size), 0); pass('unmount removes annotations and listeners before destroying map');
      await mount(true); await expect.poll(() => page.evaluate(() => (window as any).f.maps.length)).toBe(2); assert.equal(await page.evaluate(() => (window as any).f.maps[0].destroyed), true);
      assert.equal(await page.evaluate(() => (window as any).f.maps[0].markers.length), 0); assert.equal(await page.evaluate(() => (window as any).f.map().markers.every((m: any) => m.events.get('select').size === 1)), true); pass('React Strict Mode setup and cleanup leave one live layer and one listener per marker');
      assert.deepEqual(errors, []); assert.deepEqual(external, []); await context.close();
    }
    console.log(`PASS ${passed}/${passed} S12 PublicationMap browser checks (simulated SDK; no real device paint claim)`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
