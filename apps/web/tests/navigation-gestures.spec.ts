import { test, expect, type CDPSession, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { abreTeclado } from "../lib/onboarding/abre-teclado";
import {
  comoElementoEnfocado, detenerTraza, iniciarTraza, instalarAhora, leerTraza,
  type DescriptorFoco, type VentanaConTraza, type VolcadoTraza,
} from "./helpers/view-trace";

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

async function press(page: Page, from: [number, number], to: [number, number]) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from[0], y: from[1] }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from[0] + (to[0] - from[0]) * i / 8, y: from[1] + (to[1] - from[1]) * i / 8 }] });
  }
  return cdp;
}

async function gesture(page: Page, from: [number, number], to: [number, number], cancel = false) {
  const cdp = await press(page, from, to);
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

// Painted transforms of the swipe surface and the pull indicator, after framer-motion's frame.
async function motionState(page: Page) {
  return page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const indicator = getComputedStyle(document.querySelector("div[aria-hidden]")!);
    return { swipe: getComputedStyle(document.querySelector("#surface")!.parentElement!).transform, pull: indicator.transform, pullOpacity: Number(indicator.opacity) };
  });
}

// Reads while the finger is still down, then lifts with touchcancel: no navigation, no refresh.
async function held(page: Page, from: [number, number], to: [number, number]) {
  const cdp = await press(page, from, to);
  const state = await motionState(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await cdp.detach();
  return state;
}

test("reduced motion switched while mounted stops and restores the swipe and pull motion", async ({ page }) => {
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1");
  // Both wrappers live as long as the app (days in the Android WebView): the setting has to be followed
  // while mounted. framer-motion's useReducedMotion read it once at mount and kept moving.
  const swipe: [[number, number], [number, number]] = [[310, 260], [210, 260]];
  const pull: [[number, number], [number, number]] = [[180, 70], [180, 350]];
  expect((await motionState(page)).pull).not.toBe("none");
  expect((await held(page, ...swipe)).swipe).not.toBe("none");
  expect((await held(page, ...pull)).pull).not.toBe("none");

  await page.emulateMedia({ reducedMotion: "reduce" });
  expect((await motionState(page)).pull).toBe("none");
  expect((await held(page, ...swipe)).swipe).toBe("none");
  const pulling = await held(page, ...pull);
  expect(pulling.pull).toBe("none");
  expect(pulling.pullOpacity).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  expect((await motionState(page)).pull).not.toBe("none");
  expect((await held(page, ...swipe)).swipe).not.toBe("none");
  expect(await page.evaluate(() => (window as FixtureWindow).fixture.calls)).toEqual([]);
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

// ─── Matriz de toques del detector de pestañas (BUG-AND-VIEW) ────────────────
// Red de seguridad: describe lo que hacen HOY page-swipe-wrapper.tsx y
// lib/navigation/gestures.ts ante toques quietos y derivas leves en "/", junto
// con la tolerancia de toque de Chrome de escritorio (ver TOLERANCIA_TOQUE_CHROME_PX).
// No es un contrato de producto: si un cambio la rompe, se decide con Javier.
// Correr SOLO con la configuración aislada; playwright.config.ts también recoge
// este archivo, carga .env.local y arranca pnpm dev:
//   cd apps/web && pnpm exec playwright test -c playwright.gestures.config.ts tests/navigation-gestures.spec.ts
// Cada caso deja su matriz-toque.json en su carpeta del outputDir (--output la
// cambia), también si pasa: el reporter "list" no guarda adjuntos en memoria.

type ObjetivoToque = "enlace" | "boton" | "etiqueta" | "superficie";
type DireccionToque = "quieto" | "izquierda" | "derecha" | "diagonal";
interface VarianteToque { direccion: DireccionToque; px: number }
interface Punto { x: number; y: number }
interface SenalesClic { generados: number; entregados: number; prevenido: boolean }
type MatrizWindow = Window & { __matriz: { reiniciar(): void; leer(): Promise<SenalesClic> } };
interface LecturaToque {
  /** Algún clic llegó a window en captura (Chromium lo generó). */
  generado: boolean;
  /** El clic llegó al objetivo. */
  entregado: boolean;
  /** El primer clic generado terminó con defaultPrevented. */
  prevenido: boolean;
  /** Máximo |translateX| de los ancestros del objetivo, del touchstart a 500 ms tras soltar (traza). */
  transformMaxPx: number;
  pushes: number;
  hashCambio: boolean;
  scrollY: number;
  movimientos: number;
  movimientosPrevenidos: number;
  movimientosNoCancelables: number;
  maxDxRecibido: number;
  /** abreTeclado sobre el focusin de #field, si la traza lo vio en esta repetición. */
  focoAbreTeclado: boolean | null;
}
interface EsperadoToque {
  /** Algún touchmove llega a la página: la deriva sale de la tolerancia de toque. */
  llegaMovimiento: boolean;
  /** transform distinto de none en el envoltorio de PageSwipeWrapper. */
  transform: boolean;
  /** El clic llega al objetivo: Chromium generó el tap y nadie lo canceló. */
  entregado: boolean;
  /** El detector se adueña del gesto: previene los touchmove y marca suppressClick. */
  suprime: boolean;
}

const OBJETIVOS_TOQUE: readonly ObjetivoToque[] = ["enlace", "boton", "etiqueta", "superficie"];
const VARIANTES_TOQUE: readonly VarianteToque[] = [
  { direccion: "quieto", px: 0 },
  ...[4, 8, 12, 30].map((px) => ({ direccion: "izquierda" as const, px })),
  ...[4, 8, 12, 30].map((px) => ({ direccion: "diagonal" as const, px })),
  ...[12, 30].map((px) => ({ direccion: "derecha" as const, px })),
];
const REPETICIONES_TOQUE = 5;
// Pasos de ≤ 4 px: el primer touchmove que llega a la página queda cerca del borde
// de la tolerancia, como en un dedo que se desliza poco a poco.
const PASO_MAXIMO_PX = 4;
// Medido con Chrome de escritorio e Input.dispatchTouchEvent: un touchmove a ≤ 15 px
// (distancia euclídea) del touchstart no llega a la página y el toque termina en tap
// con su clic; más allá, los touchmove llegan y Chromium ya no genera el clic, con o
// sin detector. En Android la tolerancia es de unos 8 dp, así que ahí una deriva de
// 10–15 px sí llegaría al detector: esta matriz no lo mide.
const TOLERANCIA_TOQUE_CHROME_PX = 15;
const TEXTOS_INYECTADOS = ["Enlace de prueba", "Botón de prueba", "Etiqueta de prueba"];

function desplazamiento({ direccion, px }: VarianteToque): Punto {
  if (direccion === "izquierda") return { x: -px, y: 0 };
  if (direccion === "derecha") return { x: px, y: 0 };
  // Diagonal hacia arriba: |dx| = |dy| nunca fija eje y no inicia el tirar para recargar.
  if (direccion === "diagonal") return { x: -px, y: -px };
  return { x: 0, y: 0 };
}

function esperadoToque(objetivo: ObjetivoToque, variante: VarianteToque): EsperadoToque {
  const { x, y } = desplazamiento(variante);
  // Dentro de la tolerancia el detector no ve ningún movimiento: es un toque normal.
  if (Math.hypot(x, y) <= TOLERANCIA_TOQUE_CHROME_PX) {
    return { llegaMovimiento: false, transform: false, entregado: true, suprime: false };
  }
  // El primer touchmove que llega ya pasa de 10 px, así que gestures.ts fija el eje con
  // él: x si |dx| supera 1.3 veces a |dy| (la diagonal nunca fija eje). gestures.ts
  // también excluye button en el touchstart: ni gesto ni supresión.
  const ejeX = Math.abs(x) > Math.abs(y) * 1.3;
  if (objetivo === "boton" || !ejeX) return { llegaMovimiento: true, transform: false, entregado: false, suprime: false };
  // page-swipe-wrapper.tsx previene el movimiento y marca suppressClick. En "/" solo hay
  // página vecina a la izquierda (dx < 0); hacia la derecha el transform queda en 0.
  return { llegaMovimiento: true, transform: x < 0, entregado: false, suprime: true };
}

// Enlace, botón y label dentro de #surface (alto fijo de 500 px): no mueven las
// coordenadas de las pruebas de arriba. Sin aria-hidden: motionState busca div[aria-hidden].
async function inyectarObjetivos(page: Page) {
  await page.evaluate((textos) => {
    const superficie = document.querySelector<HTMLElement>("#surface");
    if (!superficie) throw new Error("Falta #surface en el fixture");
    superficie.dataset.matrizObjetivo = "superficie";
    const caja = document.createElement("div");
    caja.dataset.matrizCaja = "";
    caja.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:24px;padding-top:24px";
    const enlace = document.createElement("a");
    enlace.href = "#destino";
    enlace.textContent = textos[0]!;
    enlace.dataset.matrizObjetivo = "enlace";
    enlace.style.cssText = "display:block;width:220px;height:56px;line-height:56px;text-align:center";
    const boton = document.createElement("button");
    boton.type = "button";
    boton.textContent = textos[1]!;
    boton.dataset.matrizObjetivo = "boton";
    boton.style.cssText = "display:block;width:220px;height:56px";
    const etiqueta = document.createElement("label");
    etiqueta.dataset.matrizObjetivo = "etiqueta";
    etiqueta.style.cssText = "display:flex;align-items:center;gap:8px;width:220px;height:56px";
    const casilla = document.createElement("input");
    casilla.type = "checkbox";
    const texto = document.createElement("span");
    texto.textContent = textos[2]!;
    texto.dataset.matrizToque = "";
    texto.style.cssText = "flex:1;height:56px;line-height:56px";
    etiqueta.append(casilla, texto);
    caja.append(enlace, boton, etiqueta);
    superficie.append(caja);
  }, TEXTOS_INYECTADOS);
}

async function puntoDeToque(page: Page, objetivo: ObjetivoToque): Promise<Punto> {
  const caja = objetivo === "superficie"
    ? await page.evaluate(() => {
      // Zona vacía de #surface, debajo de lo inyectado.
      const superficie = document.querySelector("#surface")!.getBoundingClientRect();
      const ocupado = document.querySelector("[data-matriz-caja]")!.getBoundingClientRect();
      const top = ocupado.bottom + 20;
      return { x: superficie.left + 40, y: top, width: superficie.width - 80, height: superficie.bottom - 20 - top };
    })
    : await page.locator(objetivo === "etiqueta" ? "[data-matriz-toque]" : `[data-matriz-objetivo="${objetivo}"]`).boundingBox();
  if (!caja || caja.height <= 0) throw new Error(`Sin zona para tocar ${objetivo}`);
  const punto = { x: Math.round(caja.x + caja.width / 2), y: Math.round(caja.y + caja.height / 2) };
  // EDGE_GUARD_PX (20) más la deriva máxima (30): el toque nunca empieza en el borde.
  const ancho = page.viewportSize()?.width ?? 390;
  expect(punto.x).toBeGreaterThanOrEqual(50);
  expect(punto.x).toBeLessThanOrEqual(ancho - 50);
  return punto;
}

async function instrumentarClics(page: Page, objetivo: ObjetivoToque) {
  await page.evaluate((selector) => {
    const destino = document.querySelector(selector);
    if (!destino) throw new Error(`Falta el objetivo ${selector}`);
    let generados = 0;
    let entregados = 0;
    let primero: Event | null = null;
    // Clic generado: window lo ve en captura antes que el envoltorio.
    window.addEventListener("click", (evento) => { generados += 1; if (!primero) primero = evento; }, true);
    // Clic entregado: llegó al objetivo (el envoltorio lo detiene antes, en captura).
    destino.addEventListener("click", () => { entregados += 1; });
    (window as unknown as MatrizWindow).__matriz = {
      reiniciar: () => { generados = 0; entregados = 0; primero = null; },
      // defaultPrevented se lee cuando el despacho terminó.
      leer: () => new Promise((resolve) => setTimeout(() => resolve({
        generados, entregados, prevenido: (primero as Event | null)?.defaultPrevented === true,
      }), 0)),
    };
  }, `[data-matriz-objetivo="${objetivo}"]`);
}

async function tocar(cdp: CDPSession, desde: Punto, delta: Punto) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: desde.x, y: desde.y }] });
  const pasos = Math.ceil(Math.max(Math.abs(delta.x), Math.abs(delta.y)) / PASO_MAXIMO_PX);
  for (let paso = 1; paso <= pasos; paso++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove", touchPoints: [{ x: desde.x + delta.x * paso / pasos, y: desde.y + delta.y * paso / pasos }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

/** Espera a que window.scrollY no cambie en 3 frames (un fling puede seguir tras soltar). */
async function quietud(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let previo = Number.NaN;
    let quietos = 0;
    const limite = performance.now() + 2000;
    const cuadro = () => {
      quietos = window.scrollY === previo ? quietos + 1 : 0;
      previo = window.scrollY;
      if (quietos >= 3 || performance.now() > limite) resolve();
      else requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  }));
}

