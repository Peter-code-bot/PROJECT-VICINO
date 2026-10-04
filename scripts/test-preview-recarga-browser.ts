/** El preview real del inicio en Chromium con reloj falso: la caducidad de 5 min
 * ya no se pinta como "Vista previa no disponible" (Fase 1 de docs/PLAN-ANDROID-2026-10-03.md).
 * El proveedor PNG, la visibilidad y la red son fronteras controladas. Sin peticiones a produccion.
 * Uso: node node_modules/tsx/dist/cli.mjs scripts/test-preview-recarga-browser.ts */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";

const web = path.resolve(__dirname, "../apps/web");
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, expect } = req("@playwright/test");

const TTL = 300_000;
const ERROR = "Vista previa no disponible";

async function main() {
  const mocks: Record<string, string> = {
    "next/link": "import React from 'react';export default function Link({href,children,prefetch,...props}){return <a href={href} {...props}>{children}</a>;}",
    "next-themes": "export const useTheme=()=>({resolvedTheme:'light'});",
    "@/components/home/zone-card": "import React from 'react';export function ZoneCard(){return <button>Activar ubicación</button>;}",
  };
  const fixture = [
    "import React from 'react';import {createRoot} from 'react-dom/client';",
    "import {LocationMapPreview} from './components/map/location-map-preview';",
    "const f=window.f;",
    // El PNG se genera UNA vez al arrancar: un toBlob dentro de cada fetch falso se quedaba
    // colgado en Chromium tras un clic (problema del arnes, no del componente).
    "const png=new Promise(resolve=>{const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;canvas.getContext('2d').fillRect(0,0,8,8);canvas.toBlob(resolve,'image/png');});",
    "window.fetch=async(url,opts)=>{if(url!=='/api/map-preview')throw new Error('Unexpected request '+url);f.requests++;if(f.fail)return new Response('unavailable',{status:503});return new Response(await png,{headers:{'Content-Type':'image/png'}});};",
    // Registra si el texto de error aparece aunque sea un instante.
    "new MutationObserver(()=>{if(document.body.textContent.includes('" + ERROR + "'))f.sawError=true;}).observe(document.body,{subtree:true,childList:true,characterData:true});",
    "createRoot(document.getElementById('root')).render(<LocationMapPreview initialPosition={null} viewerScope='guest'/>);",
  ].join("\n");
  const bundle = await esbuild.build({ stdin: { resolveDir: web, loader: "tsx", contents: fixture }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "boundaries", setup(b: any) {
    b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a: any) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: web }));
  } }] });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let passed = 0;
  const pass = (name: string) => { passed++; console.log("PASS " + name); };
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
    page.setDefaultTimeout(8000);
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    // tsx conserva nombres en las funciones serializadas; mismo apano que test-s12-preview-browser.ts.
    await page.addInitScript("window.__name = (target) => target;");
    await page.clock.install();
    await page.route("**/*", (route: any) => route.request().isNavigationRequest()
      ? route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'><body><div id='root'></div></body></html>" })
      : route.abort());
    await page.goto("https://preview-recarga.invalid");
    await page.evaluate(() => {
      const w = window as any;
      w.f = { requests: 0, fail: false, hidden: false, offline: false, sawError: false };
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (w.f.hidden ? "hidden" : "visible") });
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => !w.f.offline });
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    const preview = page.getByRole("region", { name: "Vista previa de México" });
    const image = preview.locator("img");
    const retry = preview.getByRole("button", { name: "Reintentar" });
    const requests = () => page.evaluate(() => (window as any).f.requests as number);
    const set = (patch: Record<string, unknown>) => page.evaluate(p => Object.assign((window as any).f, p), patch);
    const volver = () => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const loaded = () => expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth).catch(() => 0)).toBe(1280);
    // Deja correr las promesas del fetch falso sin adelantar el reloj del TTL.
    const settle = async () => { for (let i = 0; i < 5; i++) await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(null)))); };

    await loaded(); assert.equal(await requests(), 1);
    pass("primera carga: una sola peticion");

    // 1) Caduca con la pagina a la vista: recarga sola y nunca pinta el error.
    await page.clock.runFor(TTL + 1_000); await loaded(); await settle();
    assert.equal(await requests(), 2);
    assert.equal(await page.evaluate(() => (window as any).f.sawError), false, "el error aparecio al caducar");
    await expect(retry).toHaveCount(0);
    pass("caducidad visible: recarga sola, sin 'Vista previa no disponible' ni boton");

    // 2) Caduca en segundo plano: no gasta peticion hasta volver.
    await set({ hidden: true }); await volver();
    await page.clock.runFor(TTL + 1_000); await settle();
    assert.equal(await requests(), 2, "pidio la imagen con la app oculta");
    await expect(preview.getByText(ERROR)).toHaveCount(0);
    await set({ hidden: false }); await volver(); await loaded();
    assert.equal(await requests(), 3);
    assert.equal(await page.evaluate(() => (window as any).f.sawError), false);
    pass("caducidad en segundo plano: cero peticiones ocultas, una al volver");

    // 3) Sin red: espera al evento online.
    await set({ offline: true });
    await page.clock.runFor(TTL + 1_000); await settle();
    assert.equal(await requests(), 3, "pidio la imagen sin red");
    await set({ offline: false }); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await loaded();
    assert.equal(await requests(), 4);
    pass("caducidad sin red: espera al evento online");

    // 4) Fallo real: se pinta, no se reintenta en el acto, una vez al volver (resume de Capacitor) y luego solo el boton.
    await set({ fail: true });
    await page.clock.runFor(TTL + 1_000); await settle();
    await expect(preview.getByText(ERROR)).toBeVisible(); await expect(retry).toBeVisible();
    assert.equal(await requests(), 5, "la recarga por caducidad debio fallar una vez");
    await settle(); assert.equal(await requests(), 5, "reintento inmediato tras el fallo");
    await page.evaluate(() => document.dispatchEvent(new Event("resume"))); await settle();
    assert.equal(await requests(), 6, "no reintento al volver a la app");
    await volver(); await page.evaluate(() => window.dispatchEvent(new Event("online"))); await settle();
    assert.equal(await requests(), 6, "reintento mas de una vez");
    await expect(retry).toBeVisible();
    pass("fallo: se muestra, un solo reintento automatico al volver, luego el boton");

    // 5) El boton sigue funcionando.
    await set({ fail: false }); await retry.click(); await loaded();
    assert.equal(await requests(), 7); await expect(preview.getByText(ERROR)).toHaveCount(0);
    pass("Reintentar manual recupera la imagen");

    // 6) Inicio olvidado en pantalla: 6 caducidades seguidas sin que nadie vuelva, y despues
    //    el boton. Volver a la app repone el presupuesto y recarga sola.
    for (let i = 1; i <= 6; i++) { await page.clock.runFor(TTL + 1_000); await loaded(); assert.equal(await requests(), 7 + i); }
    await page.clock.runFor(TTL + 1_000); await settle();
    assert.equal(await requests(), 13, "paso del tope de recargas sin nadie mirando");
    await expect(preview.getByText(ERROR)).toBeVisible(); await expect(retry).toBeVisible();
    pass("inicio olvidado: 6 recargas seguidas y luego el boton");
    await retry.click(); await loaded(); assert.equal(await requests(), 14);
    await page.clock.runFor(TTL + 1_000); await loaded(); assert.equal(await requests(), 15);
    pass("Reintentar a mano tambien repone el presupuesto");
    for (let i = 1; i <= 5; i++) { await page.clock.runFor(TTL + 1_000); await loaded(); assert.equal(await requests(), 15 + i); }
    await page.clock.runFor(TTL + 1_000); await settle();
    assert.equal(await requests(), 20); await expect(retry).toBeVisible();
    await volver(); await loaded();
    assert.equal(await requests(), 21); await expect(retry).toHaveCount(0);
    pass("volver a la app repone el presupuesto y recarga sin pulsar nada");

    assert.deepEqual(errors, []);
    console.log(`Preview recarga browser: ${passed}/${passed} PASS; proveedor sintetico, reloj falso`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
