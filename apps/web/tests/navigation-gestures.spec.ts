import { test, expect, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";

const localRequire = createRequire(path.resolve(__dirname, "../package.json"));
const esbuild = localRequire(localRequire.resolve("esbuild", { paths: [localRequire.resolve("tsx")] }));
type Call = { type: string; at: number; href?: string };
type FixtureWindow = Window & { fixture: { calls: Call[]; hapticDelay: number; releasedAt: number; finish: () => void } };
let js: string;

test.beforeAll(async () => {
  const web = path.resolve(__dirname, "..");
  const router = `import React,{createContext,useContext,useState,useMemo,use} from 'react';
    const Context=createContext(null);
    export const usePathname=()=>useContext(Context).path;
    export const useRouter=()=>useContext(Context).router;
    window.fixture={calls:[],hapticDelay:0,releasedAt:0,finish:()=>{}};
    window.addEventListener('touchend',event=>{window.fixture.releasedAt=event.timeStamp;},{capture:true});
    export function Provider({children}){
      const [state,setState]=useState({path:'/',data:Promise.resolve('initial')});
      const router=useMemo(()=>({
        prefetch:()=>{},
        push:(href)=>{window.fixture.calls.push({type:'push',href,at:performance.now()});
          const data=new Promise(resolve=>window.fixture.finish=()=>resolve('ready'));
          setState({path:href,data});},
        refresh:()=>{window.fixture.calls.push({type:'refresh',at:performance.now()});
          const data=new Promise(resolve=>window.fixture.finish=()=>resolve('refreshed'));
          setState(prev=>({...prev,data}));}
      }),[]);
      return React.createElement(Context.Provider,{value:{...state,router}},children);
    }
    export function Content(){const state=useContext(Context);const data=use(state.data);
      return React.createElement('div',{'data-testid':'ready'},state.path+':'+data);}
  `;
  const result = await esbuild.build({
    stdin: { contents: `import React,{Suspense} from 'react';import {createRoot} from 'react-dom/client';
      import {Provider,Content} from 'next/navigation';
      import {PageSwipeWrapper} from './components/layout/page-swipe-wrapper';
      import {PullToRefreshWrapper} from './components/layout/pull-to-refresh-wrapper';
      createRoot(document.getElementById('root')).render(<Provider><Suspense fallback={<p>Loading fixture</p>}>
        <PullToRefreshWrapper><PageSwipeWrapper isVendedor={false}>
          <Content/><div id="surface" style={{height:500}}>Gesture surface</div>
          <div id="carousel" style={{overflowX:'auto',width:320,height:80}}><div style={{width:1100,height:60}}>Native carousel</div></div>
          <input id="field"/><div style={{height:1600}}>Native vertical scroll</div>
        </PageSwipeWrapper></PullToRefreshWrapper></Suspense></Provider>);`,
      resolveDir: web, loader: "tsx" },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"), define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "local-router", setup(build: {
      onResolve: (options: object, callback: (args: { path: string }) => unknown) => void;
      onLoad: (options: object, callback: (args: { path: string }) => unknown) => void;
    }) {
      build.onResolve({ filter: /^(next\/navigation|@capacitor\/(core|haptics))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      build.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents:
        args.path === "next/navigation" ? router : args.path.endsWith("core")
          ? "export const Capacitor={isNativePlatform:()=>true};"
          : "export const ImpactStyle={Light:'LIGHT'};export const Haptics={impact:()=>new Promise(resolve=>setTimeout(resolve,window.fixture.hapticDelay))};",
        loader: "js", resolveDir: web }));
    } }],
  });
  js = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route("**/*", route => route.abort());
  await page.setContent('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0"><div id="root"></div></body></html>');
  await page.addScriptTag({ content: js });
  await expect(page.getByTestId("ready")).toHaveText("/:initial");
});

