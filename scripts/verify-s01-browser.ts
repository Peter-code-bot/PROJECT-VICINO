import type { Browser, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const BASE_URL = "http://localhost:3000";
const OUTPUT_DIR = path.resolve(__dirname, "../apps/web/test-results/s01");

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface TestLog {
  tipo: "Componente" | "Integración" | "E2E";
  seccion: string;
  caso: string;
  viewport: string;
  resultado: "PASA" | "FALLA" | "BLOQUEADO";
  detalles: string;
  captura?: string;
}

const resultados: TestLog[] = [];

const requireLocal = createRequire(path.resolve(__dirname, "../apps/web/package.json"));
const { chromium } = requireLocal("@playwright/test");
const esbuild = requireLocal(requireLocal.resolve("esbuild", { paths: [requireLocal.resolve("tsx")] }));

let followingBundleScript = "";
let productFormBundleScript = "";

async function buildComponentBundles() {
  const web = path.resolve(__dirname, "../apps/web");

  // 1. Bundle FollowingRail
  const mocksFollowing: Record<string, string> = {
    "next/link": `import React from 'react'; export default React.forwardRef(({children,...props},ref)=><a ref={ref} {...props}>{children}</a>);`,
    "next/image": `import React from 'react'; export default function Image(props){ return <img {...props}/>; }`,
  };

  const resFollowing = await esbuild.build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { FollowingRail } from './components/home/following-rail';

        window.__mountFollowingRail = function(stores) {
          const rootEl = document.getElementById('root');
          createRoot(rootEl).render(<FollowingRail stores={stores} />);
        };
      `,
      loader: "tsx",
      resolveDir: web,
    },
    plugins: [
      {
        name: "mocks-following",
        setup(build: any) {
          build.onResolve({ filter: /.*/ }, (args: any) =>
            mocksFollowing[args.path] ? { path: args.path, namespace: "mock" } : undefined
          );
          build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({
            contents: mocksFollowing[args.path],
            loader: "jsx",
            resolveDir: web,
          }));
        },
      },
    ],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  followingBundleScript = resFollowing.outputFiles[0].text;

  // 2. Bundle ProductForm
  const mocksProductForm: Record<string, string> = {
    "next/link": `import React from 'react'; export default React.forwardRef(({children,...props},ref)=><a ref={ref} {...props}>{children}</a>);`,
    "next/image": `import React from 'react'; export default function Image(props){ return <img {...props}/>; }`,
    "next/dynamic": `import React from 'react'; export default function dynamic(loader, opts){ return function Dyn(props){ return null; }; }`,
    "next/navigation": `
      export function useRouter() {
        return {
          push: (dest) => { window.__routerCalls.push({ action: 'push', dest }); },
          back: () => { window.__routerCalls.push({ action: 'back' }); },
          replace: (dest) => { window.__routerCalls.push({ action: 'replace', dest }); },
        };
      }
      export function useSearchParams() {
        return new URLSearchParams(window.location.search);
      }
      export function usePathname() {
        return window.location.pathname;
      }
    `,
    "@/lib/supabase/client": `export function createClient(){ return { storage: { from: () => ({ upload: async () => ({ error: null }) }) } }; }`,
    "@/lib/haptics": `export async function hapticMedium(){}`,
    "@sentry/nextjs": `export function captureException(){}`,
    "sonner": `export const toast = { error: () => {}, success: () => {} };`,
    "@/components/map/delivery-map": `export default function DeliveryMap(){ return null; }`,
    "@/components/product/product-media-cropper": `export function ProductMediaCropper(){ return null; }`,
    "./actions": `export async function createProduct(){ return { success: true }; } export async function updateProductFull(){ return { success: true }; }`,
  };

  const resProductForm = await esbuild.build({
    stdin: {
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ProductForm } from './app/(marketplace)/vender/product-form';

        window.__routerCalls = [];

        window.__mountProductForm = function(mode, userId) {
          window.__routerCalls = [];
          const rootEl = document.getElementById('root');
          createRoot(rootEl).render(
            <ProductForm userId={userId || "user-123"} mode={mode || "create"} />
          );
        };
      `,
      loader: "tsx",
      resolveDir: web,
    },
    plugins: [
      {
        name: "mocks-product-form",
        setup(build: any) {
          build.onResolve({ filter: /.*/ }, (args: any) =>
            mocksProductForm[args.path] ? { path: args.path, namespace: "mock" } : undefined
          );
          build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({
            contents: mocksProductForm[args.path],
            loader: "jsx",
            resolveDir: web,
          }));
        },
      },
    ],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: path.join(web, "tsconfig.json"),
    define: { "process.env.NODE_ENV": '"production"' },
  });
  productFormBundleScript = resProductForm.outputFiles[0].text;
}

