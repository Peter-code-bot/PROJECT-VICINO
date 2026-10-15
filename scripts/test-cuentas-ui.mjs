// Real account UI + Supabase SDK + the JS bridge shipped in CromoNativo.swift.
// Auth HTTP responses, Next navigation, telemetry and image delivery are local
// boundaries. This does NOT validate UIKit, native push, OAuth or production Auth.
// node scripts/test-cuentas-ui.mjs [--regression]
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
const { chromium, webkit, expect } = req('@playwright/test');
const postcss = createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
const tailwind = req('@tailwindcss/postcss');
const regression = process.argv.includes('--regression');
const filterName = process.env.CUENTAS_UI_FILTER?.replace(/[^a-z0-9-]/gi, '-');
const out = resolve(web, 'test-results/cuentas-ui', regression ? 'before' : filterName ? `stability-${filterName}` : 'after');
await mkdir(out, { recursive: true });
const swift = await readFile(resolve(web, 'ios/App/App/CromoNativo.swift'), 'utf8');
const bridge = swift.match(/private static let puenteJS = #"""\r?\n([\s\S]*?)\r?\n\s*"""#/)[1];
const sessions = Array.from({ length: 6 }, (_, index) => {
  const user = { id: randomUUID(), aud: 'authenticated', role: 'authenticated', email: `qa${index + 1}@example.test`,
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: { full_name: `Persona ${index + 1}` },
    created_at: new Date().toISOString() };
  const expires_at = Math.floor(Date.now() / 1000) + 3600;
  const access_token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, exp: expires_at, session_id: randomUUID(), role: user.role })).toString('base64url'),
    randomBytes(32).toString('base64url')].join('.');
  return { user, access_token, refresh_token: randomBytes(32).toString('base64url'), token_type: 'bearer', expires_in: 3600, expires_at };
});
const key = randomBytes(32).toString('base64url');
let bundle, css;
const html = '<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"><body class="bg-background text-foreground"><div id="root"></div><script src="/bundle.js"></script></body></html>';
const server = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.setHeader('Content-Type', path === '/bundle.js' ? 'text/javascript; charset=utf-8' : path === '/style.css' ? 'text/css' : 'text/html; charset=utf-8');
  response.end(path === '/bundle.js' ? bundle : path === '/style.css' ? css : html);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://localhost:${server.address().port}`;
