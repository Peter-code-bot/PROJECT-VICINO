import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] })) as { build: (options: object) => Promise<{ outputFiles: Array<{ text: string }> }> };
let js: string;
let css: string;

test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const result = await esbuild.build({
    stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
      import {SkeletonLista} from './components/shared/loading-skeletons';
      import ErrorDePagina from './app/error';
      const root=createRoot(document.getElementById('root'));
      window.loading=(delay)=>new Promise(resolve=>requestAnimationFrame((start)=>{
        flushSync(()=>root.render(React.createElement(SkeletonLista,{n:3})));
        const frames=[];
        function frame(now){ const node=document.querySelector('.esqueleto-demorado');
          if(!node) {resolve(frames);return;}
          const style=getComputedStyle(node);
          frames.push({ms:now-start,visible:style.opacity==='1',duration:style.animationDuration});requestAnimationFrame(frame);}
        requestAnimationFrame(frame);
        setTimeout(()=>flushSync(()=>root.render(React.createElement('p',null,'Contenido sintetico'))),delay);
      }));
      window.errorPage=()=>flushSync(()=>root.render(React.createElement(ErrorDePagina,{error:new Error('synthetic'),unstable_retry:()=>{window.retried=true}})));
      window.skeleton=()=>flushSync(()=>root.render(React.createElement(SkeletonLista,{n:3})));`, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
  });
  js = result.outputFiles[0].text;
  // Usar CSS real; Tailwind se compila con los plugins ya instalados.
  const postcss = localRequire("postcss") as (plugins: unknown[]) => { process: (source: string, options: object) => Promise<{ css: string }> };
  const tailwind = localRequire("@tailwindcss/postcss") as () => unknown;
  css = (await postcss([tailwind()]).process(readFileSync(path.join(web, "app/globals.css"), "utf8"), { from: path.join(web, "app/globals.css") })).css;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) => route.abort());
  await page.setContent('<html lang="es"><body><button id="focus">Foco conservado</button><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: js });
});

for (const theme of ["light", "dark"]) test(`esqueleto: 20 montajes rapidos/lentos, ${theme}`, async ({ page }, info) => {
  test.setTimeout(35_000);
  await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), theme === "dark");
  const timings: number[] = [];
  for (let n = 0; n < 20; n++) {
    const delay = n % 2 === 0 ? 100 : 800;
    const frames = await page.evaluate((ms) => (window as unknown as { loading: (ms: number) => Promise<Array<{ms: number; visible: boolean; duration: string}>> }).loading(ms), delay);
    const first = frames.find((frame) => frame.visible);
    if (delay === 100) expect(first).toBeUndefined();
    else {
      expect(first).toBeDefined();
      expect(first!.duration).toBe("0.18s");
      timings.push(first!.ms);
      expect(first!.ms).toBeGreaterThanOrEqual(180);
      if (first!.ms > 230) {
        // Chromium puede pausar rAF bajo carga. Si el umbral cae dentro de ese
        // hueco, el CSS sigue fijado a 200 ms y no hubo un frame tardio falso.
        const index = frames.indexOf(first!);
        const previous = frames[index - 1];
        expect(previous?.visible).toBe(false);
        expect(previous?.ms).toBeLessThanOrEqual(230);
        expect(first!.ms - previous!.ms).toBeGreaterThan(100);
      }
    }
  }
  await info.attach("timings", { body: JSON.stringify(timings), contentType: "application/json" });
});

test('DOM accesible, reduced motion y animaciones desactivadas; reintento funcional', async ({ page }, info) => {
  await page.locator('#focus').focus();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => (window as unknown as { skeleton: () => void }).skeleton());
  const status = page.getByRole('status');
  await expect(status).toHaveText('Cargando');
  expect(await status.evaluate((node) => Boolean(node.closest('[aria-busy="true"], [aria-hidden="true"]')))).toBe(false);
  await expect(page.locator('.esqueleto-demorado')).toHaveCSS('opacity', '1');
  await expect(page.locator('.skeleton').first()).toHaveCSS('animation-name', 'none');
  await expect(page.locator('#focus')).toBeFocused();
  await page.screenshot({ path: info.outputPath('reduced-motion.png') });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addStyleTag({ content: '.esqueleto-demorado {animation:none !important}' });
  await expect(page.locator('.esqueleto-demorado')).toHaveCSS('opacity', '1');
  await page.evaluate(() => (window as unknown as { errorPage: () => void }).errorPage());
  await page.getByRole('button', { name: 'Reintentar' }).click();
  expect(await page.evaluate(() => (window as unknown as { retried: boolean }).retried)).toBe(true);
});
