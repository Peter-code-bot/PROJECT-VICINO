import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { AuthApiError, AuthRetryableFetchError, AuthUnknownError, type Session } from "@supabase/supabase-js";
import { crearSupabaseFalso } from "../pruebas/supabase-falso";
import { instalarWindowFalso, type WindowFalso } from "./pruebas-entorno";
import { buscarCuenta, guardarCuenta, leerCuentas, quitarCuenta, type Cuenta } from "./boveda";
import {
  UMBRAL_REFRESCO_MS,
  aplicarCuenta,
  cambiarACuenta,
  datosDeSesion,
  reiniciarCambioParaPruebas,
  sesionActivaParaGuardar,
  type PuertoCambio,
} from "./cambio";
import type { ResultadoProbar } from "./sesion-aislada";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

/** `expires_at` relativo al reloj REAL: cambiarACuenta mide la vida del token con Date.now(). */
function sesion(userId: string, sufijo: string, opciones: { email?: string; vidaMs?: number } = {}): Session {
  const vidaMs = opciones.vidaMs ?? 3600_000;
  return {
    access_token: `access-${sufijo}`,
    refresh_token: `refresh-${sufijo}`,
    token_type: "bearer",
    expires_in: Math.floor(vidaMs / 1000),
    expires_at: Math.floor((Date.now() + vidaMs) / 1000),
    user: { id: userId, email: opciones.email ?? `${userId.slice(-1)}@correo.mx`, app_metadata: {}, user_metadata: { full_name: `Meta ${userId.slice(-1)}` }, aud: "authenticated", created_at: "" },
  };
}

function cuentaB(): Cuenta {
  return { userId: B, email: "b@correo.mx", nombre: "Tienda B", username: "tiendab", foto: null, accessToken: "access-b-viejo", refreshToken: "refresh-b-viejo", ultimoUso: 1 };
}

interface Escenario {
  /** undefined = A con una hora por delante; null = sin sesion. */
  sesionActual?: Session | null;
  /** Error de la PRIMERA lectura de la cookie (auth-js refresco por dentro y fallo): llega con session null. */
  errorGetSession?: AuthApiError | AuthRetryableFetchError;
  /** Lo que devuelve refreshSession; "lanza" = tope. */
  refresh?: { sesion: Session } | AuthApiError | AuthRetryableFetchError | AuthUnknownError | "lanza";
  /** Que hay en la cookie en las lecturas posteriores a la primera (restauraciones). */
  cookieDespues?: Session | null;
  prueba?: ResultadoProbar;
  errorSetSession?: AuthApiError | AuthRetryableFetchError | "lanza";
  errorPerfil?: boolean;
  /** Hace que la boveda falle a partir de la n-esima escritura. */
  bovedaFallaDesde?: number;
}

