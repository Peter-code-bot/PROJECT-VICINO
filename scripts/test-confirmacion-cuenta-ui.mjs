// Real /confirmar-cuenta page and client form in a local production React bundle.
// Auth, RPC, Server Actions and Next navigation are controlled boundaries.
// This is not a real Auth/RSC/native-device or remote database validation.
// node scripts/test-confirmacion-cuenta-ui.mjs
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'apps/web');
const req = createRequire(resolve(web, 'package.json'));
const rootReq = createRequire(resolve(root, 'package.json'));
const { build } = createRequire(rootReq.resolve('tsx/package.json'))('esbuild');
const { chromium } = req('@playwright/test');
const tailwind = req('@tailwindcss/postcss');
const postcss = createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
const out = resolve(web, 'test-results/confirmacion-cuenta');
await mkdir(out, { recursive: true });

const navigation = `
export class FixtureRedirect extends Error { constructor(href){super('Fixture redirect');this.href=href;} }
export function redirect(href){throw new FixtureRedirect(href);}
const move=href=>{window.__fixture.trace.push({action:'replace',href});history.replaceState({},'',href);};
export function useRouter(){return {replace:move,refresh:()=>{window.__fixture.trace.push({action:'refresh'});window.__render();}};}
export function useSearchParams(){return new URLSearchParams(location.search);}
`;
const auth = `
export function createClient(){return {
 auth:{getUser:async()=>({data:{user:window.__fixture.userId?{id:window.__fixture.userId}:null}})},
 rpc:async name=>{const f=window.__fixture;f.trace.push({action:'legal-read',name});return {
  error:f.rpcError?{message:'Controlled RPC unavailable'}:null,
  data:{confirmed:f.confirmed,documents:[{documento:'terminos',version:f.terminosVersion,confirmada:f.confirmed},{documento:'aviso',version:f.avisoVersion,confirmada:f.confirmed}]}
 };}
};}
`;
const legal = `
export async function confirmarDocumentosCuenta(input){
 const f=window.__fixture;f.trace.push({action:'confirm',input:structuredClone(input)});
 if(f.userId!==input.expectedUserId)return {error:'La cuenta cambió. Recarga antes de continuar.'};
 if(f.mode==='timeout'){
  if(!f.confirmed){f.confirmed=true;f.writes++;}
  return new Promise(()=>{});
 }
 await new Promise(done=>setTimeout(done,f.delay));
 if(f.failures>0){f.failures--;return {error:'No pudimos guardar tu confirmación. Intenta de nuevo.'};}
 if(input.terminosVersion!==f.terminosVersion||input.avisoVersion!==f.avisoVersion)
  return {error:'Los documentos cambiaron. Recarga y revisa las versiones actuales.'};
 if(!f.confirmed){f.confirmed=true;f.writes++;}
 return {success:true};
}
`;
const bundle = await build({
  stdin: { resolveDir: web, loader: 'tsx', contents: `
import {createRoot} from 'react-dom/client';
import ConfirmarCuentaPage from './app/(auth)/confirmar-cuenta/page';
import {TERMINOS_VERSION,AVISO_PRIVACIDAD_VERSION} from '@vicino/shared';
const params=new URLSearchParams(location.search);
window.__fixture={trace:[],writes:0,mode:params.get('mode')||'success',userId:params.get('auth')==='none'?null:'00000000-0000-4000-8000-000000000001',
 delay:Number(params.get('delay')||0),failures:Number(params.get('fail')||0),confirmed:params.get('confirmed')==='1',rpcError:params.get('rpcError')==='1',
 terminosVersion:params.get('stale')==='1'?'999.0':TERMINOS_VERSION,avisoVersion:AVISO_PRIVACIDAD_VERSION,
 expectedVersions:{terminos:TERMINOS_VERSION,aviso:AVISO_PRIVACIDAD_VERSION}};
const app=createRoot(document.getElementById('fixture-root'));
let generation=0;
window.__render=async()=>{
 const current=++generation;
 if(location.pathname!=='/confirmar-cuenta'){app.render(<main><h1>Destino de prueba</h1><p>{location.pathname+location.search}</p></main>);return;}
 try{
  const content=await ConfirmarCuentaPage({searchParams:Promise.resolve({next:new URLSearchParams(location.search).get('next')||undefined})});
  if(current===generation)app.render(content);
 }catch(error){
  if(error.href){window.__fixture.trace.push({action:'server-redirect',href:error.href});history.replaceState({},'',error.href);window.__render();}
  else{window.__fixture.error=error.message;throw error;}
 }
};
window.addEventListener('popstate',window.__render);window.__render();
` },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': web, '@vicino/shared': resolve(root, 'packages/shared/src/index.ts') },
  plugins: [{ name: 'explicit-local-boundaries', setup(b) {
    b.onLoad({ filter: /[\\/]app[\\/]actions[\\/]legal\.ts$/ }, () => ({ loader: 'tsx', resolveDir: web, contents: legal }));
    b.onLoad({ filter: /[\\/]app[\\/]\(auth\)[\\/]actions\.ts$/ }, () => ({ loader: 'tsx', resolveDir: web, contents: `export async function signOut(){window.__fixture.trace.push({action:'logout'});window.__fixture.userId=null;history.replaceState({},'','/login');window.__render();}` }));
    b.onResolve({ filter: /^(next\/link|next\/navigation|@\/lib\/supabase\/server)$/ }, a => ({ path: a.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ loader: 'tsx', resolveDir: web, contents:
      a.path === 'next/navigation' ? navigation : a.path === '@/lib/supabase/server' ? auth :
      `export default function Link({href,children,prefetch,...props}){return <a {...props} href={href} onClick={event=>{if(!props.target){event.preventDefault();history.pushState({},'',href);window.__render();}}}>{children}</a>;}`,
    }));
  } }],
});
const cssFile = resolve(web, 'app/globals.css');
const css = (await postcss([tailwind({ base: web })]).process(await readFile(cssFile, 'utf8'), { from: cssFile })).css;
const html = `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><body class="font-sans antialiased bg-background text-foreground"><div id="fixture-root"></div><script src="/bundle.js"></script></body></html>`;
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/bundle.js') { response.setHeader('Content-Type', 'text/javascript; charset=utf-8'); response.end(bundle.outputFiles[0].text); return; }
  if (path === '/style.css') { response.setHeader('Content-Type', 'text/css; charset=utf-8'); response.end(css); return; }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`Confirmación de cuenta simulated local preview: ${base}`);
