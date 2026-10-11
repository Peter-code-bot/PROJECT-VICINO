import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../../lib/pruebas/cargar-real";

type Actions = typeof import("./actions");
const UID = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const OP = "10000000-0000-4000-8000-000000000001";
const snapshot = { id: UID, username: "alice", nombre: "Alice", bio: null, foto: null, intereses: null,
  onboarding_camino: "explorar", onboarding_paso: "nombre", onboarding_revision: 1, has_seen_onboarding: false,
  es_vendedor: false, seller_type: "casual", categoria_negocio: null, nombre_negocio: null, descripcion_negocio: null, metodos_pago_aceptados: null };
const RESPONSE = { status: "saved", revision: 1, paso: "nombre", camino: "explorar", snapshot };
const CHECKPOINT = { expectedUserId: UID, operationId: OP, expectedRevision: 0, fromStep: "usuario", nextStep: "nombre", camino: "explorar" as const, fields: { username: "alice" } };

async function load(options: { userId?: string | null; data?: unknown; error?: object } = {}) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const paths: string[] = [];
  const cookieDeletes: string[] = [];
  const sentry = sentryEspia();
  const actions = await cargarReal<Actions>("app/(onboarding)/completar-perfil/actions.ts", { stubs: {
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: options.userId === null ? null : { id: options.userId ?? UID } } }) },
      rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data: options.data ?? RESPONSE, error: options.error ?? null }; },
    }) },
    "@/lib/rate-limit": { writeRateLimit: null, enforce: async () => ({ ok: true }) },
    "@/lib/revalidate-session": { revalidatePath: async (path: string) => { paths.push(path); } },
    "next/headers": { cookies: async () => ({ get: () => ({ value: "/buscar?q=mesa" }), delete: (key: string) => { cookieDeletes.push(key); } }) },
    "@sentry/nextjs": sentry,
  } });
  return { actions, calls, paths, cookieDeletes, sentry };
}

test("checkpoint de A enviado con sesión B no escribe aunque las revisiones coincidan", async () => {
  const f = await load({ userId: OTHER });
  assert.ok((await f.actions.guardarCheckpointOnboarding(CHECKPOINT)).error);
  assert.equal(f.calls.length, 0);
  const final = await f.actions.finalizarOnboarding({ expectedUserId: UID, operationId: OP, expectedRevision: 0, decision: "explorar" });
  assert.ok(final.error); assert.equal(f.calls.length, 0);
});
test("dos datos juntos o pantalla inexistente no pasan la validación de entrada", async () => {
  const f = await load();
  assert.ok((await f.actions.guardarCheckpointOnboarding({ ...CHECKPOINT, fields: { username: "alice", nombre: "Alice" } })).error);
  assert.equal(f.calls.length, 0);
  assert.ok((await f.actions.guardarCheckpointOnboarding({ ...CHECKPOINT, fromStep: "inventado" })).error);
  assert.equal(f.calls.length, 0);
});
test("checkpoint confirma snapshot propio, operación inmutable y no invalida rutas", async () => {
  const f = await load();
  const ack = await f.actions.guardarCheckpointOnboarding(CHECKPOINT);
  assert.equal(ack.success, true); assert.equal(ack.data?.revision, 1);
  assert.deepEqual(f.calls, [{ name: "guardar_checkpoint_onboarding_v3", args: { p_operation_id: OP, p_expected_revision: 0,
    p_from_step: "usuario", p_next_step: "nombre", p_camino: "explorar", p_fields: { username: "alice" } } }]);
  assert.deepEqual(f.paths, []);
});
test("ACK de otro usuario o mal formado y error transporte conservan operationId como incierto", async () => {
  for (const data of [{ ...RESPONSE, snapshot: { ...snapshot, id: OTHER } }, { ...RESPONSE, revision: 5 }, { status: "saved" }]) {
    const f = await load({ data });
    const result = await f.actions.guardarCheckpointOnboarding(CHECKPOINT);
    assert.equal(result.uncertain, true); assert.ok(result.error);
  }
  const f = await load({ error: { message: "Failed to fetch" } });
  assert.equal((await f.actions.finalizarOnboarding({ expectedUserId: UID, operationId: OP, expectedRevision: 0, decision: "explorar" })).uncertain, true);
});
test("conflicto devuelve snapshot canónico y fallo SQL definido no se clasifica como incierto", async () => {
  const f = await load({ data: { ...RESPONSE, status: "conflict" } });
  const result = await f.actions.guardarCheckpointOnboarding(CHECKPOINT);
  assert.equal(result.conflict, true); assert.equal(result.data?.snapshot.id, UID);
  const invalid = await load({ error: { code: "22023", message: "Categoría inválida" } });
  assert.equal((await invalid.actions.guardarCheckpointOnboarding(CHECKPOINT)).uncertain, undefined);
});
test("legacy, checkpoint y final ocultan mensajes SQL internos incluso bajo código de validación", async () => {
  for (const code of ["22023", "23505", "42501", "P0002"]) {
    const internal = "permission denied for function guardar_paso_onboarding_v2_internal; private policy";
    const f = await load({ error: { code, message: internal } });
    const responses = [
      await f.actions.guardarPasoOnboarding({ nombre: "Vecino" }),
      await f.actions.guardarCheckpointOnboarding(CHECKPOINT),
      await f.actions.finalizarOnboarding({ expectedUserId: UID, operationId: OP, expectedRevision: 0, decision: "explorar" }),
    ];
    for (const response of responses) {
      assert.ok(response.error); assert.notEqual(response.error, internal);
      assert.equal(response.error.includes("_internal"), false);
    }
    assert.deepEqual(f.paths, []);
  }
});
test("colisión de username y guard legal conocidos mantienen mensajes públicos útiles", async () => {
  for (const [code, message] of [
    ["23505", "Ese nombre de usuario ya esta en uso."],
    ["22023", "Ese nombre de usuario esta reservado."],
    ["42501", "Confirma los Términos y el Aviso de Privacidad para continuar."],
    ["22023", "Confirma el nombre de tu negocio antes de comenzar a vender."],
  ]) {
    const f = await load({ error: { code, message } });
    assert.equal((await f.actions.guardarCheckpointOnboarding(CHECKPOINT)).error, message);
    assert.equal(f.sentry.captureException.llamadas.length, 0);
  }
});
test("final preserva retorno seguro durante RSC y sólo invalida una vez al final", async () => {
  const finalSnapshot = { ...snapshot, has_seen_onboarding: true, onboarding_paso: null };
  const f = await load({ data: { ...RESPONSE, paso: null, snapshot: finalSnapshot } });
  const result = await f.actions.finalizarOnboarding({ expectedUserId: UID, operationId: OP, expectedRevision: 0, decision: "explorar" });
  assert.equal(result.success, true); assert.equal(result.destino, "/buscar?q=mesa");
  assert.deepEqual(f.cookieDeletes, []); assert.deepEqual(f.paths, ["/"]);
});