async function esperarTransformDeLaTraza(page: Page) {
  // La traza emite "transform" 500 ms después del touchend: es la ventana de cada repetición.
  await page.waitForFunction(() => (window as VentanaConTraza).__vicinoViewTrace!.dump().includes('"tipo":"transform"'), undefined, { timeout: 5000 });
}

function resumirTraza(volcado: VolcadoTraza) {
  const inicio = volcado.eventos.find((evento) => evento.tipo === "touchstart");
  const x0 = typeof inicio?.x === "number" ? inicio.x : 0;
  const movimientos = volcado.eventos.filter((evento) => evento.tipo === "touchmove");
  const desplazamientos = volcado.eventos
    .filter((evento) => evento.tipo === "transform")
    .flatMap((evento) => (evento.ancestros as Array<{ maxTx: number | null }>).map((ancestro) => ancestro.maxTx ?? 0));
  const foco = volcado.eventos.find((evento) => evento.tipo === "focusin"
    && (evento.objetivo as DescriptorFoco).tag === "input" && (evento.objetivo as DescriptorFoco).type === "text");
  return {
    transformMaxPx: Math.max(0, ...desplazamientos),
    movimientos: movimientos.length,
    movimientosPrevenidos: movimientos.filter((evento) => evento.defaultPrevented === true).length,
    movimientosNoCancelables: movimientos.filter((evento) => evento.cancelable !== true).length,
    maxDxRecibido: Math.max(0, ...movimientos.map((evento) => Math.abs((typeof evento.x === "number" ? evento.x : x0) - x0))),
    focoAbreTeclado: foco ? abreTeclado(comoElementoEnfocado(foco.objetivo as DescriptorFoco)) : null,
  };
}