const results = [];
let browser;
const destination = '/bienvenida?next=%2Fbuscar%3Fq%3Dmesa';
const path = options => `/confirmar-cuenta?next=${encodeURIComponent(destination)}${options ? '&' + options : ''}`;
const trace = page => page.evaluate(() => window.__fixture.trace);
const attemptCount = page => page.evaluate(() => window.__fixture.trace.filter(item => item.action === 'confirm').length);

async function runCase(name, options, fn, { viewport = { width: 375, height: 812 }, theme = 'light', clock = false } = {}) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 600 });
  page.setDefaultTimeout(10000);
  const pageErrors = [], external = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith(base)) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  if (clock) await page.clock.install();
  let result = { name, viewport, theme };
  try {
    await page.goto(base + path(options)); await page.locator('h1').waitFor();
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), theme);
    await fn(page);
    const layout = await page.evaluate(() => {
      const heading = document.querySelector('h1').getBoundingClientRect();
      const column = document.querySelector('main > div')?.getBoundingClientRect();
      return { headingTop: heading.top, column: column?.toJSON(), overflow: document.documentElement.scrollWidth > innerWidth + 1 };
    });
    assert.equal(layout.overflow, false, 'horizontal overflow');
    assert.equal(pageErrors.length, 0, pageErrors.join('; '));
    assert.equal(external.length, 0, 'Unexpected remote request');
    result = { ...result, passed: true, layout, trace: await trace(page), writes: await page.evaluate(() => window.__fixture.writes) };
    console.log(`PASS ${name}`);
  } catch (error) {
    result = { ...result, passed: false, error: error.message, trace: await trace(page).catch(() => []) };
    console.log(`FAIL ${name}: ${error.message}`);
  }
  result.pageErrors = pageErrors; result.external = external;
  await page.screenshot({ path: resolve(out, name + '.png'), fullPage: true }).catch(() => {});
  await page.close(); results.push(result);
}
async function checkBoth(page) {
  await page.getByRole('checkbox', { name: /Acepto los/ }).check();
  await page.getByRole('checkbox', { name: /He leído el/ }).check();
}
async function assertContext(page) {
  assert.equal(new URL(page.url()).pathname, '/confirmar-cuenta');
  assert.equal(new URL(page.url()).searchParams.get('next'), destination);
  assert.equal(await page.getByRole('checkbox', { name: /Acepto los/ }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: /He leído el/ }).isChecked(), true);
}

