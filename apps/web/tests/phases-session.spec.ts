/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] }));
let script: string;
test.beforeAll(async () => {
  const web=path.resolve(__dirname,'..');
  const mocks:Record<string,string>={
    'next/navigation':`const router={refresh:()=>{}};export const useRouter=()=>router;export const usePathname=()=>'/';`,
    '@/lib/supabase/client':`export const createClient=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}})}});`,
  };
  const result=await esbuild.build({stdin:{contents:`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {SessionDataProvider,useSessionData,useSessionUI,DataRetry} from './components/layout/session-data-provider';
    function Content({route}){const {data,error,retry}=useSessionData('/api/session/'+route);const [tab,setTab]=useSessionUI('tab:'+route,'products');return <><output>{data?.label??'loading'}</output><button onClick={()=>setTab('reviews')}>{tab}</button><DataRetry error={error} retry={retry}/></>;}
    function App(){const [route,setRoute]=useState('home');const [user,setUser]=useState('A');return <SessionDataProvider key={user} userId={user} revision=""><nav>{['home','chats','profile'].map(name=><button key={name} onClick={()=>setRoute(name)}>{name}</button>)}<button onClick={()=>setUser('B')}>Switch account</button></nav><Content key={route} route={route}/></SessionDataProvider>;}
    createRoot(document.getElementById('root')).render(<App/>);`,loader:'tsx',resolveDir:web},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'session-fixture',setup(build:any){
      build.onResolve({filter:/.*/},(args:any)=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
      build.onLoad({filter:/.*/,namespace:'fixture'},(args:any)=>({contents:mocks[args.path],loader:'js',resolveDir:web}));
    }}]});script=result.outputFiles[0].text;
});
test('native fetch, twenty revisits, UI state, stale failure, retry and account isolation',async({page})=>{
  let account='A',failed=false;const reads:string[]=[];
  await page.route('http://localhost:3000/session-fixture',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/session/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').pop()!;reads.push(name);await r.fulfill({status:failed?503:200,contentType:'application/json',body:JSON.stringify({userId:account,value:{label:account+':'+name}})});});
  await page.goto('/session-fixture');await page.addScriptTag({content:script});
  await expect(page.locator('output')).toHaveText('A:home');
  await page.getByRole('button',{name:'products',exact:true}).click();
  for(let i=0;i<20;i++){const route=['chats','profile','home'][i%3]!;await page.getByRole('button',{name:route,exact:true}).click();await expect(page.locator('output')).toHaveText('A:'+route);}
  await page.getByRole('button',{name:'home',exact:true}).click();
  await expect(page.getByRole('button',{name:'reviews',exact:true})).toBeVisible();
  expect(reads).toHaveLength(3);
  failed=true;
  await page.evaluate(()=>{const now=Date.now;Date.now=()=>now()+60000;window.dispatchEvent(new Event('focus'));});
  await expect(page.getByRole('button',{name:'Reintentar'})).toBeVisible();
  await expect(page.locator('output')).toHaveText('A:home');
  failed=false;await page.getByRole('button',{name:'Reintentar'}).click();
  await expect(page.getByRole('button',{name:'Reintentar'})).toHaveCount(0);
  account='B';await page.getByRole('button',{name:'Switch account'}).click();
  await expect(page.locator('output')).toHaveText('B:home');
  await expect(page.getByRole('button',{name:'products',exact:true})).toBeVisible();
});
