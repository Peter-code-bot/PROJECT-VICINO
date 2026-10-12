// Real Next navigation; synthetic catalog actions and selling page. No remote writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),web=resolve(root,'apps/web');
const req=createRequire(resolve(web,'package.json'));
const {chromium,webkit}=req('@playwright/test');
const fixture=resolve(web,'test-results/plan29-next');
const normalized=p=>p.replaceAll('\\','/');
const imp=p=>JSON.stringify(normalized(resolve(web,p)));
async function file(path,content){const dest=resolve(fixture,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,content);}
await file('package.json',JSON.stringify({private:true,scripts:{},dependencies:{next:req('next/package.json').version,react:req('react/package.json').version,'react-dom':req('react-dom/package.json').version}}));
await file('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2022',lib:['dom','esnext'],strict:true,noEmit:true,esModuleInterop:true,module:'esnext',moduleResolution:'bundler',jsx:'react-jsx',skipLibCheck:true,paths:{'@/*':[normalized(web)+'/*']}},include:['**/*.ts','**/*.tsx','.next/types/**/*.ts']}));
await file('next.config.mjs',`export default {experimental:{externalDir:true},typescript:{ignoreBuildErrors:true},webpack(config){config.resolve.alias['@']=${JSON.stringify(normalized(web))};return config;}};`);
await file('app/layout.tsx',`import {Suspense} from 'react';import {Shell} from './shell';export default function Layout({children}){return <html><body><Suspense fallback={null}><Shell>{children}</Shell></Suspense></body></html>}`);
await file('app/shell.tsx',`'use client';import {useEffect,useRef} from 'react';import {usePathname,useSearchParams} from 'next/navigation';import Link from 'next/link';
import {createCommunityNavigationObserver} from ${imp('lib/navigation/retorno-comunidad.ts')};
import {NavigationPrefetch} from ${imp('components/layout/navigation-prefetch.tsx')};
import {SellLink} from ${imp('components/layout/sell-link.tsx')};
export function Shell({children}){const path=usePathname(),search=useSearchParams().toString(),observer=useRef(null);useEffect(()=>{const value=createCommunityNavigationObserver();observer.current=value;return()=>{observer.current=null;value.dispose();}},[]);useEffect(()=>{observer.current?.observe();},[path,search]);return <><NavigationPrefetch authenticated isVendedor/><Link href="/">Inicio</Link><SellLink id="nav-vender">Vender</SellLink>{children}</>}`);
await file('app/page.tsx',`import Link from 'next/link';export default function Page(){return <><h1>Origen</h1><Link href="/comunidades/one">Comunidad uno</Link><Link href="/comunidades/two">Comunidad dos</Link><Link href="/chat">Selector</Link></>}`);
await file('app/community-filter.tsx',`'use client';import {useState} from 'react';import {notifyCommunityNavigationReplacement} from ${imp('lib/navigation/retorno-comunidad.ts')};export function CommunityFilter(){const [active,setActive]=useState(false);return <><button onClick={()=>{setActive(true);const url=new URL(location.href);url.searchParams.set('tab','descubrir');history.replaceState(history.state,'',url.toString());notifyCommunityNavigationReplacement();}}>Filtrar comunidad</button>{active&&<p>Filtros aplicados</p>}</>}`);
await file('app/comunidades/[id]/page.tsx',`import Link from 'next/link';import {CommunityFilter} from '../../community-filter';import {CommunityBackButton} from ${imp('components/comunidades/community-back-button.tsx')};export default async function Page({params}){const {id}=await params;return <><h1>Comunidad {id}</h1><CommunityBackButton id={id}/><CommunityFilter/><Link href={'/comunidades/'+id+'/administrar'}>Administrar</Link></>}`);
await file('app/comunidades/[id]/administrar/page.tsx',`import {CommunityBackButton} from ${imp('components/comunidades/community-back-button.tsx')};export default async function Page({params}){const {id}=await params;return <><h1>Administrar {id}</h1><CommunityBackButton id={id} admin/></>}`);
await file('app/vender/loading.tsx',`export {default} from ${imp('app/(marketplace)/vender/loading.tsx')};`);
await file('app/vender/page.tsx',`import {connection} from 'next/server';export default async function Page(){await connection();await new Promise(r=>setTimeout(r,700));return <><h1>Formulario sintético listo</h1><input aria-label="Título"/></>}`);
let selector=await readFile(resolve(web,'app/(marketplace)/chat/[id]/chat-product-selector.tsx'),'utf8');
await file('app/chat/selector.tsx',selector.replace('"../actions"','"./actions"'));
await file('app/chat/page.tsx',`import {Demo} from './demo';export default async function Page({searchParams}){const p=await searchParams;return <Demo mode={p.mode||'both'}/>}`);
await file('app/chat/demo.tsx',`'use client';import {useState} from 'react';import {ChatProductSelector} from './selector';export function Demo({mode}){const [active,setActive]=useState({product:null,revision:0});return <><ChatProductSelector chatId={mode} currentUserId="a" active={active} onSelected={setActive}/><p data-testid="active">{active.product?.titulo||'Sin aplicar'}</p></>}`);
await file('app/chat/actions.ts',`'use server';export async function getChatProducts({chatId,sellerId,query}){await new Promise(r=>setTimeout(r,sellerId==='a'?400:30));const sellers=chatId==='none'?[]:chatId==='one'?[{id:'b',nombre:'Beatriz',foto:null}]:[{id:'a',nombre:'Ana',foto:null},{id:'b',nombre:'Beatriz',foto:null}];const selected=sellers.some(s=>s.id===sellerId)?sellerId:sellers.length===1?sellers[0].id:null;return {sellers,sellerId:selected,data:!selected||query?[ ]:[{id:selected+'-1',titulo:'Producto de '+selected,creador_id:selected,estatus:'disponible',is_hidden:false}]};}export async function selectChatProduct({productId,expectedRevision}){return {data:{product:{id:productId,titulo:'Aplicado '+productId,creador_id:productId[0]},revision:expectedRevision+1}};}`);
const nextBin=req.resolve('next/dist/bin/next');
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1'};
const logs=[];
function child(args){const proc=spawn(process.execPath,[nextBin,...args],{cwd:fixture,env,stdio:['ignore','pipe','pipe']});proc.stdout.on('data',b=>logs.push(b.toString()));proc.stderr.on('data',b=>logs.push(b.toString()));return proc;}
const build=child(['build','--webpack']);
const code=await new Promise(r=>build.on('exit',r));await writeFile(resolve(fixture,'build.log'),logs.join(''));
if(code!==0)throw new Error('Fixture Next build failed: '+logs.join('').slice(-5000));
console.log('Next fixture build exit 0 (type checking disabled only for generated fixture; application checked separately)');
const port=4199,url='http://127.0.0.1:'+port,server=child(['start','-p',String(port)]);
const results=[];
try{
 for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break}catch{}await new Promise(r=>setTimeout(r,500));}
 for(const [engine,driver] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await driver.launch();
  try{
   const page=await browser.newPage();page.setDefaultTimeout(15000);
   page.on('pageerror',error=>console.error('Browser error:',error.message));
   await page.goto(url);await page.getByRole('heading',{name:'Origen'}).waitFor();
   for(let i=0;i<5;i++){
    await page.getByRole('link',{name:'Comunidad uno',exact:true}).click();await page.getByRole('link',{name:'Administrar',exact:true}).click();
    await page.getByRole('heading',{name:'Administrar one'}).waitFor();
    if(i===2)await page.reload();
    await page.getByRole('button',{name:'Volver a la comunidad'}).click();await page.getByRole('heading',{name:'Comunidad one'}).waitFor();
    await page.getByRole('button',{name:'Volver',exact:true}).click();await page.getByRole('heading',{name:'Origen'}).waitFor();
   }
   results.push({engine,case:'five Next cycles including reload',pass:true});
   await page.getByRole('link',{name:'Comunidad uno',exact:true}).click();await page.getByRole('heading',{name:'Comunidad one'}).waitFor();
   await page.waitForFunction(()=>!!history.state?.vicinoCommunityNavigation?.entryId);
   const entryBefore=await page.evaluate(()=>({length:history.length,id:history.state.vicinoCommunityNavigation.entryId}));
   await page.getByRole('button',{name:'Filtrar comunidad',exact:true}).click();await page.getByText('Filtros aplicados',{exact:true}).waitFor();
   assert.equal(new URL(page.url()).searchParams.get('tab'),'descubrir');
   const entryAfter=await page.evaluate(()=>({length:history.length,id:history.state.vicinoCommunityNavigation.entryId}));
   assert.deepEqual(entryAfter,entryBefore);await page.getByRole('button',{name:'Volver',exact:true}).click();await page.getByRole('heading',{name:'Origen'}).waitFor();
   assert.equal(new URL(page.url()).pathname,'/');results.push({engine,case:'same-entry community filter keeps origin without a history push',pass:true});
   await page.goto(url+'/comunidades/two/administrar');await page.getByRole('button',{name:'Volver a la comunidad'}).click();await page.getByRole('heading',{name:'Comunidad two'}).waitFor();await page.getByRole('button',{name:'Volver',exact:true}).click();await page.getByRole('heading',{name:'Origen'}).waitFor();
   results.push({engine,case:'direct admin fallback',pass:true});
   await page.getByRole('link',{name:'Comunidad dos'}).click();await page.getByRole('link',{name:'Administrar',exact:true}).click();await page.getByRole('heading',{name:'Administrar two'}).waitFor();await page.goBack();await page.getByRole('heading',{name:'Comunidad two'}).waitFor();await page.goForward();await page.getByRole('button',{name:'Volver a la comunidad'}).click();await page.getByRole('button',{name:'Volver',exact:true}).click();await page.getByRole('heading',{name:'Origen'}).waitFor();
   results.push({engine,case:'browser back-forward retains provenance',pass:true});
   await page.goto(url+'/chat');await page.getByText('Elige quién vende para ver sus productos.').waitFor();
   await page.getByRole('button',{name:'Ana · Tú'}).click();await page.getByRole('button',{name:'Beatriz',exact:true}).click();
   await page.getByRole('option',{name:'Producto de b'}).waitFor({state:'attached'});await page.waitForTimeout(600);assert.equal(await page.getByRole('option',{name:'Producto de a'}).count(),0);
   await page.getByRole('combobox').selectOption('b-1');await page.getByRole('button',{name:'Aplicar producto'}).click();await page.getByTestId('active').filter({hasText:'Aplicado b-1'}).waitFor();
   results.push({engine,case:'seller change ignores stale response; apply explicit',pass:true});
   await page.goto(url+'/chat?mode=one');await page.getByRole('option',{name:'Producto de b'}).waitFor({state:'attached'});assert.equal(await page.getByRole('button',{name:'Beatriz',exact:true}).count(),0);
   await page.getByLabel('Buscar producto').fill('missing');await page.getByRole('button',{name:'Buscar',exact:true}).click();await page.getByText('Este vendedor no tiene productos disponibles para esta búsqueda.').waitFor();
   results.push({engine,case:'single fixed seller and empty search',pass:true});
   await page.goto(url+'/chat?mode=none');await page.getByText('Ningún participante tiene productos disponibles.').waitFor();results.push({engine,case:'no eligible sellers',pass:true});
   const cold=await browser.newPage();cold.setDefaultTimeout(15000);await cold.goto(url+'/chat?mode=none');
   await cold.getByText('Ningún participante tiene productos disponibles.').waitFor();
   const historyBefore=await cold.evaluate(()=>history.length);
   await cold.locator('#nav-vender').evaluate(el=>{el.click();el.click()});
   await cold.locator('[data-navigation-feedback="sell"]').first().waitFor();
   await cold.getByRole('heading',{name:'Formulario sintético listo'}).waitFor();await cold.getByLabel('Título').fill('usable');assert.equal(new URL(cold.url()).pathname,'/vender');
   assert.equal(await cold.evaluate(()=>history.length),historyBefore+1);
   results.push({engine,case:'native-style click and duplicate click reach Next selling route',pass:true});
   await cold.close();await page.close();
  }finally{await browser.close();}
 }
 console.log(JSON.stringify({cases:results.length,results},null,2));
}finally{server.kill();await writeFile(resolve(fixture,'results.json'),JSON.stringify(results,null,2));await writeFile(resolve(fixture,'server.log'),logs.join(''));}
