/** Componentes React reales en ${process.env.TEST_BROWSER ?? "chromium"}, acciones y router simulados. No es E2E de Auth. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const { chromium, webkit, expect } = require("@playwright/test");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));

async function main() {
  const mocks: Record<string, string> = {
    "../actions": `
      export async function signUp(){window.testCalls.push('signup');return window.testResult;}
      export async function signInWithPassword(){window.testCalls.push('login');return window.testResult;}
      export async function verificarCodigo(){window.testCalls.push('verify');return {ok:true};}
      export async function requestPasswordReset(){window.testCalls.push("reset");return {success:true};}
      export async function cambiarPasswordRecuperada(){window.testCalls.push("updatePassword");return {success:true,destino:"/tecnologia/producto"};}
      export async function reenviarCodigo(){window.testCalls.push('resend');return {ok:true};}
    `,
    "next/navigation": `export const useRouter=()=>window.testRouter??(window.testRouter={push:p=>window.testRoutes.push(p),replace:p=>window.testRoutes.push(p),refresh:()=>{}});
      export const usePathname=()=>location.pathname;export const useSearchParams=()=>new URLSearchParams(location.search);`,
    "next/link": `import React from 'react';export default function Link(p){return React.createElement('a',p,p.children);}`,
    "@/lib/auth/native-oauth": "export const signInWithGoogle=async()=>({});export const signInWithApple=async()=>({});",
    "@/lib/haptics": "export const hapticLight=()=>{};",
    "@capacitor/core": "export const Capacitor={isNativePlatform:()=>location.pathname==='/native'};",
    "@capacitor/app": "export const App={getLaunchUrl:async()=>({url:window.testResult.nativeUrl}),addListener:async(_name,fn)=>{window.nativeOpen=fn;return {remove(){}};}};",
    "@capacitor/browser": "export const Browser={close:async()=>{},open:async()=>{}};",
    "@/lib/supabase/client": "export const createClient=()=>({auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),exchangeCodeForSession:async()=>{window.testCalls.push('exchange');if(window.testResult.exchangeThrows)throw new Error('offline');return {error:window.testResult.exchangeError??null};}}});",
    "@/app/(marketplace)/favoritos/actions": "export const toggleFavorite=async()=>{window.testCalls.push('favorite');return {};};",
  };
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {RegisterForm} from './app/(auth)/register/register-form';
      import {LoginForm} from './app/(auth)/login/login-form';
      import ForgotPassword from './app/(auth)/forgot-password/page';
      import {ResetPasswordForm} from './app/(auth)/reset-password/reset-password-form';
      import {MuroSesionProvider,useMuroSesion} from './components/auth/muro-sesion';
      import AuthLink from './components/auth/auth-link';
      import {GuestAuthCta} from './components/home/guest-auth-cta';
      import {useFavorite} from './hooks/use-favorite';
      import {SessionDataProvider,SessionScroll} from './components/layout/session-data-provider';
      import {PageSwipeWrapper} from './components/layout/page-swipe-wrapper';
      import {OAuthUrlListener} from './components/auth/oauth-url-listener';
      import {guardarDestinoPendiente} from './lib/auth/destino-pendiente';
      function Guest(){const {toggle}=useFavorite('synthetic',false,'/tecnologia/producto');return <><SessionScroll route='/'/><GuestAuthCta destino={location.pathname+location.search}/><div style={{height:700}}>Previews</div><AuthLink href='/tecnologia/producto'>Ver producto</AuthLink><button onClick={()=>void toggle()}>Guardar favorito</button><div style={{height:2000}}>Previews</div></>}
      function GuestPage(){return <SessionDataProvider userId='' revision=''><MuroSesionProvider haySesion={Boolean(window.testResult.hasSession)}><PageSwipeWrapper isVendedor={false}><Guest /></PageSwipeWrapper></MuroSesionProvider></SessionDataProvider>}
      if(location.pathname==='/native' && window.testResult.pending)guardarDestinoPendiente(window.testResult.pending);
      createRoot(document.getElementById('root')).render(React.createElement(location.pathname==='/native'?OAuthUrlListener:location.pathname==='/login'?LoginForm:location.pathname==='/forgot-password'?ForgotPassword:location.pathname==='/reset-password'?(()=>React.createElement(ResetPasswordForm,{destino:'/tecnologia/producto'})):['/guest','/'].includes(location.pathname)?GuestPage:RegisterForm));`,
      resolveDir: web, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_SITE_URL": '"https://app.invalid"' },
    plugins: [{ name: "browser-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
    } }],
  });
  const engine = process.env.TEST_BROWSER === "webkit" ? webkit : chromium;
  const browser = await engine.launch({ headless: true });
  let passed = 0;
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [];
      const unexpectedNetwork: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", async (route: any) => {
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === "https://s02.invalid") {
          await route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
        } else { unexpectedNetwork.push(route.request().url()); await route.abort(); }
      });
      async function mount(result: object, next = "/buscar?q=mesa", route = "/register", keepStorage = false) {
        await page.goto(`https://s02.invalid${route}?next=${encodeURIComponent(next)}`);
        await page.evaluate((value: object) => {
          if (!(value as any).keepStorage) { localStorage.clear(); sessionStorage.clear(); }
          Object.assign(window, { testResult: value, testCalls: [], testRoutes: [] });
        }, { ...result, keepStorage });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
      }
      async function submit() {
        await page.getByLabel("Nombre completo").fill("Prueba Sintética");
        await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
        await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-password");
        await page.getByRole("button", { name: "Crear cuenta", exact: true }).click();
      }
      async function routes() { return page.evaluate(() => (window as any).testRoutes); }
      async function calls() { return page.evaluate(() => (window as any).testCalls); }

      await mount({ estado: "verificacion_pendiente", hasSession: false }); await submit();
      await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Iniciar sesión", exact: true })).toHaveAttribute("href", "/login?next=%2Fbuscar%3Fq%3Dmesa");
      await expect(page.getByRole("link", { name: "Recuperar contraseña" })).toHaveAttribute("href", "/forgot-password?next=%2Fbuscar%3Fq%3Dmesa");
      await expect(page.getByRole("button", { name: "Cambiar correo" })).toBeVisible();
      assert.deepEqual(await calls(), ["signup"]);
      await expect(page.getByText(/Si recibes un código/)).toBeVisible();
      passed++;

      await page.getByRole("button", { name: "Cambiar correo" }).click();
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
      await expect(page.getByRole("heading", { name: "Únete a VICINO" })).toBeVisible();
      passed++;

      await mount({ hasSession: true, alreadyLoggedIn: true }); await submit();
      await expect.poll(routes).toEqual(["/buscar?q=mesa"]);
      await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toHaveCount(0);
      passed++;

      await mount({ hasSession: true }, "/a/../login"); await submit();
      await expect.poll(routes).toEqual(["/"]);
      passed++;

      await mount({ error: "No pudimos comprobar tu sesión. Intenta de nuevo.", sessionUnavailable: true }); await submit();
      await expect(page.getByRole("alert")).toContainText("comprobar tu sesión");
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
      assert.deepEqual(await routes(), []);
      passed++;

      await mount({ error: "For security purposes, you can only request this after 60 seconds" }); await submit();
      await expect(page.getByRole("alert")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Crear cuenta", exact: true })).toBeEnabled();
      passed++;

      await mount({ estado: "verificacion_pendiente", hasSession: false }); await submit();
      await page.locator('input[autocomplete="one-time-code"]').fill("123456");
      await expect.poll(routes).toEqual(["/buscar?q=mesa"]);
      assert.deepEqual(await calls(), ["signup", "verify"]);
      passed++;

      await mount({ success: true }, "/a/../register", "/login");
      await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
      await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-password");
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await expect.poll(routes).toEqual(["/"]);
      passed++;
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpectedNetwork, []);
      await mount({ estado: "existente", hasSession: false }); await submit();
      await expect(page.getByRole("heading", { name: "Ya existe una cuenta con este correo." })).toBeVisible();
      if (viewport.width === 375) {
        await mkdir("apps/web/test-results/registro-componentes", { recursive: true });
        await page.screenshot({ path: `apps/web/test-results/registro-componentes/existente-${process.env.TEST_BROWSER ?? "chromium"}.png` });
      }
      await expect(page.locator('input[autocomplete="one-time-code"]')).toHaveCount(0);
      await expect(page.getByRole("link", { name: "Recuperar contraseña" })).toHaveAttribute("href", "/forgot-password?next=%2Fbuscar%3Fq%3Dmesa");
      assert.deepEqual(await calls(), ["signup"]); passed++;
      await mount({}, "/buscar?q=mesa", "/login", true);
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue("synthetic@example.com"); passed++;
      await mount({}, "/buscar?q=mesa", "/forgot-password", true);
      await expect(page.getByLabel("Email", { exact: true })).toHaveValue("synthetic@example.com");
      await page.getByRole("button", { name: "Enviar enlace de recuperación" }).click();
      await expect.poll(calls).toEqual(["reset"]); passed++;
      await mount({ error: "Email not confirmed", requiereConfirmacion: true }, "/tecnologia/producto", "/login");
      await page.getByLabel("Email", { exact: true }).fill("synthetic@example.com");
      await page.getByLabel("Contraseña", { exact: true }).fill("synthetic-password");
      await page.getByRole("button", { name: "Iniciar sesión", exact: true }).click();
      await page.getByRole("button", { name: "Enviar código de confirmación" }).click();
      await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();
      assert.deepEqual(await calls(), ["login", "resend"]); passed++;
      await mount({}, "/tecnologia/producto", "/reset-password");
      await page.getByLabel("Nueva contraseña").fill("new-password");
      await page.getByLabel("Confirmar contraseña").fill("different-password");
      await page.getByRole("button", { name: "Guardar contraseña y continuar" }).click();
      await expect(page.getByRole("alert")).toContainText("no coinciden");
      assert.deepEqual(await calls(), []);
      await page.getByLabel("Confirmar contraseña").fill("new-password");
      await page.getByRole("button", { name: "Guardar contraseña y continuar" }).click();
      await expect.poll(routes).toEqual(["/tecnologia/producto"]); passed++;
      await mount({}, "/", "/");
      await expect(page.getByRole("link", { name: "Ver producto" })).toHaveAttribute("href", "/login?next=%2Ftecnologia%2Fproducto");
      await page.evaluate(() => window.scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(600);
      await page.getByRole("button", { name: "Guardar favorito" }).click();
      await expect.poll(routes).toEqual(["/login?next=%2Ftecnologia%2Fproducto"]);
      assert.deepEqual(await calls(), []); passed++;
      const homeY = await page.evaluate(() => window.scrollY);
      assert.ok(homeY > 0);
      await mount({}, "/", "/", true);
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(homeY); passed++;
      await mount({}, "/", "/");
      const createAccount = page.getByRole("link", { name: "Únete a VICINO", exact: true });
      const loginAccount = page.getByRole("link", { name: "Ya tengo cuenta · Iniciar sesión", exact: true });
      await expect(createAccount).toHaveAttribute("href", "/register?next=%2F%3Fnext%3D%252F");
      await expect(loginAccount).toHaveAttribute("href", "/login?next=%2F%3Fnext%3D%252F");
      await createAccount.click();
      const stored = await page.evaluate(() => sessionStorage.getItem("vicino:home-antes-login"));
      assert.ok(stored, "CTA preserves the Home context before registration"); passed++;
      await mount({ hasSession: true }, "/", "/", true);
      await expect(page.locator("#home-guest-auth")).toHaveCount(0); passed++;
      for (const result of [
        { nativeUrl: 'vicino://auth/callback?error=access_denied', pending: '/tecnologia/producto' },
        { nativeUrl: 'vicino://auth/callback?code=synthetic', pending: '/tecnologia/producto', exchangeError: { message: 'expired' } },
        { nativeUrl: 'vicino://auth/callback?code=synthetic', pending: '/tecnologia/producto', exchangeThrows: true },
        { nativeUrl: 'https://vicinomarket.com/auth/callback-server?code=synthetic&next=%2Freset-password%3Fnext%3D%252Ftecnologia%252Fproducto', pending: '/favoritos', exchangeError: { message: 'expired' } },
      ]) {
        await mount(result, '/', '/native');
        await expect.poll(async () => (await routes()).length).toBe(1);
        const destination = new URL((await routes())[0], 'https://s02.invalid');
        assert.equal(destination.pathname, '/login');
        assert.equal(destination.searchParams.get('next'), '/tecnologia/producto'); passed++;
        assert.equal(await page.evaluate(() => sessionStorage.getItem('vicino:destino-tras-identificarse')), null);
      }
      const seller = '11111111-1111-1111-1111-111111111111';
      await mount({ nativeUrl: 'vicino://auth/callback?code=synthetic', pending: `/chat/?seller=${seller}&intent=buy&k=synthetic` }, '/', '/native');
      await expect.poll(routes).toEqual([`/vendedor/${seller}`]);
      await page.evaluate(() => (window as any).nativeOpen({url:'vicino://auth/callback?code=synthetic'}));
      assert.deepEqual(await calls(), ['exchange']); passed++;
      assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
      console.log(`PASA: ${passed / (viewport.width === 1280 ? 1 : 2)} casos de componentes reales por viewport en ${process.env.TEST_BROWSER ?? "chromium"}; Auth, SDK nativo y router simulados.`);
      await context.close();
    }
    console.log(`PASA ${passed}/${passed}; sin tráfico externo. No acredita Auth/SMTP remoto.`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
