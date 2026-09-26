/** S02-A: implementación real; solo se simulan límites externos. No usa red ni .env. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { destinoAutenticadoSeguro } from "../apps/web/lib/auth/destino-seguro";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const esbuild = require(require.resolve("esbuild", { paths: [require.resolve("tsx")] }));
const { NextRequest } = require("next/server");
const { AuthApiError } = require("@supabase/supabase-js");
const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const copies = new Map<string, string>();
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const missing = { name: "AuthSessionMissingError", status: 400 };

function fixture(options: any = {}) {
  const calls: unknown[] = [];
  const rateKeys: string[] = [];
  return { calls, rateKeys, rate: options.rate ?? { ok: true }, client: { auth: {
    getUser: async () => {
      if (options.throws) throw new Error("offline");
      return { data: { user: options.user ?? null }, error: options.error ?? null };
    },
    signUp: async (input: unknown) => {
      calls.push(input);
      return options.signup ?? { data: { user: { identities: [] }, session: null }, error: null };
    },
  } } };
}

async function load(file: string, state: ReturnType<typeof fixture>) {
  if (!copies.has(file)) {
    const mocks: Record<string, string> = {
      "server-only": "export {};",
      "@/lib/supabase/server": "export const createClient=async()=>globalThis.state.client;",
      "@supabase/ssr": `export const createServerClient=(_url,_key,options)=>{
        options.cookies.setAll([{name:'synthetic-refresh',value:'refreshed',options:{httpOnly:true,sameSite:'lax',path:'/'}}]);
        return globalThis.state.client;
      };`,
      "next/headers": "export const headers=async()=>new Headers();",
      "next/navigation": "export const redirect=(destination)=>{const e=new Error('REDIRECT');e.destination=destination;throw e;};",
      "@sentry/nextjs": "export const captureException=()=>{};export const captureMessage=()=>{};",
      "@/lib/rate-limit": `export const authRateLimit={};export const otpResendIpRateLimit={};export const otpResendRateLimit={};
        export const otpVerifyIpRateLimit={};export const otpVerifyRateLimit={};export const getClientIp=()=> 'synthetic-ip';
        export const enforce=async(_limiter,key)=>{globalThis.state.rateKeys.push(key);return globalThis.state.rate;};`,
      "./register-form": "export const RegisterForm=()=>null;",
      "./login-form": "export const LoginForm=()=>null;",
      "next/link": "export default function Link(){return null;}",
      "next/image": "export default function Image(){return null;}",
    };
    const output = await esbuild.build({
      entryPoints: [path.join(web, file)], bundle: true, platform: "node", format: "cjs",
      packages: "external", write: false, jsx: "automatic", tsconfig: path.join(web, "tsconfig.json"),
      plugins: [{ name: "test-boundaries", setup(build: any) {
        build.onResolve({ filter: /.*/ }, (args: any) => Object.hasOwn(mocks, args.path) ? { path: args.path, namespace: "mock" } : undefined);
        build.onLoad({ filter: /.*/, namespace: "mock" }, (args: any) => ({ contents: mocks[args.path], loader: "js" }));
      } }],
    });
    copies.set(file, output.outputFiles[0].text);
  }
  const module = { exports: {} as any };
  const context = vm.createContext({ module, exports: module.exports, require, state, URL, Headers, Request, Response,
    process: { env: { NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic", NEXT_PUBLIC_SITE_URL: "https://app.invalid" } },
    fetch: () => { throw new Error("NETWORK_FORBIDDEN"); }, console: { ...console, error: () => {} },
  });
  new vm.Script(copies.get(file)!, { filename: file }).runInContext(context);
  return module.exports;
}

for (const input of ["/login", "/register?next=/vender", "/LOGIN/", "/forgot-password", "/a/../login", "/a/%2e%2e/register", "/%6cogin", "/login%2f", "/%2flogin", "/a/..//evil.invalid", "//evil.invalid", "/\\evil.invalid", "/\t/evil.invalid", "/%", ["/vender", "/perfil"], null]) {
  test(`destino rechaza ${JSON.stringify(input)}`, () => assert.equal(destinoAutenticadoSeguro(input), "/"));
}
for (const input of ["/", "/vender", "/buscar?q=mesa&sort=precio_asc#resultados", "/seller/listings", "/perfil/editar", "/logins-distintos"]) {
  test(`destino conserva ${input}`, () => assert.equal(destinoAutenticadoSeguro(input), input));
}

test("acción real: sesión existente no registra otra cuenta", { timeout: 5000 }, async () => {
  const f = fixture({ user: { id: "synthetic" } });
  const action = await load("app/(auth)/actions.ts", f);
  assert.deepEqual(plain(await action.signUp("test@example.com", "123456", "Prueba")), { hasSession: true, alreadyLoggedIn: true });
  assert.equal(f.calls.length, 0);
});
for (const [name, options] of Object.entries({ red: { throws: true }, limite: { error: new AuthApiError("limited", 429) }, servidor: { error: new AuthApiError("unavailable", 503) } })) {
  test(`acción real: fallo de sesión ${name} impide registro`, async () => {
    const f = fixture(options);
    const action = await load("app/(auth)/actions.ts", f);
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).sessionUnavailable, true);
    assert.equal(f.calls.length, 0);
  });
}
for (const identities of [[], [{ id: "synthetic" }], undefined]) {
  test(`acción real: respuesta neutral con identities=${JSON.stringify(identities)}`, async () => {
    const f = fixture({ error: missing, signup: { data: { user: { identities }, session: null }, error: null } });
    const action = await load("app/(auth)/actions.ts", f);
    assert.deepEqual(plain(await action.signUp(" TEST@example.com ", "123456", " Prueba ")), { hasSession: false });
    assert.deepEqual(plain(f.calls), [{ email: "test@example.com", password: "123456", options: { data: { full_name: "Prueba" }, emailRedirectTo: "https://app.invalid/auth/callback-server" } }]);
  });
}
test("acción real: sesión emitida por Auth", async () => {
  const action = await load("app/(auth)/actions.ts", fixture({ signup: { data: { session: {} }, error: null } }));
  assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).hasSession, true);
});
test("acción real: error de cuenta existente permanece neutral", async () => {
  const action = await load("app/(auth)/actions.ts", fixture({ signup: { data: {}, error: { code: "user_already_exists", message: "User already registered" } } }));
  assert.deepEqual(plain(await action.signUp("test@example.com", "123456", "Prueba")), { hasSession: false });
});
test("acción real: validación de entrada y frecuencia", async () => {
  const f = fixture({ signup: { data: {}, error: { message: "For security purposes, you can only request this after 60 seconds" } } });
  const action = await load("app/(auth)/actions.ts", f);
  assert.equal((await action.signUp("bad", "123456", "Prueba")).invalidInput, true);
  assert.equal(f.calls.length, 0);
  assert.match((await action.signUp("test@example.com", "123456", "Prueba")).error, /60 seconds/);
});
test("acción real: rate limit detiene registro", async () => {
  const f = fixture({ rate: { ok: false, error: "Demasiadas solicitudes" } });
  const action = await load("app/(auth)/actions.ts", f);
  assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).error, "Demasiadas solicitudes");
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.rateKeys, ["auth:signup:synthetic-ip"]);
});

