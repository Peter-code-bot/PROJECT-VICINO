/** Real S04-B React components in Chrome, server actions replaced at the boundary.
 * This verifies browser behavior, not a deployed SQL/RLS/Realtime installation. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const { chromium, webkit, expect } = require("@playwright/test");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const out = path.join(web, "test-results/venta-chat-01");
const postcss = createRequire(require.resolve("@tailwindcss/postcss"))("postcss");
const products = [
  { id: "10000000-0000-4000-8000-000000000001", titulo: "Mesa sintética", precio: 120, modo_precio: "fijo", imagen_principal: null, creador_id: "seller", estatus: "disponible", is_hidden: false },
  { id: "10000000-0000-4000-8000-000000000002", titulo: "Silla sintética", precio: 80, modo_precio: "fijo", imagen_principal: null, creador_id: "seller", estatus: "disponible", is_hidden: false },
  { id: "10000000-0000-4000-8000-000000000003", titulo: "Artículo pausado", precio: 90, modo_precio: "fijo", imagen_principal: null, creador_id: "seller", estatus: "pausado", is_hidden: false },
  { id: "10000000-0000-4000-8000-000000000004", titulo: "Artículo oculto", precio: 90, modo_precio: "fijo", imagen_principal: null, creador_id: "seller", estatus: "disponible", is_hidden: true },
  { id: "10000000-0000-4000-8000-000000000005", titulo: "Banco sintético", precio: 60, modo_precio: "fijo", imagen_principal: null, creador_id: "seller", estatus: "disponible", is_hidden: false },
];

function contrastRatio(a: string, b: string) {
  const luminance = (color: string) => {
    const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
      value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    });
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}

async function main() {
  await mkdir(out, { recursive: true });
  const mocks: Record<string, string> = {
    "@/hooks/use-chat-operations": "export const useChatOperations=()=>({operations:[],history:[],ready:true,error:null,nextCursor:null,loadingMore:false,refresh:async()=>true,loadMore:async()=>{},mutate:async()=>false,isPending:()=>false,errorFor:()=>undefined});",
    "../actions": `
      export const sendMessage=async()=>({error:'Sending is outside this S04-B fixture'});
      export const getMessagesBefore=async()=>({items:[],nextCursor:null});
      export async function getChatProducts(input){window.s04b.listCalls.push(input);return {data:window.s04b.products,sellers:[{id:'seller',nombre:'Vendedor sintético',foto:null}],sellerId:'seller'};}
      export async function selectChatProduct(input){const f=window.s04b;f.selectCalls.push(input);
        if(f.holdSelect)return new Promise(resolve=>{f.finishSelect=resolve;});
        return f.selectResult;
      }
      export async function createSaleConfirmation(input){
        const f=window.s04b;f.saleCalls.push(input);
        if(f.holdSale)return new Promise(resolve=>{f.finishSale=resolve;});
        const result=f.saleResults.shift()??{data:{id:'synthetic-sale'}};
        if(result==='transport-error')throw new Error('Fallo de transporte sintético');
        return result;
      }
    `,
    "next/navigation": "const router={refresh:()=>window.s04b.refreshes++,push:()=>{}};export const useRouter=()=>router;",
    "next/link": "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children);}",
    "next/image": "import React from 'react';export default function Image(p){return React.createElement('img',p);}",
    "@/lib/haptics": "export const hapticMedium=()=>{};export const hapticLight=()=>{};",
    "@/lib/supabase/client": "export const createClient=()=>window.s04b.client;",
    "@/hooks/use-visible-chat-read": "export const useVisibleChatRead=()=>{};",
    "@/hooks/use-firmas-adjuntos": "export const useFirmasAdjuntos=()=>new Map();",
    "@/components/moderation/report-menu-button": "export const ReportMenuButton=()=>null;",
    "@/components/ui/user-avatar": "export const UserAvatar=()=>null;",
    "./sale-confirmation-card": "export const SaleConfirmationCard=()=>null;export const SaleConfirmationBanner=()=>null;export const StatusPill=()=>null;export const ConfirmationStatus=()=>null;",
    "./message-photos": "export const MessagePhotos=()=>null;",
    "./photo-tray": "export const PhotoPickerButton=()=>null;export const PhotoTray=()=>null;export const admitirFotos=()=>({fotos:[],aviso:''});",
    "@/lib/chat/attachments": "export const CHAT_BUCKET='synthetic';export const leerAdjuntos=()=>[];export const subirAdjuntos=async()=>[];",
  };
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {ChatProductSelector} from './app/(marketplace)/chat/[id]/chat-product-selector';
      import {SaleConfirmationForm} from './app/(marketplace)/chat/[id]/sale-confirmation-form';
      import {ChatWindow} from './app/(marketplace)/chat/[id]/chat-window';
      const fixture=window.s04b;fixture.serverActive={product:fixture.products[0],revision:4};
      const channels=[];fixture.client={
        from(table){
          const query=new Proxy({}, {get(_object,key){
            if(key==='then')return (resolve,reject)=>Promise.resolve({error:null,data:table==='chats'?{
              comprador_id:'buyer',vendedor_id:'seller',deleted_at_comprador:null,deleted_at_vendedor:null,
              ultimo_producto:fixture.serverActive.product,ultimo_producto_id:fixture.serverActive.product?.id,
              producto_revision:fixture.serverActive.revision,
            }:[]}).then(resolve,reject);
            return ()=>query;
          }});return query;
        },
        channel(topic){const listeners=[];const channel={topic:'realtime:'+topic,
          on(_type,filter,callback){listeners.push({filter,callback});return channel;},
          subscribe(callback){queueMicrotask(()=>callback('SUBSCRIBED'));return channel;},
          emit(table){for(const {filter,callback} of listeners)if(filter.table===table)callback({eventType:'UPDATE',new:{id:'chat',producto_revision:fixture.serverActive.revision},old:{}});},
        };channels.push(channel);return channel;},
        getChannels:()=>channels,
        removeChannel:async channel=>{const i=channels.indexOf(channel);if(i>=0)channels.splice(i,1);return 'ok';},
        realtime:{disconnect:()=>{}},
      };
      fixture.remoteProduct=(index=1,revision=5)=>{fixture.serverActive={product:fixture.products[index],revision};for(const c of channels)c.emit('chats');};
      function Harness(){const f=window.s04b;const [active,setActive]=useState({product:f.products[f.initialIndex],revision:4});
        f.setActive=setActive;
        if(location.pathname==='/chat')return <ChatWindow chatId="chat" currentUserId={f.actor??'buyer'} isBuyer={f.actor!=='seller'}
          otherUser={{id:'seller',nombre:'Vendedor sintético',foto:null,trust_level:'new'}} product={active.product}
          productRevision={4} initialMessages={[]} initialSaleConfirmations={[]} deletedAt={null}/>;
        return <><output data-testid="active">{JSON.stringify(active)}</output>
          {location.pathname==='/selector'?<ChatProductSelector chatId="chat" currentUserId="buyer" active={active}
            onSelected={value=>{f.selections.push(value);setActive(value);}}/>:
          <SaleConfirmationForm key={active.product.id+':'+active.revision} chatId="chat" currentUserId="buyer"
            product={active.product} productRevision={active.revision} onClose={()=>f.closed++} onCreated={value=>f.created.push(value)}/>}
        </>;
      }
      createRoot(document.getElementById('root')).render(<Harness/>);`,
      resolveDir: web, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
    outfile: path.join(out, "s04b.js"),
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "server-action-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
    } }],
  });
  const cssPath = path.join(web, "app/globals.css");
  const source = (await readFile(cssPath, "utf8")).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "./(marketplace)/chat/**/*.tsx";\n@source "../components/ui/dialog.tsx";');
  const globalCss = (await postcss([require("@tailwindcss/postcss")({ base: web })]).process(source, { from: cssPath })).css;
  const css = globalCss + "\n" + bundle.outputFiles.filter((file: any) => file.path.endsWith(".css")).map((file: any) => file.text).join("\n");
  const js = bundle.outputFiles.find((file: any) => file.path.endsWith(".js")).text;
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  let passed = 0;
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 375, height: 812 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.setDefaultTimeout(5000);
      const errors: string[] = [], unexpectedNetwork: string[] = [];
      page.on("pageerror", (error: Error) => errors.push(error.message));
      await page.route("**/*", async (route: any) => {
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === "https://s04b.invalid") {
          await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:var(--bg);color:var(--fg)"><div id="root" style="height:100dvh"></div></body></html>' });
        } else { unexpectedNetwork.push(route.request().url()); await route.abort(); }
      });
      async function mount(route: string, options: object = {}) {
        await page.goto(`https://s04b.invalid${route}`);
        await page.evaluate((value: any) => {
          (window as any).s04b = { ...value, listCalls: [], selectCalls: [], saleCalls: [], selections: [], created: [], closed: 0, refreshes: 0 };
        }, { products, initialIndex: 0, selectResult: { data: { product: { ...products[1], titulo: "Respuesta canónica del servidor" }, revision: 7 } }, saleResults: [], ...options });
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: js });
      }
      async function openSelector() {
        try { await expect(page.locator(`select option[value="${products[1].id}"]`)).toHaveCount(1); }
        catch (error) { console.error({ errors, body: await page.locator('body').innerText() }); throw error; }
      }
      async function submitSale() { await page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true }).click(); }
      async function saleCalls() { return page.evaluate(() => (window as any).s04b.saleCalls); }

      await mount("/selector");
      await openSelector();
      await page.locator("select").selectOption(products[1].id);
      await page.getByRole("button", { name: "Aplicar producto", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).s04b.selections.length)).toBe(1);
      const selection = await page.evaluate(() => (window as any).s04b.selections[0]);
      assert.equal(selection.revision, 7);
      assert.equal(selection.product.titulo, "Respuesta canónica del servidor");
      assert.deepEqual(await page.evaluate(() => (window as any).s04b.selectCalls), [{ chatId: "chat", productId: products[1].id, expectedRevision: 4 }]);
      passed++;

      await mount("/selector", { selectResult: { error: "El producto cambió. Actualiza la conversación." } });
      await openSelector();
      await page.locator("select").selectOption(products[1].id);
      await page.getByRole("button", { name: "Aplicar producto", exact: true }).click();
      await expect(page.getByText("El producto cambió. Actualiza la conversación.", { exact: true })).toBeVisible();
      assert.deepEqual(await page.evaluate(() => (window as any).s04b.selections), []);
      await expect(page.getByTestId("active")).toContainText(products[0].id);
      await expect(page.getByTestId("active")).toContainText('"revision":4');
      passed++;

      await mount("/selector");
      await openSelector();
      for (const product of products.filter(p => p.estatus !== "disponible" || p.is_hidden)) {
        const option = page.locator(`select option[value="${product.id}"]`);
        if (await option.count()) await expect(option).toBeDisabled();
      }
      passed++;

      await mount("/sale", { saleResults: ["transport-error", { error: "Espera antes de reintentar.", code: "RATE_LIMITED" }, { data: { id: "synthetic-sale" } }] });
      await expect(page.getByText("Tras recibir. El vendedor confirmará la entrega.", { exact: true })).toBeVisible();
      await submitSale();
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeEnabled();
      await expect.poll(async () => (await saleCalls()).length).toBe(1);
      assert.equal(await page.evaluate(() => (window as any).s04b.closed), 0);
      await expect(page.getByRole("alert")).toContainText("Reintenta con los mismos datos");
      await expect(page.getByLabel("Total acordado (MXN)", { exact: true })).toBeDisabled();
      await expect(page.getByLabel("Cantidad", { exact: true })).toBeDisabled();
      await submitSale();
      await expect.poll(async () => (await saleCalls()).length).toBe(2);
      await expect(page.getByRole("alert")).toHaveText("Espera antes de reintentar.");
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeEnabled();
      await expect(page.getByLabel("Total acordado (MXN)", { exact: true })).toBeDisabled();
      await expect(page.getByLabel("Cantidad", { exact: true })).toBeDisabled();
      assert.equal(await page.evaluate(() => (window as any).s04b.closed), 0);
      await submitSale();
      await expect.poll(() => page.evaluate(() => (window as any).s04b.closed)).toBe(1);
      const retriedCalls = await saleCalls();
      assert.equal(retriedCalls.length, 3);
      assert.match(retriedCalls[0].idempotencyKey, /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
      assert.deepEqual(retriedCalls[1], retriedCalls[0]);
      assert.deepEqual(retriedCalls[2], retriedCalls[0]);
      assert.equal(retriedCalls[0].expectedRevision, 4);
      assert.equal(retriedCalls[0].productId, products[0].id);
      assert.equal(retriedCalls[1].precioAcordado, 120);
      passed++;

      await mount("/sale", { holdSale: true });
      await page.locator("form").evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
      await expect.poll(async () => (await saleCalls()).length).toBe(1);
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
      await page.evaluate(() => { (window as any).s04b.finishSale({ data: { id: "synthetic-sale" } }); });
      await expect.poll(() => page.evaluate(() => (window as any).s04b.closed)).toBe(1);
      assert.equal((await saleCalls()).length, 1);
      passed++;

      await mount("/sale", { initialIndex: 2 });
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeDisabled();
      assert.equal((await saleCalls()).length, 0);
      passed++;

      await mount("/chat");
      await expect(page.getByText("Recuperando conversación…", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeVisible();
      await page.evaluate(() => { (window as any).s04b.remoteProduct(); });
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toHaveCount(0);
      await expect(page.getByText(products[1].titulo, { exact: true }).first()).toBeVisible();
      assert.equal((await saleCalls()).length, 0);
      // A-B-A changes still invalidate the old draft even when the final ID matches.
      await mount("/chat");
      await expect(page.getByText("Recuperando conversación…", { exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeVisible();
      await page.evaluate(() => { (window as any).s04b.remoteProduct(0); });
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toHaveCount(0);
      await expect(page.getByText("El producto cambió o dejó de estar disponible. Revisa la selección y abre una nueva confirmación.", { exact: true })).toBeVisible();
      passed++;

      await mount("/chat", { holdSelect: true });
      await page.getByRole("button", { name: "Cambiar producto", exact: true }).click();
      await openSelector();
      await page.locator("select").selectOption(products[1].id);
      await page.getByRole("button", { name: "Aplicar producto", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).s04b.selectCalls.length)).toBe(1);
      await page.evaluate(() => { (window as any).s04b.remoteProduct(1, 5); });
      await expect(page.locator('a[href="/vendedor/seller"]')).toContainText(products[1].titulo);
      await page.evaluate(() => { (window as any).s04b.remoteProduct(4, 6); });
      await expect(page.locator('a[href="/vendedor/seller"]')).toContainText(products[4].titulo);
      await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeVisible();
      await expect(page.getByLabel("Total acordado (MXN)", { exact: true })).toHaveValue("60");
      await page.evaluate(async () => {
        const f = (window as any).s04b;
        f.finishSelect({ data: { product: f.products[1], revision: 5 } });
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeVisible();
      await expect(page.getByLabel("Total acordado (MXN)", { exact: true })).toHaveValue("60");
      await expect(page.locator('a[href="/vendedor/seller"]')).toContainText(products[4].titulo);
      assert.equal((await saleCalls()).length, 0);
      passed++;

      await mount("/chat", { holdSale: true });
      await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await submitSale();
      await expect.poll(async () => (await saleCalls()).length).toBe(1);
      await page.evaluate(() => { (window as any).s04b.remoteProduct(1, 5); });
      await expect(page.getByRole("button", { name: "Enviando...", exact: true })).toHaveCount(0);
      await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
      await expect(page.getByLabel("Total acordado (MXN)", { exact: true })).toHaveValue("80");
      await page.evaluate(async () => {
        (window as any).s04b.finishSale({ data: { id: "synthetic-old-sale" } });
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      });
      await expect(page.getByRole("form", { name: "Datos de la venta" }).getByRole("button", { name: "Confirmar venta", exact: true })).toBeVisible();
      await expect(page.getByLabel("Total acordado (MXN)", { exact: true })).toHaveValue("80");
      assert.equal((await saleCalls()).length, 1);
      passed++;

      assert.deepEqual(errors, []);
      assert.deepEqual(unexpectedNetwork, []);
      console.log(`PASA: 9 casos S04-B en Chrome ${viewport.width}x${viewport.height}; selector, formulario y ChatWindow reales.`);
      await context.close();
    }
    console.log(`PASA ${passed}/${passed}; acciones simuladas, sin tráfico externo.`);
  } finally { await browser.close(); }

  const matrices: object[] = [];
  const longTitle = "Laptop Lenovo ThinkPad T14 Gen 3 (Core i7, 16GB, 512GB SSD)";
  const thumbnail = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#1e5b4f"/><rect x="10" y="16" width="60" height="40" rx="3" fill="#a8b0ad"/><path d="M5 60h70l-6 8H11z" fill="#f4efe4"/></svg>');
  for (const [engine, launcher] of [["chromium", chromium], ["webkit", webkit]] as const) {
    const visualBrowser = await launcher.launch({ headless: true });
    try {
      for (const width of [320, 375, 1280]) for (const theme of ["light", "dark"]) {
        const context = await visualBrowser.newContext({ viewport: { width, height: 900 } });
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const errors: string[] = [], unexpectedNetwork: string[] = [];
        page.on("pageerror", (error: Error) => errors.push(error.message));
        await page.route("**/*", async (route: any) => {
          if (route.request().isNavigationRequest()) await route.fulfill({ contentType: "text/html", body: '<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;background:var(--bg);color:var(--fg)"><div id="root" style="height:100dvh"></div></body></html>' });
          else { unexpectedNetwork.push(route.request().url()); await route.abort(); }
        });
        await page.goto("https://s04b.invalid/chat");
        await page.evaluate(({ products, longTitle, thumbnail, theme }: any) => {
          document.documentElement.classList.toggle("dark", theme === "dark");
          (window as any).s04b = {
            products: products.map((product: any, index: number) => index ? product : { ...product, titulo: longTitle, precio: 12800, imagen_principal: thumbnail }),
            actor: "seller", initialIndex: 0, listCalls: [], selectCalls: [], saleCalls: [], selections: [], created: [], closed: 0, refreshes: 0,
            saleResults: ["transport-error", { data: { id: "synthetic-sale" } }],
          };
        }, { products, longTitle, thumbnail, theme });
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: js });
        await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
        const panel = page.getByRole("region", { name: "Confirmar venta", exact: true });
        const form = panel.getByRole("form", { name: "Datos de la venta" });
        const submit = form.getByRole("button", { name: "Confirmar venta", exact: true });
        const price = form.getByLabel("Total acordado (MXN)", { exact: true });
        const quantity = form.getByLabel("Cantidad", { exact: true });
        const notes = form.getByLabel("Notas (opcional)", { exact: true });
        await expect(panel).toBeVisible();
        await expect(submit).toBeEnabled();
        const colors = await form.evaluate((element: HTMLElement) => [...element.querySelectorAll("input,button")].map(control => {
          const style = getComputedStyle(control);
          return { text: style.color, background: style.backgroundColor, border: control.tagName === "INPUT" ? style.borderTopColor : null };
        }));
        const contrast = colors.map((control: any) => ({
          text: contrastRatio(control.text, control.background),
          border: control.border === null ? null : contrastRatio(control.border, control.background),
        }));
        assert.ok(contrast.every((control: any) => control.text >= 4.5 && (control.border === null || control.border >= 3)), "text and input boundary contrast");
        await expect(panel.getByText("Tras entregar. El comprador confirmará la recepción.", { exact: true })).toBeVisible();
        const bounds = await panel.boundingBox();
        const row = await page.getByRole("button", { name: "Cambiar producto", exact: true }).boundingBox();
        assert.ok(bounds && row && bounds.y + bounds.height <= row.y + 1, "form precedes product/history row");
        await page.screenshot({ path: path.join(out, "panel-" + engine + "-" + width + "-" + theme + ".png"), fullPage: true });
        assert.ok(bounds.height <= (width === 320 ? 360 : 290), "compact initial panel height: " + JSON.stringify({ engine, width, theme, bounds, fields: await form.locator("fieldset").boundingBox(), price: await price.boundingBox() }));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "no horizontal overflow");
        for (const control of [price, quantity, notes, submit, panel.getByRole("button", { name: "Cerrar confirmación" })]) {
          const rect = await control.boundingBox();
          assert.ok(rect && rect.height >= 48, "48px control target");
        }
        const quantityRect = await quantity.boundingBox(), notesRect = await notes.boundingBox();
        assert.ok(quantityRect && notesRect && Math.abs(quantityRect.y - notesRect.y) < 1, "quantity and notes share row");
        const summary = panel.locator("summary");
        const title = summary.locator("span");
        assert.equal(await title.evaluate((element: HTMLElement) => getComputedStyle(element).webkitLineClamp), "2");
        await summary.focus(); await page.keyboard.press("Enter");
        await expect(panel.locator("details")).toHaveAttribute("open", "");
        assert.equal(await title.evaluate((element: HTMLElement) => element.scrollHeight <= element.clientHeight + 1), true, "full title accessible");
        await page.keyboard.press("Enter");
        await price.fill("12500.50"); await quantity.fill("2"); await notes.fill("Entrega acordada");
        await page.getByRole("button", { name: "Cerrar confirmación" }).click();
        await page.getByRole("button", { name: "Confirmar venta", exact: true }).click();
        await expect(price).toHaveValue("12500.50"); await expect(quantity).toHaveValue("2"); await expect(notes).toHaveValue("Entrega acordada");
        await price.focus(); await page.keyboard.press("Tab"); await expect(quantity).toBeFocused();
        await page.keyboard.press("Tab"); await expect(notes).toBeFocused();
        await page.keyboard.press("Tab"); await expect(submit).toBeFocused();

        // Without a photo the placeholder stays compact. Invalid URLs get the same fallback.
        await panel.locator("img").evaluate((image: HTMLImageElement) => image.dispatchEvent(new Event("error")));
        await expect(panel.locator("img")).toHaveCount(0);
        await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "200% horizontal overflow");
        for (const control of [price, quantity, notes, submit]) {
          await control.scrollIntoViewIfNeeded();
          const rect = await control.boundingBox();
          assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1, "200% control remains reachable");
        }
        await page.screenshot({ path: path.join(out, "panel-200-" + engine + "-" + width + "-" + theme + ".png"), fullPage: true });
        await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
        await submit.click();
        await expect(panel.getByRole("alert")).toContainText("Reintenta con los mismos datos");
        await expect(price).toBeDisabled(); await expect(quantity).toBeDisabled(); await expect(notes).toBeDisabled();
        await submit.click();
        await expect(panel).toHaveCount(0);
        const calls = await page.evaluate(() => (window as any).s04b.saleCalls);
        assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
        assert.equal(calls[0].precioAcordado, 12500.5); assert.equal(calls[0].cantidad, 2); assert.equal(calls[0].notas, "Entrega acordada");
        assert.deepEqual(errors, []); assert.deepEqual(unexpectedNetwork, []);
        await context.close();
        matrices.push({ engine, width, theme, panelHeight: bounds!.height, contrast, passed: true });
        console.log("PASA panel " + engine + " " + width + " " + theme + "; altura " + bounds!.height + "px.");
      }
    } finally { await visualBrowser.close(); }
  }
  await writeFile(path.join(out, "panel-results.json"), JSON.stringify(matrices, null, 2));
  console.log("PASA " + matrices.length + "/12 matrices del panel real: Chromium/WebKit, 320/375/1280, claro/oscuro, texto200%, borrador y reintento. Sin aceptación física.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
