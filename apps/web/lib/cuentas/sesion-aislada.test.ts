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

function authFalso(opciones: { setSession?: AuthApiError | AuthRetryableFetchError | "lanza"; signOut?: AuthRetryableFetchError; devuelve?: Session }) {
  const llamadas: string[] = [];
  const auth: AuthAislado = {
    async setSession(tokens) {
      llamadas.push(`setSession:${tokens.refresh_token}`);
      if (opciones.setSession === "lanza") throw new TypeError("Failed to fetch");
      if (opciones.setSession) return { data: { session: null }, error: opciones.setSession };
      return { data: { session: opciones.devuelve ?? sesion("nuevo") }, error: null };
    },
    async signOut(o) {
      llamadas.push(`signOut:${o.scope}`);
      return { error: opciones.signOut ?? null };
    },
  };
  return { auth, llamadas };
}

const tokens = { accessToken: "access-viejo", refreshToken: "refresh-viejo" };

test("probar devuelve la sesion refrescada y no revoca nada", async () => {
  const { auth, llamadas } = authFalso({});
  const r = await probarSesion(tokens, auth);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.sesion.refresh_token, "refresh-nuevo");
  assert.deepEqual(llamadas, ["setSession:refresh-viejo"]);
});

test("probar distingue credencial de red, incluida una excepcion del fetch", async () => {
  const credencial = await probarSesion(tokens, authFalso({ setSession: new AuthApiError("Already Used", 400, "refresh_token_already_used") }).auth);
  assert.deepEqual(credencial.ok ? null : credencial.clase, "credencial");
  const red = await probarSesion(tokens, authFalso({ setSession: new AuthRetryableFetchError("fetch failed", 0) }).auth);
  assert.deepEqual(red.ok ? null : red.clase, "red");
  const lanza = await probarSesion(tokens, authFalso({ setSession: "lanza" }).auth);
  assert.deepEqual(lanza.ok ? null : lanza.clase, "red");
});

test("revocar carga la sesion y cierra SOLO esa (scope local)", async () => {
  const { auth, llamadas } = authFalso({});
  const r = await revocarSesion(tokens, auth);
  assert.deepEqual(r, { ok: true, yaInvalida: false });
  assert.deepEqual(llamadas, ["setSession:refresh-viejo", "signOut:local"]);
});

test("un token que ya no vale cuenta como revocado; la red conserva la entrada", async () => {
  const ya = await revocarSesion(tokens, authFalso({ setSession: new AuthApiError("invalid", 401, "bad_jwt") }).auth);
  assert.deepEqual(ya, { ok: true, yaInvalida: true });
  const red = await revocarSesion(tokens, authFalso({ setSession: new AuthRetryableFetchError("fetch failed", 0) }).auth);
  assert.equal(red.ok, false);
  const redAlSalir = await revocarSesion(tokens, authFalso({ signOut: new AuthRetryableFetchError("fetch failed", 0) }).auth);
  assert.equal(redAlSalir.ok, false);
  const lanza = await revocarSesion(tokens, authFalso({ setSession: "lanza" }).auth);
  assert.equal(lanza.ok, false);
});
