import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] }));
type FixtureWindow = Window & { fixture: {
  mount: (chat: string, product: string, message: string) => void;
  hide: (hidden: boolean) => void;
  finish: (ok: boolean) => void;
  receipts: string[]; views: string[]; aborted: number;
} };
let script: string;

test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const result = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {useVisibleChatRead} from './hooks/use-visible-chat-read';
      import {ProductView} from './components/product/product-view';
      const f=window.fixture={receipts:[],views:[],aborted:0,mount:()=>{},finish:()=>{},hide:()=>{}};
      let hidden=false;
      Object.defineProperty(document,'visibilityState',{get:()=>hidden?'hidden':'visible'});
      f.hide=(value)=>{hidden=value;document.dispatchEvent(new Event('visibilitychange'));};
      window.fetch=(url,options)=>{if(url!=='/api/chat/read')throw Error('Unexpected network');
        f.receipts.push(JSON.parse(options.body).chatId);
        return new Promise((resolve,reject)=>{
          f.finish=ok=>resolve({ok});
          options.signal.addEventListener('abort',()=>{f.aborted++;reject(new DOMException('Aborted','AbortError'));},{once:true});
        });};
      function Chat({id,message}){useVisibleChatRead(id,'synthetic-user',message);return <p>{id}:{message}</p>;}
      function App(){const [state,setState]=useState({chat:'',product:'',message:''});
        f.mount=(chat,product,message)=>setState({chat,product,message});
        return <>{state.chat&&<Chat id={state.chat} message={state.message}/>}{state.product&&<ProductView productId={state.product}/>}<span data-testid="ready">{state.chat+state.product+state.message}</span></>;}
      createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: web, loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "local-view-rpc", setup(build: {
      onResolve: (options: object, callback: () => unknown) => void;
      onLoad: (options: object, callback: () => unknown) => void;
    }) {
      build.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: "rpc", namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents:
        "export const createClient=()=>({rpc:(name,args)=>({then:(resolve)=>{if(name!=='increment_product_view')throw Error('Unexpected RPC');window.fixture.views.push(args.p_id);resolve({error:null});}})});",
        loader: "js", resolveDir: web }));
    } }],
  });
  script = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  await expect(page.getByTestId("ready")).toHaveCount(1);
});

test("hidden conversations and products do not write; visible visits count only once", async ({ page }) => {
  await page.evaluate(() => { const f=(window as FixtureWindow).fixture; f.hide(true); f.mount("chat-a", "product-a", "one"); });
  await expect(page.getByTestId("ready")).toHaveText("chat-aproduct-aone");
  expect(await page.evaluate(() => { const f=(window as FixtureWindow).fixture; return [f.receipts, f.views]; })).toEqual([[], []]);
  await page.evaluate(() => (window as FixtureWindow).fixture.hide(false));
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.receipts)).toEqual(["chat-a"]);
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.views)).toEqual(["product-a"]);
  await page.evaluate(() => { const f=(window as FixtureWindow).fixture; f.hide(true); f.hide(false); f.mount("chat-a", "product-a", "two"); });
  await expect(page.getByTestId("ready")).toHaveText("chat-aproduct-atwo");
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.views)).toEqual(["product-a"]);
});

test("receipt requests coalesce while messages stay usable; changing chat aborts the old receipt", async ({ page }) => {
  await page.evaluate(() => (window as FixtureWindow).fixture.mount("chat-a", "", "one"));
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.receipts.length)).toBe(1);
  for (const message of ["two", "three"]) {
    await page.evaluate(value => (window as FixtureWindow).fixture.mount("chat-a", "", value), message);
    await expect(page.getByTestId("ready")).toHaveText("chat-a" + message);
  }
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.receipts.length)).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.finish(true));
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.receipts.length)).toBe(2);
  await page.evaluate(() => (window as FixtureWindow).fixture.mount("chat-b", "", "one"));
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.aborted)).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.receipts)).toEqual(["chat-a", "chat-a", "chat-b"]);
});

test("receipt failures do not loop; a foreground event retries", async ({ page }) => {
  await page.evaluate(() => (window as FixtureWindow).fixture.mount("chat-a", "", "one"));
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.receipts.length)).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.finish(false));
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.receipts.length)).toBe(1);
  await page.evaluate(() => { const f=(window as FixtureWindow).fixture; f.hide(true); f.hide(false); });
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.receipts.length)).toBe(2);
});
