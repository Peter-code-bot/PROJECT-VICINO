import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../lib/pruebas/cargar-real";

type Legal = typeof import("./legal");
const UID = "00000000-0000-4000-8000-000000000001";
const INPUT = { expectedUserId: UID, terminosVersion: "1.1", avisoVersion: "2.2", aceptaTerminos: true, acusaAviso: true };
const STATE = { confirmed: true, documents: [{ documento: "terminos", version: "1.1", confirmada: true }, { documento: "aviso", version: "2.2", confirmada: true }] };

async function load(options: { user?: { id: string } | null; error?: object; data?: unknown } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const sentry = sentryEspia();
  const cliente = {
    auth: { getUser: async () => ({ data: { user: options.user === undefined ? { id: UID } : options.user } }) },
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: options.data ?? STATE, error: options.error ?? null }; },
  };
  const legal = await cargarReal<Legal>("app/actions/legal.ts", { stubs: {
    "@/lib/supabase/server": { createClient: async () => cliente },
    "@/lib/rate-limit": { writeRateLimit: null, enforce: async () => ({ ok: true }) },
    "@sentry/nextjs": sentry,
  } });
  return { legal, calls, sentry };
}

test("compatibilidad: el registro invisible anterior ya no escribe nada", async () => {
  const f = await load();
  assert.deepEqual(await f.legal.registrarAceptacionLegal(), { success: true, registradas: 0 });
  assert.equal(f.calls.length, 0);
});
test("confirmación no autenticada o cuenta cambiada no alcanza RPC", async () => {
  const anonymous = await load({ user: null });
  assert.ok((await anonymous.legal.confirmarDocumentosCuenta(INPUT)).error);
  assert.equal(anonymous.calls.length, 0);
  const changed = await load({ user: { id: "00000000-0000-4000-8000-000000000002" } });
  assert.ok((await changed.legal.confirmarDocumentosCuenta(INPUT)).error);
  assert.equal(changed.calls.length, 0);
});
test("casillas falsas, versión antigua y metadata adicional no se aceptan", async () => {
  const f = await load();
  for (const input of [{ ...INPUT, aceptaTerminos: false }, { ...INPUT, acusaAviso: false }, { ...INPUT, terminosVersion: "0.0" }, { ...INPUT, aceptado_en: "2020-01-01" }])
    assert.ok((await f.legal.confirmarDocumentosCuenta(input)).error);
  assert.equal(f.calls.length, 0);
});
test("acción expresa manda versiones visibles y dos decisiones, nunca fecha/modo del cliente", async () => {
  const f = await load();
  assert.deepEqual(await f.legal.confirmarDocumentosCuenta(INPUT), { success: true });
  assert.deepEqual(f.calls, [{ name: "confirmar_documentos_cuenta", args: {
    p_terminos_version: "1.1", p_aviso_version: "2.2", p_acepta_terminos: true, p_acusa_aviso: true,
  } }]);
});
test("cambio de versión durante la petición devuelve error y no anuncia confirmación", async () => {
  const message = "Los documentos cambiaron. Recarga y revisa las versiones actuales.";
  const f = await load({ error: { code: "22023", message } });
  assert.equal((await f.legal.confirmarDocumentosCuenta(INPUT)).error, message);
  assert.equal(f.sentry.captureException.llamadas.length, 0);
});
test("códigos SQL conocidos con detalles internos no se devuelven al confirmar", async () => {
  for (const code of ["22023", "42501", "P0002", "23505"]) {
    const internal = "permission denied for function internal_legal_rpc; private row and policy";
    const f = await load({ error: { code, message: internal } });
    const result = await f.legal.confirmarDocumentosCuenta(INPUT);
    assert.ok(result.error); assert.equal(result.error.includes("internal_legal_rpc"), false);
    assert.notEqual(result.error, internal); assert.equal(f.calls.length, 1);
  }
});
test("respuesta incierta o sin confirmación exige reintentar", async () => {
  const malformed = await load({ data: { confirmed: true } });
  assert.ok((await malformed.legal.confirmarDocumentosCuenta(INPUT)).error);
  const unconfirmed = await load({ data: { ...STATE, confirmed: false } });
  assert.ok((await unconfirmed.legal.confirmarDocumentosCuenta(INPUT)).error);
});
