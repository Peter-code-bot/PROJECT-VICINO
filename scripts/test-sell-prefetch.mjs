// Real component, simulated router/network signals; no backend traffic.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const esbuild=require(require.resolve('esbuild',{paths:[require.resolve('tsx')]}));
const {chromium}=require('@playwright/test');
const web=fileURLToPath(new URL('../apps/web',import.meta.url));
const bundle=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {NavigationPrefetch} from './components/layout/navigation-prefetch';createRoot(document.getElementById('root')).render(<NavigationPrefetch authenticated={window.fixture.auth} isVendedor={window.fixture.seller}/>);`,resolveDir:web,loader:'tsx'},bundle:true,platform:'browser',format:'iife',write:false,jsx:'automatic',tsconfig:web+'/tsconfig.json',define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'router-boundary',setup(build){build.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'fake'}));build.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:`const router={prefetch:(href,options)=>window.calls.push({href,kind:options.kind})};export const useRouter=()=>router;export const usePathname=()=>'/';`}));}}]});
const browser=await chromium.launch();
try{
 for(const [label,fixture,expected] of [
  ['seller',{auth:true,seller:true},1],['buyer',{auth:true,seller:false},0],['guest',{auth:false,seller:true},0],
  ['offline',{auth:true,seller:true,offline:true},0],['saveData',{auth:true,seller:true,saveData:true},0],
  ['2g',{auth:true,seller:true,effectiveType:'2g'},0],['hidden',{auth:true,seller:true,hidden:true},0],
 ]){
  const page=await browser.newPage();
  await page.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div><a data-sell-prefetch href="/vender">Vender</a>'}));
  await page.goto('https://fixture.invalid');
  await page.evaluate(f=>{window.fixture=f;window.calls=[];Object.defineProperty(navigator,'onLine',{value:!f.offline});Object.defineProperty(navigator,'connection',{value:{saveData:f.saveData,effectiveType:f.effectiveType}});Object.defineProperty(document,'visibilityState',{value:f.hidden?'hidden':'visible'});},fixture);
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForTimeout(400);
  await page.locator('a').evaluate(el=>{for(let i=0;i<8;i++)el.dispatchEvent(new Event('pointerover',{bubbles:true}));});
  const calls=await page.evaluate(()=>window.calls);assert.equal(calls.filter(c=>c.href==='/vender').length,expected,label);assert.ok(calls.length<=4);console.log('PASS',label);await page.close();
 }
 console.log('7/7 prefetch gates and deduplication pass; router mocked.');
}finally{await browser.close();}
