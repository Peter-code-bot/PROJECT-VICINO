import assert from "node:assert/strict";
import { test } from "node:test";
import { requiereSesion, loginPara } from "../apps/web/lib/auth/acceso-invitado";
import { destinoCallbackSeguro } from "../apps/web/lib/auth/destino-seguro";
import { destinoAutenticadoSeguro } from "../apps/web/lib/auth/destino-seguro";
import { enforceStrict } from "../apps/web/lib/rate-limit";
import { Ratelimit } from "../apps/web/node_modules/@upstash/ratelimit";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("recuperación llega a contraseña y conserva siguiente ruta interna", () => {
  assert.equal(destinoCallbackSeguro("/reset-password?next=%2Fbuscar%3Fq%3Dmesa"), "/reset-password?next=%2Fbuscar%3Fq%3Dmesa");
  assert.equal(destinoCallbackSeguro("/reset-password?next=%2F%2Fevil.invalid"), "/reset-password?next=%2F");
  for (const input of ["//evil.invalid", "https://evil.invalid", "/login", "/register"]) assert.equal(destinoCallbackSeguro(input), "/");
});
test("lookup se detiene sin limitador, ante caída y ante exceso", async () => {
  assert.equal((await enforceStrict(null, "test")).ok, false);
  assert.equal((await enforceStrict({ limit: async () => { throw new Error("offline"); } } as never, "test")).ok, false);
  assert.equal((await enforceStrict({ limit: async () => ({ success: false }) } as never, "test")).ok, false);
  assert.equal((await enforceStrict({ limit: async () => ({ success: true }) } as never, "test")).ok, true);
});
test("timeout del SDK no cuenta como comprobación válida aunque success sea true", async () => {
  const result = await enforceStrict({ limit: async () => ({ success: true, reason: "timeout" }) } as never, "test");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /No pudimos comprobar/);
});
test("timeout real del SDK con Redis sin respuesta falla de forma recuperable", async () => {
  const pending = () => new Promise<never>(() => {});
  const limiter = new Ratelimit({
    redis: { evalsha: pending, eval: pending } as never,
    limiter: Ratelimit.slidingWindow(5, "1 m"),
    timeout: 20,
    ephemeralCache: false,
  });
  const sdk = await limiter.limit("synthetic");
  assert.equal(sdk.success, true);
  assert.equal(sdk.reason, "timeout");
  const result = await enforceStrict(limiter, "synthetic");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /No pudimos comprobar/);
});
test("política cubre consultas y rutas codificadas, sin afectar Home ni legales", () => {
  for (const route of ["/buscar", "/%62uscar", "/?cats=comida", "/?feed=following", "/?feed=comunidades&tab=mias", "/?feed=solicitudes&cats=servicios", "/?feed=comunidades&cats=&cats=comida", "/?feed=solicitudes&feed=following", "/?feed=comunidades&tab=muro&tab=mias", "/vendedor/123", "/tecnologia/producto", "/vender"]) assert.equal(requiereSesion(route), true, route);
  for (const route of ["/", "/?feed=parati", "/?feed=solicitudes", "/?feed=comunidades", "/?feed=comunidades&tab=descubrir", "/terminos?version=1", "/privacidad", "/centro-de-ayuda", "/auth/callback-server?code=test", "/reset-password"]) assert.equal(requiereSesion(route), false, route);
  assert.equal(loginPara("/buscar?q=mesa"), "/login?next=%2Fbuscar%3Fq%3Dmesa");
});
test("chat después de autenticación vuelve al vendedor sin crear contacto/compra", () => {
  const seller = "11111111-1111-1111-1111-111111111111";
  const intent = `/chat?seller=${seller}&product=22222222-2222-2222-2222-222222222222&intent=buy&k=33333333-3333-3333-3333-333333333333`;
  assert.equal(destinoAutenticadoSeguro(intent), `/vendedor/${seller}`);
  for (const variant of ["/chat/", "/chat//", "/chat%2f", "/chat%2f%2f"]) assert.equal(destinoAutenticadoSeguro(intent.replace("/chat?", `${variant}?`)), `/vendedor/${seller}`);
  assert.equal(loginPara(intent), `/login?next=${encodeURIComponent(`/vendedor/${seller}`)}`);
  assert.equal(destinoCallbackSeguro(intent), `/vendedor/${seller}`);
  assert.equal(destinoAutenticadoSeguro("/chat?seller=invalid&intent=buy"), "/chat");
  assert.equal(destinoAutenticadoSeguro("/chat/11111111-1111-1111-1111-111111111111"), "/chat/11111111-1111-1111-1111-111111111111");
});
test("callbacks no son destinos pendientes y no forman ciclos de login", () => {
  for (const next of ["/auth/callback", "/auth/callback-server", "/callback", "/auth//callback-server", "/auth%2fcallback-server"]) assert.equal(destinoAutenticadoSeguro(next), "/");
});
test("build de producción exige Redis; preview conserva compilación sin credenciales", () => {
  const script = fileURLToPath(new URL("../apps/web/scripts/check-rate-limit-env.mjs", import.meta.url));
  for (const [environment, url, token, expected] of [["production", "", "", 1], ["production", "https://synthetic.invalid", "synthetic", 0], ["preview", "", "", 0]] as const) {
    const run = spawnSync(process.execPath, [script], { env: { ...process.env, VERCEL_ENV: environment, UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token }, encoding: "utf8" });
    assert.equal(run.status, expected);
    if (expected === 1) assert.match(run.stderr, /Registro requiere UPSTASH/);
  }
});
