import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { AuthApiError, AuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { crearSupabaseFalso } from "../pruebas/supabase-falso";
import { instalarWindowFalso, type WindowFalso } from "./pruebas-entorno";
import { buscarCuenta, guardarCuenta, leerCuentas, quitarCuenta, type Cuenta } from "./boveda";
import { aplicarCuenta, cambiarACuenta, datosDeSesion, reiniciarCambioParaPruebas, type PuertoCambio } from "./cambio";
import type { ResultadoProbar } from "./sesion-aislada";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

function sesion(userId: string, sufijo: string, email = `${userId.slice(-1)}@correo.mx`): Session {
  return {
    access_token: `access-${sufijo}`,
    refresh_token: `refresh-${sufijo}`,
    token_type: "bearer",
    expires_in: 3600,
    user: { id: userId, email, app_metadata: {}, user_metadata: { full_name: `Meta ${userId.slice(-1)}` }, aud: "authenticated", created_at: "" },
  };
}

function cuentaB(): Cuenta {
  return { userId: B, email: "b@correo.mx", nombre: "Tienda B", username: "tiendab", foto: null, accessToken: "access-b-viejo", refreshToken: "refresh-b-viejo", ultimoUso: 1 };
}

interface Escenario {
  sesionActual?: Session | null;
  errorGetSession?: AuthApiError;
  prueba?: ResultadoProbar;
  errorSetSession?: AuthApiError | AuthRetryableFetchError | "lanza";
  errorPerfil?: boolean;
}

function puerto(escenario: Escenario) {
  const llamadas: string[] = [];
  const reportes: string[] = [];
  const supabase = crearSupabaseFalso({
    usuario: { id: A },
    errores: escenario.errorPerfil ? { profiles: { status: 403, body: { code: "42501", message: "permission denied" } } } : undefined,
  });
  const p: PuertoCambio = {
    principal: {
      async getSession() {
        llamadas.push("getSession");
        if (escenario.errorGetSession) return { data: { session: null }, error: escenario.errorGetSession };
        return { data: { session: escenario.sesionActual === undefined ? sesion(A, "a-fresco") : escenario.sesionActual }, error: null };
      },
      async setSession(tokens) {
        llamadas.push(`setSession:${tokens.refresh_token}`);
        if (escenario.errorSetSession === "lanza") throw new TypeError("Failed to fetch");
        if (escenario.errorSetSession) return { data: { session: null }, error: escenario.errorSetSession };
        return { data: { session: sesion(B, "b-aplicado") }, error: null };
      },
    },
    async probar(tokens) {
      llamadas.push(`probar:${tokens.refreshToken}`);
      return escenario.prueba ?? { ok: true, sesion: sesion(B, "b-nuevo") };
    },
    async soltarTokenPush(userId) {
      llamadas.push(`soltarPush:${userId}`);
      const { error } = await supabase.cliente.from("profiles").update({ fcm_token: null }).eq("id", userId);
      if (error) throw error;
    },
    boveda: { guardar: guardarCuenta, quitar: quitarCuenta, buscar: buscarCuenta },
    marcar: (userId) => llamadas.push(`marcar:${userId}`),
    desmarcar: () => llamadas.push("desmarcar"),
    reportar: (paso) => reportes.push(paso),
  };
  return { p, llamadas, reportes, peticiones: supabase.peticiones };
}

let ventana: WindowFalso;
beforeEach(() => {
  ventana = instalarWindowFalso();
  reiniciarCambioParaPruebas();
  guardarCuenta({ userId: A, email: "a@correo.mx", nombre: "Pedro", username: "pedro", foto: "https://x/a.png", accessToken: "access-a-viejo", refreshToken: "refresh-a-viejo" }, 100);
  guardarCuenta(cuentaB(), 50);
});

test("el camino feliz guarda A con tokens frescos, prueba B, suelta el push de A, guarda B y aplica la sesion probada", async () => {
  const { p, llamadas, reportes, peticiones } = puerto({});
  const r = await cambiarACuenta(cuentaB(), p);
  assert.deepEqual(r, { ok: true, userId: B, nombre: "Tienda B" });
  assert.deepEqual(llamadas, ["getSession", "probar:refresh-b-viejo", `soltarPush:${A}`, `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  assert.deepEqual(reportes, []);
  // A conserva su perfil y lleva el token mas nuevo; B lleva los tokens que devolvio la prueba y queda primera.
  const a = buscarCuenta(A)!;
  assert.equal(a.nombre, "Pedro");
  assert.equal(a.foto, "https://x/a.png");
  assert.equal(a.refreshToken, "refresh-a-fresco");
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-nuevo");
  assert.equal(leerCuentas()[0]?.userId, B);
  // El UPDATE del fcm_token fue para A y solo para A.
  const patch = peticiones.find((q) => q.metodo === "PATCH");
  assert.ok(patch && patch.recurso === "profiles" && patch.url.includes(`id=eq.${A}`));
});

test("si B ya no vale, B sale de la boveda y A no pierde nada: ni cookie, ni push", async () => {
  const { p, llamadas } = puerto({ prueba: { ok: false, clase: "credencial", error: new AuthApiError("Already Used", 400, "refresh_token_already_used") } });
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.motivo, "vencida");
    assert.match(r.mensaje, /Tienda B/);
  }
  assert.equal(buscarCuenta(B), null);
  assert.equal(buscarCuenta(A)?.refreshToken, "refresh-a-fresco");
  assert.equal(llamadas.some((l) => l.startsWith("setSession") || l.startsWith("soltarPush") || l.startsWith("marcar")), false);
});

test("sin red al probar, B se queda y la persona sigue en A", async () => {
  const { p, reportes } = puerto({ prueba: { ok: false, clase: "red", error: new AuthRetryableFetchError("fetch failed", 0) } });
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.motivo, "red");
    assert.match(r.mensaje, /Sigues en Pedro/);
  }
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-viejo");
  assert.deepEqual(reportes, ["probar"]);
});

test("si setSession falla por red tras la prueba, se desmarca y los tokens nuevos de B ya estan a salvo", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthRetryableFetchError("fetch failed", 0) });
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "red");
  assert.equal(llamadas.at(-1), "desmarcar");
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-nuevo");
  const lanza = puerto({ errorSetSession: "lanza" });
  const r2 = await cambiarACuenta(cuentaB(), lanza.p);
  assert.equal(r2.ok ? null : r2.motivo, "red");
  assert.deepEqual(lanza.reportes, ["set_session"]);
});

test("si setSession dice que la credencial no vale, B sale de la boveda", async () => {
  const { p } = puerto({ errorSetSession: new AuthApiError("invalid JWT", 401, "bad_jwt") });
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "vencida");
  assert.equal(buscarCuenta(B), null);
});

test("sin almacenamiento se aborta antes de tocar nada", async () => {
  ventana.localStorage.lanzar = true;
  const { p, llamadas } = puerto({});
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "sin_almacenamiento");
  assert.deepEqual(llamadas, ["getSession"]);
});

test("sin sesion actual no hay cambio; con la misma cuenta no hay nada que hacer", async () => {
  const sin = puerto({ sesionActual: null });
  assert.equal((await cambiarACuenta(cuentaB(), sin.p)).ok ? null : "sin_sesion", "sin_sesion");
  const misma = puerto({ sesionActual: sesion(B, "b") });
  const r = await cambiarACuenta(cuentaB(), misma.p);
  assert.equal(r.ok, true);
  assert.deepEqual(misma.llamadas, ["getSession"]);
});

test("el fallo al soltar el push de A no detiene el cambio y se reporta", async () => {
  const { p, reportes } = puerto({ errorPerfil: true });
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  assert.deepEqual(reportes, ["soltar_token_push"]);
});

test("una cuenta activa que no estaba en la boveda se guarda con lo que trae la sesion", async () => {
  quitarCuenta(A);
  const { p } = puerto({});
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  const a = buscarCuenta(A)!;
  assert.equal(a.email, "a@correo.mx");
  assert.equal(a.nombre, "Meta a");
  assert.equal(a.username, null);
});

test("dos cambios a la vez: el segundo se rechaza sin tocar nada", async () => {
  let liberar: () => void = () => {};
  const bloqueo = new Promise<void>((resolve) => { liberar = resolve; });
  const { p } = puerto({});
  const lento: PuertoCambio = { ...p, principal: { ...p.principal, async getSession() { await bloqueo; return p.principal.getSession(); } } };
  const primero = cambiarACuenta(cuentaB(), lento);
  const segundo = await cambiarACuenta(cuentaB(), p);
  assert.equal(segundo.ok ? null : segundo.motivo, "en_curso");
  liberar();
  assert.equal((await primero).ok, true);
});

test("aplicarCuenta no necesita cuenta activa: tras cerrar sesion, despierta la siguiente", async () => {
  quitarCuenta(A);
  const { p, llamadas } = puerto({ sesionActual: null });
  const r = await aplicarCuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  assert.deepEqual(llamadas, ["probar:refresh-b-viejo", `marcar:${B}`, "setSession:refresh-b-nuevo"]);
});

test("datosDeSesion conserva el perfil guardado y rellena con la sesion cuando no lo hay", () => {
  const previa = buscarCuenta(A)!;
  const conPrevia = datosDeSesion(sesion(A, "x", "otro@correo.mx"), previa);
  assert.equal(conPrevia.nombre, "Pedro");
  assert.equal(conPrevia.email, "a@correo.mx");
  assert.equal(conPrevia.accessToken, "access-x");
  const sinPrevia = datosDeSesion(sesion(A, "x", "otro@correo.mx"), null);
  assert.equal(sinPrevia.nombre, "Meta a");
  assert.equal(sinPrevia.email, "otro@correo.mx");
  assert.equal(sinPrevia.foto, null);
});
