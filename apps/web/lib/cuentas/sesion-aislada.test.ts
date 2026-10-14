import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, AuthRetryableFetchError, type Session } from "@supabase/supabase-js";
import { probarSesion, revocarSesion, type AuthAislado } from "./sesion-aislada";

function sesion(sufijo: string): Session {
  return {
    access_token: `access-${sufijo}`,
    refresh_token: `refresh-${sufijo}`,
    token_type: "bearer",
    expires_in: 3600,
    user: { id: "00000000-0000-4000-8000-000000000002", email: "b@correo.mx", app_metadata: {}, user_metadata: {}, aud: "authenticated", created_at: "" },
  };
}

type Fallo = AuthApiError | AuthRetryableFetchError | "lanza";

function authFalso(opciones: { setSession?: Fallo; refresh?: Fallo; signOut?: AuthRetryableFetchError; devuelve?: Session; sinRotar?: boolean }) {
  const llamadas: string[] = [];
  const auth: AuthAislado = {
    async setSession(tokens) {
      llamadas.push(`setSession:${tokens.refresh_token}`);
      if (opciones.setSession === "lanza") throw new TypeError("Failed to fetch");
      if (opciones.setSession) return { data: { session: null }, error: opciones.setSession };
      return { data: { session: opciones.devuelve ?? sesion(opciones.sinRotar ? "viejo" : "nuevo") }, error: null };
    },
    async refreshSession(tokens) {
      llamadas.push(`refreshSession:${tokens.refresh_token}`);
      if (opciones.refresh === "lanza") throw new TypeError("Failed to fetch");
      if (opciones.refresh) return { data: { session: null }, error: opciones.refresh };
      return { data: { session: sesion("refrescado") }, error: null };
    },
    async signOut(o) {
      llamadas.push(`signOut:${o.scope}`);
      return { error: opciones.signOut ?? null };
    },
  };
  return { auth, llamadas };
}

const tokens = { accessToken: "access-viejo", refreshToken: "refresh-viejo" };
const credencial = () => new AuthApiError("bad_jwt", 403, "bad_jwt");
const red = () => new AuthRetryableFetchError("fetch failed", 0);

test("probar devuelve la sesion y no revoca nada", async () => {
  const { auth, llamadas } = authFalso({});
  const r = await probarSesion(tokens, auth);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sesion.refresh_token, "refresh-nuevo");
  assert.deepEqual(llamadas, ["setSession:refresh-viejo"]);
});

test("un 4xx al cargar NO es veredicto hasta probar el refresh token (reloj atrasado)", async () => {
  const recuperada = authFalso({ setSession: credencial() });
  const r = await probarSesion(tokens, recuperada.auth);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sesion.refresh_token, "refresh-refrescado");
  assert.deepEqual(recuperada.llamadas, ["setSession:refresh-viejo", "refreshSession:refresh-viejo"]);

  const muerta = authFalso({ setSession: credencial(), refresh: new AuthApiError("Already Used", 400, "refresh_token_already_used") });
  const r2 = await probarSesion(tokens, muerta.auth);
  assert.deepEqual(r2.ok ? null : r2.clase, "credencial");

  const redAlRefrescar = authFalso({ setSession: credencial(), refresh: red() });
  const r3 = await probarSesion(tokens, redAlRefrescar.auth);
  assert.deepEqual(r3.ok ? null : r3.clase, "red");
});

test("la red al cargar es red, incluida una excepcion del fetch, y no se intenta el refresh", async () => {
  const red1 = authFalso({ setSession: red() });
  assert.deepEqual((await probarSesion(tokens, red1.auth)).ok, false);
  assert.deepEqual(red1.llamadas, ["setSession:refresh-viejo"]);
  const lanza = await probarSesion(tokens, authFalso({ setSession: "lanza" }).auth);
  assert.deepEqual(lanza.ok ? null : lanza.clase, "red");
});

test("revocar carga la sesion y cierra SOLO esa (scope local); avisa de los tokens rotados antes", async () => {
  const rotados: string[] = [];
  const { auth, llamadas } = authFalso({});
  const r = await revocarSesion(tokens, (s) => rotados.push(s.refresh_token), auth);
  assert.deepEqual(r, { ok: true, yaInvalida: false });
  assert.deepEqual(llamadas, ["setSession:refresh-viejo", "signOut:local"]);
  assert.deepEqual(rotados, ["refresh-nuevo"]);
  // Sin rotacion no hay aviso.
  const sinRotar = authFalso({ sinRotar: true });
  const avisos: string[] = [];
  await revocarSesion(tokens, (s) => avisos.push(s.refresh_token), sinRotar.auth);
  assert.deepEqual(avisos, []);
});

test("las operaciones del aislado van en serie: una prueba no se cuela entre el setSession y el signOut de una revocacion", async () => {
  const orden: string[] = [];
  let soltar!: () => void;
  const primera = new Promise<void>((r) => {
    soltar = r;
  });
  const auth: AuthAislado = {
    async setSession(t) {
      orden.push(`setSession:${t.refresh_token}`);
      if (t.refresh_token === "refresh-lenta") await primera;
      return { data: { session: sesion(t.refresh_token.replace("refresh-", "")) }, error: null };
    },
    async refreshSession() {
      throw new Error("no deberia llamarse");
    },
    async signOut() {
      orden.push("signOut");
      return { error: null };
    },
  };
  const revocacion = revocarSesion({ accessToken: "access-lenta", refreshToken: "refresh-lenta" }, undefined, auth);
  const prueba = probarSesion({ accessToken: "access-otra", refreshToken: "refresh-otra" }, auth);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(orden, ["setSession:refresh-lenta"], "la prueba espera a que termine la revocacion");
  soltar();
  const [r1, r2] = await Promise.all([revocacion, prueba]);
  assert.deepEqual(orden, ["setSession:refresh-lenta", "signOut", "setSession:refresh-otra"]);
  assert.equal(r1.ok && r2.ok, true);
  // Un fallo no atasca la cola.
  const falla = await probarSesion(tokens, authFalso({ setSession: "lanza" }).auth);
  assert.equal(falla.ok, false);
  assert.equal((await probarSesion(tokens, authFalso({}).auth)).ok, true);
});

test("un token que ya no vale cuenta como revocado; la red conserva la entrada, con los tokens rotados avisados", async () => {
  const ya = await revocarSesion(tokens, undefined, authFalso({ setSession: credencial(), refresh: credencial() }).auth);
  assert.deepEqual(ya, { ok: true, yaInvalida: true });
  const redCarga = await revocarSesion(tokens, undefined, authFalso({ setSession: red() }).auth);
  assert.equal(redCarga.ok, false);
  const rotados: string[] = [];
  const redAlSalir = await revocarSesion(tokens, (s) => rotados.push(s.refresh_token), authFalso({ signOut: red() }).auth);
  assert.equal(redAlSalir.ok, false);
  assert.deepEqual(rotados, ["refresh-nuevo"]);
  const lanza = await revocarSesion(tokens, undefined, authFalso({ setSession: "lanza" }).auth);
  assert.equal(lanza.ok, false);
});