function puerto(escenario: Escenario, ventana: WindowFalso) {
  const llamadas: string[] = [];
  const reportes: string[] = [];
  let escrituras = 0;
  let lecturas = 0;
  const supabase = crearSupabaseFalso({
    usuario: { id: A },
    errores: escenario.errorPerfil ? { profiles: { status: 403, body: { code: "42501", message: "permission denied" } } } : undefined,
  });
  const sesionA = escenario.sesionActual === undefined ? sesion(A, "a-fresco") : escenario.sesionActual;
  const p: PuertoCambio = {
    principal: {
      async getSession() {
        llamadas.push("getSession");
        lecturas += 1;
        if (lecturas === 1 && escenario.errorGetSession) return { data: { session: null }, error: escenario.errorGetSession };
        if (lecturas > 1 && escenario.cookieDespues !== undefined) return { data: { session: escenario.cookieDespues }, error: null };
        return { data: { session: sesionA }, error: null };
      },
      async refreshSession() {
        llamadas.push("refreshSession");
        const r = escenario.refresh;
        if (r === "lanza") throw new Error("tope");
        if (r && "sesion" in r) return { data: { session: r.sesion }, error: null };
        if (r) return { data: { session: null }, error: r };
        return { data: { session: sesion(A, "a-refrescado") }, error: null };
      },
      async setSession(tokens) {
        llamadas.push(`setSession:${tokens.refresh_token}`);
        if (escenario.errorSetSession === "lanza") throw new TypeError("Failed to fetch");
        if (escenario.errorSetSession && tokens.refresh_token !== sesionA?.refresh_token) return { data: { session: null }, error: escenario.errorSetSession };
        return { data: { session: tokens.refresh_token === sesionA?.refresh_token ? sesionA : sesion(B, "b-aplicado") }, error: null };
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

test("camino feliz: marca, lee A (sin refrescar: le queda una hora), la guarda, prueba y guarda B, suelta el push de A y aplica", async () => {
  const { p, llamadas, reportes, peticiones } = puerto({}, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.deepEqual(r, { ok: true, userId: B, nombre: "Tienda B" });
  assert.deepEqual(llamadas, [`marcar:${B}`, "getSession", "probar:refresh-b-viejo", `soltarPush:${A}`, `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  assert.deepEqual(reportes, []);
  // A conserva su perfil y lleva el token de la cookie; B lleva los tokens que devolvio la prueba y queda primera.
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

test("si getSession falla porque auth-js refresco por dentro: el transporte deja la cookie (red); cualquier otro error la borro (sin sesion) y se pasa a B sin tocar A", async () => {
  const transporte = puerto({ errorGetSession: new AuthRetryableFetchError("fetch failed", 0) }, ventana);
  assert.deepEqual(await sesionActivaParaGuardar(transporte.p.principal, transporte.p.reportar), { estado: "red" });
  assert.deepEqual(transporte.reportes, ["get_session"]);
  const limite = puerto({ errorGetSession: new AuthApiError("rate limit", 429, "over_request_rate_limit") }, ventana);
  assert.deepEqual(await sesionActivaParaGuardar(limite.p.principal, limite.p.reportar), { estado: "sin_sesion" });
  // En el cambio completo: A no se guarda (no hay con que) ni se le suelta el
  // push (no hay sesion), pero conserva sus tokens de antes, y se aplica B.
  const cambio = puerto({ errorGetSession: new AuthApiError("boom", 500, "unexpected_failure") }, ventana);
  const r = await cambiarACuenta(cuentaB(), cambio.p);
  assert.deepEqual(r, { ok: true, userId: B, nombre: "Tienda B" });
  assert.equal(buscarCuenta(A)?.refreshToken, "refresh-a-viejo");
  assert.equal(cambio.llamadas.includes(`soltarPush:${A}`), false);
  assert.deepEqual(cambio.llamadas.slice(0, 3), [`marcar:${B}`, "getSession", "probar:refresh-b-viejo"]);
});

test("con poco token por delante, A se refresca antes de guardarse", async () => {
  const { p, llamadas } = puerto({ sesionActual: sesion(A, "a-corto", { vidaMs: UMBRAL_REFRESCO_MS - 1 }) }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  assert.deepEqual(llamadas.slice(0, 3), [`marcar:${B}`, "getSession", "refreshSession"]);
  assert.equal(buscarCuenta(A)?.refreshToken, "refresh-a-refrescado");
});

test("un 429 o un 500 al refrescar NO es veredicto: se restaura la cookie si auth-js la borro y se sigue con la instantanea", async () => {
  const { p, llamadas, reportes } = puerto({
    sesionActual: sesion(A, "a-corto", { vidaMs: 60_000 }),
    refresh: new AuthApiError("rate limit", 429, "over_request_rate_limit"),
    cookieDespues: null,
  }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, true);
  assert.deepEqual(llamadas.slice(0, 5), [`marcar:${B}`, "getSession", "refreshSession", "getSession", "setSession:refresh-a-corto"]);
  assert.deepEqual(reportes, ["refresh_actual"]);
  assert.equal(buscarCuenta(A)?.refreshToken, "refresh-a-corto");
  // Lo mismo con una respuesta que no es JSON y con un tope.
  for (const refresh of [new AuthUnknownError("html", new Error("x")), "lanza" as const]) {
    const otro = puerto({ sesionActual: sesion(A, "a-corto", { vidaMs: 60_000 }), refresh, cookieDespues: sesion(A, "a-corto", { vidaMs: 60_000 }) }, ventana);
    assert.equal((await cambiarACuenta(cuentaB(), otro.p)).ok, true);
    assert.equal(otro.llamadas.includes("setSession:refresh-a-corto"), false, "la cookie seguia: no se restaura");
  }
});

test("si GoTrue dice que el refresh token de A ya no vale, A sale de la boveda y se pasa a B como tras un cierre; si B tampoco entra, no queda sesion", async () => {
  const muerta = puerto({ sesionActual: sesion(A, "a-corto", { vidaMs: 60_000 }), refresh: new AuthApiError("Already Used", 400, "refresh_token_already_used") }, ventana);
  const r = await cambiarACuenta(cuentaB(), muerta.p);
  assert.equal(r.ok, true);
  assert.equal(buscarCuenta(A), null);
  assert.deepEqual(muerta.llamadas, [`marcar:${B}`, "getSession", "refreshSession", "probar:refresh-b-viejo", `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  guardarCuenta(cuentaB(), 50);
  const nadie = puerto({ sesionActual: sesion(A, "a-corto", { vidaMs: 60_000 }), refresh: new AuthApiError("Already Used", 400, "refresh_token_already_used"), prueba: { ok: false, clase: "credencial", error: new AuthApiError("x", 400, undefined) } }, ventana);
  const r2 = await cambiarACuenta(cuentaB(), nadie.p);
  assert.equal(r2.ok ? null : r2.motivo, "sin_sesion");
  assert.equal(nadie.llamadas.at(-1), "desmarcar");
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

test("si B ya no vale, B sale de la boveda y A no pierde nada: ni cookie, ni push; la marca se quita", async () => {
  const { p, llamadas } = puerto({ prueba: { ok: false, clase: "credencial", error: new AuthApiError("Already Used", 400, "refresh_token_already_used") } }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.motivo, "vencida");
    assert.match(r.mensaje, /Tienda B/);
  }
  assert.equal(buscarCuenta(B), null);
  assert.equal(buscarCuenta(A)?.refreshToken, "refresh-a-fresco");
  assert.equal(llamadas.some((l) => l.startsWith("setSession") || l.startsWith("soltarPush")), false);
  assert.equal(llamadas.at(-1), "desmarcar");
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

test("si setSession falla por red, B ya esta a salvo y la cookie (intacta) no se toca", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthRetryableFetchError("fetch failed", 0) }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "red");
  assert.deepEqual(llamadas.slice(-4), ["setSession:refresh-b-nuevo", "desmarcar", "getSession", "desmarcar"]);
  assert.equal(buscarCuenta(B)?.refreshToken, "refresh-b-nuevo");
  const lanza = puerto({ errorSetSession: "lanza" }, ventana);
  const r2 = await cambiarACuenta(cuentaB(), lanza.p);
  assert.equal(r2.ok ? null : r2.motivo, "red");
  assert.deepEqual(lanza.reportes, ["set_session"]);
});

test("si auth-js borro la cookie al fallar setSession(B), A se restaura con sus tokens", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthApiError("session_not_found", 403, "session_not_found"), cookieDespues: null }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "vencida");
  assert.equal(buscarCuenta(B), null);
  assert.deepEqual(llamadas.slice(-3), ["getSession", "setSession:refresh-a-fresco", "desmarcar"]);
});

test("si el setSession(B) cuajo tarde y la cookie ya es de B, se da por bueno y no se pisa", async () => {
  const { p, llamadas } = puerto({ errorSetSession: new AuthRetryableFetchError("tope", 0), cookieDespues: sesion(B, "b-aplicado") }, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.deepEqual(r, { ok: true, userId: B, nombre: "Tienda B" });
  assert.equal(llamadas.filter((l) => l.startsWith("setSession:refresh-a")).length, 0);
  assert.equal(llamadas.at(-1), `marcar:${B}`);
});

test("sin almacenamiento se aborta antes de tocar nada", async () => {
  ventana.localStorage.lanzar = true;
  const { p, llamadas } = puerto({}, ventana);
  const r = await cambiarACuenta(cuentaB(), p);
  assert.equal(r.ok ? null : r.motivo, "sin_almacenamiento");
  assert.deepEqual(llamadas, [`marcar:${B}`, "getSession", "desmarcar"]);
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
  assert.deepEqual(llamadas, [`marcar:${B}`, "getSession", "desmarcar"]);
});

test("sin cookie se pasa a B como tras un cierre de sesion; con la misma cuenta no hay nada que hacer", async () => {
  const sin = puerto({ sesionActual: null }, ventana);
  assert.equal((await cambiarACuenta(cuentaB(), sin.p)).ok, true);
  assert.deepEqual(sin.llamadas, [`marcar:${B}`, "getSession", "probar:refresh-b-viejo", `marcar:${B}`, "setSession:refresh-b-nuevo"]);
  const misma = puerto({ sesionActual: sesion(B, "b") }, ventana);
  const r = await cambiarACuenta(cuentaB(), misma.p);
  assert.equal(r.ok, true);
  assert.deepEqual(misma.llamadas, [`marcar:${B}`, "getSession"]);
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
  const lento: PuertoCambio = { ...p, principal: { ...p.principal, async getSession() { await bloqueo; return p.principal.getSession(); } } };
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

test("sesionActivaParaGuardar: sin red al leer la cookie es red; con tokens frescos no toca la red", async () => {
  const reportes: string[] = [];
  const reportar = (paso: string) => reportes.push(paso);
  const lanza = { ...puerto({}, ventana).p.principal, async getSession() { throw new Error("tope"); } };
  assert.deepEqual(await sesionActivaParaGuardar(lanza, reportar), { estado: "red" });
  assert.deepEqual(reportes, ["get_session"]);
  const fresco = puerto({}, ventana);
  const r = await sesionActivaParaGuardar(fresco.p.principal, reportar);
  assert.equal(r.estado === "ok" && r.sesion.refresh_token, "refresh-a-fresco");
  assert.deepEqual(fresco.llamadas, ["getSession"]);
});

test("datosDeSesion conserva el perfil guardado y rellena con la sesion cuando no lo hay", () => {
  const previa = buscarCuenta(A)!;
  const conPrevia = datosDeSesion(sesion(A, "x", { email: "otro@correo.mx" }), previa);
  assert.equal(conPrevia.nombre, "Pedro");
  assert.equal(conPrevia.email, "a@correo.mx");
  assert.equal(conPrevia.accessToken, "access-x");
  const sinPrevia = datosDeSesion(sesion(A, "x", { email: "otro@correo.mx" }), null);
  assert.equal(sinPrevia.nombre, "Meta a");
  assert.equal(sinPrevia.email, "otro@correo.mx");
  assert.equal(sinPrevia.foto, null);
});
