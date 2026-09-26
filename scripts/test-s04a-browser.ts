/** ChatWindow, hooks, manager and reconciler in Chrome. Synthetic transport only;
 * this does not certify a deployed Supabase/Capacitor session or remote RLS. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const { chromium, expect } = require("@playwright/test");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));

// Real PostgREST query construction runs against this in-memory fetch boundary.
const fixtureSource = `
  import {createClient} from '@supabase/supabase-js';
  export function fixture() {
    const row = (n,text='Mensaje '+n,own=false) => ({
      id:'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),chat_id:'chat',
      autor_id:own?'buyer':'seller',texto:text,attachments:[],
      created_at:'2026-09-25T10:00:'+String(Math.floor(n/100)).padStart(2,'0')+'.'+String(n%100).padStart(6,'0')+'Z',
      leido_por_comprador:false,leido_por_vendedor:false,
    });
    const f={rows:[row(1),row(2)],queries:[],active:[],history:[],pendingSends:[],
      failTable:'',removed:0,refreshes:0,nextSend:101,autoSubscribe:true};
    f.append=(n,text,own=false)=>{const m=row(n,text,own);f.rows.push(m);return m;};
    const client=createClient('https://supabase.s04.invalid','synthetic-key',{
      accessToken:async()=>'synthetic-token',global:{fetch:async(input)=>{
        const url=new URL(String(input));f.queries.push(url.toString());
        const table=url.pathname.split('/').at(-1);
        if(f.failTable===table) return Response.json({message:'synthetic failure'},{status:503});
        if(table==='chats') return Response.json({comprador_id:'buyer',vendedor_id:'seller',deleted_at_comprador:null,deleted_at_vendedor:null,ultimo_producto:null,producto_revision:0});
        if(table==='sale_confirmations') return Response.json([]);
        if(table!=='messages') throw new Error('Unexpected table '+table);
        let rows=[...f.rows];
        for(const value of url.searchParams.getAll('created_at')){
          const dot=value.indexOf('.'),op=value.slice(0,dot),date=value.slice(dot+1);
          rows=rows.filter(m=>op==='gte'?m.created_at>=date:op==='lte'?m.created_at<=date:m.created_at>date);
        }
        const or=url.searchParams.get('or');
        if(or){const date=/created_at\\.gt\\.([^,]+)/.exec(or)[1],id=/id\\.gt\\.([^)]*)/.exec(or)[1];
          rows=rows.filter(m=>m.created_at>date||(m.created_at===date&&m.id>id));}
        const ids=url.searchParams.get('id');
        if(ids){const selected=ids.slice(4,-1).split(',');rows=rows.filter(m=>selected.includes(m.id));}
        const desc=url.searchParams.get('order')?.startsWith('created_at.desc');
        rows.sort((a,b)=>(desc?-1:1)*(a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id)));
        const limit=url.searchParams.get('limit');if(limit)rows=rows.slice(0,Number(limit));
        return Response.json(rows);
      }},
    });
    client.channel=topic=>{
      if(f.active.some(c=>c.topic==='realtime:'+topic))throw new Error('Duplicate active topic');
      const callbacks=[];
      const channel={topic:'realtime:'+topic,status:null,
        on(_type,filter,callback){callbacks.push({filter,callback});return channel;},
        subscribe(callback){channel.status=callback;if(f.autoSubscribe)queueMicrotask(()=>callback('SUBSCRIBED'));return channel;},
        emitStatus(status){channel.status(status);},
        emit(table,event,newRow){for(const c of callbacks)if(c.filter.table===table&&(c.filter.event===event||c.filter.event==='*'))c.callback({eventType:event,new:newRow,old:{}});},
      };
      f.active.push(channel);f.history.push(channel);return channel;
    };
    client.getChannels=()=>f.active;
    client.removeChannel=async channel=>{
      const index=f.active.indexOf(channel);if(index>=0)f.active.splice(index,1);
      f.removed++;channel.emitStatus('CLOSED');return 'ok';
    };
    client.realtime.disconnect=()=>{};
    f.status=status=>f.active.at(-1).emitStatus(status);
    f.send=text=>new Promise(resolve=>{
      const m=f.append(f.nextSend++,text,true);f.pendingSends.push({row:m,resolve});
      for(const c of f.active)c.emit('messages','INSERT',m);
    });
    f.finishSend=index=>{const p=f.pendingSends[index];p.resolve({data:{id:p.row.id}});};
    f.client=client;return f;
  }
`;

async function main() {
  const mocks: Record<string, string> = {
    "s04-fixture": fixtureSource,
    "@/lib/supabase/client": "export const createClient=()=>window.s04.client;",
    "../actions": `export const sendMessage=(_chat,text)=>window.s04.send(text);
      export const getMessagesBefore=async()=>({items:[],nextCursor:null});
      export const getChatProducts=async()=>({data:[]});
      export const selectChatProduct=async()=>({error:'Synthetic A fixture does not select products'});`,
    "next/navigation": `const router={push:()=>{},refresh:()=>window.s04.refreshes++};export const useRouter=()=>router;`,
    "next/link": "import React from 'react';export default function Link(p){return React.createElement('a',p,p.children);}",
    "@/lib/haptics": "export const hapticMedium=()=>{};",
    "@/hooks/use-visible-chat-read": "export const useVisibleChatRead=()=>{};",
    "@/hooks/use-firmas-adjuntos": "export const useFirmasAdjuntos=()=>new Map();",
    "@/components/moderation/report-menu-button": "export const ReportMenuButton=()=>null;",
    "@/components/ui/user-avatar": "export const UserAvatar=()=>null;",
    "./sale-confirmation-card": "export const SaleConfirmationCard=()=>null;export const StatusPill=()=>null;export const ConfirmationStatus=()=>null;",
    "./sale-confirmation-form": "export const SaleConfirmationForm=()=>null;",
    "./message-photos": "export const MessagePhotos=()=>null;",
    "./photo-tray": "export const PhotoPickerButton=()=>null;export const PhotoTray=()=>null;export const admitirFotos=()=>({fotos:[],aviso:''});",
    "@/lib/chat/attachments": "export const CHAT_BUCKET='synthetic';export const leerAdjuntos=()=>[];export const subirAdjuntos=async()=>[];",
  };
  const bundle = await esbuild.build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {fixture} from 's04-fixture';import {ChatWindow} from './app/(marketplace)/chat/[id]/chat-window';
      window.s04=fixture();const root=createRoot(document.getElementById('root'));window.s04.unmount=()=>root.unmount();
      root.render(React.createElement(ChatWindow,{chatId:'chat',currentUserId:'buyer',isBuyer:true,
        otherUser:{id:'seller',nombre:'Vendedor sintético',foto:null,trust_level:'new'},product:null,
        initialMessages:[window.s04.rows[0]],initialSaleConfirmations:[],deletedAt:null}));`,
      resolveDir: web, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "synthetic-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
    } }],
  });
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
        if (route.request().isNavigationRequest() && new URL(route.request().url()).origin === "https://s04.invalid") {
          await route.fulfill({ contentType: "text/html", body: '<!doctype html><html><body><div id="root"></div></body></html>' });
        } else { unexpectedNetwork.push(route.request().url()); await route.abort(); }
      });
      async function mount() {
        await page.goto("https://s04.invalid/chat/chat");
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await expect(page.locator("[data-message-id]")).toHaveCount(2);
        await expect(page.getByRole("status")).toHaveCount(0);
      }
      async function channelCount() { return page.evaluate(() => (window as any).s04.history.length); }
      async function pending() { await expect(page.getByRole("status")).toContainText("Sincronización pendiente"); }
      async function synced() { await expect(page.getByRole("status")).toHaveCount(0); }

      await mount();
      assert.equal(await channelCount(), 1);
      assert.ok(await page.evaluate(() => (window as any).s04.queries.length >= 4));
      passed++;

      for (const status of ["CLOSED", "TIMED_OUT"]) {
        await mount();
        await page.evaluate((value: string) => { const f = (window as any).s04; f.append(3, "Recuperado tras cierre"); f.status(value); }, status);
        await pending();
        await page.getByRole("button", { name: "Reintentar", exact: true }).click();
        await expect.poll(channelCount).toBe(2);
        await synced();
        await expect(page.getByText("Recuperado tras cierre", { exact: true })).toHaveCount(1);
        assert.equal(await page.evaluate(() => (window as any).s04.active.length), 1);
        // Obsolete callbacks must never insert into the new generation.
        await page.evaluate(() => { const f = (window as any).s04; f.history[0].emit("messages", "INSERT", { ...f.rows[0], id: "stale", texto: "Eco obsoleto" }); });
        await expect(page.getByText("Eco obsoleto", { exact: true })).toHaveCount(0);
        passed++;
      }

      await mount();
      await page.evaluate(() => { const f = (window as any).s04; f.append(3, "Recuperado al volver online"); f.status("CLOSED"); window.dispatchEvent(new Event("online")); });
      await expect.poll(channelCount).toBe(2);
      await synced();
      await expect(page.getByText("Recuperado al volver online", { exact: true })).toHaveCount(1);
      passed++;

      await mount();
      await page.evaluate(() => { const f = (window as any).s04; f.append(3, "Recuperado al enfocar"); window.dispatchEvent(new Event("focus")); });
      await expect(page.getByText("Recuperado al enfocar", { exact: true })).toHaveCount(1);
      await synced();
      assert.equal(await channelCount(), 1, "Healthy focus must reconcile without replacing a subscribed channel");
      passed++;

      await mount();
      await page.evaluate(() => { const f = (window as any).s04; f.failTable = "sale_confirmations"; f.append(3, "Solo tras consulta completa"); window.dispatchEvent(new Event("focus")); });
      await pending();
      await expect(page.locator("[data-message-id]")).toHaveCount(2);
      const previousQueries = await page.evaluate(() => (window as any).s04.queries.length);
      await page.getByRole("button", { name: "Reintentar", exact: true }).click();
      await expect.poll(() => page.evaluate(() => (window as any).s04.queries.length)).toBeGreaterThan(previousQueries);
      await pending();
      await expect(page.getByText("Solo tras consulta completa", { exact: true })).toHaveCount(0);
      await page.evaluate(() => { (window as any).s04.failTable = ""; });
      await page.getByRole("button", { name: "Reintentar", exact: true }).click();
      await synced();
      await expect(page.getByText("Solo tras consulta completa", { exact: true })).toHaveCount(1);
      passed++;

      await mount();
      for (let n = 0; n < 2; n++) {
        await page.getByPlaceholder("Escribe un mensaje...").fill("Mensaje simultáneo");
        await page.getByPlaceholder("Escribe un mensaje...").press("Enter");
      }
      await expect.poll(() => page.evaluate(() => (window as any).s04.pendingSends.length)).toBe(2);
      await expect(page.getByText("Mensaje simultáneo", { exact: true })).toHaveCount(2);
      await page.evaluate(() => { (window as any).s04.status("CLOSED"); });
      await pending();
      await page.getByRole("button", { name: "Reintentar", exact: true }).click();
      await expect.poll(channelCount).toBe(2);
      await pending(); // A snapshot cannot certify messages whose sends have no final UUID yet.
      await expect(page.getByText("Mensaje simultáneo", { exact: true })).toHaveCount(2);
      await page.evaluate(() => { (window as any).s04.finishSend(1); });
      await expect(page.locator('[data-message-id^="temp-"]')).toHaveCount(1);
      await page.evaluate(() => { (window as any).s04.finishSend(0); });
      await synced();
      await expect(page.locator('[data-message-id^="temp-"]')).toHaveCount(0);
      await expect(page.getByText("Mensaje simultáneo", { exact: true })).toHaveCount(2);
      const ids = await page.locator("[data-message-id]").evaluateAll((nodes: HTMLElement[]) => nodes.map(node => node.dataset.messageId));
      assert.equal(ids.length, new Set(ids).size);
      passed++;

      await page.evaluate(() => { (window as any).s04.unmount(); });
      await expect.poll(() => page.evaluate(() => (window as any).s04.active.length)).toBe(0);
      const afterUnmount = await channelCount();
      await page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
      assert.equal(await channelCount(), afterUnmount);
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpectedNetwork, []);
      passed++;
      console.log(`PASA: 8 casos S04-A en Chrome ${viewport.width}x${viewport.height}; ChatWindow y lógica de sincronización reales.`);
      await context.close();
    }
    console.log(`PASA ${passed}/${passed}; transporte sintético, sin tráfico externo ni escrituras remotas.`);
  } finally { await browser.close(); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