for (const route of ["/register", "/login"]) {
  for (const next of ["/buscar?q=mesa", "/login", "/a/../register", "//evil.invalid"]) {
    test(`middleware ${route} next=${next}: destino y cookies`, async () => {
      const middleware = await load("lib/supabase/middleware.ts", fixture({ user: { id: "synthetic" } }));
      const result = await middleware.updateSession(new NextRequest(`https://app.invalid${route}?next=${encodeURIComponent(next)}`));
      assert.equal(result.status, 307);
      assert.equal(result.headers.get("location"), `https://app.invalid${next.startsWith("/buscar") ? next : "/"}`);
      assert.equal(result.cookies.get("synthetic-refresh")?.value, "refreshed");
      assert.match(result.headers.get("set-cookie"), /HttpOnly/);
    });
  }
  test(`middleware ${route}: invitado, cookies y nonce`, async () => {
    const middleware = await load("lib/supabase/middleware.ts", fixture({ error: missing }));
    const result = await middleware.updateSession(new NextRequest(`https://app.invalid${route}`), "synthetic-nonce");
    assert.equal(result.status, 200);
    assert.equal(result.headers.get("x-middleware-request-x-nonce"), "synthetic-nonce");
    assert.match(result.headers.get("x-middleware-request-cookie"), /synthetic-refresh=refreshed/);
  });
  test(`middleware ${route}: fallo Auth no redirige ni pierde cookies`, async () => {
    const middleware = await load("lib/supabase/middleware.ts", fixture({ error: new AuthApiError("offline", 503) }));
    const result = await middleware.updateSession(new NextRequest(`https://app.invalid${route}`));
    assert.equal(result.status, 503);
    assert.equal(result.headers.get("location"), null);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal(result.cookies.get("synthetic-refresh")?.value, "refreshed");
  });
  test(`página real ${route}: sesión y parámetros repetidos`, async () => {
    const page = await load(`app/(auth)${route}/page.tsx`, fixture({ user: { id: "synthetic" } }));
    for (const [next, expected] of [["/buscar?q=mesa", "/buscar?q=mesa"], [["/perfil", "/vender"], "/"], ["/a/../login", "/"]]) {
      await assert.rejects(page.default({ searchParams: Promise.resolve({ next }) }), (e: any) => e.destination === expected);
    }
  });
  test(`página real ${route}: invitado renderiza; caída Auth falla`, async () => {
    const guest = await load(`app/(auth)${route}/page.tsx`, fixture({ error: missing }));
    assert.ok(await guest.default({}));
    const unavailable = await load(`app/(auth)${route}/page.tsx`, fixture({ throws: true }));
    await assert.rejects(unavailable.default({}), /offline/);
  });
}
