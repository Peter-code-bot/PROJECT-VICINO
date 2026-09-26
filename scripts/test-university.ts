/** Production UI/query construction with synthetic Auth/DB/router boundaries. No remote writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const web = path.resolve(__dirname, "../apps/web");
const req = createRequire(path.join(web, "package.json"));
const esbuild = req(req.resolve("esbuild", { paths: [req.resolve("tsx")] }));
const { chromium, expect } = req("@playwright/test");
const output = path.join(web, "test-results/university");
mkdirSync(output, { recursive: true });
let passed = 0;
async function bundle(contents: string, mocks: Record<string, string>, platform: "node" | "browser") {
  const result = await esbuild.build({ stdin: { contents, loader: "tsx", resolveDir: web }, bundle: true, write: false,
    platform, format: platform === "node" ? "cjs" : "iife", jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "boundaries", setup(b: any) {
      b.onResolve({ filter: /.*/ }, (a: any) => Object.hasOwn(mocks, a.path) ? { path: a.path, namespace: "fixture" } : undefined);
      b.onLoad({ filter: /.*/, namespace: "fixture" }, (a: any) => ({ contents: mocks[a.path], loader: "tsx", resolveDir: web }));
    } }] });
  return result.outputFiles[0].text;
}
async function main() {
  const server = await bundle(`import Page from './app/(marketplace)/buscar/page'; export const run=Page;`, {
    "server-only": "",
    "@/lib/supabase/server": "export const createClient=async()=>globalThis.universityFixture.client;",
    "@sentry/nextjs": "export const captureException=()=>{};",
    "next/headers": "export const cookies=async()=>({get:k=>k==='vicino_location'&&globalThis.universityFixture.geo?{value:'19.04,-98.2'}:undefined});",
    "next/link": "export default function Link(){return null;}",
    "./search-filters": "export function SearchFilters(){return null;}",
    "@/components/product/product-card": "export function ProductCard(){return null;}",
    "@/components/ui/user-avatar": "export function UserAvatar(){return null;}",
    "@/components/shared/catalog-query-state": "export function CatalogQueryState(){return null;}",
  }, "node");
  const mod = { exports: {} as { run: (p: unknown) => Promise<unknown> } };
  new Function("require", "module", "exports", server)(req, mod, mod.exports);
  for (const geo of [false, true]) for (const membership of ["approved", "pending", "none", "error", "no-peers", "guest"]) {
    const calls: { table: string; args?: Record<string, unknown>; ops: [string, ...unknown[]][] }[] = [];
    const client = {
      auth: { getUser: async () => ({ data: { user: membership === "guest" ? null : { id: "viewer" } }, error: null }) },
      from: (table: string) => builder(table),
      rpc: (table: string, args: Record<string, unknown>) => builder(table, args),
    };
    function builder(table: string, args?: Record<string, unknown>) {
      const call = { table, args, ops: [] as [string, ...unknown[]][] }; calls.push(call);
      const b: Record<string, any> = {};
      for (const op of ["select", "throwOnError", "eq", "in", "ilike", "limit", "or", "gte", "lte", "order", "range", "maybeSingle"]) {
        b[op] = (...values: unknown[]) => { call.ops.push([op, ...values]); return b; };
      }
      b.then = (resolve: (r: unknown) => unknown, reject: (e: Error) => unknown) => {
        if (table === "seller_verification" && membership === "error") return Promise.reject(new Error("Synthetic DB unavailable")).then(resolve, reject);
        let data: unknown = [];
        if (table === "seller_verification") {
          const own = call.ops.some(o => o[0] === "eq" && o[1] === "user_id");
          data = own ? ["approved", "no-peers"].includes(membership) ? { university_name: "BUAP" } : null
            : membership === "no-peers" ? [] : [{ user_id: "campus-seller" }];
        }
        return Promise.resolve({ data, count: 45, error: null }).then(resolve, reject);
      };
      return b;
    }
    (globalThis as any).universityFixture = { client, geo };
    const tree = await mod.exports.run({ searchParams: Promise.resolve({ category: "universidad", q: "mesa", page: "2" }) });
    for (const c of calls.filter(c => c.table === "seller_verification")) {
      assert(c.ops.some(o => o[0] === "eq" && o[1] === "status" && o[2] === "approved"));
      assert(c.ops.some(o => o[0] === "eq" && o[1] === "document_type" && o[2] === "Credencial Universitaria"));
    }
    assert(!calls.some(c => c.table === "categories"), "University must not query product categories");
    const executed = calls.find(c => c.ops.some(o => o[0] === "range"));
    if (membership === "error") assert(!executed, "DB errors must not produce an unrestricted query");
    else if (geo) {
      assert.equal(executed?.args?.restrict_seller_mode, true);
      assert.equal(executed?.args?.search_term, "mesa");
      assert.deepEqual(executed?.args?.seller_ids, membership === "approved" ? ["campus-seller"] : []);
    } else {
      assert(executed?.ops.some(o => membership === "approved" ? o[0] === "in" && o[1] === "creador_id" : o[0] === "eq" && o[1] === "id"));
      assert(!executed?.ops.some(o => o[0] === "or" && String(o[1]).includes("creador_id")));
    }
    if (membership !== "error") assert(JSON.stringify(tree).includes("category=universidad"), "Pagination must retain university");
    passed++;
  }
  delete (globalThis as any).universityFixture;
  const browserCode = await bundle(`
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {HomeCategoryOrder} from './components/home/home-category-order';
    import {SearchFilters} from './app/(marketplace)/buscar/search-filters';
    const root=createRoot(document.getElementById('root'));
    window.paint=(uni)=>root.render(<><HomeCategoryOrder viewerUniversity={uni} rows={[{slug:'comida',name:'Comida',content:<div data-slot="food">Comida</div>}]} intro={<div data-slot="ranking">Ranking</div>} university={<div data-slot="university">Comunidad universitaria</div>} afterIntro={<div data-slot="nearby">Cerca de ti</div>} recent={null} tail={null} empty={null}/><SearchFilters viewerUniversity={uni} initialQuery="mesa"/></>);
  `, {
    "next/link": "export default function Link({children,...props}){return <a {...props}>{children}</a>;}",
    "next/navigation": "import {useSyncExternalStore} from 'react';const push=history.pushState.bind(history);history.pushState=(...args)=>{push(...args);dispatchEvent(new Event('popstate'));};const subscribe=cb=>{addEventListener('popstate',cb);return()=>removeEventListener('popstate',cb);};export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));export const useRouter=()=>({push:url=>window.pushed=url});",
    "@/lib/haptics": "export const hapticSelection=async()=>{};",
    "@/hooks/use-search-history": "export const useSearchHistory=()=>({history:[],addQuery:()=>{},removeQuery:()=>{},clearAll:()=>{}});",
  }, "browser");
  const cssPath = path.join(web, ".next/static/css");
  const css = readdirSync(cssPath).filter(f => f.endsWith(".css")).map(f => readFileSync(path.join(cssPath, f), "utf8")).join("\n");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 844 } });
      const errors: string[] = []; page.on("pageerror", (e: Error) => errors.push(e.message));
      await page.route("**/*", (r: any) => r.request().isNavigationRequest() ? r.fulfill({ contentType: "text/html", body: '<html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><body><main id="root" style="max-width:800px;margin:auto;padding:16px"></main></body></html>' }) : r.abort());
      await page.goto("https://university.invalid/buscar?q=mesa&page=3&sort=price_asc");
      await page.addStyleTag({ content: css }); await page.addScriptTag({ content: browserCode });
      for (const [uni, color] of [["BUAP", "rgb(0, 59, 92)"], ["UDLAP", "rgb(0, 111, 83)"], ["Universidad Anáhuac", "rgb(255, 89, 0)"]]) {
        await page.evaluate((u: string) => (window as any).paint(u), uni);
        await expect(page.locator('[aria-label="Categorías del inicio"] button').first()).toHaveAttribute("id", "cat-universidad");
        await expect(page.locator("#cat-universidad")).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#cat-universidad > span").first()).toHaveCSS("background-color", color);
        await page.screenshot({ path: path.join(output, `home-${width}-${uni}.png`) });
        await page.locator('#cat-universidad').click();
        await expect(page.locator('#cat-universidad')).toHaveAttribute('aria-pressed','true');
        await expect(page.locator('#cat-universidad > span').first()).toHaveCSS('background-color','rgb(0, 0, 0)');
        await expect(page.locator('[data-slot]').first()).toHaveAttribute('data-slot','university');
        await expect(page.locator('[data-slot="university"]')).toHaveCount(1);
        await page.screenshot({path:path.join(output, `home-selected-${width}-${uni}.png`)});
        await page.locator('#cat-universidad').click();
        await expect(page.locator('#cat-universidad > span').first()).toHaveCSS('background-color',color);
        await expect(page.locator('[data-slot]').first()).toHaveAttribute('data-slot','ranking');
        await page.getByTestId("filtro-categorias-trigger").click();
        await page.locator('[data-categoria-slug="universidad"]').click();
        await expect(page.locator('[data-categoria-slug="universidad"]')).toHaveAttribute("aria-pressed", "true");
        await page.screenshot({ path: path.join(output, `university-${width}-${uni}.png`) });
        await page.getByRole("button", { name: "Cerrar", exact: true }).click();
        assert.equal(await page.evaluate(() => (window as any).pushed), undefined, "Cancel must not apply");
        await page.getByTestId("filtro-categorias-trigger").click();
        await expect(page.locator('[data-categoria-slug="universidad"]')).toHaveAttribute("aria-pressed", "false");
        await page.locator('[data-categoria-slug="universidad"]').click();
        await page.getByRole("button", { name: "Aplicar", exact: true }).click();
        const url = new URL(await page.evaluate(() => (window as any).pushed), "https://university.invalid");
        assert.equal(url.searchParams.get("category"), "universidad"); assert.equal(url.searchParams.get("q"), "mesa");
        assert.equal(url.searchParams.get("sort"), "price_asc"); assert.equal(url.searchParams.has("page"), false);
        await page.evaluate(() => { delete (window as any).pushed; });
        passed++;
      }
      await page.evaluate(() => (window as any).paint(null));
      await expect(page.locator("#cat-universidad")).toHaveCount(0);
      await page.getByTestId("filtro-categorias-trigger").click();
      await expect(page.locator('[data-categoria-slug="universidad"]')).toHaveCount(0);
      assert.deepEqual(errors, []); passed++; await page.close();
    }
  } finally { await browser.close(); }
  console.log(`University: ${passed}/${passed} scenarios PASS (synthetic DB/Auth; real components in Chrome).`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
