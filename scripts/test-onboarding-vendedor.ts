/** Real seller UI and actions; only external auth/RPC/navigation boundaries are mocked. No network or credentials. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const { chromium } = require("@playwright/test");
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const copies = new Map<string, string>();

function fixture(options: Record<string, unknown> = {}) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const revalidated: string[] = [];
  const reports: unknown[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: options.anonymous ? null : { id: "fixture-user" } } }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: options.profile ?? null, error: options.readError ?? null }) }) }) }),
    rpc: async (name: string, args: Record<string, unknown>) => { rpcCalls.push({ name, args }); return { error: options.rpcError ?? null }; },
  };
  return { rpcCalls, revalidated, reports, client, rate: options.rate ?? { ok: true } };
}

async function load(file: string, state: ReturnType<typeof fixture>) {
  if (!copies.has(file)) {
    const mocks: Record<string, string> = {
      "@/lib/supabase/server": "export const createClient=async()=>globalThis.state.client;",
      "@/lib/revalidate-session": "export const revalidatePath=async path=>globalThis.state.revalidated.push(path);",
      "@/lib/rate-limit": "export const writeRateLimit={};export const enforce=async()=>globalThis.state.rate;",
      "@sentry/nextjs": "export const captureException=error=>globalThis.state.reports.push(error);",
      "next/navigation": "export const redirect=destination=>{const error=new Error('REDIRECT');error.destination=destination;throw error;};",
      "next/link": "export default function Link(){return null;}",
      "@/components/onboarding/onboarding-shell": "export function OnboardingShell(){return null;}",
      "./alta-vendedor": "export function AltaVendedor(){return null;}",
    };
    const result = await esbuild.build({
      entryPoints: [path.join(web, file)], bundle: true, platform: "node", format: "cjs", packages: "external", write: false,
      jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
      plugins: [{ name: "test-boundaries", setup(build: any) {
        build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents: mocks[args.path], loader: "js" }));
      } }],
    });
    copies.set(file, result.outputFiles[0].text);
  }
  const module = { exports: {} as any };
  const context = vm.createContext({ module, exports: module.exports, require, state, console });
  new vm.Script(copies.get(file)!, { filename: file }).runInContext(context);
  return module.exports;
}

const actionFile = "app/(onboarding)/empezar-a-vender/actions.ts";
const pageFile = "app/(onboarding)/empezar-a-vender/page.tsx";

test("new accounts enter the shared onboarding before seller activation", async () => {
  const f = fixture({ profile: { has_seen_onboarding: false, es_vendedor: false } });
  const page = await load(pageFile, f);
  await assert.rejects(page.default(), (error: any) => error.destination === "/completar-perfil/categoria?camino=vender");
  assert.equal(f.rpcCalls.length, 0);
});

test("anonymous seller route preserves its login return destination", async () => {
  const f = fixture({ anonymous: true });
  const page = await load(pageFile, f);
  await assert.rejects(page.default(), (error: any) => error.destination === "/login?next=/empezar-a-vender");
});

test("existing business data is hydrated instead of replaced with empty defaults", async () => {
  const f = fixture({ profile: { has_seen_onboarding: true, es_vendedor: false, nombre: "Ana", nombre_negocio: "Tienda Ana", descripcion_negocio: "Descripción guardada", categoria_negocio: "comida", seller_type: "business", foto: "https://fixture.invalid/avatar.jpg", metodos_pago_aceptados: "Efectivo, Transferencia bancaria" } });
  const page = await load(pageFile, f);
  const rendered = await page.default();
  assert.equal(rendered.props.nombreNegocioInicial, "Tienda Ana");
  assert.equal(rendered.props.descripcionNegocioInicial, "Descripción guardada");
  assert.deepEqual(plain(rendered.props.metodosPagoIniciales), ["Efectivo", "Transferencia bancaria"]);
  assert.equal(rendered.props.fotoInicial, "https://fixture.invalid/avatar.jpg");
  assert.equal(f.rpcCalls.length, 0);
});

test("profile read errors display recovery without restarting or mutating the account", async () => {
  const f = fixture({ readError: { code: "42501", message: "private internal details" } });
  const page = await load(pageFile, f);
  const rendered = await page.default();
  assert.equal(rendered.props.title, "No pudimos cargar tu perfil");
  assert.equal(f.rpcCalls.length, 0);
  assert.equal(f.reports.length, 1);
});

test("anonymous activation cannot call the seller RPC", async () => {
  const f = fixture({ anonymous: true });
  const action = await load(actionFile, f);
  assert.equal((await action.activarModoVendedor({ categoria: "comida", tipo: "casual" })).error, "No autenticado");
  assert.equal(f.rpcCalls.length, 0);
});

for (const [name, input] of Object.entries({
  category: { categoria: "unknown", tipo: "casual" },
  type: { categoria: "comida", tipo: "admin" },
  avatar: { categoria: "comida", tipo: "casual", foto: "javascript:alert(1)" },
  description: { categoria: "comida", tipo: "business", descripcionNegocio: "a".repeat(1001) },
  malformed: null,
})) {
  test(`invalid ${name} is rejected before any mutation`, async () => {
    const f = fixture();
    const action = await load(actionFile, f);
    assert.equal(typeof (await action.activarModoVendedor(input)).error, "string");
    assert.equal(f.rpcCalls.length, 0);
  });
}

test("omitted optional data sends undefined so the RPC preserves existing values", async () => {
  const f = fixture();
  const action = await load(actionFile, f);
  assert.equal((await action.activarModoVendedor({ categoria: "comida", tipo: "casual", nombreNegocio: "", descripcionNegocio: "", metodosPago: "", foto: "" })).success, true);
  const args = f.rpcCalls[0].args;
  assert.equal(args.p_nombre_negocio, undefined);
  assert.equal(args.p_descripcion_negocio, undefined);
  assert.equal(args.p_metodos_pago_aceptados, undefined);
  assert.equal(args.p_foto, undefined);
  assert.deepEqual(f.revalidated, ["/perfil", "/vender"]);
});

test("database internals never appear in the activation error", async () => {
  const f = fixture({ rpcError: { code: "42501", message: "private table, policy and auth details" } });
  const action = await load(actionFile, f);
  const result = await action.activarModoVendedor({ categoria: "comida", tipo: "casual" });
  assert.equal(result.error, "No pudimos activar el Modo Vendedor. Intenta de nuevo.");
  assert.equal(f.reports.length, 1);
});

test("seller UI: skip remains available with missing category and never activates", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mountSeller(page, {});
    const continueButton = page.getByRole("button", { name: "Continuar", exact: true });
    await continueButton.waitFor();
    assert.equal(await continueButton.isDisabled(), true);
    await page.getByRole("button", { name: "Ahora no", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.routes), ["/"]);
    assert.equal(await page.evaluate(() => (window as any).fixture.calls.length), 0);
  } finally { await browser.close(); }
});

test("seller UI: one business datum per page, back retains input, only explicit activation converts", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mountSeller(page, { categoriaInicial: "comida", tipoInicial: "business", nombreNegocioInicial: "Tienda Ana", descripcionNegocioInicial: "Descripción guardada", metodosPagoIniciales: ["Efectivo"], fotoInicial: "https://fixture.invalid/avatar.jpg" });
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    const name = page.getByLabel("Nombre del negocio", { exact: true });
    assert.equal(await name.inputValue(), "Tienda Ana");
    assert.equal(await page.getByLabel("Descripción del negocio", { exact: true }).count(), 0);
    await name.fill("Tienda nueva");
    await page.getByRole("button", { name: "Regresar", exact: true }).click();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    assert.equal(await name.inputValue(), "Tienda nueva");
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("button", { name: "Preparar foto", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Continuar", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Omitir", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Regresar", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Cancelar recorte", exact: true }).click();
    await page.getByRole("button", { name: "Usar foto nueva", exact: true }).click();
    await page.getByRole("button", { name: "Omitir", exact: true }).click();
    await page.getByLabel("Descripción del negocio", { exact: true }).fill("Borrador que se omite");
    await page.getByRole("button", { name: "Omitir", exact: true }).click();
    await page.getByRole("button", { name: "Omitir", exact: true }).click();
    assert.equal(await page.evaluate(() => (window as any).fixture.calls.length), 0);
    await page.getByRole("button", { name: "Activar Modo Vendedor", exact: true }).click();
    await page.getByRole("heading", { name: "Tu Modo Vendedor está listo", exact: true }).waitFor();
    const calls = await page.evaluate(() => (window as any).fixture.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].nombreNegocio, "Tienda nueva");
    assert.equal(calls[0].descripcionNegocio, "Descripción guardada");
    assert.equal(calls[0].metodosPago, "Efectivo");
    assert.equal(calls[0].foto, "https://fixture.invalid/avatar.jpg");
    await page.getByRole("button", { name: "Entrar a VICINO", exact: true }).click();
    assert.deepEqual(await page.evaluate(() => (window as any).fixture.routes), ["/"]);
  } finally { await browser.close(); }
});

async function mountSeller(page: any, props: Record<string, unknown>) {
  const mocks: Record<string, string> = {
    "next/navigation": "export const useRouter=()=>({replace:path=>window.fixture.routes.push(path)});",
    "next/link": "import React from 'react'; export default function Link(props){return React.createElement('a',props,props.children);}",
    "./actions": "export const activarModoVendedor=async input=>{window.fixture.calls.push(input);return {success:true};};",
    "@/components/profile/avatar-inline-upload": "import React from 'react';export function AvatarInlineUpload(props){return React.createElement('div',null,React.createElement('button',{type:'button',onClick:()=>props.onBusyChange?.(true)},'Preparar foto'),React.createElement('button',{type:'button',onClick:()=>props.onBusyChange?.(false)},'Cancelar recorte'),React.createElement('button',{type:'button',onClick:()=>props.onUploadSuccess('https://fixture.invalid/nueva.jpg')},'Usar foto nueva'));}",
  };
  const result = await esbuild.build({
    absWorkingDir: web, stdin: { contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {AltaVendedor} from './app/(onboarding)/empezar-a-vender/alta-vendedor';import {OnboardingViewport} from './components/onboarding/onboarding-shell';createRoot(document.getElementById('root')).render(<OnboardingViewport><AltaVendedor nombre='Ana' {...window.fixture.props}/></OnboardingViewport>);", resolveDir: web, loader: "tsx" },
    bundle: true, platform: "browser", format: "iife", write: false, jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
    plugins: [{ name: "browser-boundaries", setup(build: any) {
      build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
      build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents: mocks[args.path], loader: "js", resolveDir: web }));
    } }],
  });
  await page.route("**/*", (route: any) => route.abort());
  await page.setContent('<div id="root"></div>');
  await page.evaluate((props: Record<string, unknown>) => { (window as any).fixture = { props, calls: [], routes: [] }; }, props);
  await page.addScriptTag({ content: result.outputFiles[0].text });
}