try {
  browser = await chromium.launch();
  for (const [name, viewport, theme] of [['mobile-light-initial', { width: 375, height: 812 }, 'light'], ['desktop-dark-initial', { width: 1280, height: 800 }, 'dark']]) {
    await runCase(name, '', async page => {
      const boxes = page.getByRole('checkbox'); assert.equal(await boxes.count(), 2);
      for (const box of await boxes.all()) assert.equal(await box.isChecked(), false);
      assert.equal(await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Omitir', exact: true }).count(), 0);
      const versions = await page.evaluate(() => window.__fixture.expectedVersions);
      for (const [name, href, version] of [['Términos y Condiciones', '/terminos', versions.terminos], ['Aviso de Privacidad', '/privacidad', versions.aviso]]) {
        const link = page.getByRole('link', { name, exact: true });
        assert.equal(await link.getAttribute('href'), href); assert.equal(await link.getAttribute('target'), '_blank');
        assert.equal(await page.getByText(`Versión ${version}`, { exact: true }).isVisible(), true);
        assert.equal(await link.evaluate(element => Boolean(element.compareDocumentPosition(document.querySelector('button[type="submit"]')) & Node.DOCUMENT_POSITION_FOLLOWING)), true);
      }
      assert.equal(await attemptCount(page), 0);
      const placement = await page.evaluate(() => {
        const main = document.querySelector('main'), area = main.getBoundingClientRect(), style = getComputedStyle(main);
        const column = main.firstElementChild.getBoundingClientRect();
        return { top: document.querySelector('h1').getBoundingClientRect().top, width: column.width,
          center: column.x + column.width / 2,
          usableCenter: (area.left + parseFloat(style.paddingLeft) + area.right - parseFloat(style.paddingRight)) / 2 };
      });
      assert(placement.top < 100, 'Heading must start at the top'); assert(placement.width <= 449, 'max-w-md column');
      assert(Math.abs(placement.center - placement.usableCenter) <= 1, 'column horizontally centered in available content area');
    }, { viewport, theme });
  }
  await runCase('two-separate-required-decisions', '', async page => {
    const terms = page.getByRole('checkbox', { name: /Acepto los/ }), notice = page.getByRole('checkbox', { name: /He leído el/ });
    const submit = page.getByRole('button', { name: 'Aceptar y continuar', exact: true });
    await terms.check(); assert.equal(await submit.isDisabled(), true);
    await page.locator('form').first().evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(await attemptCount(page), 0);
    await terms.uncheck(); await notice.check(); assert.equal(await submit.isDisabled(), true);
    await terms.check(); assert.equal(await submit.isEnabled(), true);
    await notice.uncheck(); assert.equal(await submit.isDisabled(), true); assert.equal(await attemptCount(page), 0);
  });
  await runCase('inflight-single-submit-safe-return', 'delay=500', async page => {
    await checkBoth(page);
    await page.locator('form').first().evaluate(form => { form.requestSubmit();form.requestSubmit();form.requestSubmit(); });
    await page.getByRole('button', { name: 'Guardando…', exact: true }).waitFor();
    assert.equal(await attemptCount(page), 1);
    assert.equal(await page.getByRole('checkbox').first().isDisabled(), true);
    assert.equal(new URL(page.url()).pathname, '/confirmar-cuenta', 'No navigation before ACK');
    await page.getByRole('heading', { name: 'Destino de prueba', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, destination);
    const events = await trace(page), input = events.find(item => item.action === 'confirm').input;
    const versions = await page.evaluate(() => window.__fixture.expectedVersions);
    assert.deepEqual(input, { expectedUserId: '00000000-0000-4000-8000-000000000001', terminosVersion: versions.terminos, avisoVersion: versions.aviso, aceptaTerminos: true, acusaAviso: true });
    assert.equal(events.filter(item => item.action === 'confirm').length, 1);
    assert.equal(events.filter(item => item.action === 'replace').length, 1);
    assert.equal(events.filter(item => item.action === 'refresh').length, 1);
  });
  await runCase('error-preserves-context-and-can-retry', 'fail=1', async page => {
    await checkBoth(page); await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).click();
    await page.getByRole('alert').waitFor(); await assertContext(page);
    assert.equal(await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).isEnabled(), true);
    assert.equal((await trace(page)).filter(item => item.action === 'replace').length, 0);
    await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).click();
    await page.getByRole('heading', { name: 'Destino de prueba', exact: true }).waitFor();
    const inputs = (await trace(page)).filter(item => item.action === 'confirm').map(item => item.input);
    assert.equal(inputs.length, 2); assert.deepEqual(inputs[0], inputs[1]);
    assert.equal(await page.evaluate(() => window.__fixture.writes), 1);
  });
  await runCase('version-changed-at-click-does-not-claim-success', '', async page => {
    await checkBoth(page); await page.evaluate(() => { window.__fixture.terminosVersion = '999.0'; });
    await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).click();
    await page.getByText('Los documentos cambiaron. Recarga y revisa las versiones actuales.', { exact: true }).waitFor();
    await assertContext(page); assert.equal(await page.evaluate(() => window.__fixture.writes), 0);
    assert.equal((await trace(page)).filter(item => item.action === 'replace').length, 0);
  });
  await runCase('stale-catalog-hides-form-until-recovery', 'stale=1', async page => {
    await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).count(), 0);
    assert.equal(await page.getByRole('link', { name: 'Términos', exact: true }).getAttribute('href'), '/terminos');
    assert.equal(await page.getByRole('link', { name: 'Aviso de Privacidad', exact: true }).getAttribute('href'), '/privacidad');
    assert.equal(await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).isEnabled(), true);
    assert.equal(await page.getByRole('link', { name: 'Eliminación de cuenta y privacidad', exact: true }).getAttribute('href'), '/eliminar-cuenta');
    await page.evaluate(() => { window.__fixture.terminosVersion = window.__fixture.expectedVersions.terminos; });
    await page.getByRole('link', { name: 'Reintentar', exact: true }).click();
    await page.getByRole('checkbox', { name: /Acepto los/ }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('next'), destination);
    for (const box of await page.getByRole('checkbox').all()) assert.equal(await box.isChecked(), false);
    assert.equal(await attemptCount(page), 0);
  });
  await runCase('timeout-with-unknown-commit-keeps-decision-and-retry', 'mode=timeout', async page => {
    await checkBoth(page); await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).click();
    await page.waitForFunction(() => window.__fixture.trace.some(item => item.action === 'confirm'));
    await page.clock.fastForward(20001);
    await page.getByRole('alert').waitFor(); await assertContext(page);
    assert.equal(await page.evaluate(() => window.__fixture.writes), 1);
    assert.equal(await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.__fixture.mode = 'success'; });
    await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).click();
    await page.clock.fastForward(1);
    await page.getByRole('heading', { name: 'Destino de prueba', exact: true }).waitFor();
    assert.equal(await attemptCount(page), 2); assert.equal(await page.evaluate(() => window.__fixture.writes), 1);
  }, { clock: true });
  await runCase('changed-account-rejects-old-form-without-navigation', '', async page => {
    await checkBoth(page); await page.evaluate(() => { window.__fixture.userId = '00000000-0000-4000-8000-000000000002'; });
    await page.getByRole('button', { name: 'Aceptar y continuar', exact: true }).click();
    await page.getByText('La cuenta cambió. Recarga antes de continuar.', { exact: true }).waitFor();
    await assertContext(page); assert.equal(await page.evaluate(() => window.__fixture.writes), 0);
  });
  await runCase('already-confirmed-skips-repeat-prompt', 'confirmed=1', async page => {
    await page.getByRole('heading', { name: 'Destino de prueba', exact: true }).waitFor();
    assert.equal(await page.getByRole('checkbox').count(), 0); assert.equal(await attemptCount(page), 0);
    assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, destination);
  });
  await runCase('missing-auth-goes-to-login-with-safe-return', 'auth=none', async page => {
    await page.getByRole('heading', { name: 'Destino de prueba', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/login');
    assert.equal(new URL(page.url()).searchParams.get('next'), '/confirmar-cuenta?next=' + encodeURIComponent(destination));
    assert.equal(await attemptCount(page), 0);
  });
  await runCase('rpc-unavailable-keeps-legal-links-and-session-exit', 'rpcError=1', async page => {
    await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('checkbox').count(), 0);
    await page.evaluate(() => { window.__fixture.rpcError = false; });
    await page.getByRole('link', { name: 'Reintentar', exact: true }).click();
    await page.getByRole('checkbox', { name: /Acepto los/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).isEnabled(), true);
    assert.equal(new URL(page.url()).searchParams.get('next'), destination); assert.equal(await attemptCount(page), 0);
  });
} finally {
  await browser?.close(); server.close();
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ scope: 'local real page/form with synthetic Auth/RPC/Server Actions/Next boundaries; no RSC/Auth/native device claims', results }, null, 2));
}
const failures = results.filter(result => !result.passed);
console.log(JSON.stringify({ scope: 'simulated local real-component UI', cases: results.length, passed: results.length - failures.length, failed: failures.length, failures: failures.map(({ name, error, pageErrors, external }) => ({ name, error, pageErrors, external })), out }, null, 2));
if (failures.length) process.exitCode = 1;