const navigation = `
function move(href,kind){window.__events.push({kind,href});history[kind==='push'?'pushState':'replaceState']({},'',href);void window.__render();}
export function useRouter(){return {push:href=>move(href,'push'),replace:href=>move(href,'replace'),refresh:()=>{window.__events.push({kind:'refresh'});void window.__render();}};}
export function usePathname(){return location.pathname;}
export function useSearchParams(){return new URLSearchParams(location.search);}
`;
const entry = `
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from 'next-themes';
import {Toaster} from 'sonner';
import {AccountMenuDrawer} from './components/profile/account-menu-drawer';
import {AvisoAgregandoCuenta} from './components/cuentas/aviso-agregando-cuenta';
import {RegistroCuentaActiva} from './components/cuentas/registro-cuenta-activa';
import {SalirDeTodasSection} from './components/cuentas/salir-de-todas-section';
import {useLogout} from './hooks/use-logout';
import {createClient} from './lib/supabase/client';
import {guardarCuenta,leerCuentas} from './lib/cuentas/boveda';
window.__events=[];window.__nativeMessages=[];window.__mode='ok';
window.__sessions=${JSON.stringify(sessions)};
const client=createClient();window.__client=client;window.__read=leerCuentas;
const count=Number(new URLSearchParams(location.search).get('count')||2);
function data(s){return {userId:s.user.id,email:s.user.email,nombre:s.user.user_metadata.full_name,username:'qa'+(window.__sessions.indexOf(s)+1),foto:null,accessToken:s.access_token,refreshToken:s.refresh_token};}
for(const s of window.__sessions.slice(0,count))guardarCuenta(data(s));
const app=createRoot(document.getElementById('root'));
function Logout(){const logout=useLogout();return <button onClick={()=>void logout()}>Cerrar sesión de prueba</button>;}
window.__render=async()=>{
 const {data:{session}}=await client.auth.getSession();
 const current=session&&window.__sessions.find(s=>s.user.id===session.user.id);
 const account=current&&data(current);
 app.render(<ThemeProvider attribute="class" defaultTheme="light"><Toaster/>
 {location.pathname==='/login'?<main><h1>Acceso de prueba</h1>{location.search.includes('agregar=1')&&<AvisoAgregandoCuenta/>}</main>:
 <><header>{account&&<AccountMenuDrawer userId={account.userId} userName={account.nombre} username={account.username} userIsVendedor trigger={<button aria-label="Menú de cuenta">Menú de cuenta</button>}/>}</header>
 <main style={{minHeight:'150vh'}}><h1>{account?.nombre||'Sin sesión'}</h1>{account&&<><Logout/><SalirDeTodasSection/><RegistroCuentaActiva key={account.userId} cuenta={account} renderId={account.userId}/></>}</main></>}
 </ThemeProvider>);
};
await client.auth.setSession({access_token:window.__sessions[0].access_token,refresh_token:window.__sessions[0].refresh_token});
await window.__render();window.__ready=true;
`;
try {
  const result = await build({ stdin: { contents: entry, loader: 'tsx', resolveDir: web }, bundle: true, write: false,
    format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
    define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(base), 'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(key) },
    alias: { '@': web, '@vicino/shared': resolve(root, 'packages/shared/src/index.ts') },
    plugins: [{ name: 'local-framework-boundaries', setup(b) {
      b.onResolve({ filter: /^(next\/link|next\/navigation|next\/image|@sentry\/nextjs)$/ }, a => ({ path: a.path, namespace: 'boundary' }));
      b.onLoad({ filter: /.*/, namespace: 'boundary' }, a => ({ loader: 'tsx', resolveDir: web, contents:
        a.path === 'next/navigation' ? navigation : a.path === '@sentry/nextjs' ? 'export function captureException(){window.__events.push({kind:"telemetry"});}' :
        a.path === 'next/image' ? 'export default function Image(props){return <img {...props}/>;}' :
        'export function useLinkStatus(){return {pending:false};} export default function Link({href,children,prefetch,onNavigate,...props}){return <a {...props} href={href} onClick={event=>{props.onClick?.(event);if(!event.defaultPrevented){event.preventDefault();window.__events.push({kind:"link",href});history.pushState({},"",href);void window.__render();}}}>{children}</a>;}'
      }));
    } }] });
  bundle = result.outputFiles[0].text;
  // Top-level await is intentional in the fixture; serve it as a module.
  const cssFile = resolve(web, 'app/globals.css');
  css = (await postcss([tailwind({ base: web })]).process(await readFile(cssFile, 'utf8'), { from: cssFile })).css;
} catch (error) { server.close(); throw error; }
const moduleHtml = html.replace('<script src=', '<script type="module" src=');
server.removeAllListeners('request');
server.on('request', (request, response) => {
  const path = new URL(request.url, base).pathname;
  response.setHeader('Content-Type', path === '/bundle.js' ? 'text/javascript; charset=utf-8' : path === '/style.css' ? 'text/css' : 'text/html; charset=utf-8');
  response.end(path === '/bundle.js' ? bundle : path === '/style.css' ? css : moduleHtml);
});
const results = [];
let browser;
async function run(name, engine, fn, options = {}) {
  if (process.env.CUENTAS_UI_FILTER && !name.includes(process.env.CUENTAS_UI_FILTER)) return;
  const context = await browser.newContext({ viewport: options.viewport || { width: 375, height: 812 }, hasTouch: true });
  const page = await context.newPage();
  const failures = [], api = [];
  page.on('pageerror', e => failures.push(e.message));
  const revoked = new Set();
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    const token = request.headers().authorization?.replace(/^Bearer /, '');
    const session = sessions.find(s => s.access_token === token);
    if (url.pathname.startsWith('/auth/v1/')) {
      const mode = await page.evaluate(() => window.__mode || 'ok');
      api.push({ method: request.method(), path: url.pathname, user: session?.user.id, scope: url.searchParams.get('scope') });
      if (mode === 'offline' && session?.user.id === sessions[1].user.id) return route.abort();
      if (url.pathname.endsWith('/logout')) {
        if (session) revoked.add(session.user.id);
        return route.fulfill({ status: 204, body: '' });
      }
      if (url.pathname.endsWith('/user')) {
        if (!session || revoked.has(session.user.id) || (mode === 'expired' && session.user.id === sessions[1].user.id))
          return route.fulfill({ status: 403, json: { code: 'session_not_found', message: 'Controlled session not found' } });
        return route.fulfill({ status: 200, json: session.user });
      }
      if (url.pathname.endsWith('/token')) {
        const body = request.postDataJSON();
        const s = sessions.find(s => s.refresh_token === body.refresh_token);
        if (!s || revoked.has(s.user.id) || mode === 'expired') return route.fulfill({ status: 400, json: { code: 'refresh_token_not_found', message: 'Controlled refresh token not found' } });
        return route.fulfill({ status: 200, json: s });
      }
      throw new Error('Unexpected Auth HTTP endpoint: ' + url.pathname);
    }
    if (url.pathname.startsWith('/rest/v1/profiles')) { api.push({ method: request.method(), path: url.pathname, user: session?.user.id }); return route.fulfill({ status: 204, body: '' }); }
    return route.continue();
  });
  let result = { name, engine, viewport: options.viewport || { width: 375, height: 812 } };
  try {
    await page.goto(base + '/?count=' + (options.count || 2));
    await page.waitForFunction(() => window.__ready);
    await expect(page.getByRole('heading', { name: 'Persona 1', exact: true })).toBeVisible();
    await page.evaluate(theme => document.documentElement.classList.toggle('dark', theme === 'dark'), options.theme);
    await fn(page, api);
    assert.deepEqual(failures, [], 'No browser exceptions');
    result.passed = true; console.log('PASS ' + engine + ' ' + name);
  } catch (error) { result.passed = false; result.error = error.message; console.log('FAIL ' + engine + ' ' + name + ': ' + error.message); }
  result.api = api;
  await page.screenshot({ path: resolve(out, engine + '-' + name + '.png') }).catch(() => {});
  await context.close(); results.push(result);
}
async function nativeMenu(page) {
  await page.evaluate(() => { window.webkit = { messageHandlers: { vicinoCromo: { postMessage(text) { window.__nativeMessages.push(JSON.parse(text)); } } } }; });
  await page.addScriptTag({ content: bridge });
  await page.evaluate(() => window.__vicinoCromo.cabecera(0));
  await page.waitForFunction(() => window.__nativeMessages.some(m => m.menu));
  return page.evaluate(() => window.__nativeMessages.find(m => m.menu).menu);
}
async function openWeb(page) {
  await page.getByRole('button', { name: 'Menú de cuenta', exact: true }).click();
  await page.getByRole('button', { name: /^Cuentas:/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Cuentas', exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}
try {
  for (const [engine, launcher] of [['chromium', chromium], ['webkit', webkit]]) {
    browser = await launcher.launch({ headless: true });
    await run('native-profile-data', engine, async page => {
      const menu = await nativeMenu(page);
      assert.equal(menu.perfil.nombre, 'Persona 1', 'Native profile must keep name');
      assert.equal(menu.perfil.usuario, '@qa1', 'Native profile must keep username');
    });
    await run('native-selector-visible', engine, async page => {
      await nativeMenu(page);
      await page.evaluate(() => window.__vicinoCromo.menuIr('/perfil'));
      await expect(page.getByRole('dialog', { name: 'Cuentas', exact: true })).toBeVisible({ timeout: 3000 });
      await expect(page.getByRole('button', { name: 'Agregar cuenta', exact: true })).toBeVisible();
      assert.equal(await page.locator('[data-cromo-menu]').count(), 0, 'Dismissed native menu cannot leave hidden web drawer');
      await page.getByRole('dialog', { name: 'Cuentas', exact: true }).getByRole('button', { name: 'Cerrar', exact: true }).last().click();
      await expect(page.getByRole('dialog', { name: 'Cuentas', exact: true })).toBeHidden();
      await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
    });
    if (!regression) {
      await run('native-profile-link', engine, async page => {
        const menu = await nativeMenu(page);
        const profile = menu.secciones.flatMap(s => s.opciones).find(o => o.titulo === 'Mi perfil');
        assert.ok(profile, 'Native menu keeps Mi perfil');
        await page.evaluate(href => window.__vicinoCromo.menuIr(href), profile.href);
        await expect(page).toHaveURL(/\/perfil(?:\?|$)/);
        await expect(page.getByRole('dialog', { name: 'Cuentas', exact: true })).toHaveCount(0);
      });
      await run('native-add-cancel', engine, async page => {
        await nativeMenu(page);
        await page.evaluate(() => window.__vicinoCromo.menuIr('/perfil'));
        const sheet = page.getByRole('dialog', { name: 'Cuentas', exact: true });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: 'Agregar cuenta', exact: true }).click();
        await expect(page.getByText('Estás agregando otra cuenta.', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Persona 1', exact: true })).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
      });
      await run('native-switch', engine, async page => {
        await nativeMenu(page);
        await page.evaluate(() => window.__vicinoCromo.menuIr('/perfil'));
        const sheet = page.getByRole('dialog', { name: 'Cuentas', exact: true });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('button', { name: 'Cambiar a Persona 2', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Persona 2', exact: true })).toBeVisible();
        assert.equal(await page.locator('[data-cromo-menu]').count(), 0);
        await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
      });
      await run('keyboard-space-and-focus', engine, async page => {
        await page.getByRole('button', { name: 'Menú de cuenta', exact: true }).click();
        const trigger = page.getByRole('button', { name: /^Cuentas:/ });
        await trigger.focus(); await trigger.press('Space');
        const sheet = page.getByRole('dialog', { name: 'Cuentas', exact: true });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Cerrar', exact: true }).last()).toBeFocused();
        await page.keyboard.press('Escape'); await expect(sheet).toBeHidden();
        await expect(trigger).toBeFocused();
      });
      for (const theme of ['light', 'dark']) for (const viewport of [{ width: 375, height: 812 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
        await run('web-open-close-' + theme + '-' + viewport.width, engine, async page => {
          const sheet = await openWeb(page);
          await expect(sheet.getByRole('button', { name: /^Cuenta activa: Persona 1/ })).toHaveAttribute('aria-current', 'true');
          const box = await sheet.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
          await page.keyboard.press('Escape'); await expect(sheet).toBeHidden();
          await expect(page.getByRole('button', { name: 'Cerrar menú', exact: true })).toBeVisible();
          assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
          await page.keyboard.press('Escape');
          await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
        }, { theme, viewport });
      }
      await run('add-and-cancel', engine, async (page, api) => {
        const sheet = await openWeb(page); await sheet.getByRole('button', { name: 'Agregar cuenta', exact: true }).click();
        await expect(page).toHaveURL(/\/login\?next=%2Fperfil&agregar=1/);
        await expect(page.getByText('Estás agregando otra cuenta.', { exact: true })).toBeVisible();
        assert.ok((await page.context().cookies()).some(c => c.name === 'vicino_agregando_cuenta'));
        assert.equal(api.some(r => r.path.endsWith('/logout')), false, 'Adding cannot log out current account');
        await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await expect(page).toHaveURL(/\/perfil$/);
        await expect(page.getByRole('heading', { name: 'Persona 1', exact: true })).toBeVisible();
        assert.equal((await page.context().cookies()).some(c => c.name === 'vicino_agregando_cuenta'), false);
      });
      await run('switch-and-return', engine, async page => {
        let sheet = await openWeb(page); await sheet.getByRole('button', { name: 'Cambiar a Persona 2', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Persona 2', exact: true })).toBeVisible();
        await expect(page).toHaveURL(/\/perfil$/); sheet = await openWeb(page);
        await expect(sheet.getByRole('button', { name: /^Cuenta activa: Persona 2/ })).toHaveAttribute('aria-current', 'true');
        await sheet.getByRole('button', { name: 'Cambiar a Persona 1', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Persona 1', exact: true })).toBeVisible();
        assert.equal(await page.evaluate(() => window.__events.some(e => e.href?.includes('/login'))), false);
      });
      await run('remove-one-session', engine, async (page, api) => {
        const sheet = await openWeb(page); await sheet.getByRole('button', { name: 'Quitar Persona 2', exact: true }).click();
        await sheet.getByRole('button', { name: 'Confirmar quitar Persona 2', exact: true }).click();
        await expect(sheet.getByRole('button', { name: 'Cambiar a Persona 2', exact: true })).toHaveCount(0);
        assert.deepEqual(api.filter(r => r.path.endsWith('/logout')).map(r => [r.user, r.scope]), [[sessions[1].user.id, 'local']]);
        await expect(sheet.getByRole('button', { name: /^Cuenta activa: Persona 1/ })).toBeVisible();
      });
      await run('logout-every-account', engine, async (page, api) => {
        const sheet = await openWeb(page); await sheet.getByRole('button', { name: 'Salir de todas las cuentas', exact: true }).click();
        await expect(page).toHaveURL(/\/login$/);
        assert.equal(await page.evaluate(() => window.__read().length), 0);
        assert.deepEqual(api.filter(r => r.path.endsWith('/logout')).map(r => r.user), [sessions[1].user.id, sessions[0].user.id]);
      });
      await run('limit-five', engine, async page => {
        const sheet = await openWeb(page); await sheet.getByRole('button', { name: 'Agregar cuenta', exact: true }).click();
        await expect(sheet.getByRole('alert')).toContainText('Quita una cuenta');
        assert.equal(await page.evaluate(() => window.__read().length), 5);
        await expect(page).not.toHaveURL(/\/login/);
      }, { count: 5 });
      await run('invalid-target-preserves-current', engine, async page => {
        const sheet = await openWeb(page); await page.evaluate(() => { window.__mode = 'expired'; });
        await sheet.getByRole('button', { name: 'Cambiar a Persona 2', exact: true }).click();
        await expect(sheet.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('heading', { name: 'Persona 1', exact: true })).toBeVisible();
        assert.equal(await page.evaluate(async () => (await window.__client.auth.getSession()).data.session.user.id), sessions[0].user.id);
      });
    }
    await browser.close(); browser = null;
  }
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  await writeFile(resolve(out, 'results.json'), JSON.stringify({ scope: 'Local real UI + SDK + shipped iOS JS bridge; HTTP/framework boundaries controlled; no native device or production Auth', results }, null, 2));
}
const passed = results.filter(r => r.passed).length;
console.log(`Cuentas UI: ${passed}/${results.length} passed; no skipped cases`);
process.exitCode = passed === results.length ? 0 : 1;
