/** Actual preview/cache in Chromium with a synthetic PNG that contains visible credits. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const web = path.resolve(__dirname, "../apps/web"), requireWeb = createRequire(path.join(web, "package.json"));
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] }));
const { chromium, expect } = requireWeb("@playwright/test");
async function main() {
  const mocks: Record<string, string> = {
    "next/link": "import React from 'react';export default function Link({href,children,...props}){return <a href={href} {...props}>{children}</a>;}",
    "next-themes": "export const useTheme=()=>({resolvedTheme:window.fixture.theme});",
    "@/components/home/zone-card": "import React from 'react';export function ZoneCard(){return <button>Tu ubicación</button>;}",
  };
  const result = await esbuild.build({ stdin: { resolveDir: web, loader: "tsx", contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {LocationMapPreview} from './components/map/location-map-preview';
    window.fetch=async()=>{window.fixture.requests++;const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const ctx=canvas.getContext('2d');ctx.fillStyle='#e2e8dc';ctx.fillRect(0,0,1280,720);ctx.fillStyle='#121212';ctx.font='24px Arial';ctx.fillText('Map provider · Attribution',860,700);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return new Response(blob,{headers:{'Content-Type':'image/png'}});};
    function App(){const [compact,setCompact]=useState(false),[tick,setTick]=useState(0);window.fixture.setCompact=setCompact;window.fixture.redraw=()=>setTick(n=>n+1);return <main style={{padding:12}}><LocationMapPreview key={compact?'search':'home'} initialPosition={{lat:19.041,lng:-98.206}} viewerScope='fixture' compact={compact}/></main>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "boundaries", setup(b: any) {
    b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "mock" } : undefined);
    b.onLoad({ filter: /.*/, namespace: "mock" }, (a: any) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: web }));
  } }] });
  const cssDirectory = path.join(web, ".next/static/css");
  const css = readdirSync(cssDirectory).filter(file => file.endsWith(".css")).map(file => readFileSync(path.join(cssDirectory, file), "utf8")).join("\n");
  const browser = await chromium.launch({ channel: "chrome", headless: true }); let passed = 0;
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 844 } });
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/*", (route: any) => route.request().isNavigationRequest() ? route.fulfill({ contentType: "text/html", body: "<!doctype html><html lang='es'><meta name='viewport' content='width=device-width,initial-scale=1'><body><div id='root'></div></body></html>" }) : route.abort());
    await page.goto("https://s11-fixture.invalid");
    await page.evaluate(() => { (window as any).fixture = { requests: 0, theme: undefined }; });
    await page.addStyleTag({ content: css }); await page.addScriptTag({ content: result.outputFiles[0].text });
    await expect(page.getByRole("link", { name: "Ver publicaciones en el mapa" })).toBeVisible();
    assert.equal(await page.evaluate(() => (window as any).fixture.requests), 0);
    await page.evaluate(() => { (window as any).fixture.theme = "dark"; (window as any).fixture.redraw(); });
    await expect(page.locator("img")).toHaveCount(1);
    await expect.poll(() => page.locator("img").evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth)).toBe(1280);
    assert.equal(await page.evaluate(() => (window as any).fixture.requests), 1);
    console.log("PASS theme hydration waits without a light snapshot and makes one dark request"); passed++;
    for (const compact of [false, true]) {
      await page.evaluate(compact => (window as any).fixture.setCompact(compact), compact);
      await expect(page.locator("img")).toHaveCount(1);
      for (const width of [320, 375, 1280]) {
        await page.setViewportSize({ width, height: 844 });
        const image = await page.locator("img").boundingBox(), link = await page.getByRole("link", { name: "Ver publicaciones en el mapa" }).boundingBox();
        assert.ok(image && link); assert.ok(link.y >= image.y + image.height, `CTA intersects image at ${width}, compact=${compact}`);
        assert.equal(await page.locator("img").evaluate(image => getComputedStyle(image).objectFit), "contain");
        assert.equal(await page.evaluate(() => (window as any).fixture.requests), 1);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        console.log(`PASS ${compact ? "Search" : "Home"} ${width}px: footer outside full image; resize does not request another snapshot`); passed++;
      }
    }
    assert.deepEqual(errors, []); console.log(`S11 preview browser: ${passed}/${passed} PASS; provider image is synthetic`);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
