/**
 * Volumen del reporte semanal de Sentry (25-sep a 2-oct): 756 «errores» con
 * solo ~41 de nivel error a la vista. El total del reporte suma los eventos
 * aceptados de todos los niveles; los warnings cuentan.
 *
 * El aviso «[rate-limit] NO HAY LIMITE...» se mandaba a Sentry una vez por
 * isolate (cada arranque en frio, Node y Edge, cada region). 074dde5 lo bajo
 * a warning creyendo que asi salia del recuento: salio de la lista de issues,
 * no del total ni de la cuota. Desde 6eb060c el guard de build rompe el
 * despliegue de produccion sin Upstash, asi que el aviso en caliente queda
 * solo en los logs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "./pruebas/cargar-real";

type RateLimit = typeof import("./rate-limit");

/** Fija variables de entorno durante `fn` y deja las de antes al terminar. */
async function conEntorno(valores: Record<string, string | undefined>, fn: () => Promise<void>) {
  const antes = Object.fromEntries(Object.keys(valores).map((k) => [k, process.env[k]]));
  const poner = (v: Record<string, string | undefined>) => {
    for (const [k, valor] of Object.entries(v)) {
      if (valor === undefined) delete process.env[k];
      else process.env[k] = valor;
    }
  };
  poner(valores);
  try {
    await fn();
  } finally {
    poner(antes);
  }
}

const SIN_UPSTASH_EN_PRODUCCION = {
  VERCEL_ENV: "production",
  UPSTASH_REDIS_REST_URL: undefined,
  UPSTASH_REDIS_REST_TOKEN: undefined,
};

test("produccion sin Upstash: el aviso queda en los logs, una vez por isolate, y no va a Sentry", async (t) => {
  const consola = t.mock.method(console, "error", () => {});
  const sentry = sentryEspia();
  await conEntorno(SIN_UPSTASH_EN_PRODUCCION, async () => {
    const rl = await cargarReal<RateLimit>("lib/rate-limit.ts", { stubs: { "@sentry/nextjs": sentry } });
    // Sigue fallando abierto: sin credenciales no se le cierra la app a nadie.
    assert.deepEqual(await rl.enforce(rl.writeRateLimit, "write:u1"), { ok: true });
    assert.deepEqual(await rl.check(rl.readHeavyRateLimit, "pagina:10.0.0.1"), { success: true });
    assert.deepEqual(await rl.enforce(rl.authRateLimit, "auth:10.0.0.1"), { ok: true });
    // El envio a Sentry era un import() perezoso: se deja correr.
    await new Promise((listo) => setTimeout(listo, 20));
  });
  assert.equal(sentry.captureMessage.llamadas.length, 0);
  assert.equal(sentry.captureException.llamadas.length, 0);
  assert.equal(consola.mock.callCount(), 1);
  assert.match(String(consola.mock.calls[0]?.arguments[0]), /NO HAY LIMITE DE PETICIONES EN PRODUCCION/);
});

test("fuera de produccion sin Upstash: ni logs ni Sentry (desarrollo y previews)", async (t) => {
  const consola = t.mock.method(console, "error", () => {});
  const sentry = sentryEspia();
  await conEntorno({ ...SIN_UPSTASH_EN_PRODUCCION, VERCEL_ENV: "preview" }, async () => {
    const rl = await cargarReal<RateLimit>("lib/rate-limit.ts", { stubs: { "@sentry/nextjs": sentry } });
    assert.deepEqual(await rl.enforce(rl.writeRateLimit, "write:u1"), { ok: true });
    await new Promise((listo) => setTimeout(listo, 20));
  });
  assert.equal(sentry.captureMessage.llamadas.length, 0);
  assert.equal(consola.mock.callCount(), 0);
});
