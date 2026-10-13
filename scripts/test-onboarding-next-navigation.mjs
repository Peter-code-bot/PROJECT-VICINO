// Real Next App Router and production SessionDataProvider; only Auth is mocked.
// No accounts, cookies, remote writes or legal approvals. Generated app is ignored.
// ONBOARDING_CHROME_CHANNEL=chrome node scripts/test-onboarding-next-navigation.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const web=resolve(root,'apps/web');
const req=createRequire(resolve(web,'package.json'));
const { chromium }=req('@playwright/test');
const nextVersion=req('next/package.json').version;
const out=resolve(web,'test-results/onboarding-next-navigation');
const appDir=resolve(out,'app-fixture');
const files={
 'package.json':JSON.stringify({private:true,type:'module',dependencies:{next:nextVersion,react:req('react/package.json').version,'react-dom':req('react-dom/package.json').version}}),
 'next.config.mjs':[
  "import { resolve } from 'node:path';",
  'const web='+JSON.stringify(web)+';',
  "export default {agentRules:false,webpack(config){config.resolve.alias['@/lib/supabase/client']=resolve(process.cwd(),'mock-auth.js');config.resolve.alias['@']=web;return config;}};",
 ].join('\n'),
 'mock-auth.js':"export function createClient(){return {auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})}};}",
 'app/layout.jsx':'export default function Root({children}){return <html lang="es"><head><style>{"body{margin:16px;font-family:Arial,sans-serif}a,button{display:block;min-height:44px;margin:8px 0;line-height:44px}"}</style></head><body>{children}</body></html>;}',
 'app/(marketplace)/layout.jsx':"import {SessionDataProvider} from '@/components/layout/session-data-provider';export default function Market({children}){return <SessionDataProvider userId='' revision=''>{children}</SessionDataProvider>;}",
 'app/(marketplace)/mercado/page.jsx':"import Link from 'next/link';export default function Market(){return <main><h1>Mercado simulado</h1><Link href='/completar-perfil/categoria' prefetch={false}>Crear cuenta simulada</Link><Link href='/mercado/otra' prefetch={false}>Otra ruta del mercado</Link></main>;}",
 'app/(marketplace)/mercado/otra/page.jsx':"import Link from 'next/link';export default function Market(){return <main><h1>Otra ruta del mercado</h1><Link href='/completar-perfil/categoria' prefetch={false}>Crear cuenta simulada</Link></main>;}",
 'app/completar-perfil/layout.jsx':"import Question from './question';export default function Onboarding({children}){return <><Question/>{children}</>;}",
 'app/completar-perfil/question.jsx':[
  "'use client';",
  "import {usePathname} from 'next/navigation';",
  "import {useEffect,useState} from 'react';",
  "export default function Question(){const path=usePathname();const [ack,setAck]=useState(0);const [busy,setBusy]=useState(false);useEffect(()=>{window.__nativeHistoryReady=true;},[]);return <main><h1>{path}</h1><output data-ack>{ack}</output><button disabled={busy} onClick={async()=>{setBusy(true);await new Promise(done=>setTimeout(done,50));setAck(n=>n+1);window.history.pushState(null,'','/completar-perfil/tipo');setBusy(false);}}>Continuar con ACK simulado</button><button onClick={()=>window.history.replaceState(null,'','/completar-perfil/usuario')}>Reemplazar</button></main>;}",
 ].join('\n'),
 'app/completar-perfil/[paso]/page.jsx':'export default function Step(){return null;}',
};
await mkdir(out,{recursive:true});
for(const [path,content]of Object.entries(files)){const target=resolve(appDir,path);await mkdir(dirname(target),{recursive:true});await writeFile(target,content);}
const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));
const base='http://127.0.0.1:'+port;
let log='';let startFailure;
const server=spawn(process.execPath,[req.resolve('next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:appDir,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>{log+=chunk.toString();});
server.on('error',error=>{startFailure=error;});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
let browser;
const results=[];
async function snapshot(page){return page.evaluate(()=>({url:location.pathname,heading:document.querySelector('h1')?.textContent,ack:document.querySelector('[data-ack]')?.textContent,nextMarker:!!history.state?.__NA}));}
try{
 const deadline=Date.now()+60_000;
 while(!log.includes('Ready in')){if(startFailure)throw startFailure;if(server.exitCode!==null)throw new Error('Next exited '+server.exitCode+': '+log);if(Date.now()>deadline)throw new Error('Next did not start: '+log);await sleep(100);}
 browser=await chromium.launch(process.env.ONBOARDING_CHROME_CHANNEL?{channel:process.env.ONBOARDING_CHROME_CHANNEL}:{});
 for(const name of ['direct','marketplace-unmount','marketplace-path-change-and-unmount']){
  const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();page.setDefaultTimeout(45_000);const pageErrors=[];const external=[];const blockedHostInjection=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  await page.route('**/*',route=>{const requestUrl=route.request().url();if(requestUrl.startsWith(base))return route.continue();const host=new URL(requestUrl).hostname;
   // The host's antivirus injects a script into Chrome even with extensions disabled.
   // Keep it blocked and recorded separately; application requests remain an error.
   if(host==='gc.kis.v2.scr.kaspersky-labs.com')blockedHostInjection.push(host);else external.push(requestUrl);return route.abort();});
  let item={name};
  try{
   await page.goto(base+(name==='direct'?'/completar-perfil/categoria':'/mercado'));
   await page.waitForTimeout(200);
   if(name==='marketplace-path-change-and-unmount'){await page.getByRole('link',{name:'Otra ruta del mercado',exact:true}).click();await page.getByRole('heading',{name:'Otra ruta del mercado',exact:true}).waitFor();await page.waitForTimeout(100);}
   if(name!=='direct')await page.getByRole('link',{name:'Crear cuenta simulada',exact:true}).click();
   await page.waitForFunction(()=>window.__nativeHistoryReady===true);await page.waitForTimeout(100);
   item.before=await snapshot(page);
   await page.getByRole('button',{name:'Continuar con ACK simulado',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('[data-ack]')?.textContent==='1');
   await page.waitForTimeout(300);item.after=await snapshot(page);
   assert.equal(item.after.url,'/completar-perfil/tipo');assert.equal(item.after.ack,'1');
   assert.equal(item.after.heading,item.after.url,'ACK committed and URL moved, but usePathname/question did not move');
   await page.getByRole('button',{name:'Reemplazar',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='/completar-perfil/usuario');
   await page.goBack();await page.waitForFunction(()=>document.querySelector('h1')?.textContent==='/completar-perfil/categoria');
   assert.equal((await snapshot(page)).ack,'1','Back preserves the persistent question state');
   assert.deepEqual(pageErrors,[]);assert.deepEqual(external,[]);item.passed=true;console.log('PASS '+name+' push/replace/browser Back keep URL, hook and question in sync after ACK');
  }catch(error){item={...item,passed:false,error:error.message,after:await snapshot(page).catch(()=>null),targets:await page.locator('a,button').evaluateAll(elements=>elements.map(element=>({text:element.textContent,box:element.getBoundingClientRect().toJSON(),style:{display:getComputedStyle(element).display,visibility:getComputedStyle(element).visibility}}))).catch(()=>[])};await page.screenshot({path:resolve(out,name+'-failure.png'),fullPage:true}).catch(()=>{});console.log('FAIL '+name+': '+error.message);}
  item.pageErrors=pageErrors;item.external=external;item.blockedHostInjection=blockedHostInjection;results.push(item);await context.close();
 }
}catch(error){results.push({name:'setup',passed:false,error:error.message});console.log('FAIL setup: '+error.message);}
finally{
 await browser?.close();
 if(server.pid&&server.exitCode===null){if(process.platform==='win32'){await promisify(execFile)('taskkill',['/PID',String(server.pid),'/T','/F'],{windowsHide:true}).catch(()=>server.kill());}else server.kill('SIGTERM');}
 await writeFile(resolve(out,'server.log'),log);await writeFile(resolve(out,'results.json'),JSON.stringify({scope:'real Next App Router and real SessionDataProvider; Auth and ACK boundary simulated; no accounts/remote writes',nextVersion,results},null,2));
}
const failed=results.filter(r=>!r.passed);console.log(JSON.stringify({nextVersion,cases:results.length,passed:results.length-failed.length,failed:failed.length,out},null,2));
if(failed.length)process.exitCode=1;
