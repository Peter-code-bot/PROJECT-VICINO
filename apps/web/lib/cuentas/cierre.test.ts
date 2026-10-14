import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { instalarWindowFalso } from "./pruebas-entorno";
import { buscarCuenta, cuentaMasReciente, cuentasDormidas, guardarCuenta, leerCuentas, quitarCuenta, vaciarBoveda, type Cuenta } from "./boveda";
import { cerrarSesionConCuentas, type PuertoCierre } from "./cierre";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

function cuenta(userId: string, nombre: string, ultimoUso: number): Cuenta {
  return { userId, email: `${nombre.toLowerCase()}@x`, nombre, username: null, foto: null, accessToken: `a-${nombre}`, refreshToken: `r-${nombre}`, ultimoUso };
}

interface Escenario {
  activa?: string | null;
  sesionActualLanza?: boolean;
  revocarFalla?: Set<string>;
  signOutError?: AuthRetryableFetchError | "lanza";
  aplicarFalla?: "vencida" | "red";
}

function puerto(e: Escenario) {
  const llamadas: string[] = [];
  const reportes: string[] = [];
  const p: PuertoCierre = {
    async sesionActual() {
      llamadas.push("sesionActual");
      if (e.sesionActualLanza) throw new Error("tope");
      return e.activa === undefined ? A : e.activa;
    },
    async soltarTokenPush(userId) {
      llamadas.push(`soltarPush:${userId}`);
    },
    async revocar(c) {
      llamadas.push(`revocar:${c.userId}`);
      return e.revocarFalla?.has(c.userId) ? { ok: false, clase: "red", error: new AuthRetryableFetchError("x", 0) } : { ok: true, yaInvalida: false };
    },
    async signOut() {
      llamadas.push("signOut");
      if (e.signOutError === "lanza") throw new Error("tope");
      return { error: e.signOutError ?? null };
    },
    async aplicar(destino) {
      llamadas.push(`aplicar:${destino.userId}`);
      if (e.aplicarFalla === "vencida") {
        quitarCuenta(destino.userId);
        return { ok: false, motivo: "vencida", mensaje: `La sesión de ${destino.nombre} venció. Vuelve a entrar.` };
      }
      if (e.aplicarFalla === "red") return { ok: false, motivo: "red", mensaje: "Sin conexión. Inténtalo de nuevo." };
      return { ok: true, userId: destino.userId, nombre: destino.nombre };
    },
    boveda: { quitar: quitarCuenta, vaciar: vaciarBoveda, cuentaMasReciente, cuentasDormidas },
    marcar: (userId) => llamadas.push(`marcar:${userId}`),
    desmarcar: () => llamadas.push("desmarcar"),
    reportar: (paso) => reportes.push(paso),
  };
  return { p, llamadas, reportes };
}

beforeEach(() => {
  instalarWindowFalso();
  guardarCuenta(cuenta(A, "Pedro", 300), 300);
  guardarCuenta(cuenta(B, "Tienda", 200), 200);
  guardarCuenta(cuenta(C, "Vieja", 100), 100);
});

test("con otras cuentas guardadas, cerrar la activa pasa a la mas reciente, con la marca puesta ANTES de signOut y renovada despues", async () => {
  const { p, llamadas } = puerto({});
  const r = await cerrarSesionConCuentas(p);
  assert.deepEqual(r, { ok: true, siguiente: { userId: B, nombre: "Tienda" } });
  assert.deepEqual(llamadas, ["sesionActual", `soltarPush:${A}`, `marcar:${B}`, "signOut", `marcar:${B}`, `aplicar:${B}`]);
  assert.equal(buscarCuenta(A), null);
  assert.deepEqual(leerCuentas().map((c) => c.userId), [B, C]);
});

test("sin otras cuentas, es el cierre de siempre: a /login", async () => {
  quitarCuenta(B);
  quitarCuenta(C);
  const { p, llamadas } = puerto({});
  const r = await cerrarSesionConCuentas(p);
  assert.deepEqual(r, { ok: true, siguiente: null });
  assert.deepEqual(llamadas, ["sesionActual", `soltarPush:${A}`, "signOut"]);
  assert.equal(leerCuentas().length, 0);
});

test("si signOut falla, la sesion sigue viva: no se navega, se desmarca y nada sale de la boveda", async () => {
  const red = puerto({ signOutError: new AuthRetryableFetchError("x", 0) });
  const r = await cerrarSesionConCuentas(red.p);
  assert.equal(r.ok, false);
  assert.deepEqual(red.llamadas.slice(-2), ["signOut", "desmarcar"]);
  assert.equal(leerCuentas().length, 3);
  const tope = puerto({ signOutError: "lanza" });
  assert.equal((await cerrarSesionConCuentas(tope.p)).ok, false);
  assert.deepEqual(tope.reportes, ["sign_out"]);
});

test("si la siguiente no despierta, se avisa y se va a /login; una vencida ya salio de la boveda", async () => {
  const { p, llamadas } = puerto({ aplicarFalla: "vencida" });
  const r = await cerrarSesionConCuentas(p);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.siguiente, null);
    assert.match(r.aviso ?? "", /Tienda/);
  }
  assert.equal(llamadas.at(-1), "desmarcar");
  assert.deepEqual(leerCuentas().map((c) => c.userId), [C]);
  const red = puerto({ aplicarFalla: "red" });
  const r2 = await cerrarSesionConCuentas(red.p);
  assert.equal(r2.ok && r2.siguiente, null);
  assert.deepEqual(red.reportes, ["cierre_siguiente"]);
});

test("la cuenta que se va se resuelve con la cookie, sin red: sin sesion local no se inventa una siguiente equivocada", async () => {
  // Sin sesion: la "mas reciente" es la primera de la boveda, que es A (su espejo).
  const { p, llamadas } = puerto({ activa: null });
  const r = await cerrarSesionConCuentas(p);
  assert.equal(r.ok && r.siguiente?.userId, A);
  assert.equal(llamadas.includes(`soltarPush:${A}`), false);
  // Si leer la cookie lanza, se sigue sin cuenta activa y se reporta.
  const lanza = puerto({ sesionActualLanza: true });
  assert.equal((await cerrarSesionConCuentas(lanza.p)).ok, true);
  assert.deepEqual(lanza.reportes, ["sesion_actual"]);
});

test("salir de todas revoca cada dormida antes de tocar la activa y deja la boveda vacia", async () => {
  const { p, llamadas } = puerto({});
  const r = await cerrarSesionConCuentas(p, { todas: true });
  assert.deepEqual(r, { ok: true, siguiente: null });
  assert.deepEqual(llamadas, ["sesionActual", `soltarPush:${A}`, `revocar:${B}`, `revocar:${C}`, "signOut"]);
  assert.equal(leerCuentas().length, 0);
});

test("salir de todas se detiene si una dormida no se pudo revocar: la activa sigue viva y la fallida sigue en la boveda", async () => {
  const { p, llamadas, reportes } = puerto({ revocarFalla: new Set([C]) });
  const r = await cerrarSesionConCuentas(p, { todas: true });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /Vieja/);
  assert.equal(llamadas.includes("signOut"), false);
  assert.deepEqual(leerCuentas().map((c) => c.userId), [A, C]);
  assert.deepEqual(reportes, ["revocar_dormida"]);
});
