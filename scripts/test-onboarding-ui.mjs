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
const route=(href,replace=false)=>{window.__fixture.trace.push({action:replace?'replace':'push',href});history[replace?'replaceState':'pushState']({},'',href);window.__render();};
const router={push:href=>route(href),replace:href=>route(href,true),refresh:()=>window.__render()};
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
 return {success:true};
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
 import {CompletarPerfil} from './app/(onboarding)/completar-perfil/completar-perfil';
 import {OnboardingOptions} from './app/(onboarding)/bienvenida/onboarding-options';
 import {OnboardingViewport} from './components/onboarding/onboarding-shell';
 import {CATEGORIES} from '@vicino/shared';
 const params=new URLSearchParams(location.search);
 window.__fixture={trace:[],pushMode:params.get('push')||'prompt',saveFailures:Number(params.get('saveFail')||0),profile:{id:'fixture-user',username:'javier_actual',nombre:'Javier',foto:null,bio:null,intereses:[],has_seen_onboarding:false,onboarding_camino:params.get('camino')||'explorar',onboarding_paso:null,es_vendedor:false,categoria_negocio:CATEGORIES[0].slug,seller_type:params.get('tipo')==='business'?'business':'casual',nombre_negocio:'Tienda de prueba',descripcion_negocio:null,metodos_pago_aceptados:null}};
 const originalFetch=window.fetch.bind(window);window.fetch=(resource,init={})=>{if(String(resource).startsWith('/api/onboarding/usuario')){const headers=new Headers(init.headers);headers.set('X-Fixture-Race',window.__fixture.collided?'1':'0');return originalFetch(resource,{...init,headers});}return originalFetch(resource,init);};
 const app=createRoot(document.getElementById('fixture-root'));
 window.__render=()=>{const step=location.pathname.split('/').pop();const content=location.pathname==='/bienvenida'?<OnboardingOptions/>:location.pathname==='/fixture-finished'?<h1>Finalizado</h1>:<CompletarPerfil key={step} profile={{...window.__fixture.profile}} paso={step} camino={window.__fixture.profile.onboarding_camino}/>;app.render(<OnboardingViewport>{content}</OnboardingViewport>);};
 window.addEventListener('popstate',window.__render);window.__render();
 `,resolveDir:web,loader:'tsx'},
 bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',
 define:{'process.env.NODE_ENV':'"production"'},
 alias:{'@':web,'@vicino/shared':resolve(root,'packages/shared/src/index.ts')},
 plugins:[{name:'local-boundaries',setup(b){
  b.onLoad({filter:/[\\/]app[\\/]\((?:onboarding|marketplace)\)[\\/](?:completar-perfil|empezar-a-vender|perfil)[\\/]actions\.ts$/},()=>({loader:'tsx',resolveDir:web,contents:serverActions}));
  b.onResolve({filter:/^(next\/link|next\/navigation|next\/image|@sentry\/nextjs|@\/hooks\/useGeolocation|@\/components\/map\/onboarding-location-map|@\/components\/profile\/avatar-inline-upload|@capacitor\/(?:core|app|push-notifications))$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:web,contents:
   a.path==='next/navigation'?navigation:
   a.path==='next/link'?`export default function Link({href,onClick,children,...props}){return <a href={href} {...props} onClick={event=>{onClick?.(event);if(!event.defaultPrevented&&!props.target){event.preventDefault();history.pushState({},'',href);window.__render();}}}>{children}</a>;}`:
   a.path==='next/image'?`export default function Image({fill,priority,...props}){return <img {...props}/>;}`:
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
  const status=!username?'empty':username==='ocupado'||collision?'taken':username==='admin'?'reserved':!/^[a-zA-Z0-9_]{3,30}$/.test(username)?'invalid':'available';
  const message={empty:'Elige un ID.',taken:'Este ID ya está en uso.',reserved:'Este ID no se puede usar.',invalid:'Usa de 3 a 30 letras, números o guiones bajos.',available:null}[status];
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
await new Promise(done=>server.listen(process.argv[2]==='serve'?4179:0,'127.0.0.1',done));
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
  if(footer){const r=footer.getBoundingClientRect();if(r.bottom>innerHeight+1)failures.push('footer below viewport');for(const button of footer.querySelectorAll('button')){const b=button.getBoundingClientRect();if(b.height<48-1)failures.push('footer touch target <48px');if(!button.contains(document.elementFromPoint(b.left+b.width/2,b.top+b.height/2)))failures.push('footer action occluded');}}
  return {width:innerWidth,height:innerHeight,headingTop:title?.getBoundingClientRect().top,headingFont:title&&getComputedStyle(title).fontFamily,bodyFont:getComputedStyle(document.body).fontFamily,column:section?.getBoundingClientRect().toJSON(),footer:footer?.getBoundingClientRect().toJSON(),failures};
 });
}
async function runCase(name,viewport,path,fn,{theme='light',scale=1,clock=false}={}){
 const page=await browser.newPage({viewport,hasTouch:viewport.width<600});page.setDefaultTimeout(12000);
 const pageErrors=[];const external=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 await page.route('**/*',route=>{if(route.request().url().startsWith(url))return route.continue();external.push(route.request().url());return route.abort();});
 if(clock)await page.clock.install();
 let result={name,viewport,theme,scale,fontSource};
 try{
  await page.goto(url+path);await page.locator('h1').waitFor();
  await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
  await page.evaluate(()=>document.fonts.ready);
  await fn(page);
  if(scale===2)await page.evaluate(()=>{const sizes=[...document.querySelectorAll('h1,p,span,button,label,input,textarea')].map(el=>({el,font:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));for(const {el,font,line}of sizes){el.style.fontSize=font*2+'px';if(Number.isFinite(line))el.style.lineHeight=line*2+'px';}});
  result={...result,...await metrics(page),trace:await page.evaluate(()=>window.__fixture.trace),pageErrors,external};
  assert.equal(result.failures.length,0,result.failures.join('; '));assert.equal(pageErrors.length,0,pageErrors.join('; '));assert.equal(external.length,0,'Unexpected remote request');
  result.passed=true;
 }catch(error){result={...result,passed:false,error:error.message,pageErrors,external};}
 await page.screenshot({path:resolve(out,name+'.png'),fullPage:true}).catch(()=>{});
 await page.close();results.push(result);
}
const mobile={width:375,height:812};
const onlyKeyboardFocus=process.argv[2]==='keyboard-focus';
const onlyCanonicalCaptures=process.argv[2]==='canonical-captures';
const resultFile=onlyKeyboardFocus?'results-keyboard-focus.json':onlyCanonicalCaptures?'results-captures.json':'results.json';
async function availableUsername(page){
 await page.getByText('Este ID está disponible.',{exact:true}).waitFor();
 await page.waitForFunction(()=>{const button=document.querySelector('footer button');return button?.disabled===false&&getComputedStyle(button).opacity==='1';});
 assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),true);
}
try{
 browser=await chromium.launch(launchOptions);
 if(!onlyCanonicalCaptures)for(const [step,label]of [['usuario','ID de usuario'],['nombre','Tu nombre'],['descripcion','Tu descripción']])await runCase(`keyboard-focus-${step}`,mobile,`/completar-perfil/${step}?camino=explorar`,async page=>{
  if(step==='usuario')await availableUsername(page);
  const field=page.getByLabel(label,{exact:true});await field.focus();
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
 if(!onlyKeyboardFocus&&!onlyCanonicalCaptures){
 const steps=['usuario','nombre','foto','descripcion','intereses','ubicacion','categoria','tipo','pagos','activar','notificaciones','listo'];
 for(const [device,viewport]of [['mobile',mobile],['desktop',{width:1280,height:800}],['keyboard',{width:375,height:400}]]){
  for(const theme of ['light','dark']){
   await runCase(`${device}-${theme}-welcome`,viewport,'/bienvenida',async page=>{assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);},{theme});
   for(const step of steps)await runCase(`${device}-${theme}-${step}`,viewport,`/completar-perfil/${step}?camino=vender&tipo=business&push=prompt`,async page=>{if(step==='usuario')await availableUsername(page);},{theme});
  }
 }
 for(const step of ['usuario','descripcion','activar'])await runCase(`mobile-large-text-${step}`,mobile,`/completar-perfil/${step}?camino=vender&push=prompt`,async page=>{if(step==='usuario')await availableUsername(page);},{scale:2});
 for(const step of ['nombre','descripcion'])await runCase(`mobile-light-explore-${step}`,mobile,`/completar-perfil/${step}?camino=explorar`,async()=>{});
 await runCase('username-taken-suggestion',mobile,'/completar-perfil/usuario',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('ocupado');await page.getByText('Este ID ya está en uso.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
  await page.getByRole('button',{name:'@javier_1001',exact:true}).click();await availableUsername(page);
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),true);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'javier_1001');
 });
 await runCase('username-invalid-omit',mobile,'/completar-perfil/usuario',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('?');await page.getByText('Usa de 3 a 30 letras, números o guiones bajos.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.username),'javier_actual');assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').some(x=>'username'in x.input)),false);
 });
 await runCase('username-write-race',mobile,'/completar-perfil/usuario',async page=>{
  await page.getByLabel('ID de usuario',{exact:true}).fill('racing_user');await availableUsername(page);await page.getByRole('button',{name:'Continuar',exact:true}).click();
  await page.getByRole('alert').waitFor();await page.getByText('Este ID ya está en uso.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isDisabled(),true);assert.equal(await page.getByRole('button',{name:'@vecino_2001',exact:true}).isVisible(),true);
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);assert.equal(new URL(page.url()).pathname,'/completar-perfil/usuario');
 });
 await runCase('back-restores-name-draft',mobile,'/completar-perfil/nombre',async page=>{
  await page.getByLabel('Tu nombre',{exact:true}).fill('Nombre sin guardar');await page.getByRole('button',{name:'Regresar',exact:true}).click();await page.getByLabel('ID de usuario',{exact:true}).waitFor();await availableUsername(page);
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByLabel('Tu nombre',{exact:true}).waitFor();assert.equal(await page.getByLabel('Tu nombre',{exact:true}).inputValue(),'Nombre sin guardar');
 });
 await runCase('activation-omit-stays-buyer',mobile,'/completar-perfil/activar?camino=vender&push=prompt',async page=>{
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='activate').length),0);await page.getByRole('button',{name:'Ahora no',exact:true}).click();await page.getByRole('heading',{name:'Activa las notificaciones',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),false);assert.equal(await page.evaluate(()=>window.__fixture.profile.onboarding_camino),'explorar');
 });
 await runCase('activation-only-explicit-cta',mobile,'/completar-perfil/activar?camino=vender&push=prompt',async page=>{
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='activate').length),0);await page.getByRole('button',{name:'Activar Modo Vendedor',exact:true}).click();await page.getByRole('heading',{name:'Activa las notificaciones',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='activate').length),1);assert.equal(await page.evaluate(()=>window.__fixture.profile.es_vendedor),true);
 });
 await runCase('photo-busy-blocks-actions',mobile,'/completar-perfil/foto',async page=>{
  await page.getByRole('button',{name:'Elegir foto de prueba',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('footer button')?.disabled===false);assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);
 });
 for(const mode of ['granted','denied','no-nativo'])await runCase(`permission-auto-${mode}`,mobile,`/completar-perfil/notificaciones?push=${mode}`,async page=>{
  await page.getByRole('heading',{name:'Todo listo para empezar',exact:true}).waitFor();await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').length),1);assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='push-request').length),0);
 });
 await runCase('permission-unknown-can-omit',mobile,'/completar-perfil/notificaciones?push=unknown',async page=>{
  assert.equal(await page.getByRole('button',{name:'Continuar',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Omitir',exact:true}).click();await page.getByRole('heading',{name:'Todo listo para empezar',exact:true}).waitFor();
 });
 for(const mode of ['request-error','read-error','request-denied'])await runCase(`permission-continues-${mode}`,mobile,`/completar-perfil/notificaciones?push=${mode}`,async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('heading',{name:'Todo listo para empezar',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='push-request').length),1);
 });
 await runCase('permission-save-failure-retry',mobile,'/completar-perfil/notificaciones?push=granted&saveFail=1',async page=>{
  await page.getByRole('alert').waitFor();await page.waitForTimeout(400);assert.equal(await page.evaluate(()=>window.__fixture.trace.filter(x=>x.action==='save').length),1);
  assert.equal(await page.getByRole('button',{name:'Omitir',exact:true}).isEnabled(),true);await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.getByRole('heading',{name:'Todo listo para empezar',exact:true}).waitFor();
 });
 await runCase('permission-hanging-request-timeout',mobile,'/completar-perfil/notificaciones?push=hanging',async page=>{
  await page.getByRole('button',{name:'Continuar',exact:true}).click();await page.waitForFunction(()=>window.__fixture.trace.some(x=>x.action==='push-request'));
  await page.clock.fastForward(60_001);await page.getByRole('heading',{name:'Todo listo para empezar',exact:true}).waitFor();
 },{clock:true});
 }
}finally{
 await browser?.close();server.close();await writeFile(resolve(out,resultFile),JSON.stringify(results,null,2));
}
const failures=results.filter(result=>!result.passed);
console.log(JSON.stringify({scope:'simulated local component UI; not auth/RLS/native-device validation',fontSource,cases:results.length,passed:results.length-failures.length,failed:failures.length,failures:failures.map(({name,error,failures,pageErrors,external})=>({name,error,failures,pageErrors,external})),out},null,2));
if(failures.length)process.exitCode=1;
