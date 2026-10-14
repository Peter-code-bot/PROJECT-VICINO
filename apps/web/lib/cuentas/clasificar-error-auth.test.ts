import assert from "node:assert/strict";
import test from "node:test";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { clasificarErrorAuth } from "./clasificar-error-auth";

test("un veredicto de GoTrue sobre el token es de credencial", () => {
  assert.equal(clasificarErrorAuth(new AuthApiError("Invalid Refresh Token: Already Used", 400, "refresh_token_already_used")), "credencial");
  assert.equal(clasificarErrorAuth(new AuthApiError("invalid JWT", 401, "bad_jwt")), "credencial");
  assert.equal(clasificarErrorAuth(new AuthApiError("User not found", 403, "user_not_found")), "credencial");
  assert.equal(clasificarErrorAuth(new AuthApiError("not found", 404, undefined)), "credencial");
  assert.equal(clasificarErrorAuth(new AuthSessionMissingError()), "credencial");
});

test("el transporte, los 5xx, el 429 y el 408 son de red: se conserva la cuenta", () => {
  assert.equal(clasificarErrorAuth(new AuthRetryableFetchError("fetch failed", 0)), "red");
  assert.equal(clasificarErrorAuth(new AuthApiError("gateway", 502, undefined)), "red");
  assert.equal(clasificarErrorAuth(new AuthApiError("too many", 429, "over_request_rate_limit")), "red");
  assert.equal(clasificarErrorAuth(new AuthApiError("timeout", 408, undefined)), "red");
  assert.equal(clasificarErrorAuth(new TypeError("Failed to fetch")), "red");
  assert.equal(clasificarErrorAuth(undefined), "red");
});
