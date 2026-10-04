/** S02-A: implementación real; solo se simulan límites externos. No usa red ni .env. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { destinoAutenticadoSeguro } from "../apps/web/lib/auth/destino-seguro";
import { enforceStrict } from "../apps/web/lib/rate-limit";

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
  const authCalls: unknown[] = [];
  const cookies = new Map<string, string>();
  const leases = new Map<string, string>();
  const lockRedis = {
    set: async (key: string, value: string) => {
      if (options.lockFail) throw new Error("offline");
      if (options.lockBusy || leases.has(key)) return null;
      leases.set(key, value); options.afterSet?.(); return "OK";
    },
    eval: async (_script: string, [key]: string[], [owner]: string[]) => leases.get(key) === owner ? Number(leases.delete(key)) : 0,
  };
  if (options.next) cookies.set("vicino_onboarding_next", options.next);
  return { calls, rateKeys, authCalls, cookies, leases, lockRedis, onLookup: options.onLookup, rpcCalls: [] as unknown[], lookup: options.lookup ?? { data: false, error: null }, rate: options.rate ?? { ok: true }, client: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { es_vendedor: options.vendor ?? false, has_seen_onboarding: options.hasSeen ?? true }, error: null }) }) }) }), rpc: async () => options.onboarding ?? { error: null }, auth: {
    getUser: async () => {
      if (options.throws) throw new Error("offline");
      return { data: { user: options.user ?? null }, error: options.error ?? null };
    },
    signUp: async (input: unknown) => {
      calls.push(input);
      if (options.signupFn) return options.signupFn(input);
      return options.signup ?? { data: { user: { identities: [{ id: "new" }] }, session: null }, error: null };
    },
    signInWithPassword: async (input: unknown) => { authCalls.push({ method: "login", input }); return options.login ?? { error: null }; },
    resetPasswordForEmail: async (email: string, input: unknown) => { authCalls.push({ method: "reset", email, input }); return { error: null }; },
    updateUser: async (input: unknown) => { authCalls.push({ method: "update", input }); return options.update ?? { error: null }; },
    exchangeCodeForSession: async () => options.exchange ?? { error: null },
  } } };
}

async function load(file: string, state: ReturnType<typeof fixture>) {
  if (!copies.has(file)) {
    const mocks: Record<string, string> = {
      "server-only": "export {};",
      "@upstash/redis": "export const Redis={fromEnv:()=>globalThis.state.lockRedis};",
      "@/lib/supabase/server": "export const createClient=async()=>globalThis.state.client;",
      "@/lib/supabase/admin": "export const createAdminClient=()=>({rpc:async(name,args)=>{globalThis.state.rpcCalls.push({name,args});globalThis.state.onLookup?.();return globalThis.state.lookup;}});",
      "@supabase/ssr": `export const createServerClient=(_url,_key,options)=>{
        options.cookies.setAll([{name:'synthetic-refresh',value:'refreshed',options:{httpOnly:true,sameSite:'lax',path:'/'}}]);
        return globalThis.state.client;
      };`,
      "next/headers": "export const headers=async()=>new Headers();export const cookies=async()=>({get:key=>({value:globalThis.state.cookies.get(key)}),delete:key=>globalThis.state.cookies.delete(key)});",
      "@/lib/revalidate-session": "export const revalidatePath=async()=>{};",
      "next/navigation": "export const redirect=(destination)=>{const e=new Error('REDIRECT');e.destination=destination;throw e;};",
      "@sentry/nextjs": "export const captureException=()=>{};export const captureMessage=()=>{};",
      "@/lib/rate-limit": `export const authRateLimit={};export const writeRateLimit={};export const otpResendIpRateLimit={};export const otpResendRateLimit={};
        export const otpVerifyIpRateLimit={};export const otpVerifyRateLimit={};export const getClientIp=()=> 'synthetic-ip';
        export const enforceStrict=async(_limit,key)=>{globalThis.state.rateKeys.push(key);return globalThis.state.strictRateCheck ? globalThis.state.strictRateCheck(key) : globalThis.state.rate;};export const enforce=async(_limiter,key)=>{globalThis.state.rateKeys.push(key);return globalThis.state.rate;};`,
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
  const context = vm.createContext({ module, exports: module.exports, require, state, URL, URLSearchParams, Headers, Request, Response, AbortSignal, Date: (state as any).clock ?? Date,
    process: { env: { UPSTASH_REDIS_REST_URL: "https://synthetic.invalid", UPSTASH_REDIS_REST_TOKEN: "synthetic", NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic", NEXT_PUBLIC_SITE_URL: "https://app.invalid" } },
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
  assert.deepEqual(plain(await action.signUp("test@example.com", "123456", "Prueba")), { estado: "autenticado", hasSession: true, alreadyLoggedIn: true });
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
for (const identities of [[], [{ id: "synthetic" }]]) {
  test(`acción real: clasifica respuesta de Auth identities=${JSON.stringify(identities)}`, async () => {
    const f = fixture({ error: missing, signup: { data: { user: { identities }, session: null }, error: null } });
    const action = await load("app/(auth)/actions.ts", f);
    assert.deepEqual(plain(await action.signUp(" TEST@example.com ", "123456", " Prueba ")), { estado: identities?.length === 0 ? "existente" : "verificacion_pendiente", hasSession: false });
    assert.deepEqual(plain(f.calls), [{ email: "test@example.com", password: "123456", options: { data: { full_name: "Prueba" }, emailRedirectTo: "https://app.invalid/auth/callback-server" } }]);
  });
}
test("respuesta ambigua de signup no abre OTP", async () => {
  for (const user of [{}, null]) {
    const action = await load("app/(auth)/actions.ts", fixture({ signup: { data: { user, session: null }, error: null } }));
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "error");
  }
});
test("acción real: sesión emitida por Auth", async () => {
  const action = await load("app/(auth)/actions.ts", fixture({ signup: { data: { session: {} }, error: null } }));
  assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).hasSession, true);
});
test("acción real: error de cuenta existente muestra estado explícito", async () => {
  const action = await load("app/(auth)/actions.ts", fixture({ signup: { data: {}, error: { code: "user_already_exists", message: "User already registered" } } }));
  assert.deepEqual(plain(await action.signUp("test@example.com", "123456", "Prueba")), { estado: "existente", hasSession: false });
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

for (const [name, limiter] of [
  ["ausente", null],
  ["error", { limit: async () => { throw new Error("offline"); } }],
  ["exceso", { limit: async () => ({ success: false }) }],
  ["timeout SDK permitido", { limit: async () => ({ success: true, reason: "timeout" }) }],
] as const) {
  test(`acción real con freno estricto ${name}: cero lookup, signup, reserva y sesión`, async () => {
    const f = fixture();
    Object.assign(f, { strictRateCheck: (key: string) => enforceStrict(limiter as never, key) });
    const action = await load("app/(auth)/actions.ts", f);
    const result = await action.signUp("test@example.com", "123456", "Prueba");
    assert.equal(result.estado, "error");
    assert.notEqual(result.hasSession, true);
    assert.equal(f.rpcCalls.length, 0);
    assert.equal(f.calls.length, 0);
    assert.equal(f.leases.size, 0);
    assert.equal(f.authCalls.length, 0);
  });
}

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

for (const kind of ["confirmada", "sin confirmar", "Google/Apple"]) {
  test(`cuenta ${kind}: lookup detiene signup y no emite sesión/correo`, async () => {
    const f = fixture({ lookup: { data: true, error: null } });
    const action = await load("app/(auth)/actions.ts", f);
    assert.deepEqual(plain(await action.signUp(" EXISTE@example.com ", "123456", "Prueba")), { estado: "existente", hasSession: false });
    assert.equal(f.calls.length, 0);
    assert.deepEqual(plain(f.rpcCalls), [{ name: "registration_email_exists", args: { p_email: "existe@example.com" } }]);
  });
}
for (const lookup of [{ data: null, error: { code: "offline" } }, { data: null, error: null }]) {
  test("fallo/resultado ambiguo de lookup no crea cuenta", async () => {
    const f = fixture({ lookup }); const action = await load("app/(auth)/actions.ts", f);
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "error");
    assert.equal(f.calls.length, 0);
  });
}
for (const route of ["/buscar?q=mesa", "/tecnologia/producto", "/vendedor/123", "/mapa", "/chat", "/comunidades", "/?feed=following", "/?feed=comunidades&tab=mias", "/?feed=solicitudes&cats=comida", "/?cats=comida"]) {
  test(`invitado ruta directa ${route} conserva destino/cookies`, async () => {
    const middleware = await load("lib/supabase/middleware.ts", fixture({ error: missing }));
    const result = await middleware.updateSession(new NextRequest(`https://app.invalid${route}`));
    assert.equal(result.status, 307);
    assert.equal(new URL(result.headers.get("location")).searchParams.get("next"), route);
    assert.equal(result.cookies.get("synthetic-refresh")?.value, "refreshed");
  });
}
for (const route of ["/", "/?feed=parati", "/?feed=solicitudes", "/?feed=comunidades", "/?feed=comunidades&tab=descubrir", "/terminos", "/privacidad", "/centro-de-ayuda", "/forgot-password", "/auth/callback-server?code=synthetic"]) {
  test(`invitado ruta pública ${route}`, async () => {
    const middleware = await load("lib/supabase/middleware.ts", fixture({ error: missing }));
    assert.equal((await middleware.updateSession(new NextRequest(`https://app.invalid${route}`))).status, 200);
  });
}

test("recuperación valida correo/callback antes de solicitar el enlace", async () => {
  const f = fixture(); const action = await load("app/(auth)/actions.ts", f);
  for (const callback of ["https://evil.invalid/auth/callback-server", "https://app.invalid/perfil/editar"]) {
    assert.ok((await action.requestPasswordReset("test@example.com", callback)).error);
  }
  assert.equal(f.authCalls.length, 0);
  const callback = "https://app.invalid/auth/callback-server?next=%2Freset-password%3Fnext%3D%252Fbuscar";
  assert.equal((await action.requestPasswordReset(" TEST@example.com ", callback)).success, true);
  assert.deepEqual(plain(f.authCalls), [{ method: "reset", email: "test@example.com", input: { redirectTo: callback } }]);
});
test("contraseña recuperada exige sesión, valida y conserva destino seguro", async () => {
  const guest = fixture(); const unavailable = await load("app/(auth)/actions.ts", guest);
  assert.ok((await unavailable.cambiarPasswordRecuperada("synthetic-new-password", "/buscar")).error);
  assert.equal(guest.authCalls.length, 0);
  const f = fixture({ user: { id: "synthetic" } }); const action = await load("app/(auth)/actions.ts", f);
  assert.ok((await action.cambiarPasswordRecuperada("x", "/buscar")).error);
  assert.equal(f.authCalls.length, 0);
  assert.deepEqual(plain(await action.cambiarPasswordRecuperada("synthetic-new-password", "/buscar?q=mesa")), { success: true, destino: "/buscar?q=mesa" });
  assert.equal((await action.cambiarPasswordRecuperada("synthetic-new-password", "//evil.invalid")).destino, "/");
});
test("fallo al actualizar contraseña no continúa al destino", async () => {
  const action = await load("app/(auth)/actions.ts", fixture({ user: { id: "synthetic" }, update: { error: { message: "offline" } } }));
  const result = await action.cambiarPasswordRecuperada("synthetic-new-password", "/buscar");
  assert.ok(result.error); assert.equal(result.destino, undefined);
});
test("login sin confirmar ofrece reenvío y normaliza correo", async () => {
  const f = fixture({ login: { error: { code: "email_not_confirmed", message: "Email not confirmed" } } });
  const action = await load("app/(auth)/actions.ts", f);
  assert.equal((await action.signInWithPassword(" TEST@example.com ", "synthetic-password")).requiereConfirmacion, true);
  assert.equal((f.authCalls[0] as any).input.email, "test@example.com");
});
test("onboarding completa antes del destino y consume su cookie", async () => {
  for (const [next, expected] of [["/tecnologia/producto", "/tecnologia/producto"], ["/login", "/"], ["//evil.invalid", "/"]]) {
    const f = fixture({ user: { id: "synthetic" }, next }); const action = await load("app/(marketplace)/perfil/actions.ts", f);
    assert.deepEqual(plain(await action.completeOnboarding()), { success: true, destino: expected });
    assert.equal(f.cookies.has("vicino_onboarding_next"), false);
  }
  const f = fixture({ user: { id: "synthetic" }, next: "/buscar", onboarding: { error: { code: "P0002", message: "missing" } } });
  const action = await load("app/(marketplace)/perfil/actions.ts", f);
  assert.ok((await action.completeOnboarding()).error);
  assert.equal(f.cookies.get("vicino_onboarding_next"), "/buscar");
});
test("middleware conserva destino de onboarding en cookie HttpOnly", async () => {
  const middleware = await load("lib/supabase/middleware.ts", fixture({ user: { id: "synthetic" } }));
  const response = await middleware.updateSession(new NextRequest("https://app.invalid/bienvenida?next=%2Ftecnologia%2Fproducto"));
  const cookie = response.cookies.get("vicino_onboarding_next");
  assert.equal(cookie.value, "/tecnologia/producto"); assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true);
});
test("callback real conserva recuperación y rechaza destinos externos/circulares", async () => {
  const callback = await load("app/auth/callback-server/route.ts", fixture());
  for (const [next, expected] of [["/reset-password?next=%2Fbuscar", "/reset-password?next=%2Fbuscar"], ["/buscar?q=mesa", "/buscar?q=mesa"], ["//evil.invalid", "/"], ["/login", "/"]]) {
    const response = await callback.GET(new Request(`https://app.invalid/auth/callback-server?code=synthetic&next=${encodeURIComponent(next)}`));
    assert.equal(response.status, 303); assert.equal(response.headers.get("location"), `https://app.invalid${expected}`);
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
});
test("enlace de registro nuevo conserva producto y descarta next externo", async () => {
  const f = fixture(); const action = await load("app/(auth)/actions.ts", f);
  await action.signUp("test@example.com", "123456", "Prueba", "/tecnologia/producto");
  assert.equal((f.calls[0] as any).options.emailRedirectTo, "https://app.invalid/auth/callback-server?next=%2Ftecnologia%2Fproducto");
  await action.signUp("test@example.com", "123456", "Prueba", "//evil.invalid");
  assert.equal((f.calls[1] as any).options.emailRedirectTo, "https://app.invalid/auth/callback-server");
});
test("dos envíos simultáneos VICINO: solo uno consulta y llama Auth; el reintento detecta la cuenta", async () => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const called = new Promise<void>(resolve => { started = resolve; });
  const f = fixture({ signupFn: async () => { started(); await pending; return { data: { user: { identities: [{ id: "new" }] }, session: null }, error: null }; } });
  const action = await load("app/(auth)/actions.ts", f);
  const first = action.signUp("TEST@example.com", "123456", "Prueba");
  await called;
  assert.equal((await action.signUp(" test@example.com ", "123456", "Prueba")).estado, "error");
  assert.equal(f.calls.length, 1); assert.equal(f.rpcCalls.length, 1);
  release(); assert.equal((await first).estado, "verificacion_pendiente");
  assert.equal(f.leases.size, 0);
  f.lookup = { data: true, error: null };
  assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "existente");
  assert.equal(f.calls.length, 1); assert.equal(f.leases.size, 0);
});
test("reserva distribuida: caída/bloqueo no consultan Auth; transporte ambiguo conserva reserva", async () => {
  for (const options of [{ lockFail: true }, { lockBusy: true }]) {
    const f = fixture(options); const action = await load("app/(auth)/actions.ts", f);
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "error");
    assert.equal(f.calls.length, 0); assert.equal(f.rpcCalls.length, 0);
  }
  for (const options of [{ signupFn: async () => { throw new Error("offline"); } }, { signup: { data: {}, error: { name: "AuthRetryableFetchError", message: "offline", status: 0 } } }]) {
    const f = fixture(options); const action = await load("app/(auth)/actions.ts", f);
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "error");
    assert.equal(f.leases.size, 1);
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "error");
    assert.equal(f.calls.length, 1);
  }
});
test("callback vencido conserva contexto interno al login y recuperación siguiente", async () => {
  const callback = await load("app/auth/callback-server/route.ts", fixture({ exchange: { error: { message: "expired" } } }));
  for (const [next, expected] of [["/reset-password?next=%2Ftecnologia%2Fproducto", "/tecnologia/producto"], ["/buscar?q=mesa", "/buscar?q=mesa"], ["//evil.invalid", "/"]]) {
    const response = await callback.GET(new Request(`https://app.invalid/auth/callback-server?code=synthetic&next=${encodeURIComponent(next)}`));
    const location = new URL(response.headers.get("location"));
    assert.equal(location.pathname, "/login"); assert.equal(location.searchParams.get("next"), expected);
  }
});
test("reserva atrasada o vencida antes de Auth nunca envía signup", async () => {
  for (const during of ["set", "lookup"]) {
    let now = 0;
    const f = fixture({ afterSet: () => { if (during === "set") now = 299_000; }, onLookup: () => { if (during === "lookup") now = 75_000; } });
    (f as any).clock = { now: () => now };
    const action = await load("app/(auth)/actions.ts", f);
    assert.equal((await action.signUp("test@example.com", "123456", "Prueba")).estado, "error");
    assert.equal(f.calls.length, 0);
  }
});
test("destino vendedor después de login exige onboarding primero y conserva cookies", async () => {
  for (const route of ["/vender", "/seller/listings"]) {
    const middleware = await load("lib/supabase/middleware.ts", fixture({ user: { id: "synthetic" }, hasSeen: false }));
    const response = await middleware.updateSession(new NextRequest(`https://app.invalid${route}`));
    const destination = new URL(response.headers.get("location"));
    assert.equal(destination.pathname, "/bienvenida"); assert.equal(destination.searchParams.get("next"), route);
    assert.equal(response.cookies.get("synthetic-refresh")?.value, "refreshed");
  }
});
