/** Local browser integration: real forms/details/CSS/actions; controlled Next transport,
 * Auth/DB/storage/map and secondary detail widgets. No remote data or device claim. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const web=path.resolve(__dirname,'../apps/web');
const req=createRequire(path.join(web,'package.json'));
const esbuild=req(req.resolve('esbuild',{paths:[req.resolve('tsx')]}));
const {chromium,webkit,expect}=req('@playwright/test');
const actions=require('./test-product-optional-actions.cjs');
const out=path.join(web,'test-results/pub-opt'); mkdirSync(out,{recursive:true});
// Compare actual glyph line boxes, including labels, against cells and each other.
function textGeometry(grid:Element){
 const texts=[...grid.children].flatMap((cell,index)=>[...cell.querySelectorAll('span')].map(span=>{const range=document.createRange();range.selectNodeContents(span);return {index,text:span.textContent,cell:cell.getBoundingClientRect(),rects:[...range.getClientRects()]};}));
 const outside=texts.filter(v=>v.rects.some(r=>r.left<v.cell.left-1||r.right>v.cell.right+1||r.top<v.cell.top-1||r.bottom>v.cell.bottom+1)).map(v=>v.text);
 const overlaps=[];for(let i=0;i<texts.length;i++)for(let j=i+1;j<texts.length;j++)if(texts[i].index!==texts[j].index&&texts[i].rects.some(a=>texts[j].rects.some(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1)))overlaps.push([texts[i].text,texts[j].text]);
 return {outside,overlaps};
}
async function main(){
 const mocks:Record<string,string>={
  'next/navigation':`export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>'/producto/prueba';export const useRouter=()=>({push(){},replace(){},back(){},refresh(){}});`,
  'next/link':`import React from 'react';export default function Link({href,children,prefetch,...p}){return <a href={href} {...p}>{children}</a>}`,
  '@/components/auth/auth-link':`export {default} from 'next/link'`,
  'next/image':`import React from 'react';export default function Image({fill,priority,sizes,...p}){return <img {...p}/>}`,
  'next/dynamic':`export default function dynamic(){return ()=>null}`,
  './actions':`async function send(name,id,fd){const r=await fetch('/action',{method:'POST',body:JSON.stringify({name,id,entries:[...fd.entries()]})});const data=await r.json();window.f.saved=data;return data.result?.error?data.result:undefined;}export const createProduct=fd=>send('createProduct',null,fd);export const updateProductFull=(id,fd)=>send('updateProductFull',id,fd);`,
  '@/lib/supabase/client':`export const createClient=()=>({storage:{from(){throw Error('unexpected storage operation')}}});`,
  '@/lib/haptics':`export const hapticMedium=async()=>{}`,
  '@sentry/nextjs':`export const captureException=e=>{window.f.reports.push(String(e))};export const captureMessage=()=>{}`,
  'sonner':`export const toast={error(){},success(){}}`,
  '@/components/ui/boton-regresar':`export const BotonRegresar=()=>null`,
  '@/components/shared/favorite-button':`export const FavoriteButton=()=>null`,
  '@/components/moderation/report-menu-button':`export const ReportMenuButton=()=>null`,
 };
 const widgets:Record<string,string[]>={
  './appointment-button':['AppointmentButton'], './product-extras':['ProductCoupons','ProductReviews'],
  './gallery-top-bar':['GalleryTopBar'],'./listing-status-banner':['ListingStatusBanner'],
  './location-banner':['LocationBanner'],'./meta-row':['MetaRow'],'./negociable-pill':['NegociablePill'],
  './payment-chips':['PaymentChips'],'./preview-banner':['PreviewBanner'],
  './product-gallery-carousel':['ProductGalleryCarousel'],'./product-gallery':['ProductGallery'],
  './seller-card-mini':['SellerCardMini'],'./sticky-cta':['StickyCta'],'./trust-callout':['TrustCallout']
 };
 for(const [key,names] of Object.entries(widgets))mocks[key]=`import React from 'react';`+names.map(n=>`export const ${n}=()=>${['LocationBanner','PaymentChips','SellerCardMini','TrustCallout','MetaRow'].includes(n)?`<div data-widget="${n}" style={{minHeight:24}}>${n}</div>`:['ProductGallery','ProductGalleryCarousel'].includes(n)?`<div style={{height:160,background:'var(--card)'}}>Galería local</div>`:'null'};`).join('');
 const bundle=await esbuild.build({stdin:{resolveDir:web,loader:'tsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {ProductForm} from './app/(marketplace)/vender/product-form';
 import {ProductDetailMobile} from './components/product/product-detail-mobile';
 import {ProductDetailDesktop} from './components/product/product-detail-desktop';
 const f=window.f;const product={id:'${actions.PRODUCT_ID}',titulo:'Producto de prueba',slug:'prueba',descripcion:'',precio:25,modo_precio:'precio',categoria:'comida',tipo:'producto',estado:null,color:null,estatus:'disponible',created_at:'2026-10-20T12:00:00Z',creador_id:'22222222-2222-4222-8222-222222222222',galeria_imagenes:[],ubicacion:'Zona de prueba'};
 const initial={...product,descripcion:'Texto anterior',estado:'bueno',categories:[{slug:'comida',is_primary:true}],ubicacion_lat:19.04,ubicacion_lng:-98.21,tipo_entrega:'punto_encuentro',precio_negociable:false,allow_appointments:false};
 function Harness(){const [n,setN]=useState(0);f.mount=(next)=>{Object.assign(f,next);setN(x=>x+1)};
 if(f.view==='form')return <ProductForm key={n} userId={product.creador_id} mode={f.mode} initialValues={{...initial,...f.initial}}/>;
 const props={purchaseIntentKey:'local',product:{...product,...f.product},seller:{id:product.creador_id,nombre:'Vendedor de prueba'},reviews:[],coupons:[],extras:{},user:null,isFavorite:false,isOwner:false,deliveryLabel:'Mano a mano',categoryName:'Comida'};
 return <><div id="mobile" className="lg:hidden"><ProductDetailMobile {...props}/></div><div id="desktop" className="hidden lg:block"><ProductDetailDesktop {...props}/></div></>;}
 createRoot(document.getElementById('root')).render(<Harness/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"','process.env':'{}'},plugins:[{name:'boundaries',setup(b:any){b.onResolve({filter:/.*/},(a:any)=>Object.hasOwn(mocks,a.path)?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},(a:any)=>({contents:mocks[a.path],loader:'tsx',resolveDir:web}));}}]});
 const postcss=createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
 const cssFile=path.join(web,'app/globals.css');
 // These wrapper classes belong to the synthetic host, outside Tailwind's app scan.
 const {css}=await postcss([req('@tailwindcss/postcss')({base:web})]).process(readFileSync(cssFile,'utf8')+'\n@source inline("hidden lg:block lg:hidden");',{from:cssFile});
 const server=createServer(async(r,s)=>{try{
 if(r.url==='/fixture.js'){s.setHeader('Content-Type','text/javascript');s.end(bundle.outputFiles[0].text);return;}
 if(r.url==='/fixture.css'){s.setHeader('Content-Type','text/css');s.end(css);return;}
 if(r.url==='/action'){let body='';for await(const part of r)body+=part;const data=JSON.parse(body);const state=actions.reset();const result=await actions.invoke(data.name,...(data.id?[data.id]:[]),actions.form(Object.fromEntries(data.entries)));s.setHeader('Content-Type','application/json');s.end(JSON.stringify({result,record:state.record,writes:state.writes}));return;}
 s.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><body><main id="root"></main><script>window.f={view:'detail',product:{},reports:[]}</script><script src="/fixture.js"></script></body></html>`);
 }catch(e){s.statusCode=500;s.end(String(e));}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 let cases=0;const measurements:any[]=[];const failures:any[]=[];const pass=(name:string)=>{cases++;console.log('PASS '+cases+' '+name)};
 try{for(const [engineName,engine] of [['chromium',chromium],['webkit',webkit]] as const){
 const browser=await engine.launch({headless:true});
 try{const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',(e:any)=>errors.push(String(e)));
 await page.goto(origin);await expect(page.locator('#mobile h1')).toHaveText('Producto de prueba');
 for(const [width,theme] of [[375,'light'],[375,'dark'],[390,'light'],[390,'dark'],[1280,'light'],[1280,'dark']] as const){
 await page.setViewportSize({width,height:900});
 for(let i=0;i<4;i++){
 // Complementary mobile theme checks need only empty/full, avoiding redundant permutations.
 if(((width===375&&theme==='dark')||(width===390&&theme==='light'))&&(i===1||i===2))continue;
 const descripcion=i===1||i===3?'Texto breve de prueba':'';const estado=i>=2?'bueno':null;const color=i%2?'Verde':null;
 await page.evaluate(({descripcion,estado,color,theme})=>{document.documentElement.classList.toggle('dark',theme==='dark');(window as any).f.mount({view:'detail',product:{descripcion,estado,color}});},{descripcion,estado,color,theme});
 const detail=page.locator(width<1024?'#mobile':'#desktop');await expect(detail).toBeVisible();
 await expect(detail.getByRole('heading',{name:'Descripción',exact:true})).toHaveCount(descripcion?1:0);
 await expect(detail.getByText('ESTADO',{exact:true})).toHaveCount(estado?1:0);
 const grid=detail.locator('.grid.product-card-custom');await expect(grid).toHaveCount(1);
 const count=2+Number(!!estado)+Number(!!color);await expect(grid.locator(':scope > div')).toHaveCount(count);
 const info=await grid.evaluate(el=>{const css=getComputedStyle(el),cells=[...el.children].map(c=>c.getBoundingClientRect());return {display:css.display,columns:css.gridTemplateColumns.split(' ').filter(t=>parseFloat(t)>0).length,width:el.getBoundingClientRect().width,cells:cells.map(c=>({x:c.x,y:c.y,width:c.width}))}});
 assert.equal(info.display,'grid');assert.equal(info.columns,count);assert.ok(info.width>200);assert.ok(Math.max(...info.cells.map(c=>c.width))-Math.min(...info.cells.map(c=>c.width))<1);
 const gap=await detail.evaluate(el=>{const loc=el.querySelector('[data-widget="LocationBanner"]')!.parentElement!;const pay=el.querySelector('[data-widget="PaymentChips"]')!.parentElement!;return {adjacent:loc.nextElementSibling===pay,gap:pay.getBoundingClientRect().top-loc.getBoundingClientRect().bottom,emptyChildren:[...loc.parentElement!.children].filter(c=>!c.textContent?.trim()&&!c.querySelector('svg,input,img,button,a')).length};});
 assert.equal(gap.adjacent,!descripcion);if(!descripcion)assert.equal(gap.gap,20);
 measurements.push({engine:engineName,width,theme,descripcion:!!descripcion,estado:!!estado,color:!!color,columns:info.columns,gap:gap.gap});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 if(i===0||i===3)await page.screenshot({path:path.join(out,`${engineName}-${width}-${theme}-${i}.png`),fullPage:true});
 pass(`${engineName} ${width} ${theme} detail matrix ${i} grid${count} no optional hole`);
 }}
 // Q07 acceptance edges: narrow/tablet, text enlargement and long readable copy.
 const longDescription=Array.from({length:28},(_,i)=>`Detalle ${i+1}: publicación de prueba con información amplia sobre medidas, materiales, entrega y cuidados. Este texto conserva palabras separadas para verificar lectura y salto de línea.`).join('\n');
 for(const [width,scale] of [[320,1],[820,1],[320,2],[390,2]] as const)for(const theme of ['light','dark'])for(const populated of [false,true]){
 await page.setViewportSize({width,height:900});
 await page.evaluate(({scale,theme,populated,longDescription})=>{document.documentElement.style.fontSize=`${scale*100}%`;document.documentElement.classList.toggle('dark',theme==='dark');(window as any).f.mount({view:'detail',product:{tipo:'producto',descripcion:populated?longDescription:'',estado:populated?'bueno':null,color:populated?'Verde':null}});},{scale,theme,populated,longDescription});
 const detail=page.locator('#mobile');await expect(detail).toBeVisible();
 await expect(detail.getByRole('heading',{name:'Descripción',exact:true})).toHaveCount(populated?1:0);
 const layout=await detail.evaluate(el=>{const loc=el.querySelector('[data-widget="LocationBanner"]')!.parentElement!;const pay=el.querySelector('[data-widget="PaymentChips"]')!.parentElement!;const section=el.querySelector('section');const p=section?.querySelector('p');const grid=el.querySelector('.grid.product-card-custom')!;return {scrollWidth:document.documentElement.scrollWidth,viewport:innerWidth,rootFont:getComputedStyle(document.documentElement).fontSize,adjacent:loc.nextElementSibling===pay,gap:pay.getBoundingClientRect().top-loc.getBoundingClientRect().bottom,descriptionText:p?.textContent??null,descriptionFont:p?getComputedStyle(p).fontSize:null,descriptionHeight:p?.getBoundingClientRect().height??0,locationBottom:loc.getBoundingClientRect().bottom,sectionTop:section?.getBoundingClientRect().top??null,sectionBottom:section?.getBoundingClientRect().bottom??null,paymentTop:pay.getBoundingClientRect().top,columns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(t=>parseFloat(t)>0).length};});
 assert.ok(layout.scrollWidth<=layout.viewport,JSON.stringify(layout));assert.equal(layout.rootFont,`${16*scale}px`);if(scale===1)assert.equal(layout.columns,populated?4:2);else assert.ok(layout.columns>=1&&layout.columns<=(populated?4:2));assert.equal(layout.adjacent,!populated);
 if(populated){assert.equal(layout.descriptionText,longDescription);assert.equal(layout.descriptionFont,`${14*scale}px`);assert.ok(layout.descriptionHeight>600);assert.ok(layout.sectionTop!>=layout.locationBottom+20*scale);assert.ok(layout.paymentTop>=layout.sectionBottom!+20*scale);}else assert.equal(layout.gap,20*scale);
 measurements.push({engine:engineName,width,theme,scale,populated,longDescription:populated,...layout});
 await page.screenshot({path:path.join(out,`${engineName}-edge-${width}-${theme}-${scale*100}-${populated?'long':'empty'}.png`),fullPage:true});
 if(populated)await page.screenshot({path:path.join(out,`${engineName}-edge-${width}-${theme}-${scale*100}-head.png`),fullPage:false});
 const geometry=await detail.locator('.grid.product-card-custom').evaluate(textGeometry);
 const label=`${engineName} Q07 ${width} ${theme} text${scale*100}% ${populated?'long description + fields':'empty optionals'}`;
 if(geometry.overlaps.length||geometry.outside.length){cases++;failures.push({case:cases,label,...geometry});console.log(`FAIL ${cases} ${label} specification geometry: ${JSON.stringify(geometry)}`);}else pass(label+' no horizontal overflow/readable separation');
 }
 for(const theme of ['light','dark']){
 await page.setViewportSize({width:320,height:900});
 const longColor='VerdeEsmeraldaIntensoConAcabadoMetalizadoSinSeparaciones'.repeat(2);
 await page.evaluate(({theme,longColor})=>{document.documentElement.style.fontSize='200%';document.documentElement.classList.toggle('dark',theme==='dark');(window as any).f.mount({view:'detail',product:{tipo:'producto',descripcion:'Detalle breve',estado:'bueno',color:longColor}});},{theme,longColor});
 await expect(page.locator('#mobile').getByText(longColor,{exact:true})).toHaveCount(1);
 const geometry=await page.locator('#mobile .grid.product-card-custom').evaluate(textGeometry);
 assert.deepEqual(geometry,{outside:[],overlaps:[]});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(out,`${engineName}-long-color-320-${theme}-200.png`),fullPage:true});
 pass(`${engineName} Q07 320 ${theme} text200% long unbroken color wraps inside cell without collisions`);
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='';});
 await page.setViewportSize({width:390,height:900});
 for(let i=0;i<4;i++){
 const descripcion=i===1||i===3?'ok':'';const estado=i>=2?'bueno':'';
 for(const mode of ['create','edit']){
 await page.evaluate(({mode})=>{(window as any).f.saved=null;(window as any).f.mount({view:'form',mode,initial:mode==='create'?{descripcion:'',estado:''}:{descripcion:'Texto anterior',estado:'bueno'}});},{mode});
 const desc=page.locator('[name=descripcion]'),condition=page.locator('select[name=estado]');
 await expect(desc).toBeVisible();assert.equal(await desc.getAttribute('required'),null);assert.equal(await desc.getAttribute('minlength'),null);assert.equal(await condition.getAttribute('required'),null);
 await desc.fill(descripcion);await condition.selectOption(estado);
 if(i===0&&mode==='create')await page.screenshot({path:path.join(out,`${engineName}-form-optional.png`),fullPage:true});
 assert.equal(await page.locator('form').evaluate((f:HTMLFormElement)=>f.checkValidity()),true);
 await page.getByRole('button',{name:mode==='create'?'Publicar':'Guardar',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>(window as any).f.saved?.writes.length)).toBe(1);
 const saved=await page.evaluate(()=>(window as any).f.saved);assert.ok(!saved.result?.error,JSON.stringify(saved.result));assert.equal(saved.record.descripcion,descripcion);assert.equal(saved.record.estado,estado||null);
 // This uses the actual action output to render the real detail after create/edit.
 await page.evaluate(record=>(window as any).f.mount({view:'detail',product:record}),saved.record);
 await expect(page.locator('#mobile').getByRole('heading',{name:'Descripción',exact:true})).toHaveCount(descripcion?1:0);
 await expect(page.locator('#mobile').getByText('ESTADO',{exact:true})).toHaveCount(estado?1:0);
 }
 pass(`${engineName} form matrix ${i}: native optional + create + edit cleanup + saved detail`);
 }
 await page.evaluate(()=>{(window as any).f.saved=null;(window as any).f.mount({view:'form',mode:'create',initial:{tipo:'servicio',descripcion:'',estado:'bueno',color:'Verde',categories:[{slug:'servicios-hogar',is_primary:true}]}})});
 await expect(page.locator('select[name=estado]')).toHaveCount(0);await expect(page.locator('[name=color]')).toHaveCount(0);
 await page.getByRole('button',{name:'Publicar',exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).f.saved?.writes.length)).toBe(1);
 assert.equal(await page.evaluate(()=>(window as any).f.saved.record.tipo),'servicio');
 await page.evaluate(()=>(window as any).f.mount({view:'detail',product:{tipo:'servicio',descripcion:'   ',estado:'bueno',color:'Verde'}}));
 await expect(page.locator('#mobile .grid.product-card-custom > div')).toHaveCount(2);await expect(page.locator('#mobile section')).toHaveCount(0);
 await page.setViewportSize({width:1280,height:900});await expect(page.locator('#desktop')).toBeVisible();
 await expect(page.locator('#desktop .grid.product-card-custom > div')).toHaveCount(2);await expect(page.locator('#desktop section')).toHaveCount(0);
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as any).f.reports),[]);pass(`${engineName} service omits condition/color and whitespace description; pageerror0`);
 }finally{await browser.close();}
 }}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));writeFileSync(path.join(out,'measurements.json'),JSON.stringify(measurements,null,2));writeFileSync(path.join(out,'failures.json'),JSON.stringify(failures,null,2));}
 console.log(`${cases-failures.length}/${cases} browser cases PASS; ${failures.length} FAIL; ${measurements.length} CSS measurements; controlled local integration only`);
 assert.equal(failures.length,0,'Q07 specification text must remain readable without overlapping values');
}
main().catch(e=>{console.error(e);process.exitCode=1});
