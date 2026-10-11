/** Actual route loaders and flow helpers; auth/database boundaries are synthetic. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { pasosDelCamino, pasoParaReanudar, siguientePaso, rutaDePaso } from "../apps/web/lib/onboarding/steps.ts";

const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const explorar = { camino: "explorar" as const, tipo: "casual" as const };
const business = { camino: "vender" as const, tipo: "business" as const };
const compiled = new Map<string, string>();

test("exploration asks one profile question per page and never activates a seller", () => {
  assert.deepEqual(pasosDelCamino(explorar), ["usuario", "nombre", "foto", "descripcion", "intereses", "ubicacion", "notificaciones", "listo"]);
  assert.equal(siguientePaso("ubicacion", explorar), "notificaciones");
  assert.equal(siguientePaso("listo", explorar), null);
});

test("business asks payments separately before the explicit activation review", () => {
  assert.equal(siguientePaso("descripcion", business), "pagos");
  assert.equal(siguientePaso("descripcion", { camino: "vender", tipo: "casual" }), "intereses");
  assert.equal(siguientePaso("ubicacion", business), "activar");
});

test("legacy profile resumes at username without rewinding interests or location", () => {
  assert.equal(pasoParaReanudar("perfil", business), "usuario");
  assert.equal(pasoParaReanudar("intereses", business), "intereses");
  assert.equal(pasoParaReanudar("ubicacion", explorar), "ubicacion");
  assert.equal(pasoParaReanudar("bogus", explorar), "usuario");
});

function state(overrides: Record<string, unknown> = {}) {
  const reports: unknown[] = [];
  const profile = { id: "synthetic", nombre: "Ana", username: "ana_1000", onboarding_camino: "explorar",
    onboarding_paso: "descripcion", has_seen_onboarding: false, seller_type: "casual", ...overrides };
  return { reports, profile, user: { id: "synthetic" } as { id: string } | null, readError: null as unknown,
    client: { auth: { getUser: async () => ({ data: { user: fixture.user } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: fixture.readError ? null : fixture.profile, error: fixture.readError }) }) }) }) } };
}
let fixture: ReturnType<typeof state>;

async function load(file: string) {
  if (!compiled.has(file)) {
    const mocks: Record<string, string> = {
      "@/lib/supabase/server": "export const createClient=async()=>globalThis.fixture.client;",
      "@sentry/nextjs": "export const captureException=error=>globalThis.fixture.reports.push(error);",
      "next/navigation": "export const redirect=destination=>{const error=new Error('REDIRECT');error.destination=destination;throw error;};",
      "next/link": "export default function Link(){return null;}",
      "@/components/onboarding/onboarding-shell": "export function OnboardingShell(){return null;}",
      "../completar-perfil": "export function CompletarPerfil(){return null;}",
      "./onboarding-options": "export function OnboardingOptions(){return null;}",
    };
    const result = await esbuild.build({ entryPoints: [path.join(web, file)], bundle: true,
      platform: "node", format: "cjs", packages: "external", write: false, jsx: "automatic",
      tsconfig: path.join(web, "tsconfig.json"), plugins: [{ name: "route-boundaries", setup(build: any) {
        build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "fixture" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args: any) => ({ contents: mocks[args.path], loader: "js" }));
      } }] });
    compiled.set(file, result.outputFiles[0].text);
  }
  const module = { exports: {} as any };
  new vm.Script(compiled.get(file)!, { filename: file }).runInContext(vm.createContext({ module, exports: module.exports, require, fixture, console }));
  return module.exports;
}

const entry = "app/(onboarding)/completar-perfil/page.tsx";
const dynamic = "app/(onboarding)/completar-perfil/[paso]/page.tsx";
const welcome = "app/(onboarding)/bienvenida/page.tsx";
const redirectTo = (destination: string) => (error: any) => error.destination === destination;

test("entry reloads the pending page from the server", async () => {
  fixture = state();
  const page = await load(entry);
  await assert.rejects(page.default({ searchParams: Promise.resolve({}) }), redirectTo(rutaDePaso("descripcion")));
});

test("anonymous and completed accounts keep their guards", async () => {
  fixture = state(); fixture.user = null;
  let page = await load(entry);
  await assert.rejects(page.default({ searchParams: Promise.resolve({}) }), redirectTo("/login"));
  fixture = state({ has_seen_onboarding: true });
  page = await load(dynamic);
  await assert.rejects(page.default({ params: Promise.resolve({ paso: "nombre" }), searchParams: Promise.resolve({}) }), redirectTo("/"));
});

test("read failure stays recoverable on the same page, without a welcome loop", async () => {
  fixture = state(); fixture.readError = { code: "42501" };
  const page = await load(dynamic);
  const rendered = await page.default({ params: Promise.resolve({ paso: "nombre" }), searchParams: Promise.resolve({}) });
  assert.equal(rendered.props.href, "/completar-perfil/nombre");
  assert.equal(fixture.reports.length, 1);
});

test("unknown pages and seller-only steps cannot paint a blank exploration page", async () => {
  fixture = state();
  const page = await load(dynamic);
  for (const paso of ["bogus", "activar", "pagos"]) {
    await assert.rejects(page.default({ params: Promise.resolve({ paso }), searchParams: Promise.resolve({}) }), redirectTo("/completar-perfil"));
  }
});

test("welcome resumes by default but explicit back can choose the path again", async () => {
  fixture = state();
  const page = await load(welcome);
  await assert.rejects(page.default({ searchParams: Promise.resolve({}) }), redirectTo("/completar-perfil"));
  assert.ok(await page.default({ searchParams: Promise.resolve({ elegir: "1" }) }));
});

test("path selection bypass still sends completed accounts home", async () => {
  fixture = state({ has_seen_onboarding: true });
  const page = await load(welcome);
  await assert.rejects(page.default({ searchParams: Promise.resolve({ elegir: "1" }) }), redirectTo("/"));
});
