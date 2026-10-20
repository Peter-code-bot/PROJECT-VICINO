import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { onboardingUsernameSchema, usernameSchema } from "../packages/shared/src/validators/profile.ts";
import { fieldsForOnboardingStep } from "../apps/web/lib/onboarding/draft.ts";

let checks = 0;
for (const value of ["abc", "ana_123", "a".repeat(30), "___", "123"]) {
  assert.equal(onboardingUsernameSchema.parse(value), value);
  checks++;
}
for (const value of ["", "ab", "a".repeat(31), "Abc", "ana 123", " ana", "ana ", "ana\u00a0123", "áña", "ana-123", "@ana", "ana😀", "ana\n123", "ａｎａ"]) {
  assert.equal(onboardingUsernameSchema.safeParse(value).success, false, value);
  checks++;
}
assert.equal(usernameSchema.parse("U0000123"), "U0000123");
assert.equal(onboardingUsernameSchema.optional().parse(undefined), undefined);
// The transport must preserve invalid spaces for server validation, not trim them away.
const fields = fieldsForOnboardingStep("usuario", { username: " ana " } as Parameters<typeof fieldsForOnboardingStep>[1], false);
assert.equal(fields.username, " ana ");
assert.equal(onboardingUsernameSchema.safeParse(fields.username).success, false);
checks += 4;
console.log(`PASS ${checks} username format checks: boundaries, characters, legacy compatibility and raw transport.`);

// Invoke the real HTTP handler and Server Actions with only infrastructure stubbed.
// This checks bypassing the UI without credentials, network or database writes.
async function verifyServerContract() {
  const root = resolve(__dirname, "..");
  const rootRequire = createRequire(resolve(root, "package.json"));
  const { build } = createRequire(rootRequire.resolve("tsx/package.json"))("esbuild");
  const id = "00000000-0000-4000-8000-000000000001";
  const state = { user: { id } as { id: string } | null, reads: 0, calls: [] as Array<{ name: string; args: Record<string, unknown> }> };
  const stubs: Record<string, string> = {
    "@/lib/supabase/server": `export async function createClient(){return {
      auth:{getUser:async()=>({data:{user:globalThis.contract.user}})},
      from:()=>{globalThis.contract.reads++;return {select:()=>({eq:()=>({single:async()=>({data:{nombre:'Ana'}})})})};},
      rpc:async(name,args)=>{globalThis.contract.calls.push({name,args});
        return name==='consultar_usuarios_onboarding'
          ? {data:{username:args.p_username,status:'available',message:null,suggestions:['ana_1001','ana_1002','ana_1003']}}
          : {error:{code:'TEST_BOUNDARY',message:'No database writes in this test'}};
      }
    };}`,
    "@/lib/rate-limit": "export const readHeavyRateLimit={},writeRateLimit={};export async function enforce(){return {ok:true};}",
    "@/lib/revalidate-session": "export async function revalidatePath(){}",
    "@sentry/nextjs": "export function captureException(){}",
    "next/headers": "export async function cookies(){return {get:()=>undefined};}",
    "@/lib/auth/acceso-invitado": "export const COOKIE_DESTINO_ONBOARDING='fixture';",
    "@/lib/auth/destino-seguro": "export const destinoAutenticadoSeguro=()=>'/';",
  };
  async function load(relative: string) {
    const result = await build({ entryPoints: [resolve(root, relative)], bundle: true, write: false, platform: "node", format: "cjs", plugins: [{
      name: "contract-infrastructure",
      setup(plugin: { onResolve: Function; onLoad: Function }) {
        plugin.onResolve({ filter: /.*/ }, (args: { path: string }) => {
          if (args.path in stubs) return { path: args.path, namespace: "stub" };
          if (args.path === "@vicino/shared") return { path: resolve(root, "packages/shared/src/validators/profile.ts") };
          if (args.path === "@/lib/onboarding/steps") return { path: resolve(root, "apps/web/lib/onboarding/steps.ts") };
        });
        plugin.onLoad({ filter: /.*/, namespace: "stub" }, (args: { path: string }) => ({ contents: stubs[args.path], loader: "js" }));
      },
    }] });
    const module = { exports: {} as Record<string, Function> };
    runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: rootRequire, URL, Response, contract: state });
    return module.exports;
  }
  const route = await load("apps/web/app/api/onboarding/usuario/route.ts");
  const actions = await load("apps/web/app/(onboarding)/completar-perfil/actions.ts");
  const checkpoint = { operationId: id, expectedUserId: id, expectedRevision: 0, fromStep: "usuario", nextStep: "nombre", camino: "explorar" };
  let serverChecks = 0;
  for (const username of ["ab", "Aba", " ana ", "ana 123", "áña", "ana-123", "a".repeat(31)]) {
    const expected = onboardingUsernameSchema.safeParse(username);
    assert(!expected.success);
    const response = await route.GET(new Request(`https://fixture.invalid/api/onboarding/usuario?username=${encodeURIComponent(username)}`));
    const body = await response.json();
    assert.equal(body.status, "invalid");
    assert.equal(body.message, expected.error.issues[0].message);
    for (const result of [
      await actions.guardarPasoOnboarding({ username }),
      await actions.guardarCheckpointOnboarding({ ...checkpoint, fields: { username } }),
    ]) assert.equal(result.error, expected.error.issues[0].message);
    assert.equal(state.reads, 0);
    assert.equal(state.calls.length, 0);
    serverChecks += 3;
  }
  const response = await route.GET(new Request("https://fixture.invalid/api/onboarding/usuario?username=ana_123"));
  assert.equal((await response.json()).status, "available");
  assert.equal(state.reads, 1);
  assert.equal(state.calls[0].name, "consultar_usuarios_onboarding");
  state.calls.length = 0;
  await actions.guardarCheckpointOnboarding({ ...checkpoint, fields: {} });
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].name, "guardar_checkpoint_onboarding_v3");
  assert.equal(Object.keys(state.calls[0].args.p_fields as object).length, 0);
  state.user = null;
  assert.equal((await route.GET(new Request("https://fixture.invalid/api/onboarding/usuario?username=abc"))).status, 401);
  assert.equal((await actions.guardarCheckpointOnboarding({ ...checkpoint, fields: { username: "abc" } })).error, "No autenticado");
  serverChecks += 4;
  console.log(`PASS ${serverChecks} real server boundary checks: HTTP, both save actions, skip and authentication; infrastructure simulated.`);
}

verifyServerContract().catch(error => { console.error(error); process.exitCode = 1; });