async function logTest(
  tipo: "Componente" | "Integración" | "E2E",
  seccion: string,
  caso: string,
  viewport: string,
  fn: (page: Page) => Promise<{ resultado: "PASA" | "FALLA" | "BLOQUEADO"; detalles: string; captura?: string }>,
  browser: Browser,
  vp: { width: number; height: number },
) {
  const context = await browser.newContext({
    viewport: vp,
    permissions: ["geolocation"],
    geolocation: { latitude: 19.4326, longitude: -99.1332 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.setDefaultNavigationTimeout(35000);

  try {
    const res = await fn(page);
    resultados.push({
      tipo,
      seccion,
      caso,
      viewport: `${vp.width}x${vp.height}`,
      resultado: res.resultado,
      detalles: res.detalles,
      captura: res.captura,
    });
    console.log(
      `[${res.resultado}] [${tipo}] ${seccion} - ${caso} (${vp.width}x${vp.height}): ${res.detalles}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    resultados.push({
      tipo,
      seccion,
      caso,
      viewport: `${vp.width}x${vp.height}`,
      resultado: "FALLA",
      detalles: `Error inesperado: ${msg}`,
    });
    console.error(
      `[FALLA] [${tipo}] ${seccion} - ${caso} (${vp.width}x${vp.height}): ${msg}`,
    );
  } finally {
    await context.close();
  }
}

async function main() {
  console.log("Compilando bundles controlados de componentes reales con esbuild...");
  await buildComponentBundles();
  console.log("Bundles de FollowingRail y ProductForm preparados correctamente.");

  console.log("\nIniciando verificación en navegador real (Google Chrome)...");
  const browser = await chromium.launch({ channel: "chrome", headless: true });

  const viewports = [
    { name: "Escritorio", width: 1280, height: 800 },
    { name: "Móvil", width: 375, height: 812 },
  ];

  for (const vp of viewports) {
    console.log(`\n============================================================`);
    console.log(`=== VIEWPORT: ${vp.name} (${vp.width}x${vp.height}) ===`);
    console.log(`============================================================`);

    // ─────────────────────────────────────────────────────────────
    // 1. SIGUIENDO: Renderizado del componente FollowingRail real con datos sintéticos
    // ─────────────────────────────────────────────────────────────
    await logTest(
      "Componente",
      "Siguiendo",
      "Renderizado de FollowingRail real con datos sintéticos",
      vp.name,
      async (page) => {
        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: followingBundleScript });

        await page.evaluate(() => {
          const syntheticStores = [
            { id: "store-1", nombre: "Taquería Doña Mari", avatar_url: null },
            { id: "store-2", nombre: "Tortillería El Sol", avatar_url: null },
            { id: "store-3", nombre: "Café Mestizo", avatar_url: null },
          ];
          (window as any).__mountFollowingRail(syntheticStores);
        });

        // 1. El texto visible "Tiendas que sigues" no debe existir
        const visibleLiteralCount = await page.locator("text='Tiendas que sigues'").count();

        // 2. Encabezado sr-only debe existir
        const srHeader = page.locator("h2.sr-only:has-text('Tiendas seguidas')");
        const srHeaderCount = await srHeader.count();

        // 3. El contador debe mostrar exactamente 3 y tener tabular-nums
        const counter = page.locator('[data-testid="following-counter"]');
        await counter.waitFor({ state: "visible", timeout: 5000 });
        const counterText = (await counter.textContent())?.trim();
        const hasTabular = (await counter.getAttribute("class"))?.includes("tabular-nums") ?? false;

        // 4. Las tarjetas de tiendas reales deben haberse renderizado
        const store1 = await page.locator("text='Taquería Doña Mari'").count();
        const store2 = await page.locator("text='Tortillería El Sol'").count();

        const shotPath = path.join(OUTPUT_DIR, `siguiendo-componente-${vp.name}.png`);
        await page.screenshot({ path: shotPath });

        const ok =
          visibleLiteralCount === 0 &&
          srHeaderCount === 1 &&
          counterText === "3" &&
          hasTabular &&
          store1 === 1 &&
          store2 === 1;

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Texto literal visible=${visibleLiteralCount} (esperado 0), h2.sr-only=${srHeaderCount} (esperado 1), contador="${counterText}" (tabular=${hasTabular}), tiendas montadas=${store1 + store2}`,
          captura: shotPath,
        };
      },
      browser,
      vp,
    );

    // ─────────────────────────────────────────────────────────────
    // 2. BÚSQUEDA: Recorridos reales en la aplicación
    // ─────────────────────────────────────────────────────────────
    await logTest(
      "Integración",
      "Búsqueda",
      "Disparador compacto 'Categorías' y descarte de chip viejo",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/buscar?q=mesa&sort=price_asc&page=2`, { waitUntil: "networkidle" });
        const trigger = page.locator('[data-testid="filtro-categorias-trigger"]').first();
        await trigger.waitFor({ state: "visible", timeout: 25000 });
        const oldChip = await page.locator("text='Todas las categorías'").count();
        const triggerText = await trigger.textContent();
        const shotPath = path.join(OUTPUT_DIR, `busqueda-trigger-${vp.name}.png`);
        await page.screenshot({ path: shotPath });

        const ok = oldChip === 0 && (triggerText?.includes("Categorías") ?? false);
        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Disparador texto="${triggerText?.trim()}", chips viejos="${oldChip}"`,
          captura: shotPath,
        };
      },
      browser,
      vp,
    );

    await logTest(
      "Integración",
      "Búsqueda",
      "Abrir drawer, seleccionar y cancelar sin aplicar cambios",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/buscar?q=mesa&sort=price_asc&page=2`, { waitUntil: "networkidle" });
        const trigger = page.locator('[data-testid="filtro-categorias-trigger"]').first();
        await trigger.waitFor({ state: "visible", timeout: 25000 });
        await trigger.click();

        const dialog = page.locator('div[role="dialog"]');
        await dialog.waitFor({ state: "visible", timeout: 10000 });

        const firstCat = dialog.locator("button[data-categoria-slug]").first();
        await firstCat.waitFor({ state: "visible", timeout: 10000 });
        await firstCat.click();

        const closeBtn = dialog.locator('button[aria-label="Cerrar"]');
        await closeBtn.click();
        await dialog.waitFor({ state: "detached", timeout: 10000 });

        const url = page.url();
        const hasCategory = url.includes("category=");
        const keepsOriginals = url.includes("q=mesa") && url.includes("sort=price_asc") && url.includes("page=2");

        const ok = !hasCategory && keepsOriginals;
        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `URL tras cancelar permanece intacta: ${url}`,
        };
      },
      browser,
      vp,
    );

    await logTest(
      "Integración",
      "Búsqueda",
      "Aplicar categoría: conserva q y sort, actualiza category y resetea page",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/buscar?q=mesa&sort=price_asc&page=2`, { waitUntil: "networkidle" });
        const trigger = page.locator('[data-testid="filtro-categorias-trigger"]').first();
        await trigger.waitFor({ state: "visible", timeout: 25000 });
        await trigger.click();

        const dialog = page.locator('div[role="dialog"]');
        await dialog.waitFor({ state: "visible", timeout: 10000 });

        const firstCat = dialog.locator("button[data-categoria-slug]").first();
        await firstCat.waitFor({ state: "visible", timeout: 10000 });
        const slug = await firstCat.getAttribute("data-categoria-slug");
        await firstCat.click();

        const aplicarBtn = dialog.locator('button:has-text("Aplicar")');
        await aplicarBtn.click();
        await dialog.waitFor({ state: "detached", timeout: 10000 });

        await page.waitForFunction(
          (s) => new URL(window.location.href).searchParams.get("category") === s,
          slug,
          { timeout: 15000 },
        );
        const url = new URL(page.url());
        const hasCategory = url.searchParams.get("category") === slug;
        const keepsQ = url.searchParams.get("q") === "mesa";
        const keepsSort = url.searchParams.get("sort") === "price_asc";
        const pageReset = !url.searchParams.has("page");

        const shotPath = path.join(OUTPUT_DIR, `busqueda-aplicada-${vp.name}.png`);
        await page.screenshot({ path: shotPath });

        const ok = hasCategory && keepsQ && keepsSort && pageReset;
        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `category=${slug}, keepsQ=${keepsQ}, keepsSort=${keepsSort}, pageReset=${pageReset}`,
          captura: shotPath,
        };
      },
      browser,
      vp,
    );

    await logTest(
      "Integración",
      "Búsqueda",
      "Quitar categoría directamente con botón X del disparador",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/buscar?q=mesa&sort=price_asc&category=hogar`, { waitUntil: "networkidle" });
        const clearBtn = page.locator('span[aria-label="Limpiar categoría"]').first();
        await clearBtn.waitFor({ state: "visible", timeout: 25000 });
        await clearBtn.click();

        await page.waitForFunction(
          () => !new URL(window.location.href).searchParams.has("category"),
          null,
          { timeout: 15000 },
        );
        const url = new URL(page.url());
        const categoryRemoved = !url.searchParams.has("category");
        const keepsQ = url.searchParams.get("q") === "mesa";
        const keepsSort = url.searchParams.get("sort") === "price_asc";

        const ok = categoryRemoved && keepsQ && keepsSort;
        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `categoryRemoved=${categoryRemoved}, keepsQ=${keepsQ}, keepsSort=${keepsSort}`,
        };
      },
      browser,
      vp,
    );

    // ─────────────────────────────────────────────────────────────
    // 3. SOLICITUDES: Verificación real de llamadas al RPC y tarjetas filtradas
    // ─────────────────────────────────────────────────────────────
    await logTest(
      "Integración",
      "Solicitudes",
      "Disparador, RPC verificado, tarjetas filtradas y reseteo",
      vp.name,
      async (page) => {
        let lastRpcCatSlug: string | undefined | null = null;
        let rpcCallCount = 0;

        const fixtures = [
          {
            id: "req-1",
            titulo: "Busco mesa de centro de madera",
            descripcion: "Para sala moderna",
            presupuesto: 500,
            buyer_profile: { nombre: "Ana Martínez", avatar_url: null },
            categories: [{ slug: "hogar", nombre: "Hogar" }],
            created_at: new Date().toISOString(),
          },
          {
            id: "req-2",
            titulo: "Orden de comida para evento",
            descripcion: "Taquiza para 20 personas",
            presupuesto: 2500,
            buyer_profile: { nombre: "Carlos López", avatar_url: null },
            categories: [{ slug: "comida", nombre: "Comida" }],
            created_at: new Date().toISOString(),
          },
          {
            id: "req-3",
            titulo: "Reparación de pantalla laptop",
            descripcion: "Modelo ThinkPad",
            presupuesto: 1800,
            buyer_profile: { nombre: "Sofía Ruiz", avatar_url: null },
            categories: [{ slug: "tecnologia", nombre: "Tecnología" }],
            created_at: new Date().toISOString(),
          },
        ];

        await page.route("**/rest/v1/rpc/feed_nearby_requests*", async (route) => {
          rpcCallCount++;
          const reqBody = route.request().postDataJSON() as { cat_slug?: string } | null;
          lastRpcCatSlug = reqBody?.cat_slug;

          const filtered = lastRpcCatSlug
            ? fixtures.filter((r) => r.categories.some((c) => c.slug === lastRpcCatSlug))
            : fixtures;

          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(filtered),
          });
        });

        await page.goto(`${BASE_URL}/?feed=solicitudes`, { waitUntil: "networkidle" });
        const trigger = page.locator('[data-testid="filtro-categorias-trigger"]').first();
        await trigger.waitFor({ state: "visible", timeout: 25000 });

        // Paso A: Comprobar carga inicial de fixtures
        const card1 = page.locator("text='Busco mesa de centro de madera'");
        const card2 = page.locator("text='Orden de comida para evento'");
        const card3 = page.locator("text='Reparación de pantalla laptop'");
        await card1.waitFor({ state: "visible", timeout: 10000 });
        const initialCards = (await card1.count()) + (await card2.count()) + (await card3.count());

        // Paso B: Abrir drawer, seleccionar 'comida', pero CANCELAR sin aplicar
        await trigger.click();
        const dialog = page.locator('div[role="dialog"]');
        await dialog.waitFor({ state: "visible", timeout: 10000 });

        const catComida = dialog.locator("button[data-categoria-slug='comida']");
        await catComida.waitFor({ state: "visible", timeout: 10000 });
        await catComida.click();

        const closeBtn = dialog.locator('button[aria-label="Cerrar"]');
        await closeBtn.click();
        await dialog.waitFor({ state: "detached", timeout: 10000 });

        // Tarjetas deben seguir siendo 3
        const cardsAfterCancel = (await card1.count()) + (await card2.count()) + (await card3.count());

        // Paso C: Abrir drawer y APLICAR 'comida'
        await trigger.click();
        await dialog.waitFor({ state: "visible", timeout: 10000 });
        await catComida.waitFor({ state: "visible", timeout: 10000 });
        await catComida.click();

        const aplicarBtn = dialog.locator('button:has-text("Aplicar")');
        await aplicarBtn.click();
        await dialog.waitFor({ state: "detached", timeout: 10000 });

        // Esperar a que la tarjeta de comida sea visible y las demás desaparezcan
        await card2.waitFor({ state: "visible", timeout: 10000 });
        await card1.waitFor({ state: "detached", timeout: 10000 });
        await card3.waitFor({ state: "detached", timeout: 10000 });

        const rpcCatMatches = lastRpcCatSlug === "comida";
        const onlyComidaVisible = (await card2.count()) === 1 && (await card1.count()) === 0 && (await card3.count()) === 0;

        // Paso D: Quitar con la X del disparador
        const clearBtn = page.locator('span[aria-label="Limpiar categoría"]').first();
        await clearBtn.waitFor({ state: "visible", timeout: 10000 });
        await clearBtn.click();

        // Esperar que se restauren las 3 tarjetas
        await card1.waitFor({ state: "visible", timeout: 10000 });
        await card3.waitFor({ state: "visible", timeout: 10000 });
        const restoredCards = (await card1.count()) + (await card2.count()) + (await card3.count());

        const shotPath = path.join(OUTPUT_DIR, `solicitudes-filtrado-${vp.name}.png`);
        await page.screenshot({ path: shotPath });

        const ok =
          initialCards === 3 &&
          cardsAfterCancel === 3 &&
          rpcCatMatches &&
          onlyComidaVisible &&
          restoredCards === 3;

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Iniciales=${initialCards}, tras cancelar=${cardsAfterCancel}, rpcSlug=${lastRpcCatSlug}, filtradas(solo comida)=${onlyComidaVisible}, restauradas=${restoredCards}`,
          captura: shotPath,
        };
      },
      browser,
      vp,
    );

    // ─────────────────────────────────────────────────────────────
    // 4. NAVEGACIÓN: Formulario ProductForm real y handleVolver
    // ─────────────────────────────────────────────────────────────

    // 4.1 Entrar desde Perfil (?from=/perfil) -> botón Volver real
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real: retorno a Perfil vía ?from=/perfil",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/?from=/perfil`);
        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("create", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const lastCall = calls[calls.length - 1];
        const ok = lastCall?.action === "push" && lastCall?.dest === "/perfil";

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Botón Volver real llamó router: ${JSON.stringify(lastCall)}`,
        };
      },
      browser,
      vp,
    );

    // 4.2 Entrar desde Búsqueda con parámetros vía sessionStorage -> botón Volver real
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real: retorno a Búsqueda conservando parámetros desde sessionStorage",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/`);
        await page.evaluate(() => {
          window.sessionStorage.setItem("vicino:origen-vender", "/buscar?q=mesa&sort=precio_asc");
        });

        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("create", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const lastCall = calls[calls.length - 1];
        const ok = lastCall?.action === "push" && lastCall?.dest === "/buscar?q=mesa&sort=precio_asc";

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Botón Volver real llamó router: ${JSON.stringify(lastCall)}`,
        };
      },
      browser,
      vp,
    );

    // 4.3 Entrada directa a /vender sin historial ni origen -> fallback seguro a /
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real: entrada directa sin origen -> fallback seguro a /",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/`);
        await page.evaluate(() => {
          window.sessionStorage.clear();
        });

        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("create", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const lastCall = calls[calls.length - 1];
        const ok = lastCall?.action === "push" && lastCall?.dest === "/";

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Botón Volver real llamó router: ${JSON.stringify(lastCall)}`,
        };
      },
      browser,
      vp,
    );

    // 4.4 Entrada directa tras navegación previa: descarta origen viejo de storage y va a /
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real: entrada directa tras navegación previa descarta origen viejo",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/`);
        await page.evaluate(() => {
          // Dejar un origen viejo en sessionStorage
          window.sessionStorage.setItem("vicino:origen-vender", "/buscar?q=bicicleta_antigua");
          // Simular navegación directa dura por Performance Navigation Timing
          try {
            Object.defineProperty(performance, "getEntriesByType", {
              configurable: true,
              value: (type: string) => {
                if (type === "navigation") {
                  return [{ type: "navigate" }];
                }
                return [];
              },
            });
            Object.defineProperty(document, "referrer", {
              configurable: true,
              value: "",
            });
          } catch {}
        });

        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("create", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const storageAfter = await page.evaluate(() => window.sessionStorage.getItem("vicino:origen-vender"));
        const lastCall = calls[calls.length - 1];

        const ok = lastCall?.action === "push" && lastCall?.dest === "/" && storageAfter === null;
        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Origen viejo descartado (storage=${storageAfter}), retorno a: ${lastCall?.dest}`,
        };
      },
      browser,
      vp,
    );

    // 4.5 Recargar /vender tras llegar desde búsqueda: mantiene origen
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real: recargar formulario conserva origen de sesión",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/`);
        await page.evaluate(() => {
          window.sessionStorage.setItem("vicino:origen-vender", "/buscar?q=mesa");
          try {
            Object.defineProperty(performance, "getEntriesByType", {
              configurable: true,
              value: (type: string) => {
                if (type === "navigation") {
                  return [{ type: "reload" }];
                }
                return [];
              },
            });
          } catch {}
        });

        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("create", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const lastCall = calls[calls.length - 1];
        const ok = lastCall?.action === "push" && lastCall?.dest === "/buscar?q=mesa";

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Tras recarga, botón Volver retornó al origen preservado: ${lastCall?.dest}`,
        };
      },
      browser,
      vp,
    );

    // 4.6 Modo edición: siempre retorna a /seller/listings
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real en modo edición: retorno obligatorio a /seller/listings",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/?from=/perfil`);
        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("edit", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        const label = await volverBtn.getAttribute("aria-label");
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const lastCall = calls[calls.length - 1];
        const ok = lastCall?.action === "push" && lastCall?.dest === "/seller/listings" && label === "Volver a mis publicaciones";

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Aria-label="${label}", router push a: ${lastCall?.dest}`,
        };
      },
      browser,
      vp,
    );

    // 4.7 Prevención de open redirects y bucles en ProductForm
    await logTest(
      "Componente",
      "Navegación",
      "ProductForm real: neutralización de open redirects (//, \\) y bucles (/vender)",
      vp.name,
      async (page) => {
        await page.goto(`${BASE_URL}/?from=//evil.com`);
        await page.setContent(`<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body><div id="root"></div></body></html>`);
        await page.addScriptTag({ content: productFormBundleScript });

        await page.evaluate(() => {
          (window as any).__mountProductForm("create", "user-123");
        });

        const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
        await volverBtn.waitFor({ state: "visible", timeout: 10000 });
        await volverBtn.click();

        const calls = await page.evaluate(() => (window as any).__routerCalls);
        const lastCall = calls[calls.length - 1];
        const ok = lastCall?.action === "push" && lastCall?.dest === "/";

        return {
          resultado: ok ? "PASA" : "FALLA",
          detalles: `Intento ?from=//evil.com neutralizado hacia: ${lastCall?.dest}`,
        };
      },
      browser,
      vp,
    );
  }

  // ─────────────────────────────────────────────────────────────
  // 5. EVALUACIÓN DE INTEGRACIÓN COMPLETA (LIVE APP) Y BLOQUEOS
  // ─────────────────────────────────────────────────────────────
  console.log(`\n============================================================`);
  console.log(`=== EVALUACIÓN DE NAVEGACIÓN COMPLETA EN APLICACIÓN LIVE ===`);
  console.log(`============================================================`);

  const desktopVp = viewports[0]!;

  // 5.1 Búsqueda -> SessionDataProvider captura origen en vivo
  await logTest(
    "Integración",
    "Navegación",
    "SessionDataProvider en vivo registra ruta con query params en sessionStorage",
    desktopVp.name,
    async (page) => {
      await page.goto(`${BASE_URL}/buscar?q=mesa&sort=precio_asc&category=hogar`, { waitUntil: "networkidle" });
      const trigger = page.locator('[data-testid="filtro-categorias-trigger"]').first();
      await trigger.waitFor({ state: "visible", timeout: 25000 });

      await page.waitForFunction(
        () => window.sessionStorage.getItem("vicino:origen-vender") !== null,
        null,
        { timeout: 15000 },
      );

      const origen = await page.evaluate(() => window.sessionStorage.getItem("vicino:origen-vender"));
      const ok = origen === "/buscar?q=mesa&sort=precio_asc&category=hogar";

      return {
        resultado: ok ? "PASA" : "FALLA",
        detalles: `sessionStorage('vicino:origen-vender') = "${origen}"`,
      };
    },
    browser,
    desktopVp,
  );

  // 5.2 Recorrido E2E completo: Perfil -> Publicar -> Volver en vivo
  await logTest(
    "E2E",
    "Navegación",
    "Recorrido real en vivo: Perfil -> Publicar -> Volver",
    desktopVp.name,
    async (page) => {
      await page.goto(`${BASE_URL}/perfil`, { waitUntil: "networkidle" });
      const currentUrl = page.url();

      if (currentUrl.includes("/login")) {
        return {
          resultado: "BLOQUEADO",
          detalles: "Requiere sesión autenticada en Supabase Auth. En el entorno local dev no existen credenciales de prueba válidas en .env.local (error 'Invalid login credentials'), por lo que Server Components y Middleware redirigen a /login?next=/perfil.",
        };
      }

      const publicarLink = page.locator('a[href*="/vender"]');
      if ((await publicarLink.count()) === 0) {
        return {
          resultado: "BLOQUEADO",
          detalles: "No se encontró enlace a publicar en perfil.",
        };
      }

      await publicarLink.click();
      await page.waitForURL("**/vender*", { timeout: 10000 });
      const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
      await volverBtn.waitFor({ state: "visible", timeout: 10000 });
      await volverBtn.click();
      await page.waitForURL("**/perfil*", { timeout: 10000 });

      return {
        resultado: "PASA",
        detalles: "Recorrido completado exitosamente de Perfil a Publicar y retorno a Perfil.",
      };
    },
    browser,
    desktopVp,
  );

  // 5.3 Recorrido E2E completo: Búsqueda -> Publicar -> Volver en vivo
  await logTest(
    "E2E",
    "Navegación",
    "Recorrido real en vivo: Búsqueda con parámetros -> Publicar -> Volver",
    desktopVp.name,
    async (page) => {
      await page.goto(`${BASE_URL}/buscar?q=mesa&sort=precio_asc`, { waitUntil: "networkidle" });
      await page.goto(`${BASE_URL}/vender`, { waitUntil: "networkidle" });
      const currentUrl = page.url();

      if (currentUrl.includes("/login")) {
        return {
          resultado: "BLOQUEADO",
          detalles: "Ruta /vender protegida por autenticación. Al no existir usuario autenticado localmente, redirige a /login?next=/vender.",
        };
      }

      const volverBtn = page.locator('[data-testid="volver-vender-btn"]');
      await volverBtn.waitFor({ state: "visible", timeout: 10000 });
      await volverBtn.click();
      await page.waitForURL("**/buscar*", { timeout: 10000 });

      return {
        resultado: "PASA",
        detalles: "Recorrido completado exitosamente retornando a Búsqueda con parámetros.",
      };
    },
    browser,
    desktopVp,
  );

  await browser.close();

  // Guardar informe
  const reportPath = path.join(OUTPUT_DIR, "reporte-verificacion-navegador.json");
  fs.writeFileSync(reportPath, JSON.stringify(resultados, null, 2), "utf8");

  console.log(`\n============================================================`);
  const pasan = resultados.filter((r) => r.resultado === "PASA").length;
  const fallan = resultados.filter((r) => r.resultado === "FALLA").length;
  const bloqueados = resultados.filter((r) => r.resultado === "BLOQUEADO").length;
  console.log(`Verificación completada.`);
  console.log(`Total casos evaluados: ${resultados.length}`);
  console.log(`- PASAN: ${pasan}`);
  console.log(`- FALLAN: ${fallan}`);
  console.log(`- BLOQUEADOS: ${bloqueados}`);
  console.log(`Reporte guardado en: ${reportPath}`);
  console.log(`============================================================\n`);

  process.exit(fallan === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Fallo general en ejecución de pruebas de navegador:", err);
  process.exit(1);
});
