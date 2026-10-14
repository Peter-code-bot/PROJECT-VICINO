import assert from "node:assert/strict";
import test from "node:test";
import { sessionIdDeJwt } from "./jwt";

function jwt(claims: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${b64(JSON.stringify(claims))}.firma`;
}

test("lee session_id sin verificar la firma y devuelve null ante cualquier cosa rara", () => {
  assert.equal(sessionIdDeJwt(jwt({ sub: "u", session_id: "s-1", exp: 1 })), "s-1");
  assert.equal(sessionIdDeJwt(jwt({ sub: "u" })), null);
  assert.equal(sessionIdDeJwt(jwt({ session_id: 42 })), null);
  assert.equal(sessionIdDeJwt("no.es.jwt"), null);
  assert.equal(sessionIdDeJwt("sin-puntos"), null);
  assert.equal(sessionIdDeJwt(""), null);
});
