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

// Fixture SEMBRADA: lo que pinta una pagina cuyo Server Component ya trajo los
// datos y los entrega como semilla (SessionSeed). La semilla es una constante
// de modulo, como en la app: el mismo objeto en cada render, un solo renderId.
type PluginArgs={path:string};
type PluginBuild={onResolve:(o:{filter:RegExp},cb:(a:PluginArgs)=>unknown)=>void;onLoad:(o:{filter:RegExp;namespace:string},cb:(a:PluginArgs)=>unknown)=>void};
let seededScript:string;
test.beforeAll(async()=>{
  const web=path.resolve(__dirname,'..');
  const mocks:Record<string,string>={
    'next/navigation':`const router={refresh:()=>{}};export const useRouter=()=>router;export const usePathname=()=>'/';`,
    '@/lib/supabase/client':`export const createClient=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}})}});`,
  };
  const result=await esbuild.build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';
    import {SessionDataProvider,useSessionData} from './components/layout/session-data-provider';
    const seed={value:{label:'seed:home'},renderId:'r1'};
    function Content(){const {data}=useSessionData('/api/session/home',seed);return <output>{data?.label??'loading'}</output>;}
    createRoot(document.getElementById('root')).render(<SessionDataProvider userId="A" revision=""><Content/></SessionDataProvider>);`,loader:'tsx',resolveDir:web},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:path.join(web,'tsconfig.json'),define:{'process.env.NODE_ENV':'"production"'},plugins:[{name:'session-seed-fixture',setup(build:PluginBuild){
      build.onResolve({filter:/.*/},(args)=>mocks[args.path]?{path:args.path,namespace:'fixture'}:undefined);
      build.onLoad({filter:/.*/,namespace:'fixture'},(args)=>({contents:mocks[args.path],loader:'js',resolveDir:web}));
    }}]});seededScript=result.outputFiles[0].text;
});
test('a seeded render paints the server data without a read and refetches once on invalidation',async({page})=>{
  const reads:string[]=[];
  await page.route('http://localhost:3000/session-fixture',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.route('**/api/session/*',async r=>{const name=new URL(r.request().url()).pathname.split('/').pop()!;reads.push(name);await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({userId:'A',value:{label:'A:'+name}})});});
  await page.goto('/session-fixture');await page.addScriptTag({content:seededScript});
  await expect(page.locator('output')).toHaveText('seed:home');
  // La hidratacion, el refreshActive del proveedor y el focus del arranque no
  // deben pedir nada: la semilla es reciente y esta dentro del TTL.
  await page.waitForTimeout(300);
  expect(reads).toHaveLength(0);
  // Mismo evento y misma forma que lib/session-events.ts: CustomEvent con el
  // prefijo en `detail`. Un CustomEvent SIN detail lleva null, no undefined,
  // y null no activa el prefijo por defecto de SessionCache.invalidate.
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('vicino:data-invalidated',{detail:'/api/session/home'})));
  await expect(page.locator('output')).toHaveText('A:home');
  expect(reads).toEqual(['home']);
});
