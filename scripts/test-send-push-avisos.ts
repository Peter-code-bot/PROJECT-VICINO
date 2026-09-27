/**
 * PT07: badge real y limpieza de tokens UNREGISTERED en send-push.
 *
 *   apps/web/node_modules/.bin/jiti scripts/test-send-push-avisos.ts
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  construirAps,
  contarNoLeidos,
  esTokenMuerto,
  soltarTokenMuerto,
} from "../supabase/functions/send-push/avisos.ts";

// Base de datos falsa: registra los filtros y devuelve lo que diga cada tabla.
type Resp = { data?: unknown; error?: unknown; count?: number | null };
function dbFalsa(respuestas: Record<string, Resp | ((filtros: string[]) => Resp)>) {
  const llamadas: { tabla: string; filtros: string[] }[] = [];
  return {
    llamadas,
    from(tabla: string) {
      const filtros: string[] = [];
      llamadas.push({ tabla, filtros });
      const clave = () => {
        if (tabla !== "chats") return tabla;
        return filtros.some((f) => f.startsWith("comprador_id")) ? "chats:comprador" : "chats:vendedor";
      };
      const b: Record<string, unknown> = {};
      for (const m of ["select", "update", "neq"]) b[m] = (..._: unknown[]) => b;
      b.eq = (col: string, val: unknown) => { filtros.push(`${col}=${String(val)}`); return b; };
      b.then = (ok: (r: Resp) => unknown, ko: (e: unknown) => unknown) => {
        const r = respuestas[clave()];
        const valor = typeof r === "function" ? r(filtros) : r ?? {};
        return Promise.resolve(valor).then(ok, ko);
      };
      return b;
    },
  };
}

const FCM_UNREGISTERED = JSON.stringify({
  error: {
    code: 404,
    message: "Requested entity was not found.",
    status: "NOT_FOUND",
    details: [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "UNREGISTERED" }],
  },
});

test("esTokenMuerto: solo 404 con UNREGISTERED", () => {
  assert.equal(esTokenMuerto(404, FCM_UNREGISTERED), true);
  assert.equal(esTokenMuerto(404, JSON.stringify({ error: { code: 404 } })), false, "404 sin details");
  assert.equal(esTokenMuerto(400, JSON.stringify({ error: { details: [{ errorCode: "INVALID_ARGUMENT" }] } })), false);
  assert.equal(esTokenMuerto(403, JSON.stringify({ error: { details: [{ errorCode: "SENDER_ID_MISMATCH" }] } })), false);
  assert.equal(esTokenMuerto(500, FCM_UNREGISTERED), false, "un 500 nunca suelta el token");
  assert.equal(esTokenMuerto(404, "<html>Not Found</html>"), false, "cuerpo no JSON");
  assert.equal(esTokenMuerto(404, ""), false, "cuerpo vacio");
});

test("contarNoLeidos: notificaciones + comprador + vendedor", async () => {
  const db = dbFalsa({
    notifications: { count: 2 },
    "chats:comprador": { data: [{ no_leidos_comprador: 1 }] },
    "chats:vendedor": { data: [{ no_leidos_vendedor: 3 }, { no_leidos_vendedor: 1 }] },
  });
  assert.equal(await contarNoLeidos(db, "u1"), 7);
  const n = db.llamadas.find((l) => l.tabla === "notifications")!;
  assert.deepEqual(n.filtros, ["user_id=u1", "leida=false"]);
});

test("contarNoLeidos: sin filas da 0 y los null cuentan 0", async () => {
  const db = dbFalsa({
    notifications: { count: null },
    "chats:comprador": { data: [{ no_leidos_comprador: null }] },
    "chats:vendedor": { data: [] },
  });
  assert.equal(await contarNoLeidos(db, "u1"), 0);
});

test("contarNoLeidos: un error en cualquier consulta da null", async () => {
  for (const rota of ["notifications", "chats:comprador", "chats:vendedor"]) {
    const base: Record<string, Resp> = {
      notifications: { count: 1 },
      "chats:comprador": { data: [] },
      "chats:vendedor": { data: [] },
    };
    base[rota] = { error: { message: "boom" } };
    assert.equal(await contarNoLeidos(dbFalsa(base), "u1"), null, rota);
  }
});

test("construirAps: badge null omite la clave; numeros se recortan", () => {
  const sin = construirAps("T", "C", null);
  assert.equal("badge" in sin, false);
  assert.deepEqual(sin, { alert: { title: "T", body: "C" }, sound: "default", "content-available": 1 });
  assert.equal(construirAps("T", "C", 7).badge, 7);
  assert.equal(construirAps("T", "C", -1).badge, 0);
  assert.equal(construirAps("T", "C", 3.7).badge, 3);
  assert.equal("badge" in construirAps("T", "C", Number.NaN), false);
});

test("soltarTokenMuerto: compare-and-set por id Y token", async () => {
  const db = dbFalsa({ profiles: { data: [{ id: "u1" }] } });
  const r = await soltarTokenMuerto(db, "u1", "tok-A");
  assert.deepEqual(r, { ok: true, filas: 1 });
  assert.deepEqual(db.llamadas[0].filtros, ["id=u1", "fcm_token=tok-A"]);
});

test("soltarTokenMuerto: token ya cambiado = 0 filas; error = fallo, no exito", async () => {
  assert.deepEqual(await soltarTokenMuerto(dbFalsa({ profiles: { data: [] } }), "u1", "viejo"), { ok: true, filas: 0 });
  const r = await soltarTokenMuerto(dbFalsa({ profiles: { error: { code: "42501" } } }), "u1", "tok");
  assert.equal(r.ok, false);
});
