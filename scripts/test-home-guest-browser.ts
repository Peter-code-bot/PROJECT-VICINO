/** Real guest components and current CSS in Chromium/WebKit. Next navigation,
 * session state and mutations are explicit fixtures; no Auth/DB/device requests. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, webkit, expect } = req("@playwright/test");
const origin = "https://mp03d-fixture.invalid";
const requestId = "10000000-0000-4000-8000-000000000001";
const communityId = "20000000-0000-4000-8000-000000000001";
const postId = "30000000-0000-4000-8000-000000000001";

function contrast(a: number[], b: number[]) {
  const luminance = (rgb: number[]) => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i]!, 0);
  const [x, y] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (x! + .05) / (y! + .05);
}

async function main() {
  const mocks: Record<string, string> = {
    "next/navigation": `import {useSyncExternalStore} from 'react';
      const subscribe=callback=>{addEventListener('fixture-navigation',callback);return()=>removeEventListener('fixture-navigation',callback);};
      export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
      export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname);
      export const useRouter=()=>window.f.router;`,
    "next/link": `import React from 'react';export default function Link({href,prefetch,children,onClick,...props}){
      return <a {...props} href={href} data-prefetch={String(prefetch)} onClick={event=>{
        onClick?.(event);if(event.defaultPrevented||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
        event.preventDefault();window.f.router.push(href);
      }}>{children}</a>;}`,
    "next/image": "import React from 'react';export default function Image({fill,sizes,...props}){return <img {...props}/>;}",
    "@/lib/haptics": "export const hapticLight=async()=>{};export const hapticMedium=async()=>{};export const hapticSelection=async()=>{};",
    "@/app/(marketplace)/comunidades/actions": "const forbidden=async()=>{window.f.mutations++;throw new Error('MUTATION_FORBIDDEN');};export const alternarMembresia=forbidden;export const solicitarUnion=forbidden;export const cancelarSolicitudPropia=forbidden;",
  };
  const fixture = `import React,{useLayoutEffect} from 'react';import {createRoot} from 'react-dom/client';
    import {usePathname,useSearchParams} from 'next/navigation';
    import {MuroSesionProvider} from './components/auth/muro-sesion';
    import {HomeTabs} from './components/home/home-tabs';
    import {GuestRequestsFeed,GuestCommunitiesFeed} from './components/home/guest-home-feeds';
    import {AuthHomeLink} from './components/auth/auth-home-link';
    import {restaurarRetornoHome} from './lib/auth/retorno-home';
    function Home(){const search=useSearchParams(),feed=search.get('feed')==='solicitudes'?'solicitudes':'comunidades';
      useLayoutEffect(()=>restaurarRetornoHome(),[search.toString()]);
      const requests={kind:'solicitudes',failure:null,requests:[{id:'${requestId}',titulo:'Busco una silla',descripcion:'Necesito una silla para el comedor',presupuesto_max:400,categoria:'comida',created_at:'2026-10-03T12:00:00Z'}]};
      const communities={kind:'comunidades',communityFailure:null,postFailure:null,communities:[{id:'${communityId}',nombre:'A',descripcion:'Convivencia vecinal',miembros_count:3,publicaciones_count:1,ultima_publicacion_at:'2026-10-03T12:00:00Z'}],
        posts:[{id:'${postId}',community_id:'${communityId}',community_nombre:'A',contenido:'Hola',created_at:'2026-10-03T12:00:00Z',likes_count:0,comentarios_count:0}]};
      return <MuroSesionProvider haySesion={false}><HomeTabs active={feed}/><div data-testid='scroll-spacer' style={{height:650}}/>
        {feed==='solicitudes'?<GuestRequestsFeed preview={requests}/>:<GuestCommunitiesFeed preview={communities} activeTab={search.get('tab')==='descubrir'?'descubrir':'muro'}/>}
        <div style={{height:1600}}/></MuroSesionProvider>;}
    function App(){const pathname=usePathname();return pathname==='/'?<Home/>:<main><h1>Autenticación simulada</h1><AuthHomeLink>Volver a Inicio</AuthHomeLink></main>;}
    const replace=history.replaceState.bind(history);history.replaceState=(...args)=>{replace(...args);dispatchEvent(new Event('fixture-navigation'));};
    window.f.router={push:route=>{window.f.routes.push(route);history.pushState(null,'',route);dispatchEvent(new Event('fixture-navigation'));requestAnimationFrame(()=>scrollTo(0,0));},replace:route=>{history.replaceState(null,'',route);},refresh:()=>{}};
    createRoot(document.getElementById('root')).render(<App/>);`;
  const bundle = await esbuild.build({ stdin: { contents: fixture, loader: "tsx", resolveDir: web }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "controlled-boundaries", setup(b: any) {
      b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "mock" }, (a: any) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: web }));
    } }] });
  const cssFile = path.join(web, "app/globals.css");
  const postcss = createRequire(req.resolve("@tailwindcss/postcss"))("postcss");
  const { css } = await postcss([req("@tailwindcss/postcss")({ base: web })]).process(readFileSync(cssFile, "utf8"), { from: cssFile });
  const browser = await (process.env.TEST_BROWSER === "webkit" ? webkit : chromium).launch({ headless: true });
  let passed = 0;
  const metricFailures: string[] = [];
  try {
    for (const width of [375, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 812 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8000);
      const errors: string[] = [], unexpectedNetwork: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await context.addInitScript("window.__name=(target)=>target;");
      await context.route("**/*", async (route: any) => {
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === origin) {
          await route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'><body><div id='root'></div></body></html>" });
        } else { unexpectedNetwork.push(route.request().url()); await route.abort(); }
      });
      async function mount(route: string, dark = false) {
        await page.goto(origin + route);
        await page.evaluate((dark: boolean) => { sessionStorage.clear(); document.documentElement.classList.toggle("dark", dark); Object.assign(window, { f: { routes: [], mutations: 0 } }); }, dark);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await expect(page.locator("[data-guest-preview]")).toBeVisible();
      }
      const pass = (name: string) => { passed++; console.log(`PASS ${width}px ${name}`); };
      async function checkTargets() {
        const targets = await page.locator("[data-guest-preview] a, [data-guest-preview] button").evaluateAll((elements: Element[]) => elements.map(element => {
          const box = element.getBoundingClientRect();
          return { name: element.getAttribute("aria-label") ?? element.textContent?.trim(), width: box.width, height: box.height };
        }));
        for (const target of targets) assert.ok(target.width >= 48 && target.height >= 48, JSON.stringify(target));
      }
      async function checkContrast(locator: any, focus = false) {
        if (focus) { await page.keyboard.press("Tab"); await locator.focus(); await expect(locator).toBeFocused(); }
        await locator.evaluate(async (element: HTMLElement) => {
          await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
          await Promise.race([Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))), new Promise(resolve => setTimeout(resolve, 2000))]);
        });
        const colors = await locator.evaluate((element: HTMLElement) => {
          const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          const rgba = (value: string) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); return Array.from(ctx.getImageData(0, 0, 1, 1).data); };
          const over = (front: number[], back: number[]) => front.slice(0, 3).map((v, i) => v * front[3]! / 255 + back[i]! * (1 - front[3]! / 255));
          const background = (start: HTMLElement | null) => {
            const chain: HTMLElement[] = [];
            for (let at = start; at; at = at.parentElement) chain.unshift(at);
            return chain.reduce((back, node) => [...over(rgba(getComputedStyle(node).backgroundColor), back), 255], [255, 255, 255, 255]);
          };
          const style = getComputedStyle(element);
          return { text: over(rgba(style.color), background(element)), background: background(element), outline: rgba(style.outlineColor), outer: background(element.parentElement), outlineStyle: style.outlineStyle, visible: element.matches(":focus-visible") };
        });
        assert.ok(contrast(colors.text, colors.background) >= 4.5, `Text contrast ${contrast(colors.text, colors.background)}: ${await locator.textContent()}`);
        if (focus) { assert.equal(colors.visible, true); assert.notEqual(colors.outlineStyle, "none"); assert.ok(contrast(colors.outline, colors.outer) >= 3, `Focus contrast ${contrast(colors.outline, colors.outer)}: ${await locator.textContent()} ${JSON.stringify(colors)}`); }
      }
      async function assertLogin(next: string) {
        await expect(page).toHaveURL(origin + "/login?next=" + encodeURIComponent(next));
        assert.equal(await page.evaluate(() => (window as any).f.mutations), 0);
      }
      await mount("/?feed=solicitudes");
      await page.getByRole("link", { name: "Comunidades", exact: true }).click();
      await expect(page).toHaveURL(origin + "/?feed=comunidades");
      await expect(page.locator('[data-guest-preview="comunidades"]')).toBeVisible();
      await page.getByRole("link", { name: "Solicitudes", exact: true }).click();
      await expect(page).toHaveURL(origin + "/?feed=solicitudes");
      await expect(page.locator('[data-guest-preview="solicitudes"]')).toBeVisible();
      assert.equal(await page.evaluate(() => (window as any).f.mutations), 0); pass("primary Solicitudes/Comunidades tabs navigate public previews");
      await page.getByRole("link", { name: "Siguiendo", exact: true }).click();
      await assertLogin("/?feed=following"); pass("primary Following tab stays private");
      await mount("/?feed=comunidades");
      await page.getByRole("tab", { name: "Descubrir", exact: true }).click();
      await expect(page).toHaveURL(origin + "/?feed=comunidades&tab=descubrir");
      await expect(page.getByRole("tab", { name: "Descubrir", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("[data-guest-preview] article").getByRole("heading", { name: "A", exact: true })).toBeVisible();
      await page.getByRole("tab", { name: "Muro", exact: true }).click();
      await expect(page).toHaveURL(origin + "/?feed=comunidades");
      await expect(page.getByText("Hola", { exact: true })).toBeVisible();
      assert.deepEqual(await page.evaluate(() => (window as any).f.routes), []); pass("Muro/Descubrir change real content through history without login or effects");
      await page.getByRole("tab", { name: "Mis comunidades", exact: true }).click();
      await assertLogin("/?feed=comunidades&tab=mias");
      await expect(page.getByRole("link", { name: "Volver a Inicio", exact: true })).toHaveAttribute("href", "/?feed=comunidades"); pass("Mis comunidades goes to login and auth logo preserves public preview");

      for (const action of ["Me gusta", "Comentar"]) {
        await mount("/?feed=comunidades");
        await page.getByRole("button", { name: action, exact: true }).click();
        await assertLogin(`/comunidades/${communityId}/publicacion/${postId}`);
        pass(`${action} preserves post context without mutation`);
      }
      await mount("/?feed=comunidades");
      await page.getByRole("button", { name: "Fundar comunidad", exact: true }).click();
      await assertLogin("/?feed=comunidades"); pass("founding preserves feed context without mutation");
      await mount("/?feed=solicitudes");
      await page.getByRole("link", { name: "Filtrar solicitudes", exact: true }).click();
      await assertLogin("/?feed=solicitudes"); pass("request filters lead to login");
      await mount("/?feed=solicitudes");
      await page.getByRole("link", { name: "Publicar solicitud", exact: true }).click();
      await assertLogin("/?feed=solicitudes"); pass("request creation has no automatic effect");
      await mount("/?feed=solicitudes");
      const card = page.getByRole("link").filter({ has: page.getByRole("heading", { name: "Busco una silla", exact: true }) });
      await expect(card).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/solicitudes/${requestId}`)}`);
      await card.click(); await assertLogin(`/solicitudes/${requestId}`); pass("request card anchor carries exact detail context");

      await mount("/?feed=comunidades&tab=descubrir");
      const community = page.locator("[data-guest-preview] article a").first();
      await expect(community).toHaveAttribute("href", `/login?next=${encodeURIComponent(`/comunidades/${communityId}`)}`);
      const popupPromise = context.waitForEvent("page", { timeout: 8000 });
      // Win32 headless WebKit does not implement middle-click navigation (even
      // for a plain anchor). Test the same real AuthLink href in a browser tab
      // without changing the application's link or simulating its auth result.
      if (process.env.TEST_BROWSER === "webkit") await community.evaluate((link: HTMLAnchorElement) => { window.open(link.href, "_blank"); });
      else await community.click({ button: "middle" });
      const popup = await popupPromise;
      await expect(popup).toHaveURL(origin + `/login?next=${encodeURIComponent(`/comunidades/${communityId}`)}`);
      await popup.close(); assert.equal(await page.evaluate(() => (window as any).f.mutations), 0); pass("new-tab uses actual guest anchor URL, never private detail");

      await page.evaluate(() => scrollTo(0, 600));
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
      await community.focus();
      let exactY = 0;
      await page.evaluate(() => { document.addEventListener("click", () => { (window as any).f.exactY = scrollY; }, { capture: true, once: true }); });
      await page.keyboard.press("Enter");
      exactY = await page.evaluate(() => (window as any).f.exactY);
      await assertLogin(`/comunidades/${communityId}`);
      assert.ok(exactY > 0);
      await page.getByRole("link", { name: "Volver a Inicio", exact: true }).click();
      await expect(page).toHaveURL(origin + "/?feed=comunidades&tab=descubrir");
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(exactY);
      await page.waitForTimeout(1000); assert.equal(await page.evaluate(() => scrollY), exactY);
      await expect(page.getByRole("tab", { name: "Descubrir", exact: true })).toHaveAttribute("aria-selected", "true"); pass("keyboard detail/login/Home return preserves tab and actual captured scroll after settling");

      for (const dark of [false, true]) {
        for (const route of ["/?feed=solicitudes", "/?feed=comunidades", "/?feed=comunidades&tab=descubrir"]) {
          await mount(route, dark);
          const previousFailures = metricFailures.length;
          const check = async (label: string, verify: () => Promise<void>) => {
            try { await verify(); }
            catch (error) { const message = `${width}px ${dark ? "dark" : "light"} ${route} ${label}: ${String(error)}`; metricFailures.push(message); console.error("FAIL " + message); }
          };
          await check("touch targets", checkTargets);
          const preview = page.locator("[data-guest-preview]");
          for (const locator of await preview.locator("button,a").all()) await check("control contrast", () => checkContrast(locator, true));
          // Small labels/text inside cards must be readable on their own surfaces.
          for (const locator of await preview.locator("p, h3, span:not(.sr-only)").all()) {
            if ((await locator.textContent())?.trim()) await check("card text contrast", () => checkContrast(locator));
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow ${route}`);
          if (metricFailures.length === previousFailures) pass(`${dark ? "dark" : "light"} ${route}: 48px targets, text >=4.5, keyboard focus >=3, no overflow`);
        }
      }
      assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
      assert.equal(await page.evaluate(() => (window as any).f.mutations), 0);
      await context.close();
    }
    assert.deepEqual(metricFailures, [], "All visual criteria must pass before reporting green");
    console.log(`RESULT ${process.env.TEST_BROWSER ?? "chromium"}: ${passed}/${passed} PASS; real components/current CSS; Next/Auth/DB simulated; no device acceptance`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
