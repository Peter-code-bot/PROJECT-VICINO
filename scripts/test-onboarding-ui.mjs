// Local component harness: real onboarding components, push helpers and global CSS.
// Only Next routing, Server Actions, username API data, avatar/geo controls and
// native permission bridge boundaries are simulated. No accounts or remote writes.
// node scripts/test-onboarding-ui.mjs [serve|keyboard-focus|canonical-captures]
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const req = createRequire(resolve(web, 'package.json'));
const rootReq = createRequire(resolve(root, 'package.json'));
const { build } = createRequire(rootReq.resolve('tsx/package.json'))('esbuild');
const tailwind = req('@tailwindcss/postcss');
const postcss = createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
const { chromium } = req('@playwright/test');
const out = resolve(web, 'test-results/onboarding');
await mkdir(out, { recursive: true });

const navigation = `
const route=(href,replace=false)=>{window.__fixture.trace.push({action:replace?'replace':'push',href});history[replace?'replaceState':'pushState']({},'',href);};
const router={push:href=>route(href),replace:href=>route(href,true),refresh:()=>window.__render(),prefetch:href=>window.__fixture.trace.push({action:'prefetch',href})};
export function useRouter(){return router;}
export function usePathname(){return location.pathname;}
export function useSearchParams(){return new URLSearchParams(location.search);}
export function redirect(href){route(href,true);}
`;
const serverActions = `
export async function guardarPasoOnboarding(input){
 const f=window.__fixture;f.trace.push({action:'save',input});
 if(f.saveFailures>0){f.saveFailures--;return {error:'Fallo de guardado simulado.'};}
 if(input.username==='racing_user'){f.collided=true;return {error:'Ese ID acaba de ser elegido por otra persona.'};}
 const keys={paso:'onboarding_paso',camino:'onboarding_camino'};
 for(const [key,value]of Object.entries(input))if(value!==undefined)f.profile[keys[key]||key]=value;
 f.profile.onboarding_revision++;return {success:true};
}
export async function guardarCheckpointOnboarding(input){
 const f=window.__fixture;f.trace.push({action:'save',input});
 await new Promise(done=>setTimeout(done,f.ackDelay));
 if(f.hangingSave)return new Promise(()=>{});
 if(f.userId!==input.expectedUserId)return {error:'Tu sesión cambió. Vuelve a entrar para continuar.'};
 if(f.receipts[input.operationId]){const saved=f.receipts[input.operationId];if(JSON.stringify(input)!==saved.payload)return {error:'Operación reutilizada con otros datos.'};f.trace.push({action:'ack',at:performance.now()});return saved.result;}
 if(f.saveFailures>0){f.saveFailures--;return {error:'Fallo de guardado simulado.'};}
 if(input.fields.username==='racing_user'){f.collided=true;return {error:'Ese ID acaba de ser elegido por otra persona.'};}
 if(input.expectedRevision!==f.profile.onboarding_revision)return {error:'Tu perfil cambió en otra sesión.',conflict:true,data:{status:'conflict',revision:f.profile.onboarding_revision,snapshot:structuredClone(f.profile)}};
 Object.assign(f.profile,input.fields,{onboarding_camino:input.camino,onboarding_paso:input.nextStep,onboarding_revision:f.profile.onboarding_revision+1});
 const result={success:true,data:{status:'saved',revision:f.profile.onboarding_revision,paso:input.nextStep,camino:input.camino,snapshot:structuredClone(f.profile)}};
 f.receipts[input.operationId]={payload:JSON.stringify(input),result};window.__persistFixture();f.trace.push({action:'ack',at:performance.now()});
 if(f.lostAck>0){f.lostAck--;throw new Error('Respuesta de guardado perdida.');}return result;
}
export async function elegirCaminoOnboarding(input){return guardarCheckpointOnboarding(input);}
export async function finalizarOnboarding(input){
 const f=window.__fixture;f.trace.push({action:'finish',input});await new Promise(done=>setTimeout(done,f.ackDelay));
 if(f.userId!==input.expectedUserId)return {error:'Tu sesión cambió.'};
 if(f.receipts[input.operationId]){const saved=f.receipts[input.operationId];if(JSON.stringify(input)!==saved.payload)return {error:'Operación final reutilizada con otros datos.'};return saved.result;}
 if(f.finalFailures>0){f.finalFailures--;return {error:'Fallo final simulado.'};}
 if(input.expectedRevision!==f.profile.onboarding_revision)return {error:'Tu perfil cambió en otra sesión.',conflict:true,data:{status:'conflict',snapshot:structuredClone(f.profile)}};
 if(input.decision==='activar')f.profile.es_vendedor=true;
 Object.assign(f.profile,{has_seen_onboarding:true,onboarding_paso:null,onboarding_revision:f.profile.onboarding_revision+1});
 const result={success:true,destino:'/fixture-finished',data:{status:'saved',snapshot:structuredClone(f.profile)}};
 f.receipts[input.operationId]={payload:JSON.stringify(input),result};window.__persistFixture();f.trace.push({action:'ack',at:performance.now()});
 if(f.finalLostAck>0){f.finalLostAck--;throw new Error('Respuesta final perdida.');}return result;
}
export async function activarModoVendedor(input){window.__fixture.trace.push({action:'activate',input});window.__fixture.profile.es_vendedor=true;return {success:true};}
export async function completeOnboarding(){window.__fixture.trace.push({action:'complete'});return {success:true,destino:'/fixture-finished'};}
`;
const bridgeCore = `export const Capacitor={isNativePlatform:()=>window.__fixture.pushMode!=='no-nativo',getPlatform:()=>window.__fixture.pushMode==='no-nativo'?'web':'android'};export function registerPlugin(){return {};}`;
const bridgePush = `
export const PushNotifications={
 checkPermissions:async()=>{const mode=window.__fixture.pushMode;if(mode==='unknown')return new Promise(()=>{});if(mode==='read-error')throw new Error('Simulated bridge read failure');return {receive:mode==='granted'?'granted':mode==='denied'?'denied':'prompt'};},
 requestPermissions:async()=>{const f=window.__fixture;f.trace.push({action:'push-request'});if(f.pushMode==='hanging')return new Promise(()=>{});if(f.pushMode==='request-error')throw new Error('Simulated bridge request failure');return {receive:f.pushMode==='request-denied'?'denied':'granted'};},
 createChannel:async()=>{},register:async()=>{},addListener:async()=>({remove:async()=>{}}),removeAllListeners:async()=>{}
};
`;
const geo = `export function useGeolocation(){return {state:{status:'idle'},setManualPosition:position=>window.__fixture.trace.push({action:'location',position})};}`;
const map = `export default function Map({onSelectionChange}){return <button type='button' className='min-h-12 w-full rounded-xl border border-border p-4' onClick={()=>onSelectionChange(19,-99,'Zona de prueba')}>Elegir zona de prueba</button>;}`;
const avatar = `export function AvatarInlineUpload({onUploadSuccess,onBusyChange}){return <button type='button' className='min-h-12 rounded-xl border border-border p-4' onClick={()=>{onBusyChange?.(true);setTimeout(()=>{onUploadSuccess('/fixture-avatar.png');onBusyChange?.(false);},300);}}>Elegir foto de prueba</button>;}`;
const bundle = await build({
 stdin:{contents:`
 import {createRoot} from 'react-dom/client';
 import {useState} from 'react';
 import {CompletarPerfil} from './app/(onboarding)/completar-perfil/completar-perfil';
 import {OnboardingSessionProvider} from './app/(onboarding)/completar-perfil/onboarding-session';
 import {OnboardingOptions} from './app/(onboarding)/bienvenida/onboarding-options';
 import {OnboardingViewport} from './components/onboarding/onboarding-shell';
 import {CATEGORIES} from '@vicino/shared';
 const params=new URLSearchParams(location.search);
 const savedConfig=sessionStorage.getItem('test-only-onboarding-config');
 if(savedConfig)for(const [key,value] of new URLSearchParams(savedConfig))if(!params.has(key))params.set(key,value);
 if(params.get('resumeFixture')==='1')sessionStorage.setItem('test-only-onboarding-config',params.toString());
 window.__fixture={trace:[],metricAware:true,receipts:{},userId:'fixture-user',ackDelay:Number(params.get('ackDelay')||0),lostAck:Number(params.get('lostAck')||0),finalFailures:Number(params.get('finalFail')||0),pushMode:params.get('push')||'prompt',saveFailures:Number(params.get('saveFail')||0),profile:{id:'fixture-user',username:params.get('initialUsername')??'javier_actual',nombre:'Javier',foto:null,bio:null,intereses:[],has_seen_onboarding:false,onboarding_revision:0,onboarding_camino:params.get('camino')||'explorar',onboarding_paso:null,es_vendedor:params.get('active')==='1',categoria_negocio:params.get('noCategory')==='1'?null:CATEGORIES[0].slug,seller_type:params.get('tipo')==='business'?'business':'casual',nombre_negocio:'Tienda de prueba',descripcion_negocio:null,metodos_pago_aceptados:null}};
 window.__fixture.finalLostAck=Number(params.get('finalLostAck')||0);
 window.__fixture.hangingSave=params.get('hangingSave')==='1';
 const fixtureKey='test-only-onboarding-server';
 if(params.get('resumeFixture')==='1'){const saved=sessionStorage.getItem(fixtureKey);if(saved){const state=JSON.parse(saved);window.__fixture.profile=state.profile;window.__fixture.receipts=state.receipts;}}
 window.__persistFixture=()=>{if(params.get('resumeFixture')==='1')try{sessionStorage.setItem(fixtureKey,JSON.stringify({profile:window.__fixture.profile,receipts:window.__fixture.receipts}));}catch{}};
 if(params.get('blockedStorage')==='1')Object.defineProperty(sessionStorage,'setItem',{value:()=>{throw new Error('Simulated blocked storage');}});
 const originalFetch=window.fetch.bind(window);window.fetch=(resource,init={})=>{if(String(resource).startsWith('/api/onboarding/usuario')){const headers=new Headers(init.headers);headers.set('X-Fixture-Race',window.__fixture.collided?'1':'0');return originalFetch(resource,{...init,headers});}return originalFetch(resource,init);};
 const app=createRoot(document.getElementById('fixture-root'));
 // The real route layout loads a fresh canonical snapshot when entering it;
 // question-only history changes keep the existing provider mounted.
 function ProfileScreen(){const [loaded]=useState(()=>structuredClone(window.__fixture.profile));return <OnboardingSessionProvider profile={loaded}><CompletarPerfil/></OnboardingSessionProvider>;}
 function WelcomeScreen(){const [loaded]=useState(()=>structuredClone(window.__fixture.profile));return <OnboardingOptions profile={loaded}/>;}
 window.__render=()=>{const content=location.pathname==='/bienvenida'?<WelcomeScreen/>:location.pathname==='/fixture-finished'?<h1>Finalizado</h1>:location.pathname==='/login'?<h1>Inicia sesión</h1>:<ProfileScreen/>;app.render(<OnboardingViewport>{content}</OnboardingViewport>);};
 const pushState=history.pushState.bind(history),replaceState=history.replaceState.bind(history);
 history.pushState=(...args)=>{pushState(...args);window.__render();};history.replaceState=(...args)=>{replaceState(...args);window.__render();};
 window.addEventListener('vicino:onboarding-metric',event=>window.__fixture.trace.push({...event.detail,interaction:event.detail.action,action:'metric'}));
 window.addEventListener('popstate',window.__render);window.__render();
 `,resolveDir:web,loader:'tsx'},
 bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
 define:{'process.env.NODE_ENV':'"production"'},
 alias:{'@':web,'@vicino/shared':resolve(root,'packages/shared/src/index.ts')},
 plugins:[{name:'local-boundaries',setup(b){
  b.onLoad({filter:/[\\/]app[\\/]\((?:onboarding|marketplace)\)[\\/](?:completar-perfil|empezar-a-vender|perfil)[\\/]actions\.ts$/},()=>({loader:'tsx',resolveDir:web,contents:serverActions}));
  b.onResolve({filter:/^(next\/link|next\/navigation|next\/image|next\/dynamic|@sentry\/nextjs|@\/lib\/supabase\/client|@\/hooks\/useGeolocation|@\/components\/map\/onboarding-location-map|@\/components\/profile\/avatar-inline-upload|@capacitor\/(?:core|app|push-notifications))$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:web,contents:
   a.path==='next/navigation'?navigation:
   a.path==='next/link'?`export default function Link({href,onClick,children,...props}){return <a href={href} {...props} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&!props.target){event.preventDefault();history.pushState({},'',href);window.__render();}}}>{children}</a>;}`:
   a.path==='next/image'?`export default function Image({fill,priority,...props}){return <img {...props}/>;}`:
   a.path==='next/dynamic'?`import {lazy,Suspense} from 'react';export default function dynamic(loader,options={}){const Component=lazy(()=>loader().then(value=>typeof value==='function'?{default:value}:value));return props=><Suspense fallback={options.loading?<options.loading/>:null}><Component {...props}/></Suspense>;}`:
   a.path==='@/lib/supabase/client'?`export function createClient(){return {auth:{onAuthStateChange:callback=>{window.__fixture.authChange=callback;return {data:{subscription:{unsubscribe:()=>{}}}}}}};}`:
   a.path==='@/hooks/useGeolocation'?geo:
   a.path==='@/components/map/onboarding-location-map'?map:
   a.path==='@/components/profile/avatar-inline-upload'?avatar:
   a.path==='@sentry/nextjs'?`export {captureException,captureMessage} from '@sentry/react';`:
   a.path==='@capacitor/core'?bridgeCore:
   a.path==='@capacitor/push-notifications'?bridgePush:
   `export const App={addListener:async()=>({remove:async()=>{}})};`}));
 }}]
});
const cssFile=resolve(web,'app/globals.css');
let cssText=(await postcss([tailwind({base:web})]).process(await readFile(cssFile,'utf8'),{from:cssFile})).css;
let fontClasses='';
let fontSource='system-fallback';
try{
 const cssDir=resolve(web,'.next/static/css');
 const built=(await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).map(f=>readFile(resolve(cssDir,f),'utf8')))).join('\n');
 const faces=[...built.matchAll(/@font-face\{[^}]+\}/g)].map(m=>m[0]).join('\n');
 const variables=[...built.matchAll(/\.([\w-]+)\{--font-(?:inter|outfit):[^}]+\}/g)];
 if(variables.length>=2){cssText=faces+'\n'+variables.map(m=>m[0]).join('\n')+'\n'+cssText;fontClasses=variables.map(m=>m[1]).join(' ');fontSource='next-build-inter-outfit';}
}catch{/* A build is optional: actual global styles still run with system font fallback. */}
const html=`<!doctype html><html lang='es' class='h-full ${fontClasses}'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1,viewport-fit=cover'><link rel='stylesheet' href='/style.css'><body class='min-h-full font-sans antialiased bg-background text-foreground'><div id='fixture-root'></div><script src='/bundle.js'></script></body></html>`;
const server=createServer(async(r,s)=>{
 const pathname=new URL(r.url,'http://localhost').pathname;
 if(pathname==='/api/onboarding/usuario'){
  const username=new URL(r.url,'http://localhost').searchParams.get('username')||'';
  const collision=username==='racing_user'&&r.headers['x-fixture-race']==='1';
  const status=!username?'empty':username==='ocupado'||collision?'taken':['admin','api','www','root'].includes(username)?'reserved':!/^[a-zA-Z0-9_]{3,30}$/.test(username)?'invalid':'available';
  const message={empty:'Elige un ID.',taken:'Este ID ya está en uso. Elige otro o una de las sugerencias.',reserved:'Este ID está reservado. Elige otro o una de las sugerencias.',invalid:'Revisa el formato del ID antes de continuar.',available:null}[status];
  s.setHeader('Content-Type','application/json');s.end(JSON.stringify({username,status,message,suggestions:collision?['vecino_2001','vecino_2002','vecino_2003']:['javier_1001','javier_1002','javier_1003']}));return;
 }
 if(pathname==='/bundle.js'){s.setHeader('Content-Type','text/javascript; charset=utf-8');s.end(bundle.outputFiles[0].text);return;}
 if(pathname==='/style.css'){s.setHeader('Content-Type','text/css; charset=utf-8');s.end(cssText);return;}
 if(/^\/_next\/static\/media\/[\w.-]+\.woff2$/.test(pathname)){
  try{s.setHeader('Content-Type','font/woff2');s.end(await readFile(resolve(web,'.next/static/media',pathname.split('/').pop())));}catch{s.writeHead(404);s.end();}return;
 }
 if(/^\/vicino-logo-(?:light-v2|dark)\.png$/.test(pathname)){
  s.setHeader('Content-Type','image/png');s.end(await readFile(resolve(web,'public',pathname.slice(1))));return;
 }
 s.setHeader('Content-Type','text/html; charset=utf-8');s.end(html);
});
await new Promise(done=>server.listen(process.argv[2]==='serve'?Number(process.env.ONBOARDING_FIXTURE_PORT||4179):0,'127.0.0.1',done));
const url=`http://127.0.0.1:${server.address().port}`;
console.log(`Onboarding simulated local preview: ${url}`);
if(process.argv[2]==='serve')await new Promise(()=>{});
const results=[];
const launchOptions=process.env.ONBOARDING_CHROME_CHANNEL?{channel:process.env.ONBOARDING_CHROME_CHANNEL}:{};
let browser;