async function gesture(page: Page, from: [number, number], to: [number, number], cancel = false) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + (to[0] - from[0]) * i / 8, y: from[1] + (to[1] - from[1]) * i / 8 }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: cancel ? "touchCancel" : "touchEnd", touchPoints: [] });
  await cdp.detach();
  // Measure from the browser event clock; a timestamp before sending the CDP
  // command also measures the test runner's IPC/scheduling under build load.
  return page.evaluate(() => (window as FixtureWindow).fixture.releasedAt);
}

test("swipe starts navigation without waiting for haptics; old content remains usable", async ({ page }, info) => {
  await page.evaluate(() => { (window as FixtureWindow).fixture.hapticDelay = 1500; });
  const releasedAt = await gesture(page, [310, 260], [80, 260]);
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.calls.filter(c => c.type === "push").length), { timeout: 4000 }).toBe(1);
  const elapsed = await page.evaluate(start => (window as FixtureWindow).fixture.calls.find(c => c.type === "push")!.at - start, releasedAt);
  await info.attach("release-to-router.json", { body: JSON.stringify({ ms: elapsed, hapticDelayMs: 1500, productionReact: true, simulatedRouter: true, clock: "browser touchend timestamp to router call; not content-ready or hardware latency" }), contentType: "application/json" });
  if (process.env.VICINO_GESTURE_BASELINE === "1") return;
  expect(elapsed).toBeLessThan(100);
  await expect(page.getByTestId("ready")).toBeVisible();
  expect(await page.getByTestId("ready").evaluate(el => el.getBoundingClientRect().right)).toBeGreaterThan(0);
  await gesture(page, [310, 260], [80, 260]);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls.filter(c => c.type === "push").length)).toBe(1);
  await page.evaluate(() => (window as FixtureWindow).fixture.finish());
  await expect(page.getByTestId("ready")).toHaveText("/buscar:ready");
});

test("cancelled pull never refreshes, including after a completed pull", async ({ page }) => {
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1");
  await gesture(page, [180, 70], [180, 350], true);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
  await gesture(page, [180, 70], [180, 80]);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
});

test("refresh status follows real data completion instead of a 1200 ms timer", async ({ page }) => {
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1");
  await gesture(page, [180, 70], [180, 350]);
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.calls.filter(c => c.type === "refresh").length)).toBe(1);
  await expect(page.getByRole("status")).toHaveText("Actualizando");
  await page.waitForTimeout(1400);
  await expect(page.getByRole("status")).toHaveText("Actualizando");
  await page.evaluate(() => (window as FixtureWindow).fixture.finish());
  await expect(page.getByTestId("ready")).toHaveText("/:refreshed");
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("native vertical scroll does not change route", async ({ page }) => {
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1");
  await gesture(page, [180, 450], [180, 190]);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
});

test("native carousel and system edge do not change route", async ({ page }) => {
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1");
  const box = await page.locator("#carousel").boundingBox();
  if (!box) throw new Error("Carousel missing");
  await gesture(page, [box.x + 280, box.y + 35], [box.x + 40, box.y + 35]);
  await expect.poll(() => page.locator("#carousel").evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await gesture(page, [5, 260], [240, 260]);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
});

test("reduced motion keeps feedback and navigation functional", async ({ page }) => {
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gesture(page, [310, 260], [80, 260]);
  await expect.poll(() => page.evaluate(() => (window as FixtureWindow).fixture.calls.filter(c => c.type === "push").length)).toBe(1);
  await expect(page.getByTestId("ready")).toBeVisible();
  await page.evaluate(() => (window as FixtureWindow).fixture.finish());
  await expect(page.getByTestId("ready")).toHaveText("/buscar:ready");
});

test("cancelled horizontal swipe never navigates", async ({ page }) => {
  await gesture(page, [310, 260], [80, 260], true);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
  await expect(page.getByTestId("ready")).toHaveText("/:initial");
});

test("an open modal owns gestures instead of the underlying page", async ({ page }) => {
  await page.evaluate(() => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    document.querySelector("#surface")!.appendChild(dialog);
  });
  await gesture(page, [310, 260], [80, 260]);
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
});