async function repetirToque(page: Page, cdp: CDPSession, punto: Punto, delta: Punto, conFoco: boolean): Promise<LecturaToque> {
  // Entre repeticiones: scroll a 0 y hash limpio. La vuelta de 160 ms ya terminó
  // dentro de la ventana de 500 ms de la repetición anterior.
  await quietud(page);
  await page.evaluate(() => { if (location.hash) location.hash = ""; window.scrollTo(0, 0); });
  await quietud(page);
  const antes = await page.evaluate((enfocar) => {
    (window as unknown as MatrizWindow).__matriz.reiniciar();
    (window as VentanaConTraza).__vicinoViewTrace!.clear();
    if (enfocar) document.querySelector<HTMLInputElement>("#field")!.focus({ preventScroll: true });
    return { pushes: (window as unknown as FixtureWindow).fixture.calls.filter((call) => call.type === "push").length, hash: location.hash };
  }, conFoco);
  await tocar(cdp, punto, delta);
  await esperarTransformDeLaTraza(page);
  const senales = await page.evaluate(() => (window as unknown as MatrizWindow).__matriz.leer());
  const despues = await page.evaluate(() => ({
    pushes: (window as unknown as FixtureWindow).fixture.calls.filter((call) => call.type === "push").length,
    hash: location.hash,
    scrollY: Math.round(window.scrollY),
  }));
  return {
    generado: senales.generados > 0,
    entregado: senales.entregados > 0,
    prevenido: senales.prevenido,
    pushes: despues.pushes - antes.pushes,
    hashCambio: despues.hash !== antes.hash,
    scrollY: despues.scrollY,
    ...resumirTraza(await leerTraza(page)),
  };
}

