/** Real S12 preview, ZoneCard, location sheet and result drawer in Chromium.
 * PNG provider, navigation, GPS/geocoder and persistence are controlled boundaries.
 * Does not replace real Apple/device/VoiceOver acceptance. No production requests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const web = path.resolve(__dirname, "../apps/web");
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, expect } = req("@playwright/test");

async function main() {
  const mocks: Record<string, string> = {
    "next/link": "import React from 'react';export default function Link({href,children,prefetch,...props}){return <a href={href} data-prefetch={String(prefetch)} {...props} onClick={event=>{event.preventDefault();window.f.navigations.push(href);}}>{children}</a>;}",
    "next/image": "import React from 'react';export default function Image({fill,sizes,...props}){return <img {...props}/>;}",
    "next-themes": "export const useTheme=()=>({resolvedTheme:window.f.theme});",
    "next/navigation": "export const useRouter=()=>({refresh:()=>window.f.refreshes++});",
    "next/dynamic": "import React,{lazy,Suspense} from 'react';export default function dynamic(load){const Component=lazy(load);return props=><Suspense fallback={null}><Component {...props}/></Suspense>;}",
    "@/hooks/useGeolocation": "export const useGeolocation=()=>({state:window.f.saved?{status:'success',position:window.f.saved}:{status:'idle'},setManualPosition:position=>window.f.writes.push(position)});",
    "@/lib/geo/apple-geocoder": "export const reverseGeocodeWithApple=async(lat,lng)=>{window.f.geocodes.push({lat,lng});return {name:'Puebla',fullName:'Puebla, México'};};",
    "@/lib/geo/cobertura": "export const useReglaCobertura=()=>null;",
    "@/lib/geo/location-search": "export const clasificarResultado=p=>p&&Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&p.lat>=14.5&&p.lat<=32.8&&p.lng>=-118.5&&p.lng<=-86.5?'ok':'fuera-de-mexico';export const searchLocations=async()=>({results:[]});export const resolveLocationCoordinates=async()=>null;",
    "@/lib/haptics": "export const hapticSelection=async()=>{};",
    "./change-location-map": "import React from 'react';export default function Map({lat,lng}){return <div data-testid='draft-map' data-lat={lat} data-lng={lng}>Mapa de prueba</div>;}",
  };
  const fixture = [
    "import React,{useRef,useState} from 'react';import {createRoot} from 'react-dom/client';",
    "import {LocationMapPreview} from './components/map/location-map-preview';import {PublicationResultsDrawer} from './components/map/publication-results-drawer';",
    "const f=window.f;window.fetch=async(url,opts)=>{if(url!=='/api/map-preview')throw new Error('Unexpected request '+url);f.requests.push(JSON.parse(opts.body));if(f.fail)return new Response('unavailable',{status:503});const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.fillStyle='#e2e8dc';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#121212';ctx.font='24px Arial';ctx.fillText('Apple Maps',32,700);ctx.fillText('Map provider · Attribution',880,700);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return new Response(blob,{headers:{'Content-Type':'image/png'}});};",
    "const point={id:'cell:1:-9821:1904',public_lat:19.04,public_lng:-98.21,count:2,seller_count:1,bounds:{west:-98.21,east:-98.21,south:19.04,north:19.04}};",
    "const data={list_total:2,list_seller_total:1,next_cursor:null,listings:[{id:'one',titulo:'Instalación y carga de aire acondicionado para tu hogar',slug:'servicio-local',categoria:'servicios-del-hogar',precio:950,modo_precio:'precio',imagen_principal:null,creador_id:'seller',vendedor_nombre:'Negocio de prueba con nombre largo'},{id:'two',titulo:'Servicio con cotización',slug:'cotizacion',categoria:'servicios-del-hogar',precio:null,modo_precio:'cotizacion',imagen_principal:null,creador_id:'seller',vendedor_nombre:'Negocio de prueba'}]};",
    "function App(){const [tick,setTick]=useState(0),[mounted,setMounted]=useState(true),[center,setCenter]=useState({lat:19.04,lng:-98.21}),[feature,setFeature]=useState(null);const trigger=useRef(null),fallback=useRef(null);f.redraw=()=>setTick(n=>n+1);f.setMounted=setMounted;f.setCenter=setCenter;return <main ref={fallback} tabIndex={-1} style={{padding:12,minHeight:1800}}>{mounted&&<LocationMapPreview initialPosition={center} viewerScope={f.viewer}/>}<button ref={trigger} onClick={()=>setFeature(point)} style={{minHeight:48,marginTop:24}}>Abrir punto</button><PublicationResultsDrawer feature={feature} data={data} pending={false} error={null} onClose={()=>{f.closes++;setFeature(null);}} onRetry={()=>{}} onLoadMore={()=>{}} returnFocus={trigger} fallbackFocus={fallback}/></main>;}",
    "createRoot(document.getElementById('root')).render(<App/>);",
  ].join("\n");
  const bundle = await esbuild.build({ stdin: { resolveDir: web, loader: "tsx", contents: fixture }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "boundaries", setup(b: any) {
    b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a: any) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: web }));
  } }] });
  // Compile current CSS, including the new classes, without a Next build.
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const cssFile = path.join(web, "app/globals.css");
  const { css } = await postcss([req("@tailwindcss/postcss")({ base: web })]).process(readFileSync(cssFile, "utf8"), { from: cssFile });
  const out = path.join(web, "test-results/s12"); mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 320, height: 844 }, hasTouch: true });
  let passed = 0;
  try {
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    // tsx preserves names in serialized callbacks; expose its harmless helper in this fixture.
    await page.addInitScript("window.__name = (target) => target;");
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/*", (route: any) => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><body><div id='root'></div></body></html>" })
      : route.abort());
    await page.goto("https://s12-fixture.invalid");
    await page.evaluate(() => {
      (window as any).f = { requests: [], navigations: [], writes: [], geocodes: [], gps: 0, refreshes: 0, closes: 0, viewer: "guest", theme: undefined, fail: false, saved: { lat: 19.04, lng: -98.21, name: "Puebla", radius: 10000 } };
      Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition: (_success: unknown, failure: (error: {code: number}) => void) => { (window as any).f.gps++; failure({code: 1}); } }, configurable: true });
    });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const pass = (name: string) => { passed++; console.log("PASS " + name); };
    const preview = page.getByRole("region", { name: "Vista previa de tu zona", exact: true });
    const mapLink = page.getByRole("link", { name: "Ver publicaciones en el mapa", exact: true });
    await expect(mapLink).toBeVisible(); assert.equal(await page.evaluate(() => (window as any).f.requests.length), 0);
    assert.equal(await mapLink.getAttribute("data-prefetch"), "false");
    await page.evaluate(() => { (window as any).f.theme = "light"; (window as any).f.redraw(); });
    await expect.poll(() => preview.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBe(1280);
    assert.equal(await page.evaluate(() => (window as any).f.requests.length), 1);
    assert.equal(await page.evaluate(() => (window as any).f.gps + (window as any).f.geocodes.length), 0);
    pass("theme hydration waits; one snapshot, no automatic GPS/geocode or map prefetch");
    for (const width of [320, 375, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const bounds = await preview.evaluate(section => {
        const image = section.querySelector("img")!, link = section.querySelector("a")!, button = section.querySelector("button")!;
        const s = section.getBoundingClientRect(), i = image.getBoundingClientRect(), a = link.getBoundingClientRect(), b = button.getBoundingClientRect();
        return { section: {width:s.width,height:s.height,y:s.y}, image: {width:i.width,height:i.height,y:i.y}, link: {width:a.width,height:a.height,y:a.y}, buttonBottom:b.bottom, creditsTop:i.bottom-48*i.height/720, background:getComputedStyle(section).backgroundColor, nested:!!button.closest("a"), text:link.textContent };
      });
      assert.ok(Math.abs(bounds.image.width / bounds.image.height - 16/9) < .01);
      assert.deepEqual(bounds.section, bounds.image); assert.deepEqual(bounds.link, bounds.image);
      assert.equal(bounds.background, "rgba(0, 0, 0, 0)"); assert.equal(bounds.nested, false); assert.equal(bounds.text, "");
      assert.ok(bounds.buttonBottom < bounds.creditsTop, "location selector overlaps provider credits");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.equal(await page.evaluate(() => (window as any).f.requests.length), 1);
      await page.screenshot({ path: path.join(out, "home-preview-" + width + ".png"), fullPage: false });
      pass(width + "px: full 16:9 image, no footer/bands, credits unobstructed, resize makes no request");
    }
    await page.setViewportSize({width:390,height:844}); await page.evaluate(() => window.scrollTo(0,0));
    const touch = await context.newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {type:"touchStart",touchPoints:[{x:210,y:150}]});
    await touch.send("Input.dispatchTouchEvent", {type:"touchMove",touchPoints:[{x:210,y:100}]});
    await touch.send("Input.dispatchTouchEvent", {type:"touchMove",touchPoints:[{x:210,y:60}]});
    await touch.send("Input.dispatchTouchEvent", {type:"touchEnd",touchPoints:[]});
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    assert.deepEqual(await page.evaluate(() => (window as any).f.navigations), []);
    pass("touch scrolling started on the map does not activate its link");
    await page.evaluate(() => window.scrollTo(0,0)); await mapLink.focus(); await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => (window as any).f.navigations.length)).toBe(1);
    assert.equal(await page.evaluate(() => (window as any).f.navigations[0]), "/mapa");
    assert.equal(await mapLink.evaluate(el => getComputedStyle(el).outlineStyle), "solid");
    assert.equal(await mapLink.evaluate(el => getComputedStyle(el).outlineWidth), "2px");
    pass("Enter activates the accessible map surface with visible keyboard focus");
    await page.getByRole("button", {name:"Cambiar ubicación: Puebla",exact:true}).click();
    await expect(page.getByRole("dialog",{name:"Cambiar ubicación",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(() => (window as any).f.navigations.length), 1);
    assert.equal(await page.evaluate(() => (window as any).f.writes.length), 0);
    await page.getByRole("button",{name:"Cerrar",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    pass("real ZoneCard opens its independent location editor without navigation or persistence");
    await page.evaluate(() => (window as any).f.setMounted(false)); await expect(mapLink).toHaveCount(0);
    await page.evaluate(() => (window as any).f.setMounted(true)); await expect(preview.locator("img")).toHaveCount(1);
    assert.equal(await page.evaluate(() => (window as any).f.requests.length), 1);
    pass("revisiting Home reuses the valid in-memory image");
    await page.evaluate(() => { (window as any).f.saved=null;(window as any).f.setCenter(null); });
    await expect(page.getByRole("img",{name:"Mapa de México",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(() => (window as any).f.requests.at(-1).center), null);
    await expect(page.getByRole("button",{name:"Activar ubicación",exact:true})).toBeVisible();
    pass("without a saved zone the preview uses Mexico and keeps location activation");
    await page.evaluate(() => { (window as any).f.viewer="another-viewer";(window as any).f.fail=true;(window as any).f.redraw(); });
    await expect(page.getByRole("button",{name:"Reintentar",exact:true})).toBeVisible();
    const failedCalls=await page.evaluate(()=>(window as any).f.requests.length);
    assert.equal(await page.getByRole("button",{name:"Reintentar",exact:true}).evaluate(el=>!!el.closest("a")),false);
    await page.evaluate(()=>(window as any).f.setMounted(false)); await expect(mapLink).toHaveCount(0);
    await page.evaluate(()=>(window as any).f.setMounted(true)); await expect(page.getByRole("button",{name:"Reintentar",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>(window as any).f.requests.length),failedCalls);
    await page.evaluate(()=>(window as any).f.fail=false); await page.getByRole("button",{name:"Reintentar",exact:true}).click();
    await expect(page.getByRole("img",{name:"Mapa de México",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>(window as any).f.requests.length),failedCalls+1);
    assert.equal(await page.evaluate(()=>(window as any).f.navigations.length),1);
    pass("failed image is cached until an explicit independent retry; retry does not navigate");

    for (const theme of ["light","dark"]) {
      await page.evaluate(theme=>{(window as any).f.theme=theme;document.documentElement.classList.toggle("dark",theme==="dark");(window as any).f.redraw();},theme);
      await page.emulateMedia({reducedMotion:"reduce"});
      await page.getByRole("button",{name:"Abrir punto",exact:true}).click();
      const drawer=page.getByRole("dialog"); await expect(drawer).toBeVisible();
      await expect(page.getByRole("button",{name:"Cerrar publicaciones",exact:true})).toBeFocused();
      await expect(drawer.locator("article")).toHaveCount(2);
      await expect(drawer.getByText("Cotización",{exact:true})).toBeVisible();
      const styles=await drawer.evaluate(dialog=>{
        const normalized=(token:string)=>{const d=document.createElement("div");d.style.backgroundColor="var("+token+")";document.body.append(d);const c=getComputedStyle(d).backgroundColor;d.remove();return c;};
        const contrast=(fg:string,bg:string)=>{const lum=(rgb:string)=>{const values=rgb.match(/[\d.]+/g)!.slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;};const a=lum(fg),b=lum(bg);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);};
        const surface=getComputedStyle(dialog).backgroundColor,card=dialog.querySelector("article")!,cardStyle=getComputedStyle(card),title=card.querySelector("h3")!;
        const description=document.getElementById(dialog.getAttribute("aria-describedby")!)!;
        const scroll=card.parentElement!.parentElement!,handle=dialog.querySelector("button")!;
        return {surface,expectedSurface:normalized("--bg"),card:cardStyle.backgroundColor,expectedCard:normalized("--sidebar-bg"),titleContrast:contrast(getComputedStyle(title).color,cardStyle.backgroundColor),descriptionContrast:contrast(getComputedStyle(description).color,surface),padding:parseFloat(getComputedStyle(scroll).paddingBottom),scroll:getComputedStyle(scroll).overflowY,handle:handle.getBoundingClientRect().height};
      });
      assert.equal(styles.surface,styles.expectedSurface); assert.equal(styles.card,styles.expectedCard); assert.notEqual(styles.surface,styles.card);
      assert.ok(styles.titleContrast>=4.5); assert.ok(styles.descriptionContrast>=4.5);
      assert.equal(styles.scroll,"auto"); assert.ok(styles.padding>=24); assert.ok(styles.handle>=48);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(out,"drawer-"+theme+"-390.png")});
      await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0);
      await expect(page.getByRole("button",{name:"Abrir punto",exact:true})).toBeFocused();
      pass(theme+" drawer: separate theme surface/cards, AA text contrast, safe padding, reduced motion and Escape/focus");
    }
    await page.emulateMedia({reducedMotion:"no-preference"});
    await page.getByRole("button",{name:"Abrir punto",exact:true}).click(); await expect(page.getByRole("dialog")).toBeVisible();
    const handle=page.getByRole("button",{name:"Cerrar o deslizar hacia abajo las publicaciones",exact:true});
    const entry=await handle.boundingBox();
    await expect.poll(()=>page.getByRole("dialog").evaluate(el=>getComputedStyle(el).transform)).toBe("none");
    const box=await handle.boundingBox(); assert.ok(box);
    console.log("INFO drag timing: entry y="+entry?.y+"; settled y="+box.y+"; viewport=844; pointer starts on settled handle");
    await page.mouse.move(box.x+box.width/2,box.y+12);await page.mouse.down();await page.mouse.move(box.x+box.width/2,box.y+175,{steps:12});await page.mouse.up();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Abrir punto",exact:true})).toBeFocused();
    pass("downward handle drag preserves dismissal and focus restoration");
    assert.deepEqual(errors,[]);
    console.log("S12 preview/drawer browser: "+passed+"/"+passed+" PASS; controlled PNG/navigation/GPS/geocoder/persistence, not real Apple/devices");
  } finally { await context.close(); await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
