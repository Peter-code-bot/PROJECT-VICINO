// Banco local: componentes y Server Actions reales; datos desechables en memoria.
// node scripts/listing-flow-fixture.mjs -> http://127.0.0.1:4318
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const scripts = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(scripts, "../apps/web");
const requireWeb = createRequire(path.join(web, "package.json"));
const requireHere = createRequire(import.meta.url);
const cssDirectory = process.env.VICINO_FIXTURE_CSS_DIR || path.join(web, ".next/static");
const { reset, invoke, form, PRODUCT_ID } = requireHere("./test-listing-actions.cjs");
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] }));
let fixture = reset();
let scenario = "success";
let requests = 0;
let delayMs = 12000;
function summary() { return { requests, revalidated: fixture.revalidated, record: fixture.record, writes: fixture.writes }; }
const clientActions = `
async function call(action, id, values) {
  const response = await fetch('/__action', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({action,id,values})});
  if (!response.ok) throw new Error('Conexión interrumpida');
  const result = await response.json();
  window.__fixtureUpdate(result.state);
  if (result.redirect) window.__fixtureNavigate(result.redirect, result.type === 'replace');
  return result.error ? {error:result.error} : undefined;
}
export const deleteProduct = id => call('deleteProduct',id);
export const createProduct = data => call('createProduct',null,Object.fromEntries(data));
export const updateProductFull = (id,data) => call('updateProductFull',id,Object.fromEntries(data));
export const toggleProductStatus = (id,status) => call('toggleProductStatus',id,status);
export const updateProductsOrder = async () => ({});
`;
const mocks = {
  "@/app/(marketplace)/vender/actions": clientActions,
  "./actions": clientActions,
  "next/navigation": `const router={push:p=>window.__fixtureNavigate(p),replace:p=>window.__fixtureNavigate(p,true),back:()=>history.back(),refresh:()=>{window.__refreshes=(window.__refreshes||0)+1;}};export const useRouter=()=>router; export const useSearchParams=()=>new URLSearchParams(location.search); export const usePathname=()=>location.pathname;`,
  "next/link": `import React from 'react'; export default React.forwardRef(({children,href,scroll,prefetch,replace,onClick,...props},ref)=><a ref={ref} href={href} onClick={e=>{onClick?.(e);if(!e.defaultPrevented){e.preventDefault();window.__fixtureNavigate(href,replace);}}} {...props}>{children}</a>);`,
  "next/image": `import React from 'react'; export default function Image({fill,priority,sizes,...props}){return <img {...props}/>;}`,
  "next/dynamic": `export default ()=>()=>null;`,
  "@/components/auth/muro-sesion": `export const useMuroSesion=()=>({pedirSesion:()=>true,haySesion:true});`,
  "@/components/shared/favorite-button": `export const FavoriteButton=()=>null;`,
  "@/components/moderation/report-modal": `export const ReportModal=()=>null;`,
  "@/hooks/use-optimistic-mutation": `export const useOptimisticMutation=fn=>({mutate:fn,isPending:false});`,
  "@/lib/supabase/client": `export const createClient=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},storage:{from:()=>({})}});`,
  "@/lib/haptics": `export const hapticMedium=async()=>{};`,
  "@sentry/nextjs": `export const captureException=()=>{}; export const captureMessage=()=>{};`,
  "sonner": `export const toast={error:()=>{},success:()=>{}};`,
};
const result = await esbuild.build({
  stdin: { loader: "tsx", resolveDir: web, contents: `
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {GalleryTopBar} from './components/product/gallery-top-bar';
import {ListingActions} from './app/seller/listings/listing-actions';
import {ProductForm} from './app/(marketplace)/vender/product-form';
import {DescriptionBlock} from './components/product/description-block';
import {SpecRow} from './components/product/spec-row';
import {ProfileTabs} from './app/(marketplace)/perfil/profile-tabs';
import {SessionDataProvider} from './components/layout/session-data-provider';
const initial={id:'${PRODUCT_ID}',titulo:'Producto de prueba',descripcion:'',precio:100,modo_precio:'precio',tipo:'producto',categories:[{slug:'comida',is_primary:true}],tipo_entrega:'punto_encuentro',estado:null,ubicacion_lat:19,ubicacion_lng:-98,galeria_imagenes:[]};
function App(){
 const [route,setRoute]=useState(location.pathname==='/'?'/perfil':location.pathname+location.search);
 const [snapshot,setSnapshot]=useState(window.__fixtureInitialState);
 useEffect(()=>{const sync=()=>setRoute(location.pathname+location.search);window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 window.__fixtureUpdate=setSnapshot;
 window.__fixtureNavigate=(p,replace=false)=>{history[replace?'replaceState':'pushState']({},'',p);setRoute(p);};
 function go(p){window.__fixtureNavigate(p);}
 async function configure(value){const r=await fetch('/__configure',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({scenario:value})});setSnapshot(await r.json());}
 const pathname=route.split('?')[0];
 const products=snapshot.record&&snapshot.record.estatus!=='eliminado'?[{...snapshot.record,precio:100,imagen_principal:'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/%3E',ventas_count:0}]:[];
 return <SessionDataProvider userId="fixture-user" revision={String(snapshot.revalidated.length)}>
 <header style={{padding:16,borderBottom:'1px solid #ccc'}}><strong>Prueba local con datos simulados</strong>
 <label style={{marginLeft:16}}>Escenario <select aria-label="Escenario" defaultValue="success" onChange={e=>configure(e.target.value)}>
 <option value="success">Correcto</option><option value="slow">Conexión lenta</option><option value="error-once">Error del servidor una vez</option><option value="network-once">Error de conexión una vez</option></select></label>
 <button onClick={()=>go('/perfil')}>Ir al perfil</button> <button onClick={()=>go('/seller/listings')}>Ir a Mi tienda</button>
 <button onClick={()=>go('/vender')}>Abrir formulario</button><button onClick={()=>go('/vender/editar')}>Editar prueba</button>
 </header>
 <main style={{padding:16,maxWidth:760,margin:'auto'}}>
 {pathname==='/perfil'||pathname.startsWith('/vendedor/')?<><h1>Mi perfil</h1><p data-testid="profile-count">Publicaciones: {products.length}</p><ProfileTabs products={products} reviewsAsSeller={[]} reviewsAsBuyer={[]} isVendedor={true} currentUserId="fixture-user"/></>:
 pathname==='/seller/listings'?<><h1>Mi tienda</h1>{snapshot.record&&snapshot.record.estatus!=='eliminado'&&<ListingActions id="${PRODUCT_ID}" estatus={snapshot.record.estatus}/>}</>:
 pathname.startsWith('/vender')?<ProductForm key={route} userId="fixture-user" mode={pathname.endsWith('editar')?'edit':'create'} initialValues={pathname.endsWith('editar')?{...initial,descripcion:'Texto anterior',estado:'bueno'}:initial}/>:
 <><div className="relative" style={{height:240,background:'#1F5A4E',borderRadius:16}}><GalleryTopBar productId="${PRODUCT_ID}" productTitle="Producto de prueba" isFavorite={false} isOwner={!route.includes('visitor=1')} estatus={snapshot.record?.estatus||'disponible'}/></div><h1>{snapshot.record?.titulo||'Producto de prueba'}</h1><SpecRow estado={snapshot.record?.estado} deliveryLabel="Punto de encuentro" createdAt="2026-10-14T12:00:00Z" tipo="producto"/><DescriptionBlock descripcion={snapshot.record?.descripcion}/></>}
 </main><output id="fixture-state" style={{display:'block',padding:16,overflowWrap:'anywhere'}}>{JSON.stringify(snapshot)}</output>
 </SessionDataProvider>;
}
createRoot(document.getElementById('root')).render(<App/>);
` },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "fixture", setup(build) {
    build.onResolve({ filter: /.*/ }, args => mocks[args.path] ? { path: args.path, namespace: "fixture" } : undefined);
    build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "jsx", resolveDir: web }));
  } }],
});
function cssFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry => entry.isDirectory()?cssFiles(path.join(directory,entry.name)):entry.name.endsWith('.css')?[path.join(directory,entry.name)]:[]);
}
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method==='POST'){
      let body=''; for await(const chunk of req) body+=chunk;
      const data=JSON.parse(body);
      if(req.url==='/__configure'){scenario=data.scenario;delayMs=data.delayMs??12000;requests=0;fixture=reset(data.empty?{record:null}:{});res.setHeader('content-type','application/json');res.end(JSON.stringify(summary()));return;}
      if(req.url==='/__action'){
        requests++;
        if(scenario==='slow')await new Promise(resolve=>setTimeout(resolve,delayMs));
        if(scenario==='network-once'){scenario='success';res.statusCode=503;res.end();return;}
        fixture.error=scenario==='error-once'?{code:'42501',message:'fixture error'}:null;
        if(scenario==='error-once')scenario='success';
        const args=data.action==='deleteProduct'?[data.id]:data.action==='toggleProductStatus'?[data.id,data.values]:data.action==='createProduct'?[form(data.values)]:[data.id,form(data.values)];
        const outcome=await invoke(data.action,...args);
        res.setHeader('content-type','application/json');res.end(JSON.stringify({...outcome,state:summary()}));return;
      }
    }
    if(req.url==='/bundle.js'){res.setHeader('content-type','text/javascript');res.end(result.outputFiles[0].text);return;}
    if(req.url==='/styles.css'){res.setHeader('content-type','text/css');res.end(cssFiles(cssDirectory).map(file=>fs.readFileSync(file,'utf8')).join('\n'));return;}
    res.setHeader('content-type','text/html');res.end('<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script>window.__fixtureInitialState='+JSON.stringify(summary()).replaceAll('<','\\u003c')+';</script><script src="/bundle.js"></script></body></html>');
  }catch(error){console.error(error);res.statusCode=500;res.end('Fixture error');}
});
server.listen(4318,'127.0.0.1',()=>console.log('Fixture listo: http://127.0.0.1:4318 (sin base de datos real)'));
