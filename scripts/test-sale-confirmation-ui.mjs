// Real components, CSS and optimistic hook; only actions/haptics are controlled.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),web=resolve(root,'apps/web');
const req=createRequire(resolve(web,'package.json'));
const {build}=createRequire(createRequire(resolve(root,'package.json')).resolve('tsx/package.json'))('esbuild');
const {chromium,webkit,expect}=req('@playwright/test');
const postcss=createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
const out=resolve(web,'test-results/sale-confirmation');await mkdir(out,{recursive:true});
const fontDir=resolve(process.env.SALE_FONT_DIR||resolve(web,'.next/static/media'));
const inter='e4af272ccee01ff0-s.p.woff2',outfit='7b0b24f36b1a6d0b-s.p.woff2';
await readFile(resolve(fontDir,inter));await readFile(resolve(fontDir,outfit));
const entry=`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import {SaleConfirmationCard,SaleConfirmationBanner} from './app/(marketplace)/chat/[id]/sale-confirmation-card';
window.__calls=[];window.__mode='success';
const params=new URLSearchParams(location.search),state=params.get('state')||'pendiente',buyer=params.get('role')!=='seller';
const initial={id:'sale-fixture',product_id:'product-fixture',buyer_id:'buyer-fixture',seller_id:'seller-fixture',precio_acordado:950,cantidad:1,metodo_pago:null,tipo_entrega:'pickup',initiated_by:'seller-fixture',created_at:null,
status:state==='completado'?'completed':state==='rechazado'?'cancelled':'pending_confirmation',
buyer_confirmed:state==='completado'||(buyer&&state==='esperando'),seller_confirmed:state==='completado'||(!buyer&&state==='esperando')||state==='pendiente',
cancelled_by:state==='rechazado'?'seller-fixture':null,products_services:{titulo:'Guayabera Tabasqueña de Lino Fino con Bordado Artesanal',imagen_principal:null}};
function App(){const [sc,setSc]=useState(initial),[open,setOpen]=useState(true);window.__setSale=setSc;
window.__action=async(kind,id)=>{window.__calls.push({kind,id});await new Promise(done=>window.__release=done);
if(window.__mode==='error')return {error:'No se pudo guardar. Intenta nuevamente.'};
setSc(old=>({...old,...(kind==='confirm'?{[buyer?'buyer_confirmed':'seller_confirmed']:true}:{status:'cancelled',cancelled_by:buyer?'buyer-fixture':'seller-fixture'})}));return {success:true};};
return <main style={{maxWidth:520,margin:'auto',padding:12}}>
<SaleConfirmationBanner status={state} label={state==='pendiente'?'Pendiente de tu confirmación':undefined} expanded={open} controlsId="sale-details" onToggle={()=>setOpen(!open)}/>
<div id="sale-details" hidden={!open} style={{marginTop:12}}>{open&&<SaleConfirmationCard confirmation={sc} currentUserId={buyer?'buyer-fixture':'seller-fixture'} counterpart={{name:'Pedro Soriano Inmobiliaria',role:buyer?'vendedor':'comprador'}} currentUser={{initial:'T',role:buyer?'comprador':'vendedor'}} onRate={()=>window.__calls.push({kind:'rate'})} onPropose={()=>setOpen(false)}/>}</div></main>}
createRoot(document.getElementById('root')).render(<App/>);`;
const built=await build({stdin:{contents:entry,loader:'tsx',resolveDir:web},bundle:true,write:false,outdir:out,format:'esm',platform:'browser',jsx:'automatic',target:'es2022',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':web,'@vicino/shared':resolve(root,'packages/shared/src/index.ts')},plugins:[{name:'boundaries',setup(b){
b.onResolve({filter:/^\.\.\/actions$/},()=>({path:'actions',namespace:'boundary'}));b.onResolve({filter:/^@\/lib\/haptics$/},()=>({path:'haptics',namespace:'boundary'}));
b.onLoad({filter:/.*/,namespace:'boundary'},a=>({contents:a.path==='actions'?"export const confirmSale=id=>window.__action('confirm',id);export const cancelSale=id=>window.__action('cancel',id);":"export function hapticMedium(){}"}));}}]});
const js=built.outputFiles.find(f=>f.path.endsWith('.js')).text,moduleCSS=built.outputFiles.find(f=>f.path.endsWith('.css')).text;
const cssFile=resolve(web,'app/globals.css');
const css=(await postcss([req('@tailwindcss/postcss')({base:web})]).process(await readFile(cssFile,'utf8'),{from:cssFile})).css+'\n'+moduleCSS+
'@font-face{font-family:Inter;src:url(/'+inter+');font-weight:100 900}@font-face{font-family:Outfit;src:url(/'+outfit+');font-weight:100 900}:root{--font-inter:Inter;--font-outfit:Outfit}body{margin:0;background:var(--bg);color:var(--fg)}';
const html='<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>';
const server=createServer(async(request,response)=>{const path=new URL(request.url,'http://localhost').pathname;
if(path.endsWith('.woff2')){response.setHeader('Content-Type','font/woff2');response.end(await readFile(resolve(fontDir,basename(path))));return;}
response.setHeader('Content-Type',path==='/bundle.js'?'text/javascript':path==='/style.css'?'text/css':'text/html');response.end(path==='/bundle.js'?js:path==='/style.css'?css:html);});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const base='http://127.0.0.1:'+server.address().port,results=[];
async function inspect(page){return page.evaluate(()=>{
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=canvas.height=1;
function rgba(v){ctx.clearRect(0,0,1,1);ctx.fillStyle=v;ctx.fillRect(0,0,1,1);const d=ctx.getImageData(0,0,1,1).data;return [d[0],d[1],d[2],d[3]/255];}
function over(f,b){return f.slice(0,3).map((v,i)=>v*f[3]+b[i]*(1-f[3]));}
function bg(el){return el?over(rgba(getComputedStyle(el).backgroundColor),bg(el.parentElement)):[255,255,255];}
function l(c){return c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);}
const failures=[],ratios=[];
for(const el of document.querySelectorAll('main *')){
if(!el.getClientRects().length||el.closest('[disabled]')||!Array.from(el.childNodes).some(n=>n.nodeType===3&&n.textContent.trim()))continue;
const back=bg(el),front=over(rgba(getComputedStyle(el).color),back),a=l(front),b=l(back),r=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);ratios.push(r);if(r<4.5)failures.push({text:el.textContent.slice(0,70),ratio:r});}
return {failures,min:Math.min(...ratios),overflow:document.documentElement.scrollWidth>innerWidth,buttons:[...document.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height),font:getComputedStyle(document.querySelector('h3')).fontFamily};
});}
try{for(const [engine,type] of [['chromium',chromium],['webkit',webkit]]){
const browser=await type.launch({headless:true});try{
for(const width of [320,390,430,768,1280])for(const theme of ['light','dark'])for(const state of ['pendiente','esperando','completado','rechazado']){
const page=await browser.newPage({viewport:{width,height:900},colorScheme:theme==='light'?'dark':'light'});
await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
await page.goto(base+'/?state='+state);await page.locator('h3').waitFor();await page.evaluate(t=>document.documentElement.classList.toggle('dark',t==='dark'),theme);await page.evaluate(()=>document.fonts.ready);
const check=await inspect(page);assert.deepEqual(check.failures,[],engine+' '+theme+' '+state+' contrast');assert.equal(check.overflow,false,engine+' '+width+' overflow');assert(check.buttons.every(h=>h>=48),'48px targets');assert(check.font.includes('Outfit'),'Outfit loaded');
const card=page.getByRole('region',{name:'Detalle de confirmación de venta'});assert.equal(await card.evaluate(el=>getComputedStyle(el).backgroundColor),theme==='light'?'rgb(255, 255, 255)':'rgb(14, 20, 19)');
if(width===390&&state==='pendiente')await page.screenshot({path:resolve(out,engine+'-'+theme+'.png'),fullPage:true});
const toggle=page.getByRole('button',{name:/Confirmación de venta/});await toggle.focus();await page.keyboard.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','false');await page.keyboard.press('Space');await expect(toggle).toHaveAttribute('aria-expanded','true');
await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.equal((await inspect(page)).overflow,false,'text 200% overflow');results.push({engine,width,theme,state,minContrast:check.min});await page.close();}
for(const role of ['buyer','seller'])for(const kind of ['confirm','cancel'])for(const mode of ['success','error']){
const page=await browser.newPage({viewport:{width:390,height:900}});await page.goto(base+'/?role='+role);await page.locator('h3').waitFor();await page.evaluate(m=>{window.__mode=m;window.__setSale(s=>({...s,buyer_confirmed:false,seller_confirmed:false}));},mode);
await page.getByRole('button',{name:kind==='confirm'?'Confirmar venta':'Rechazar',exact:true}).click();await expect(page.getByText('Guardando respuesta…')).toBeVisible();assert.equal(await page.evaluate(()=>window.__calls.length),1);await page.evaluate(()=>window.__release());
if(mode==='error'){await expect(page.getByRole('alert')).toContainText('No se pudo guardar');await expect(page.getByRole('button',{name:'Confirmar venta',exact:true})).toBeEnabled();}else if(kind==='confirm')await expect(page.getByText(/Ya confirmaste tu parte/)).toBeVisible();else await expect(page.getByRole('heading',{name:'Venta rechazada'})).toBeVisible();results.push({engine,role,kind,mode});await page.close();}
}finally{await browser.close();}}
await writeFile(resolve(out,'results.json'),JSON.stringify(results,null,2));console.log('PASS '+results.length+' cases: real components/CSS/hook; Chromium + WebKit; contrast, themes, 5 widths, 200% text, accordion, confirm/cancel rollback.');
}finally{server.close();}
