import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, AuthInvalidJwtError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from "@supabase/supabase-js";
import { clasificarErrorAuth } from "./clasificar-error-auth";

test("un veredicto de GoTrue o de auth-js sobre el token es de credencial", () => {
  assert.equal(clasificarErrorAuth(new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")), "credencial");
  assert.equal(clasificarErrorAuth(new AuthApiError("invalid JWT", 401, "bad_jwt")), "credencial");
  assert.equal(clasificarErrorAuth(new AuthApiError("User not found", 403, "user_not_found")), "credencial");
  assert.equal(clasificarErrorAuth(new AuthApiError("not found", 404, undefined)), "credencial");
  assert.equal(clasificarErrorAuth(new AuthSessionMissingError()), "credencial");
  // Un access token malformado en la boveda: auth-js lo rechaza sin ir a la red.
  assert.equal(clasificarErrorAuth(new AuthInvalidJwtError("Invalid JWT structure")), "credencial");
});

test("el transporte, los 5xx, el 429, el 408 y los errores que no son de auth son de red: se conserva la cuenta", () => {
  assert.equal(clasificarErrorAuth(new AuthRetryableFetchError("fetch failed", 0)), "red");
  assert.equal(clasificarErrorAuth(new AuthApiError("gateway", 502, undefined)), "red");
  assert.equal(clasificarErrorAuth(new AuthApiError("too many", 429, "over_request_rate_limit")), "red");
  assert.equal(clasificarErrorAuth(new AuthApiError("timeout", 408, undefined)), "red");
  assert.equal(clasificarErrorAuth(new TypeError("Failed to fetch")), "red");
  assert.equal(clasificarErrorAuth(new DOMException("VICINO_AUTH_TIMEOUT", "TimeoutError")), "red");
  // Un 52x con cuerpo HTML llega como AuthUnknownError: el servidor no dio veredicto.
  assert.equal(clasificarErrorAuth(new AuthUnknownError("Unexpected token <", new Error("html"))), "red");
  assert.equal(clasificarErrorAuth(undefined), "red");
});
