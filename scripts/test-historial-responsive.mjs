// Local component harness: actual page, tabs and global CSS; only auth/data and
// Next routing are substituted. Does not validate RLS, staging or native shells.
// node scripts/test-historial-responsive.mjs [before|after|serve]
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { runHistorialFlows } from './fixtures/historial-flows.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const req = createRequire(resolve(web, 'package.json'));
const rootReq = createRequire(resolve(root, 'package.json'));
const { build } = createRequire(rootReq.resolve('tsx/package.json'))('esbuild');
const tailwind = req('@tailwindcss/postcss');
const postcss = createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
const { chromium, webkit } = req('@playwright/test');
const mode = process.argv[2] || 'after';
const runLabel = process.env.HISTORIAL_RUN_LABEL || mode;
if (!/^[a-zA-Z0-9-]+$/.test(runLabel)) throw new Error('Invalid run label');
const out = resolve(root, 'apps/web/test-results/historial', runLabel);
await mkdir(out, { recursive: true });

const fixture = `
import {createFixtureClient} from ${JSON.stringify(resolve(root,'scripts/fixtures/historial-client.mjs'))};
export function createClient(){
 const params=new URLSearchParams(location.search);
 if(params.has('total'))localStorage.setItem('fixture-total',params.get('total'));
 if(params.has('hidden'))localStorage.setItem('fixture-hidden','1');
 return createFixtureClient({total:params.has('empty')?0:Number(localStorage.getItem('fixture-total')||5),failure:params.get('fail')||'',hidden:localStorage.getItem('fixture-hidden')==='1',storage:localStorage});
}
`;
const navigation = `
import {useSyncExternalStore} from 'react';
const original=history.replaceState.bind(history);
history.replaceState=(...args)=>{original(...args);window.dispatchEvent(new Event('fixture-navigation'))};
const subscribe=fn=>{window.addEventListener('fixture-navigation',fn);window.addEventListener('popstate',fn);return()=>{window.removeEventListener('fixture-navigation',fn);window.removeEventListener('popstate',fn)}};
export function useSearchParams(){return new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search,()=>''))}
const router={push:href=>location.assign(href),replace:href=>location.replace(href),refresh:()=>window.__refresh()};
export function useRouter(){return router}
export function redirect(href){throw {redirect:href}}
`;
const bundle = await build({
 stdin: { contents: `import {createRoot} from 'react-dom/client'; import Page from './app/(account)/historial/page'; import ReviewPage from './app/(account)/historial/review/page'; import ReviewError from './app/(account)/historial/review/error'; const root=createRoot(document.body); const render=()=>{const component=location.pathname==='/historial/review'?ReviewPage:Page;component({searchParams:Promise.resolve(Object.fromEntries(new URLSearchParams(location.search)))}).then(page=>root.render(page)).catch(error=>{if(error.redirect)location.replace(error.redirect);else root.render(<ReviewError reset={render}/>)});}; window.__refresh=render; render();`, resolveDir:web, loader:'tsx' },
 bundle:true, write:false, format:'iife', platform:'browser', jsx:'automatic',
 alias:{'@':web,'@vicino/shared':resolve(root,'packages/shared/src/index.ts')},
 plugins:[{name:'synthetic-boundaries',setup(b){
 if(mode==='before') b.onLoad({filter:/historial[\\/](page|historial-tabs)\.tsx$/},a=>({loader:'tsx',resolveDir:dirname(a.path),contents:execFileSync('git',['show',`${process.env.HISTORIAL_BASE_REF||'733721753c552e315bb98d51d711fe5db5f18ad4'}:apps/web/app/(account)/historial/${a.path.split(/[\\/]/).pop()}`],{cwd:root,encoding:'utf8'})}));
 b.onResolve({filter:/^(next\/link|next\/navigation|next\/image|@\/lib\/supabase\/(?:server|client))$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'tsx',resolveDir:web,contents:
 a.path==='next/link' ? `export default function Link(props){return <a {...props}/>}` :
 a.path==='next/navigation' ? navigation : a.path==='next/image' ? `export default function Image({fill,...props}){return <img {...props}/>} ` : fixture}));
 }}]
});
const cssFile = resolve(web,'app/globals.css');
const builtCss = process.env.HISTORIAL_BUILT_CSS === '1';
let cssText;
let fontClasses = '';
if (builtCss) {
 const cssDir = resolve(web,'.next/static/css');
 cssText = (await Promise.all((await readdir(cssDir)).filter(f=>f.endsWith('.css')).sort().map(f=>readFile(resolve(cssDir,f),'utf8')))).join('\n');
 fontClasses = [...cssText.matchAll(/\.([\w-]+)\{--font-(?:inter|outfit):[^}]+\}/g)].map(m=>m[1]).join(' ');
 if(fontClasses.split(' ').length!==2)throw new Error('Build CSS must provide Inter and Outfit font variables');
} else {
 cssText = (await postcss([tailwind({base:web})]).process(await readFile(cssFile,'utf8'),{from:cssFile})).css;
}
const html = `<!doctype html><html lang="es" class="h-full ${fontClasses}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><body class="min-h-full flex flex-col font-sans antialiased bg-background text-foreground"><script src="/bundle.js"></script></body></html>`;
const server = createServer(async (r,s)=>{
 const font=/^\/_next\/static\/media\/([\w.-]+\.woff2)$/.exec(r.url);
 if(font) {
  try {s.setHeader('Content-Type','font/woff2');s.end(await readFile(resolve(web,'.next/static/media',font[1])))}
  catch {s.writeHead(404);s.end()}
  return;
 }
 const type = r.url==='/bundle.js' ? 'text/javascript' : r.url==='/style.css' ? 'text/css' : 'text/html';
 s.setHeader('Content-Type',type+'; charset=utf-8');
 s.end(r.url==='/bundle.js'?bundle.outputFiles[0].text:r.url==='/style.css'?cssText:html);
});
await new Promise(r=>server.listen(mode==='serve'?4178:0,'127.0.0.1',r));
const url = `http://127.0.0.1:${server.address().port}`;
console.log(`Historial synthetic preview: ${url}`);
if(mode==='serve') await new Promise(()=>{});
const results=[];
const flowResults=[];
try {
 for(const [engine,type] of Object.entries({chromium,webkit}).filter(([name])=>!process.env.HISTORIAL_ENGINE||process.env.HISTORIAL_ENGINE===name)) {
  const browser = await type.launch(engine==='chromium'&&process.env.HISTORIAL_CHROME_CHANNEL?{channel:process.env.HISTORIAL_CHROME_CHANNEL}:{});
  try {
   if(mode==='flows'){await runHistorialFlows(browser,url,flowResults);continue;}
   for(const width of [320,360,390,430,768,1280]) for(const theme of ['light','dark']) for(const scale of [1,2]) {
    const page = await browser.newPage({viewport:{width,height:900},hasTouch:true});
    page.setDefaultTimeout(15000);
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url); await page.locator('h3').first().waitFor();
    if(builtCss)await page.evaluate(async()=>{await document.fonts.ready;if(!document.fonts.check('14px Inter')||!document.fonts.check('14px Outfit'))throw new Error('Real fonts unavailable')});
    await page.evaluate(theme=>document.documentElement.classList.toggle('dark',theme==='dark'),theme);
    for(const role of ['ventas','compras']) {
     const checks=[];
     const tab = page.getByRole('button',{name:new RegExp(role==='ventas'?'Mis ventas':'Mis compras')});
     await tab.tap();
     if(mode!=='before') {
      // Activate the other choice by keyboard, rather than reselecting the active one.
      const other=page.getByRole('button',{name:new RegExp(role==='ventas'?'Mis compras':'Mis ventas')});
      await other.focus();await page.keyboard.press('Space');
      if(await other.getAttribute('aria-pressed')!=='true' || await tab.getAttribute('aria-pressed')!=='false')checks.push('keyboard switch');
      await tab.focus();await page.keyboard.press('Enter');
     }
     await page.evaluate(scale=>{
     // Enlarge text including fixed-pixel labels, without scaling spacing.
     // Reapply after switching: React may mount new elements for either role.
     for(const el of document.body.querySelectorAll('[style]')) {el.style.removeProperty('font-size');el.style.removeProperty('line-height')}
     const styles=[...document.body.querySelectorAll('div,h1,h3,span,button,a')].map(el=>({el,font:parseFloat(getComputedStyle(el).fontSize),line:parseFloat(getComputedStyle(el).lineHeight)}));
     for(const {el,font,line} of styles){el.style.fontSize=font*scale+'px';if(Number.isFinite(line))el.style.lineHeight=line*scale+'px'}
     }, scale);
     const geometry = await page.evaluate(()=>{
      const failures=[];
      for(const el of document.body.querySelectorAll('div,h3,span,button,a')) {
       const rect=el.getBoundingClientRect(); if(!rect.width||!rect.height)continue;
       if(rect.left < -1 || rect.right > innerWidth+1) failures.push({text:el.textContent.slice(0,70),left:rect.left,right:rect.right});
       if(el.matches('h3,span,button,a') && el.scrollWidth>el.clientWidth+1)failures.push({text:el.textContent.slice(0,70),clipped:true});
       // Inline text and multi-line glyphs can escape while the element box fits.
       for(const node of el.childNodes) if(node.nodeType===Node.TEXT_NODE && node.textContent.trim()) {
        const range=document.createRange();range.selectNodeContents(node);
        for(const r of range.getClientRects())if(r.left < -1 || r.right > innerWidth+1)failures.push({text:node.textContent.slice(0,70),glyphOutside:true,left:r.left,right:r.right});
       }
      }
      return {container:document.querySelector('body > div').getBoundingClientRect().toJSON(),failures};
     });
     if(await page.locator('h3').count()!==5) checks.push('fixture count');
     if(await page.getByText('EN CURSO',{exact:true}).count()!==(role==='ventas'?1:0))checks.push('sales-only stats');
     const review=page.getByRole('link',{name:'Dejar reseña →'});
     if(await review.count()!==1)checks.push('review state');
     const href=await review.getAttribute('href');
     if(!href.includes(role==='ventas'?'seller_to_buyer':'buyer_to_seller'))checks.push('review direction');
     if(mode!=='before') {
      if(await tab.getAttribute('aria-pressed')!=='true')checks.push('selected accessible state');
      const box=await review.boundingBox(); if(box.height<44)checks.push('touch target');
      await review.scrollIntoViewIfNeeded();
      if(!await review.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}))checks.push('review hit target occluded');
     }
     results.push({engine,browserVersion:browser.version(),cssSource:builtCss?'next-build-inter-outfit':'globals-system-fallback',width,theme,scale,role,...geometry,checks,errors});
     if([320,390,1280].includes(width)&&scale===1 || width===320&&scale===2)await page.screenshot({path:resolve(out,`${engine}-${width}-${theme}-${scale}-${role}.png`),fullPage:true});
    }
    await page.close();
   }
   const page=await browser.newPage();page.setDefaultTimeout(15000);await page.goto(url+'/?empty');await page.getByText('Sin ventas aún').waitFor();await page.getByRole('button',{name:/Mis compras/}).click();await page.getByText('Sin compras aún').waitFor();await page.close();
  } finally {await browser.close()}
 }
} finally { server.close(); await writeFile(resolve(out,'results.json'),JSON.stringify(mode==='flows'?flowResults:results,null,2)); }
const failed=results.filter(r=>r.failures.length||r.checks.length||r.errors.length);
console.log(JSON.stringify({cases:results.length+flowResults.length,passed:results.length-failed.length+flowResults.length,failed:failed.length,firstFailure:failed[0]&&{...failed[0],failures:failed[0].failures.slice(0,5)},out},null,2));
if(mode!=='before'&&failed.length)process.exitCode=1;
