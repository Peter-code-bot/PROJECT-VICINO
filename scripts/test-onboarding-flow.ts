/** Real route loaders and helpers; authentication/database boundaries are synthetic. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { pasosDelCamino, pasoParaReanudar, siguientePaso } from "../apps/web/lib/onboarding/steps.ts";

const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const comprar = { camino: "explorar" as const, tipo: "casual" as const };
const negocio = { camino: "vender" as const, tipo: "business" as const };
const compiled = new Map<string, string>();

test("buying asks one question per page, without a seller-only activation page", () => {
  assert.deepEqual(pasosDelCamino(comprar), ["usuario", "nombre", "foto", "descripcion", "intereses", "ubicacion", "notificaciones", "listo"]);
  assert.equal(siguientePaso("ubicacion", comprar), "notificaciones");
  assert.equal(siguientePaso("listo", comprar), null);
});
test("business asks payments separately and every path ends in a single final review", () => {
  assert.equal(siguientePaso("descripcion", negocio), "pagos");
  assert.equal(siguientePaso("descripcion", { camino: "vender", tipo: "casual" }), "intereses");
  assert.equal(siguientePaso("ubicacion", negocio), "notificaciones");
  assert.equal(pasosDelCamino(negocio).length, 11);
  assert.equal(pasosDelCamino({ camino: "vender", tipo: "casual" }).length, 10);
});
test("resolved notifications leave both the step counter and Back sequence", () => {
  for (const context of [comprar, negocio, { camino: "vender" as const, tipo: "casual" as const }]) {
    const resolved = { ...context, notificacionesResueltas: true };
    assert.equal(pasosDelCamino(resolved).length, pasosDelCamino(context).length - 1);
    assert.equal(siguientePaso("ubicacion", resolved), "listo");
    assert.equal(pasoParaReanudar("notificaciones", resolved), "listo");
    assert.equal(pasosDelCamino(resolved).at(-2), "ubicacion");
  }
});
test("legacy markers resume safely without rewinding valid profile questions", () => {
  assert.equal(pasoParaReanudar("perfil", negocio), "usuario");
  assert.equal(pasoParaReanudar("activar", negocio), "listo");
  assert.equal(pasoParaReanudar("intereses", negocio), "intereses");
  assert.equal(pasoParaReanudar("ubicacion", comprar), "ubicacion");
  assert.equal(pasoParaReanudar("pagos", comprar), "usuario");
  assert.equal(pasoParaReanudar("bogus", comprar), "usuario");
});

function state(overrides: Record<string, unknown> = {}) {
  const reports: unknown[] = [];
  const profile = { id: "synthetic", nombre: "Ana", username: "ana_1000", onboarding_camino: "explorar",
    onboarding_paso: "descripcion", onboarding_revision: 0, has_seen_onboarding: false, seller_type: "casual", ...overrides };
  return { reports, profile, user: { id: "synthetic" } as { id: string } | null, readError: null as unknown,
    reads: 0, destination: undefined as string | undefined,
    client: { auth: { getUser: async () => ({ data: { user: fixture.user } }) },
      from: () => ({ select: () => ({ eq: () => ({ single: async () => {
        fixture.reads++;
        return { data: fixture.readError ? null : fixture.profile, error: fixture.readError };
      } }) }) }) } };
}
let fixture: ReturnType<typeof state>;

async function load(file: string) {
  if (!compiled.has(file)) {
    const mocks: Record<string, string> = {
      "@/lib/supabase/server": "export const createClient=async()=>globalThis.fixture.client;",
      "@sentry/nextjs": "export const captureException=error=>globalThis.fixture.reports.push(error);",
      "next/navigation": "export const redirect=destination=>{const error=new Error('REDIRECT');error.destination=destination;throw error;};",
      "next/headers": "export const cookies=async()=>({get:()=>globalThis.fixture.destination?{value:globalThis.fixture.destination}:undefined});",
      "next/link": "export default function Link(){return null;}",
      "@/components/onboarding/onboarding-shell": "export function OnboardingShell(){return null;}",
      "./completar-perfil": "export function CompletarPerfil(){return null;}",
      "./onboarding-session": "export function OnboardingSessionProvider(){return null;}",
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
  new vm.Script(compiled.get(file)!, { filename: file }).runInContext(vm.createContext({ module, exports: module.exports, require, fixture, console, URL }));
  return module.exports;
}

const entry = "app/(onboarding)/completar-perfil/page.tsx";
const loader = "app/(onboarding)/completar-perfil/load-profile.tsx";
const layout = "app/(onboarding)/completar-perfil/layout.tsx";
const dynamic = "app/(onboarding)/completar-perfil/[paso]/page.tsx";
const welcome = "app/(onboarding)/bienvenida/page.tsx";
const redirectTo = (destination: string) => (error: any) => error.destination === destination;

test("step pages avoid a second profile request; the persistent loader owns guards", async () => {
  fixture = state();
  assert.equal((await load(entry)).default(), null);
  assert.equal(await (await load(dynamic)).default({ params: Promise.resolve({ paso: "nombre" }), searchParams: Promise.resolve({}) }), null);
  assert.equal(fixture.reads, 0);
  const profile = await (await load(loader)).loadOnboardingProfile();
  assert.equal(profile.onboarding_paso, "descripcion");
  assert.equal(fixture.reads, 1);
});
test("anonymous and completed accounts retain guards and the safe final destination", async () => {
  fixture = state(); fixture.user = null;
  await assert.rejects((await load(loader)).loadOnboardingProfile(), redirectTo("/login"));
  const destinations: Array<[string | undefined, string]> = [[undefined, "/"], ["/guardados", "/guardados"], ["https://evil.test", "/"]];
  for (const [destination, expected] of destinations) {
    fixture = state({ has_seen_onboarding: true }); fixture.destination = destination;
    await assert.rejects((await load(loader)).loadOnboardingProfile(), redirectTo(expected));
  }
});
test("profile read failure remains recoverable without a welcome redirect loop", async () => {
  fixture = state(); fixture.readError = { code: "42501" };
  const rendered = await (await load(layout)).default({ children: null });
  assert.equal(rendered.props.href, "/completar-perfil");
  assert.equal(fixture.reports.length, 1);
});
test("legacy activation URL reaches the final review; unknown URLs are recoverable", async () => {
  fixture = state(); const page = await load(dynamic);
  await assert.rejects(page.default({ params: Promise.resolve({ paso: "bogus" }), searchParams: Promise.resolve({}) }), redirectTo("/completar-perfil"));
  await assert.rejects(page.default({ params: Promise.resolve({ paso: "activar" }), searchParams: Promise.resolve({ camino: "vender" }) }), redirectTo("/completar-perfil/listo?camino=vender"));
  await assert.rejects(page.default({ params: Promise.resolve({ paso: "activar" }), searchParams: Promise.resolve({}) }), redirectTo("/completar-perfil/listo"));
});
test("welcome resumes by default; explicit Back allows changing path", async () => {
  fixture = state(); const page = await load(welcome);
  await assert.rejects(page.default({ searchParams: Promise.resolve({}) }), redirectTo("/completar-perfil"));
  assert.ok(await page.default({ searchParams: Promise.resolve({ elegir: "1" }) }));
});
test("welcome cannot restart a completed account", async () => {
  fixture = state({ has_seen_onboarding: true });
  await assert.rejects((await load(welcome)).default({ searchParams: Promise.resolve({ elegir: "1" }) }), redirectTo("/"));
});