async function metrics(page){
 return page.evaluate(()=>{
  const failures=[];const section=document.querySelector('section[aria-labelledby]');const title=section?.querySelector('h1');const footer=section?.querySelector('footer');
  if(document.documentElement.scrollWidth>innerWidth+1)failures.push('document horizontal overflow');
  for(const element of document.querySelectorAll('h1,p,button,label,input,textarea,span')){
   const rect=element.getBoundingClientRect();if(!rect.width||!rect.height)continue;
   if(rect.left < -1||rect.right>innerWidth+1)failures.push('horizontal overflow: '+element.textContent.slice(0,50));
   if(element.matches('h1,p,button')&&element.scrollWidth>element.clientWidth+1)failures.push('clipped content: '+element.textContent.slice(0,50));
  }
  if(section){const r=section.getBoundingClientRect();const parent=section.parentElement;const p=parent.getBoundingClientRect();const style=getComputedStyle(parent);const center=(p.left+parseFloat(style.paddingLeft)+p.right-parseFloat(style.paddingRight))/2;if(r.width>448+1)failures.push('column exceeds max-w-md');if(Math.abs((r.left+r.right)/2-center)>1)failures.push('column not horizontally centered in safe content area');}
  if(title&&title.getBoundingClientRect().top>100)failures.push('heading centered vertically');
  const progress=section?.querySelector('[role=progressbar]');
  let progressDetails=null;
  if(progress){const fill=progress.querySelector('[data-onboarding-progress-fill]');const p=progress.getBoundingClientRect();const back=section.querySelector('header [aria-label=Regresar]')?.getBoundingClientRect();const value=Number(progress.getAttribute('aria-valuenow'));
   progressDetails={value,text:progress.getAttribute('aria-valuetext'),fill:getComputedStyle(fill).backgroundColor,track:getComputedStyle(progress).backgroundColor,rect:p.toJSON()};
   if(progressDetails.fill!=='rgb(0, 0, 0)')failures.push('progress fill is not black');
   if(progressDetails.track!=='rgb(217, 217, 217)')failures.push('progress track is not neutral gray');
   if(!Number.isFinite(value)||value<0||value>100||progress.getAttribute('aria-valuemin')!=='0'||progress.getAttribute('aria-valuemax')!=='100')failures.push('invalid accessible progress range');
   if(!progress.getAttribute('aria-label'))failures.push('progress accessible name missing');
   if(back&&back.right>p.left)failures.push('back arrow overlaps progress');
   if(p.height<6||p.height>10)failures.push('progress bar height outside mobile contract');
  }
  if(/Paso \d+ de \d+/.test(section?.querySelector('header')?.textContent||''))failures.push('visible numbered step counter remains');
  if(footer){const r=footer.getBoundingClientRect();if(r.bottom>innerHeight+1)failures.push('footer below viewport');for(const button of footer.querySelectorAll('button')){const b=button.getBoundingClientRect();if(b.height<48-1)failures.push('footer touch target <48px');if(!button.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)))failures.push('footer action occluded');}}
  return {width:innerWidth,height:innerHeight,headingTop:title?.getBoundingClientRect().top,headingFont:title&&getComputedStyle(title).fontFamily,bodyFont:getComputedStyle(document.body).fontFamily,column:section?.getBoundingClientRect().toJSON(),footer:footer?.getBoundingClientRect().toJSON(),progress:progressDetails,failures};
 });
}
async function runCase(name,viewport,path,fn,{theme='light',scale=1,clock=false}={}){
 if(onlyUsername&&!name.startsWith('username-'))return;
 const page=await browser.newPage({viewport,hasTouch:viewport.width<600});page.setDefaultTimeout(12000);
 const pageErrors=[];const external=[];const blockedHostInjection=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 await page.route('**/*',route=>{const requestUrl=route.request().url();if(requestUrl.startsWith(url))return route.continue();const host=new URL(requestUrl).hostname;
  // Host antivirus injects this script into Chrome. Keep it blocked and recorded
  // separately; any external application request still fails the test.
  if(host==='gc.kis.v2.scr.kaspersky-labs.com')blockedHostInjection.push(host);else external.push(requestUrl);return route.abort();});
 if(clock)await page.clock.install();
 let result={name,viewport,theme,scale,fontSource};
 try{
  await page.goto(url+path);await page.locator('h1').waitFor();
  await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
  await page.evaluate(()=>document.fonts.ready);
  await fn(page);
  if(scale===2)await page.evaluate(()=>{const sizes=[...document.querySelectorAll('h1,p,span,button,label,input,textarea')].map(el=>({el,font:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));for(const {el,font,line}of sizes){el.style.fontSize=font*2+'px';if(Number.isFinite(line))el.style.lineHeight=line*2+'px';}});
  result={...result,...await metrics(page),trace:await page.evaluate(()=>window.__fixture.trace),pageErrors,external,blockedHostInjection};
  assert.equal(result.failures.length,0,result.failures.join('; '));assert.equal(pageErrors.length,0,pageErrors.join('; '));assert.equal(external.length,0,'Unexpected remote request');
  result.passed=true;
 }catch(error){result={...result,passed:false,error:error.message,pageErrors,external,blockedHostInjection};}
 await page.screenshot({path:resolve(out,name+'.png'),fullPage:true}).catch(()=>{});
 await page.close();results.push(result);
}
const mobile={width:375,height:812};
const onlyKeyboardFocus=process.argv[2]==='keyboard-focus';
const onlyCanonicalCaptures=process.argv[2]==='canonical-captures';
const onlyJourneys=process.argv[2]==='journeys';
const onlyUsername=process.argv[2]==='username';
const resultFile=onlyUsername?'results-username.json':onlyKeyboardFocus?'results-keyboard-focus.json':onlyCanonicalCaptures?'results-captures.json':onlyJourneys?'results-journeys.json':'results.json';
async function availableUsername(page){
 await page.getByText('Este ID está disponible.',{exact:true}).waitFor();
 await page.waitForFunction(()=>{const button=document.querySelector('footer button');return button?.disabled===false&&getComputedStyle(button).opacity==='1';});
 assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),true);
 assert.equal(await page.locator('#username-continue-help').count(),0,'Available IDs do not show a disabled reason');
 assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).getAttribute('aria-describedby'),null);
}
async function blockedUsername(page,message){
 const status=page.locator('#username-status');
 const footer=page.locator('#username-continue-help');
 const button=page.getByRole('button',{name:'Continuar',exact:true});
 await status.getByText(message,{exact:true}).waitFor();
 await footer.getByText(message,{exact:true}).waitFor();
 assert.equal(await status.innerText(),message,'Username field feedback is specific');
 assert.equal(await footer.innerText(),message,'Footer explains why Continue is disabled');
 assert.equal(await button.isDisabled(),true);
 const describedBy=(await button.getAttribute('aria-describedby')||'').split(/\s+/);
 assert(describedBy.includes('username-continue-help'),'Continue is associated with its reason');
}
async function choosePath(page,label,heading){
 await page.getByRole('heading',{name:'Bienvenido a VICINO',exact:true}).waitFor();
 await page.getByText(label,{exact:true}).click();
 await page.getByRole('button',{name:'Continuar',exact:true}).click();
 await page.getByRole('heading',{name:heading,exact:true}).waitFor();
}
try{
 browser=await chromium.launch(launchOptions);
 if(!onlyCanonicalCaptures&&!onlyJourneys)for(const [step,label]of [['usuario','ID de usuario'],['nombre','Tu nombre'],['descripcion','Tu descripción']])await runCase(`keyboard-focus-${step}`,mobile,`/completar-perfil/${step}?camino=explorar`,async page=>{
  if(step==='usuario')await availableUsername(page);
  // A person cannot focus a disabled field during provider bootstrap. Let the
  // initial heading-focus frame finish, then assert the actual field owns focus.
  await page.waitForFunction(()=>document.querySelector('input,textarea')?.matches(':enabled')===true);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const field=page.getByLabel(label,{exact:true});await field.focus();
  assert.equal(await field.evaluate(element=>document.activeElement===element),true,'The editable question must receive keyboard focus');
  await page.setViewportSize({width:375,height:400});
  await page.waitForFunction(()=>document.querySelector('section[aria-labelledby]')?.getBoundingClientRect().bottom<=400);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const visible=await field.evaluate(element=>{const rect=element.getBoundingClientRect();const scroll=element.closest('section').querySelector(':scope > div').getBoundingClientRect();return rect.top>=scroll.top-1&&rect.bottom<=scroll.bottom+1;});
  assert.equal(visible,true,'Focused field is not fully visible in the reduced keyboard viewport');
 });
 if(onlyCanonicalCaptures)for(const theme of ['light','dark']){
  await runCase(`mobile-${theme}-usuario`,mobile,'/completar-perfil/usuario?camino=vender&tipo=business',availableUsername,{theme});
  for(const step of ['nombre','descripcion'])await runCase(`mobile-${theme}-explore-${step}`,mobile,`/completar-perfil/${step}?camino=explorar`,async()=>{},{theme});
 }
 if(!onlyKeyboardFocus&&!onlyCanonicalCaptures&&!onlyJourneys){
 const steps=['usuario','nombre','foto','descripcion','intereses','ubicacion','categoria','tipo','pagos','activar','notificaciones','listo'];
 for(const [device,viewport]of [['mobile',mobile],['desktop',{width:1280,height:800}],['keyboard',{width:375,height:400}]]){
  for(const theme of ['light','dark']){
   await runCase(`${device}-${theme}-welcome`,viewport,'/bienvenida',async page=>{
    assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled(),true);
    assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).count(),0);
    assert.equal(await page.getByText('Quiero comprar',{exact:true}).isVisible(),true);
    assert.equal(await page.locator('[aria-pressed="true"]').count(),0);
   },{theme});
   for(const step of steps)await runCase(`${device}-${theme}-${step}`,viewport,`/completar-perfil/${step}?camino=vender&tipo=business&push=prompt`,async page=>{if(step==='usuario')await availableUsername(page);},{theme});
  }
 }
 for(const step of ['usuario','descripcion','activar'])await runCase(`mobile-large-text-${step}`,mobile,`/completar-perfil/${step}?camino=vender&push=prompt`,async page=>{if(step==='usuario')await availableUsername(page);},{scale:2});
 for(const step of ['nombre','descripcion'])await runCase(`mobile-light-explore-${step}`,mobile,`/completar-perfil/${step}?camino=explorar`,async()=>{});
 for(const viewport of [mobile,{width:1280,height:800}])for(const theme of ['light','dark'])await runCase(`username-format-${viewport.width}-${theme}`,viewport,'/completar-perfil/usuario',async page=>{
  await availableUsername(page);
  const input=page.getByLabel('ID de usuario',{exact:true});
  const requests=[];
  page.on('request',request=>{if(request.url().includes('/api/onboarding/usuario'))requests.push(request.url());});
  for(const [value,message]of [
   ['', 'Escribe un ID o elige Omitir.'],
   ['a', 'Usa al menos 3 caracteres.'],
   ['ab', 'Usa al menos 3 caracteres.'],
   ['a'.repeat(31), 'Usa como máximo 30 caracteres.'],
   ['Ana_123', 'Usa solo letras minúsculas (a–z).'],
   ['ana 123', 'El ID no puede tener espacios. Usa guion bajo (_) para separar palabras.'],
   [' ana_123 ', 'El ID no puede tener espacios. Usa guion bajo (_) para separar palabras.'],
   ['ana\u00a0123', 'El ID no puede tener espacios. Usa guion bajo (_) para separar palabras.'],
   ['áña', 'Usa solo letras sin acentos (a–z), números y guion bajo (_).'],
   ['ana.123', 'El ID no admite puntos (.). Usa guion bajo (_), por ejemplo: ana_lopez.'],
   ['ana-123', 'El ID no admite guiones (-). Usa guion bajo (_), por ejemplo: ana_lopez.'],
   ['ana\u2011123', 'El ID no admite guiones (-). Usa guion bajo (_), por ejemplo: ana_lopez.'],
   ['@ana', 'Usa solo letras sin acentos (a–z), números y guion bajo (_).'],
   ['ana😀', 'Usa solo letras sin acentos (a–z), números y guion bajo (_).'],
  ]){
   await input.fill(value);
    await blockedUsername(page,message);
   assert.equal(await input.inputValue(),value,'Invalid text stays editable');
   assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);
   if(value)assert.equal(await input.getAttribute('aria-invalid'),'true');
   assert.equal(await page.locator('#username-count').innerText(),`${value.length}/30 caracteres`);
   await page.waitForTimeout(400);
   assert.deepEqual((await metrics(page)).failures,[],'Error text and controls fit the viewport');
   if(value==='ana 123')await page.screenshot({path:resolve(out,`username-error-${viewport.width}-${theme}.png`),fullPage:true});
  }
  assert.equal(requests.length,0,'No availability calls for invalid format');
  assert.equal(await page.getByRole('button',{name:'@javier_1001',exact:true}).isVisible(),true,'Keep suggestions while correcting');
  for(const value of ['abc','a'.repeat(30),'ana_123']){
   await input.fill(value);
   await page.locator('#username-continue-help').getByText('Comprobando disponibilidad…',{exact:true}).waitFor();
   const pendingButton=page.getByRole('button',{name:'Continuar',exact:true});
   assert.equal(await pendingButton.isDisabled(),true);
   assert((await pendingButton.getAttribute('aria-describedby')||'').split(/\s+/).includes('username-continue-help'));
   await availableUsername(page);assert.equal(await input.getAttribute('aria-invalid'),null);
  }
  for(const reserved of ['admin','api','www','root']){
   await input.fill(reserved);await blockedUsername(page,'Este ID está reservado. Elige otro o una de las sugerencias.');
  }
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
 },{theme});
 for(const [status,body] of [
  [401,{error:'Unauthorized'}],
  [429,{error:'Rate limited'}],
  [503,{error:'Unavailable'}],
 ])await runCase(`username-availability-http-${status}`,mobile,'/completar-perfil/usuario',async page=>{
  await availableUsername(page);
  const input=page.getByLabel('ID de usuario',{exact:true});
  await page.route('**/api/onboarding/usuario**',route=>route.fulfill({status,json:body}));
  await input.fill(`lookup_${status}`);
  const message=status===401?'Tu sesión venció. Inicia sesión de nuevo para comprobar el ID.'
   :status===429?'Hiciste varios intentos seguidos. Espera un minuto y vuelve a comprobar el ID.'
     :'La comprobación no está disponible. Conservamos tu ID para que reintentes.';
  await blockedUsername(page,message);
  assert.equal(await input.inputValue(),`lookup_${status}`);
 });
 await runCase('username-availability-network-failure',mobile,'/completar-perfil/usuario',async page=>{
  await availableUsername(page);
  const input=page.getByLabel('ID de usuario',{exact:true});
  await page.route('**/api/onboarding/usuario**',route=>route.abort('failed'));
  await input.fill('lookup_network');
  await blockedUsername(page,'No pudimos comprobar este ID. Revisa tu conexión y vuelve a intentarlo.');
 });
 await runCase('username-availability-response-mismatched-id',mobile,'/completar-perfil/usuario',async page=>{
  await availableUsername(page);
  const input=page.getByLabel('ID de usuario',{exact:true});
  await page.route('**/api/onboarding/usuario**',route=>route.fulfill({status:200,json:{
   username:'different_id',status:'available',message:null,suggestions:['javier_1001','javier_1002','javier_1003'],
  }}));
  const response=page.waitForResponse(response=>response.url().includes('username=lookup_mismatch'));
  await input.fill('lookup_mismatch');
  await response;
  await page.waitForFunction(()=>!document.querySelector('#username-status')?.innerText.includes('Comprobando disponibilidad'));
  await blockedUsername(page,'No pudimos confirmar la respuesta para este ID. Vuelve a comprobarlo.');
 });
 await runCase('username-availability-timeout',mobile,'/completar-perfil/usuario',async page=>{
  await availableUsername(page);
  const input=page.getByLabel('ID de usuario',{exact:true});
  await page.route('**/api/onboarding/usuario**',()=>new Promise(()=>{}));
  await input.fill('lookup_timeout');
  await page.clock.fastForward(351);
  await page.waitForRequest(request=>request.url().includes('username=lookup_timeout'));
  await page.clock.fastForward(10_001);
  await blockedUsername(page,'La comprobación tardó demasiado. Reintenta para continuar.');
 });
 await runCase('username-initial-uppercase-suggestions',mobile,'/completar-perfil/usuario?initialUsername=U0000123',async page=>{
  const input=page.getByLabel('ID de usuario',{exact:true});
  assert.equal(await input.inputValue(),'U0000123');
  await blockedUsername(page,'Usa solo letras minúsculas (a–z).');
  await page.getByRole('button',{name:'@javier_1001',exact:true}).waitFor();
  assert.equal(await input.getAttribute('aria-invalid'),'true');
  const lookups=await page.evaluate(()=>performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>name.includes('/api/onboarding/usuario')));
  assert(lookups.length>0);
  assert(lookups.every(name=>!new URL(name).searchParams.has('username')),'Initial suggestions never submit the invalid draft');
  await page.getByRole('button',{name:'Ver otras opciones',exact:true}).click();
  await page.getByRole('button',{name:'@javier_1001',exact:true}).waitFor();
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
 });
 await runCase('username-initial-suggestions-retry',mobile,'/completar-perfil/usuario?initialUsername=U0000123',async page=>{
  let fail=true;
  await page.route('**/api/onboarding/usuario',route=>fail?route.fulfill({status:503,json:{error:'Fixture failure'}}):route.continue());
  await page.reload();
  await page.getByText('No pudimos cargar tus opciones. Intenta de nuevo.',{exact:true}).waitFor();
  fail=false;await page.getByRole('button',{name:'Reintentar',exact:true}).click();
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
  assert.equal(await page.getByText('No pudimos cargar tus opciones. Intenta de nuevo.',{exact:true}).count(),0);
 });
 await runCase('username-legacy-uppercase-omit',mobile,'/completar-perfil/usuario',async page=>{
  await page.evaluate(()=>{window.__fixture.profile.username='U0000123';window.__render();});
  await page.getByLabel('ID de usuario',{exact:true}).fill('INVALID');
  await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'U0000123');
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save'));
  assert.equal(saves.some(x=>'username'in (x.input.fields||{})),false,'Skip never submits a replacement ID');
 });
 await runCase('username-checkpoint-saves-minimum-and-maximum',mobile,'/completar-perfil/usuario',async page=>{
  let input=page.getByLabel('ID de usuario',{exact:true});
  for(const username of ['abc','a'.repeat(30)]){
   await input.fill(username);await availableUsername(page);
   await page.getByRole('button',{name:'Continuar',exact:true}).click();
   await page.getByLabel('Tu nombre',{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.__fixture.profile.username),username);
   const saved=await page.evaluate(()=>window.__fixture.trace.filter(entry=>entry.action==='save').at(-1)?.input.fields);
   assert.equal(saved.username,username,'The checkpoint saves the ID without changing it');
   if(username.length===3){
    await page.getByRole('button',{name:'Regresar',exact:true}).click();
    await page.getByLabel('ID de usuario',{exact:true}).waitFor();
    input=page.getByLabel('ID de usuario',{exact:true});
    assert.equal(await input.inputValue(),'abc');
   }
  }
 });
 await runCase('username-taken-suggestion',mobile,'/completar-perfil/usuario',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('ocupado');await blockedUsername(page,'Este ID ya está en uso. Elige otro o una de las sugerencias.');
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'javier_1001');
 });
 await runCase('username-invalid-omit',mobile,'/completar-perfil/usuario',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('?');await blockedUsername(page,'Usa solo letras sin acentos (a–z), números y guion bajo (_).');
  await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'javier_actual');assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').some(x=>'username'in x.input)),false);
 });
 await runCase('username-write-race',mobile,'/completar-perfil/usuario',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('racing_user');await availableUsername(page);await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('alert').waitFor();await blockedUsername(page,'Este ID ya está en uso. Elige otro o una de las sugerencias.');
  assert.equal(await page.getByRole('button',{name:'@vecino_2001',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);assert.equal(new URL(page.url()).pathname,'/completar-perfil/usuario');
 });
 await runCase('back-restores-name-draft',mobile,'/completar-perfil/nombre',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Nombre sin guardar');await page.getByRole('button',{name:'Regresar',exact:true}).click();await page.getByLabel('ID de usuario',{exact:true}).waitFor();await availableUsername(page);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();assert.equal(await page.getByLabel('Tu nombre',{exact:true}).inputValue(),'Nombre sin guardar');
 });
 await runCase('seller-final-enter-for-now-stays-buyer',mobile,'/completar-perfil/listo?camino=vender&push=prompt',async page=>{
  assert.equal(await page.getByRole('heading',{name:'Tu perfil para vender',exact:true}).isVisible(),true);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='finish').length),0);
  await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByRole('heading',{name:'Finalizado',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),false);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='finish')[0].input.decision),'explorar');
 });
 await runCase('seller-activates-only-in-atomic-final',mobile,'/completar-perfil/listo?camino=vender&push=prompt',async page=>{
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),false);
  await page.getByRole('button',{name:'Activar y entrar',exact:true}).click();await page.getByRole('heading',{name:'Finalizado',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='finish').length),1);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='activate').length),0);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),true);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.has_seen_onboarding),true);
 });
 await runCase('photo-busy-blocks-actions',mobile,'/completar-perfil/foto',async page=>{
  await page.getByRole('button',{name:'Elegir foto de prueba',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('footer button')?.disabled===false);assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);
 });
 for(const mode of ['granted','denied','no-nativo'])await runCase(`permission-auto-${mode}`,mobile,`/completar-perfil/notificaciones?push=${mode}`,async page=>{
  await page.getByRole('heading',{name:'Tu perfil está listo',exact:true}).waitFor();await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').length),1);assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='push-request').length),0);
 });
 await runCase('permission-unknown-can-omit',mobile,'/completar-perfil/notificaciones?push=unknown',async page=>{
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByRole('heading',{name:'Tu perfil está listo',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='push-request').length),0);
 });
 for(const mode of ['request-error','read-error','request-denied'])await runCase(`permission-continues-${mode}`,mobile,`/completar-perfil/notificaciones?push=${mode}`,async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('heading',{name:'Tu perfil está listo',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='push-request').length),1);
 });
 await runCase('permission-save-failure-retry',mobile,'/completar-perfil/notificaciones?push=granted&saveFail=1',async page=>{
  await page.getByRole('alert').waitFor();await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').length),1);
  await page.getByRole('button',{name:'Reintentar guardado',exact:true}).isEnabled();await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();await page.getByRole('heading',{name:'Tu perfil está listo',exact:true}).waitFor();
 });
 await runCase('permission-hanging-request-timeout',mobile,'/completar-perfil/notificaciones?push=hanging',async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.waitForFunction(()=>window.__fixture.trace.some(x=>x.action==='push-request'));
  await page.clock.fastForward(60_001);await page.getByRole('heading',{name:'Tu perfil está listo',exact:true}).waitFor();
 },{clock:true});
 }
 if(!onlyKeyboardFocus&&!onlyCanonicalCaptures){
 for(const journey of [
  {name:'buyer',camino:'explorar',tipo:'casual'},
  {name:'casual-seller',camino:'vender',tipo:'casual'},
  {name:'business-seller',camino:'vender',tipo:'business'},
 ])for(const action of ['continue','skip'])await runCase(`all-steps-${journey.name}-${action}`,mobile,`/bienvenida?tipo=${journey.tipo}&push=prompt`,async page=>{
  await choosePath(page,journey.camino==='vender'?'Quiero vender':'Quiero comprar',journey.camino==='vender'?'¿Qué vendes?':'Elige tu ID de usuario');
  const expected=[...(journey.camino==='vender'?['categoria','tipo']:[]),'usuario','nombre','foto','descripcion',...(journey.camino==='vender'&&journey.tipo==='business'?['pagos']:[]),'intereses','ubicacion','notificaciones','listo'];
  for(let index=0;index<expected.length;index++){
   const step=expected[index];
   await page.waitForFunction(step=>location.pathname===`/completar-perfil/${step}`,step);
   assert.equal(await page.getByRole('alert').count(),0,`Unexpected error at ${step}`);
   const skip=page.getByRole('button',{name:'Omitir',exact:true});
   await skip.waitFor();
   await page.waitForFunction(()=>[...document.querySelectorAll('footer button')].some(button=>button.textContent==='Omitir'&&!button.disabled));
   assert.equal(await skip.count(),1,`One Skip at ${step}`);
   assert.equal(await skip.isEnabled(),true,`Skip available at ${step}`);
   if(action==='continue'){
    if(step==='categoria'||step==='intereses')await page.getByText('Comida y Bebidas',{exact:true}).click();
    if(step==='tipo')await page.getByText(journey.tipo==='business'?'Negocio':'Casual',{exact:true}).click();
    if(step==='usuario'){await page.getByLabel('ID de usuario',{exact:true}).fill('journey_user');await availableUsername(page);}
    if(step==='nombre')await page.getByLabel(journey.tipo==='business'?'Nombre del negocio':'Tu nombre',{exact:true}).fill('Nombre de prueba');
    if(step==='foto')await page.getByRole('button',{name:'Elegir foto de prueba',exact:true}).click();
    if(step==='descripcion')await page.getByLabel(journey.tipo==='business'?'Descripción del negocio':'Tu descripción',{exact:true}).fill('Descripción de prueba');
    if(step==='pagos'){
     await page.getByRole('button',{name:'Selecciona métodos de pago...',exact:true}).click();
     await page.getByText('Efectivo',{exact:true}).click();
    }
    if(step==='ubicacion')await page.getByRole('button',{name:'Elegir zona de prueba',exact:true}).click();
   }
   const label=action==='skip'?'Omitir':step==='listo'?(journey.camino==='vender'?'Activar y entrar':'Entrar a VICINO'):'Continuar';
   await page.getByRole('button',{name:label,exact:true}).click();
   if(step!=='listo')await page.waitForFunction(next=>location.pathname===`/completar-perfil/${next}`,expected[index+1]);
  }
  await page.getByRole('heading',{name:'Finalizado',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.has_seen_onboarding),true);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),journey.camino==='vender'&&action==='continue');
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(entry=>entry.action==='save').map(entry=>entry.input));
  assert.deepEqual(saves.map(input=>input.nextStep),[expected[0],...expected.slice(1)]);
  assert.equal(new Set(saves.map(input=>input.operationId)).size,saves.length,'Each question uses one operation');
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(entry=>entry.action==='finish').length),1);
 });
 await runCase('reported-seller-buyer-id-back-seller-sequence',mobile,'/bienvenida',async page=>{
  await choosePath(page,'Quiero vender','¿Qué vendes?');
  await page.getByText('Comida y Bebidas',{exact:true}).click();
  await page.getByRole('button',{name:'Regresar',exact:true}).click();
  await choosePath(page,'Quiero comprar','Elige tu ID de usuario');
  await page.getByLabel('ID de usuario',{exact:true}).fill('javierrr');await availableUsername(page);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo te llamas?',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'javierrr');
  await page.getByRole('button',{name:'Regresar',exact:true}).click();await availableUsername(page);
  await page.getByRole('button',{name:'Regresar',exact:true}).click();
  await choosePath(page,'Quiero vender','¿Qué vendes?');
  await page.getByText('Comida y Bebidas',{exact:true}).click();
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Regresar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Qué vendes?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.profile.onboarding_revision===6);
  assert.equal(await page.getByRole('alert').count(),0);
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.deepEqual(saves.map(x=>x.expectedRevision),[0,1,2,3,4,5]);
  assert.deepEqual(saves.map(x=>x.fields),[{},{},{username:'javierrr'},{},{categoria_negocio:'comida'},{}]);
  assert.equal(new Set(saves.map(x=>x.operationId)).size,6);
 });
 await runCase('slow-ack-back-to-selector-serializes-path-change',mobile,'/completar-perfil/categoria?camino=vender&ackDelay=600',async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Regresar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Qué vendes?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Regresar',exact:true}).click();
  await page.getByRole('heading',{name:'Bienvenido a VICINO',exact:true}).waitFor();
  await choosePath(page,'Quiero comprar','Elige tu ID de usuario');await availableUsername(page);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo te llamas?',exact:true}).waitFor();
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_camino),'explorar');
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  const unique=saves.filter((save,index)=>saves.findIndex(other=>other.operationId===save.operationId)===index);
  assert.deepEqual(unique.map(x=>x.expectedRevision),[0,1,2]);
  assert.deepEqual(unique.map(x=>x.camino),['vender','explorar','explorar']);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),3);
 });
 await runCase('browser-back-before-ack-preserves-one-operation',mobile,'/completar-perfil/categoria?camino=vender&ackDelay=600',async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'¿Qué vendes?',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.profile.onboarding_revision===1);
  assert.equal(await page.getByRole('alert').count(),0);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').length),1);
  await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.profile.onboarding_revision===2);
 });
 await runCase('black-progress-start-advance-back-and-final-unconfirmed',mobile,'/completar-perfil/usuario?push=prompt',async page=>{
  await availableUsername(page);
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'0');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo te llamas?',exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'13');
  await page.getByRole('button',{name:'Regresar',exact:true}).click();await availableUsername(page);
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'0');
  await page.evaluate(()=>{history.pushState({},'','/completar-perfil/listo');});
  await page.getByRole('heading',{name:'Tu perfil está listo',exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'88');
 });
 await runCase('black-progress-320px-dark-large-text', {width:320,height:812},'/completar-perfil/usuario?camino=vender&push=prompt',availableUsername,{theme:'dark',scale:2});
 await runCase('black-progress-resolved-notifications-changes-denominator',mobile,'/completar-perfil/listo?push=no-nativo',async page=>{
  await page.waitForFunction(()=>document.querySelector('[role=progressbar]')?.getAttribute('aria-valuetext')==='Etapa 7 de 7');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'86');
 });
 await runCase('saved-id-lost-ack-retry-advances-without-another-operation',mobile,'/completar-perfil/usuario?lostAck=1&resumeFixture=1',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('javierrr');await availableUsername(page);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('alert').first().waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'javierrr');
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_paso),'nombre');
  await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo te llamas?',exact:true}).waitFor();
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),1);
 });
 await runCase('welcome-lost-ack-retry-resumes-original-choice',mobile,'/bienvenida?lostAck=1&resumeFixture=1',async page=>{
  await page.getByText('Quiero vender',{exact:true}).click();
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('alert').first().waitFor();
  assert.equal(new URL(page.url()).pathname,'/bienvenida');
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_camino),'vender');
  await page.getByText('Quiero comprar',{exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),false);
  await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
  await page.getByRole('heading',{name:'¿Qué vendes?',exact:true}).waitFor();
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.equal(saves.length,2);assert.deepEqual(saves[0],saves[1]);
  assert.equal(saves[0].camino,'vender');
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),1);
 });
 await runCase('browser-back-during-id-barrier-is-not-overridden-by-late-ack',mobile,'/completar-perfil/categoria?camino=vender&ackDelay=600',async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'Elige tu ID de usuario',exact:true}).waitFor();
  await page.getByLabel('ID de usuario',{exact:true}).fill('javierrr');await availableUsername(page);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.waitForFunction(()=>window.__fixture.trace.some(x=>x.action==='save'&&x.input.fromStep==='usuario'));
  await page.goBack();await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.profile.username==='javierrr');
  await page.waitForTimeout(50);
  assert.equal(new URL(page.url()).pathname,'/completar-perfil/tipo');
  assert.equal(await page.getByRole('heading',{name:'¿Cómo quieres vender?',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('alert').count(),0);
  const idSaves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save'&&x.input.fromStep==='usuario').map(x=>x.input));
  assert.equal(idSaves.length,1);assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),3);
 });
 await runCase('optional-steps-advance-before-ack-and-save-serially',mobile,'/completar-perfil/nombre?ackDelay=600',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Nombre confirmado');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.nombre),'Javier');
  await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByLabel('Tu descripción',{exact:true}).waitFor();
  await page.getByLabel('Tu descripción',{exact:true}).fill('Descripción confirmada');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'¿Qué te interesa?',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.trace.filter(x=>x.action==='ack').length===3);
  const saves=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.deepEqual(saves.map(x=>x.expectedRevision),[0,1,2]);
  assert.deepEqual(saves.map(x=>x.fields),[{nombre:'Nombre confirmado'},{},{bio:'Descripción confirmada'}]);
 });
 await runCase('omit-discards-current-draft-without-submitting-it',mobile,'/completar-perfil/nombre',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('No guardar este nombre');
  await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.profile.onboarding_revision===1);
  await page.getByRole('button',{name:'Regresar',exact:true}).click();
  await page.getByLabel('Tu nombre',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Tu nombre',{exact:true}).inputValue(),'Javier');
  assert.deepEqual(await page.evaluate(()=>window.__fixture.trace.find(x=>x.action==='save').input.fields),{});
 });
 await runCase('failed-head-stops-descendants-and-retry-preserves-ids',mobile,'/completar-perfil/nombre?ackDelay=150&saveFail=1',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Nombre pendiente');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();
  await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByLabel('Tu descripción',{exact:true}).waitFor();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').length),1);
  await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
  await page.waitForFunction(()=>window.__fixture.profile.onboarding_revision===2);
  const inputs=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.equal(inputs.length,3);assert.deepEqual(inputs[0],inputs[1]);
  assert.notEqual(inputs[1].operationId,inputs[2].operationId);
 });
 await runCase('lost-ack-retries-one-immutable-operation',mobile,'/completar-perfil/nombre?lostAck=1',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Respuesta perdida');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button',{name:'Volver al avance guardado',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Recargar y recuperar',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'Reintentar guardado',exact:true}).click();
  await page.waitForFunction(()=>window.__fixture.trace.filter(x=>x.action==='save').length===2&&!document.querySelector('[role=alert]'));
  const inputs=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.deepEqual(inputs[0],inputs[1]);assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),1);
 });
 await runCase('reload-recovers-prepared-operation-after-lost-ack',mobile,'/completar-perfil/nombre?lostAck=1&resumeFixture=1',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Nombre recuperado');
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('alert').waitFor();
  const original=await page.evaluate(()=>window.__fixture.trace.find(x=>x.action==='save').input);
  await page.reload();await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.trace.some(x=>x.action==='ack'));
  assert.deepEqual(await page.evaluate(()=>window.__fixture.trace.find(x=>x.action==='save').input),original);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),1);
 });
 await runCase('stale-receipt-cannot-rebase-descendants-over-another-session',mobile,'/completar-perfil/nombre?ackDelay=150&lostAck=1&resumeFixture=1',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Primer nombre');await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByRole('alert').waitFor();
  await page.evaluate(()=>{Object.assign(window.__fixture.profile,{onboarding_revision:2,nombre:'Otra sesión',onboarding_paso:'ubicacion'});window.__persistFixture();});
  await page.reload();await page.getByRole('alert').waitFor();
  const inputs=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').map(x=>x.input));
  assert.deepEqual(inputs.map(x=>x.expectedRevision),[0,1]);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.nombre),'Otra sesión');
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),2);
  assert.equal(await page.getByRole('button',{name:'Reintentar guardado',exact:true}).count(),0);
  await page.getByRole('button',{name:'Volver al avance guardado',exact:true}).click();
  await page.getByRole('heading',{name:'¿Dónde estás?',exact:true}).waitFor();
 });
 await runCase('account-change-removes-own-pending-state-and-ignores-late-response',mobile,'/completar-perfil/nombre?ackDelay=400',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Cuenta anterior');await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.waitForFunction(()=>typeof window.__fixture.authChange==='function');
  await page.evaluate(()=>{sessionStorage.setItem('vicino_onboarding_draft:other-user','keep');window.__fixture.authChange('SIGNED_IN',{user:{id:'other-user'}});});
  await page.waitForTimeout(500);
  assert.equal(new URL(page.url()).pathname,'/login');
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('vicino_onboarding_journal_v1:fixture-user')),null);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('vicino_onboarding_draft:other-user')),'keep');
 });
 await runCase('blocked-storage-waits-for-server-before-advancing',mobile,'/completar-perfil/nombre?ackDelay=400&blockedStorage=1',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Guardado sin storage');await page.getByRole('button',{name:'Continuar',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,'/completar-perfil/nombre');
  await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.nombre),'Guardado sin storage');
 });
 await runCase('hanging-checkpoint-times-out-without-discarding-operation',mobile,'/completar-perfil/nombre?hangingSave=1&blockedStorage=1',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Pendiente de confirmar');await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.waitForFunction(()=>window.__fixture.trace.some(x=>x.action==='save'));
  await page.clock.fastForward(20_001);await page.getByText('Aún no sabemos si este paso se guardó. Conservaremos la misma operación para comprobarlo.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reintentar guardado',exact:true}).isEnabled(),true);
  assert.equal(await page.getByRole('button',{name:'Volver al avance guardado',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isDisabled(),true);
 },{clock:true});
 await runCase('business-branch-and-counter-wait-for-confirmed-type',mobile,'/completar-perfil/tipo?camino=vender&ackDelay=300',async page=>{
  await page.getByText('Negocio',{exact:true}).click();await page.getByRole('button',{name:'Continuar',exact:true}).click();
  assert.equal(new URL(page.url()).pathname,'/completar-perfil/tipo');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuetext'),'Etapa 2 de 10. Guardado pendiente');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'10');
  await page.getByLabel('ID de usuario',{exact:true}).waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuetext'),'Etapa 3 de 11');
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'),'18');
  assert.equal(await page.evaluate(()=>window.__fixture.profile.seller_type),'business');
 });
 await runCase('definitive-final-failure-allows-changing-the-decision',mobile,'/completar-perfil/listo?camino=vender&finalFail=1',async page=>{
  await page.getByRole('button',{name:'Activar y entrar',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),false);
  await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByRole('heading',{name:'Finalizado',exact:true}).waitFor();
  const inputs=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='finish').map(x=>x.input));
  assert.deepEqual(inputs.map(x=>x.decision),['activar','explorar']);assert.notEqual(inputs[0].operationId,inputs[1].operationId);
 });
 await runCase('uncertain-final-retains-the-original-decision-and-id',mobile,'/completar-perfil/listo?camino=vender&finalLostAck=1',async page=>{
  await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).count(),1);
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Reintentar entrada',exact:true}).click();await page.getByRole('heading',{name:'Finalizado',exact:true}).waitFor();
  const inputs=await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='finish').map(x=>x.input));
  assert.deepEqual(inputs[0],inputs[1]);assert.equal(inputs[1].decision,'explorar');
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),false);
  assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_revision),1);
 });
 for(const mode of ['granted','denied','no-nativo'])await runCase('final-back-stays-editable-'+mode,mobile,'/completar-perfil/listo?push='+mode,async page=>{
  await page.getByRole('button',{name:'Regresar',exact:true}).click();await page.getByRole('heading',{name:'¿Dónde estás?',exact:true}).waitFor();
  await page.waitForTimeout(100);assert.equal(new URL(page.url()).pathname,'/completar-perfil/ubicacion');
 });
 await runCase('skip-final-existing-seller-preserves-activation',mobile,'/completar-perfil/listo?camino=vender&active=1',async page=>{
  await page.getByRole('button',{name:'Omitir',exact:true}).click();
  await page.getByRole('heading',{name:'Finalizado',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),true);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(entry=>entry.action==='finish')[0].input.decision),'explorar');
 });
 await runCase('skip-double-click-preserves-one-operation',mobile,'/completar-perfil/nombre?ackDelay=600',async page=>{
  await page.waitForFunction(()=>[...document.querySelectorAll('footer button')].some(button=>button.textContent==='Omitir'&&!button.disabled));
  await page.evaluate(()=>{const button=[...document.querySelectorAll('footer button')].find(button=>button.textContent==='Omitir');button.click();button.click();});
  await page.getByRole('heading',{name:'Agrega tu foto',exact:true}).waitFor();
  await page.waitForFunction(()=>window.__fixture.profile.onboarding_revision===1);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(entry=>entry.action==='save').length),1);
  assert.equal(await page.getByRole('alert').count(),0);
 });
 }
}finally{
 await browser?.close();server.close();await writeFile(resolve(out,resultFile),JSON.stringify(results,null,2));
}
const failures=results.filter(result=>!result.passed);
console.log(JSON.stringify({scope:'simulated local component UI; not auth/RLS/native-device validation',fontSource,cases:results.length,passed:results.length-failures.length,failed:failures.length,failures:failures.map(({name,error,failures,pageErrors,external})=>({name,error,failures,pageErrors,external})),out},null,2));
if(failures.length)process.exitCode=1;
