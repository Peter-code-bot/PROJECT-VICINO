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
  /** undefined = A con tokens frescos; null = sin sesion. */
  sesionActual?: Session | null;
  errorRefresh?: AuthApiError | AuthRetryableFetchError | "lanza";
  prueba?: ResultadoProbar;
  errorSetSession?: AuthApiError | AuthRetryableFetchError | "lanza";
  /** Lo que devuelve getSession tras un setSession fallido (para la restauracion). */
  cookieTrasFallo?: Session | null;
  errorPerfil?: boolean;
  /** Hace que la boveda falle a partir de la n-esima escritura. */
  bovedaFallaDesde?: number;
}

function puerto(escenario: Escenario, ventana: WindowFalso) {
  const llamadas: string[] = [];
  const reportes: string[] = [];
  let escrituras = 0;
  const supabase = crearSupabaseFalso({
    usuario: { id: A },
    errores: escenario.errorPerfil ? { profiles: { status: 403, body: { code: "42501", message: "permission denied" } } } : undefined,
  });
  const sesionA = escenario.sesionActual === undefined ? sesion(A, "a-fresco") : escenario.sesionActual;
  const p: PuertoCambio = {
    principal: {
      async getSession() {
        llamadas.push("getSession");
        return { data: { session: escenario.cookieTrasFallo === undefined ? sesionA : escenario.cookieTrasFallo }, error: null };
      },
      async refreshSession() {
        llamadas.push("refreshSession");
        if (escenario.errorRefresh === "lanza") throw new Error("tope");
        if (escenario.errorRefresh) return { data: { session: null }, error: escenario.errorRefresh };
        return { data: { session: sesionA }, error: null };
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
    boveda: {
      guardar(datos) {
        escrituras += 1;
        if (escenario.bovedaFallaDesde !== undefined && escrituras >= escenario.bovedaFallaDesde) ventana.localStorage.lanzar = true;
        return guardarCuenta(datos);
      },
      quitar: quitarCuenta,
      buscar: buscarCuenta,
    },
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

test("camino feliz: refresca A, la guarda, prueba B, guarda B, suelta el push de A, marca y aplica", async () => {
  const { p, llamadas, reportes, peticiones } = puerto({}, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.deepEqual(r, { ok: true, userId: B, nombre: "Tienda B" });
  assert.deepEqual(llamadas, ["refreshSession", "probar:refresh-b-viejo", `soltarPush:${A}`, `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  assert.deepEqual(reportes, []);
  // A conserva su perfil y lleva el token recien refrescado; B lleva los tokens que devolvio la prueba y queda primera.
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

test("los tokens rotados de B se guardan ANTES de soltar el push: un PATCH colgado no los pierde", async () => {
  const { p } = puerto({}, ventana);
  const original = p.soltarTokenPush;
  p.soltarTokenPush = async (userId) => {
    assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-nuevo");
    return original(userId);
  };
  assert.equal((await cambiarACuenta(cuentaB(), p)).ok, true);
});

test("si B ya no vale, B sale de la boveda y A no pierde nada: ni cookie, ni push", async () => {
  const { p, llamadas } = puerto({ prueba: { ok: false, clase: "credencial", error: new AuthApiError("Already Used", 400, "refresh_token_already_used") } }, ventana);
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
  const { p, reportes } = puerto({ prueba: { ok: false, clase: "red", error: new AuthRetryableFetchError("fetch failed", 0) } }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.motivo, "red");
    assert.match(r.mensaje, /Sigues en Pedro/);
  }
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-viejo");
  assert.deepEqual(reportes, ["probar"]);
});

test("si setSession falla por red, se desmarca, B ya esta a salvo y la cookie de A se comprueba", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthRetryableFetchError("fetch failed", 0) }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "red");
  assert.deepEqual(llamadas.slice(-3), ["setSession:refresh-b-nuevo", "desmarcar", "getSession"]);
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-nuevo");
  const lanza = puerto({ errorSetSession: "lanza" }, ventana);
  const r2 = await cambiarACuenta(cuentaB(), lanza.p);
  assert.equal(r2.ok ? null : r2.motivo, "red");
  assert.deepEqual(lanza.reportes, ["set_session"]);
});

test("si setSession dice que la credencial de B no vale y auth-js borro la cookie, A se restaura con sus tokens frescos", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthApiError("session_not_found", 403, "session_not_found"), cookieTrasFallo: null }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "vencida");
  assert.equal(buscarCuenta(B), null);
  assert.deepEqual(llamadas.slice(-2), ["getSession", "setSession:refresh-a-fresco"]);
});

test("si la cookie sigue siendo de A tras el fallo, no se toca", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthApiError("invalid JWT", 401, "bad_jwt") }, ventana);
  await cambiarACuenta(cuentaB(), p);
  assert.equal(llamadas.at(-1), "getSession");
});

test("sin almacenamiento se aborta antes de tocar nada", async () => {
  ventana.localStorage.lanzar = true;
  const { p, llamadas } = puerto({}, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "sin_almacenamiento");
  assert.deepEqual(llamadas, ["refreshSession"]);
});

test("si la boveda falla justo al guardar B, el cambio sigue y se reporta: los tokens ya rotaron", async () => {
  const { p, reportes } = puerto({ bovedaFallaDesde: 2 }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  assert.deepEqual(reportes, ["guardar_destino"]);
});

test("la boveda llena con A sin espejo se queda en el paso 2", async () => {
  quitarCuenta(A);
  for (let n = 1; n <= 4; n++) {
    guardarCuenta({ userId: `00000000-0000-4000-8000-00000000000${n}`, email: `${n}@x`, nombre: `${n}`, username: null, foto: null, accessToken: "a", refreshToken: "r" }, n);
  }
  const { p, llamadas } = puerto({}, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "llena");
  assert.deepEqual(llamadas, ["refreshSession"]);
});

test("sin red al refrescar A no hay cambio; si A ya no vale, se pasa a B como tras un cierre de sesion", async () => {
  const red = puerto({ errorRefresh: new AuthRetryableFetchError("fetch failed", 0) }, ventana);
  assert.equal((await cambiarACuenta(cuentaB(), red.p)).ok ? null : "red", "red");
  assert.deepEqual(red.llamadas, ["refreshSession"]);
  const tope = puerto({ errorRefresh: "lanza" }, ventana);
  assert.equal((await cambiarACuenta(cuentaB(), tope.p)).ok ? null : "red", "red");
  const muerta = puerto({ errorRefresh: new AuthApiError("Already Used", 400, "refresh_token_already_used") }, ventana);
  const r = await cambiarACuenta(cuentaB(), muerta.p);
  assert.equal(r.ok, true);
  assert.deepEqual(muerta.llamadas, ["refreshSession", "probar:refresh-b-viejo", `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  const sin = puerto({ sesionActual: null }, ventana);
  assert.equal((await cambiarACuenta(cuentaB(), sin.p)).ok, true);
});

test("con la misma cuenta no hay nada que hacer", async () => {
  const misma = puerto({ sesionActual: sesion(B, "b") }, ventana);
  const r = await cambiarACuenta(cuentaB(), misma.p);
  assert.equal(r.ok, true);
  assert.deepEqual(misma.llamadas, ["refreshSession"]);
});

test("el fallo al soltar el push de A no detiene el cambio y se reporta", async () => {
  const { p, reportes } = puerto({ errorPerfil: true }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  assert.deepEqual(reportes, ["soltar_token_push"]);
});

test("una cuenta activa que no estaba en la boveda se guarda con lo que trae la sesion", async () => {
  quitarCuenta(A);
  const { p } = puerto({}, ventana);
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
  const { p } = puerto({}, ventana);
  const lento: PuertoCambio = { ...p, principal: { ...p.principal, async refreshSession() { await bloqueo; return p.principal.refreshSession(); } } };
  const primero = cambiarACuenta(cuentaB(), lento);
  const segundo = await cambiarACuenta(cuentaB(), p);
  assert.equal(segundo.ok ? null : segundo.motivo, "en_curso");
  liberar();
  assert.equal((await primero).ok, true);
});

test("aplicarCuenta no necesita cuenta activa y distingue credencial de red", async () => {
  quitarCuenta(A);
  const feliz = puerto({ sesionActual: null }, ventana);
  const r = await aplicarCuenta(cuentaB(), feliz.p);
  assert.equal(r.ok, true);
  assert.deepEqual(feliz.llamadas, ["probar:refresh-b-viejo", `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  const vencida = puerto({ prueba: { ok: false, clase: "credencial", error: new AuthApiError("x", 400, undefined) } }, ventana);
  assert.equal((await aplicarCuenta(cuentaB(), vencida.p)).ok ? null : "vencida", "vencida");
  assert.equal(buscarCuenta(B), null);
  guardarCuenta(cuentaB(), 50);
  const red = puerto({ prueba: { ok: false, clase: "red", error: new AuthRetryableFetchError("x", 0) } }, ventana);
  const r2 = await aplicarCuenta(cuentaB(), red.p);
  assert.equal(r2.ok ? null : r2.mensaje, "Sin conexión. Inténtalo de nuevo.");
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-viejo");
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