const clasificar = (lectura: LecturaToque) => ({
  generado: lectura.generado,
  entregado: lectura.entregado,
  prevenido: lectura.prevenido,
  transform: lectura.transformMaxPx > 0.5,
  pushes: lectura.pushes,
  hashCambio: lectura.hashCambio,
});

async function contarEscuchas(cdp: CDPSession) {
  const conteo: Record<string, number> = {};
  for (const [nombre, expresion] of [["window", "window"], ["document", "document"], ["visualViewport", "window.visualViewport"]] as const) {
    const { result } = await cdp.send("Runtime.evaluate", { expression: expresion });
    if (!result.objectId) throw new Error(`Sin objeto remoto para ${expresion}`);
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId });
    conteo[nombre] = listeners.length;
    await cdp.send("Runtime.releaseObject", { objectId: result.objectId });
  }
  return conteo;
}

test.describe("matriz de toques del detector de pestañas", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  test.skip(process.env.VICINO_GESTURE_BASELINE === "1", "describe el detector actual, no la línea base");

  for (const objetivo of OBJETIVOS_TOQUE) {
    for (const variante of VARIANTES_TOQUE) {
      for (const conFoco of [false, true]) {
        const esperado = esperadoToque(objetivo, variante);
        test(`${objetivo} · ${variante.direccion} ${variante.px} px${conFoco ? " · con #field enfocado" : ""}`, async ({ page }, info) => {
          await inyectarObjetivos(page);
          await instrumentarClics(page, objetivo);
          await instalarAhora(page);
          expect(await iniciarTraza(page)).toBe(true);
          const punto = await puntoDeToque(page, objetivo);
          const delta = desplazamiento(variante);
          const cdp = await page.context().newCDPSession(page);
          const lecturas: LecturaToque[] = [];
          try {
            for (let repeticion = 0; repeticion < REPETICIONES_TOQUE; repeticion++) {
              lecturas.push(await repetirToque(page, cdp, punto, delta, conFoco));
            }
          } finally {
            await cdp.detach();
            // A disco antes de las aserciones, también con lecturas parciales si una
            // repetición lanzó: el registro queda aunque la prueba pase o falle.
            const registro = info.outputPath("matriz-toque.json");
            await writeFile(registro, JSON.stringify({ objetivo, variante, conFoco, punto, esperado, lecturas }, null, 2));
            await info.attach("matriz-toque.json", { path: registro, contentType: "application/json" });
          }
          const clases = lecturas.map(clasificar);
          for (const clase of clases.slice(1)) expect(clase, "las 5 repeticiones se clasifican igual").toEqual(clases[0]);
          for (const lectura of lecturas) {
            const detalle = JSON.stringify(lectura);
            expect(lectura.pushes, `sin navegación: ${detalle}`).toBe(0);
            // Si esto falla, cambió la tolerancia de toque del navegador, no el detector.
            expect(lectura.movimientos > 0, `touchmove que llegan a la página (tolerancia de ${TOLERANCIA_TOQUE_CHROME_PX} px): ${detalle}`)
              .toBe(esperado.llegaMovimiento);
            expect(lectura.movimientosPrevenidos > 0, `el detector previene el movimiento: ${detalle}`).toBe(esperado.suprime);
            expect(lectura.transformMaxPx > 0.5, `transform del envoltorio: ${detalle}`).toBe(esperado.transform);
            expect(lectura.entregado, `clic entregado: ${detalle}`).toBe(esperado.entregado);
            if (esperado.suprime) {
              if (lectura.generado) expect(lectura.prevenido, `el envoltorio cancela el clic: ${detalle}`).toBe(true);
            } else {
              expect(lectura.generado && !lectura.entregado, `el envoltorio no cancela el clic: ${detalle}`).toBe(false);
            }
            expect(lectura.hashCambio, `el hash solo cambia si el enlace recibió el clic: ${detalle}`)
              .toBe(objetivo === "enlace" && lectura.entregado);
          }
          // El foco en un campo no cambia el detector; la traza lo ve y abreTeclado lo reconoce.
          if (conFoco) expect(lecturas[0]!.focoAbreTeclado, "focusin de #field en la traza").toBe(true);
        });
      }
    }
  }

  test("la traza no escucha nada antes de start(), start() es idempotente y stop() retira todo", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    try {
      const base = await contarEscuchas(cdp);
      await instalarAhora(page);
      expect(await contarEscuchas(cdp), "instalada pero apagada").toEqual(base);
      expect(await iniciarTraza(page)).toBe(true);
      const encendida = await contarEscuchas(cdp);
      for (const nombre of ["window", "document", "visualViewport"]) expect(encendida[nombre]!, nombre).toBeGreaterThan(base[nombre]!);
      expect(await iniciarTraza(page)).toBe(true);
      expect(await contarEscuchas(cdp), "un segundo start no duplica").toEqual(encendida);
      await detenerTraza(page);
      expect(await contarEscuchas(cdp), "stop retira todo").toEqual(base);
    } finally {
      await cdp.detach();
    }
  });

  test("la traza no guarda textos, ids, enlaces ni partes de la URL", async ({ page }) => {
    await inyectarObjetivos(page);
    await instalarAhora(page);
    expect(await iniciarTraza(page)).toBe(true);
    const cdp = await page.context().newCDPSession(page);
    try {
      for (const objetivo of OBJETIVOS_TOQUE) {
        await tocar(cdp, await puntoDeToque(page, objetivo), { x: 0, y: 0 });
        await page.waitForTimeout(350); // toques separados: que Chromium no los junte como doble toque
      }
      await page.evaluate(() => document.querySelector<HTMLInputElement>("#field")!.focus());
      await tocar(cdp, await puntoDeToque(page, "superficie"), { x: -30, y: 0 });
    } finally {
      await cdp.detach();
    }
    await esperarTransformDeLaTraza(page);
    await page.waitForTimeout(1100); // sondas de blanco tras el último toque
    expect(await page.evaluate(() => location.hash), "el enlace sí navegó al fragmento").toBe("#destino");
    const json = await page.evaluate(() => (window as VentanaConTraza).__vicinoViewTrace!.dump());
    const prohibidos = [...TEXTOS_INYECTADOS, "Gesture surface", "Native carousel", "Native vertical scroll",
      "destino", "matriz", "surface", "carousel", "field", "#", "?"];
    for (const prohibido of prohibidos) expect(json.includes(prohibido), `la traza contiene "${prohibido}"`).toBe(false);
    const volcado = JSON.parse(json) as VolcadoTraza;
    for (const tipo of ["inicio", "touchstart", "touchmove", "touchend", "clic", "focusin", "transform"]) {
      expect(volcado.eventos.some((evento) => evento.tipo === tipo), tipo).toBe(true);
    }
    expect(volcado.errores).toBe(0);
  });

  test("con la traza encendida, el swipe intencional de 230 px sigue navegando", async ({ page }) => {
    await instalarAhora(page);
    expect(await iniciarTraza(page)).toBe(true);
    await gesture(page, [310, 260], [80, 260]);
    await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).fixture.calls.filter((call) => call.type === "push").length)).toBe(1);
    await esperarTransformDeLaTraza(page);
    const volcado = await leerTraza(page);
    expect(resumirTraza(volcado).transformMaxPx).toBeGreaterThan(0);
    expect(volcado.errores).toBe(0);
  });
});
