import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { firmarJwtRs256, verificarJwtRs256 } from "./jwt";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

test("firma RS256 verificable con la clave publica y con cabecera estandar", () => {
  const jwt = firmarJwtRs256({ iss: "cuenta@proyecto.iam.gserviceaccount.com", aud: "google", typ: "savetowallet", iat: 1 }, privateKey);
  const [cabecera] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(cabecera!, "base64url").toString("utf8")), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(verificarJwtRs256(jwt, publicKey), {
    iss: "cuenta@proyecto.iam.gserviceaccount.com",
    aud: "google",
    typ: "savetowallet",
    iat: 1,
  });
});

test("una firma manipulada o con otra clave no verifica", () => {
  const jwt = firmarJwtRs256({ iat: 1 }, privateKey);
  const otra = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  assert.equal(verificarJwtRs256(jwt, otra.publicKey), null);
  const [c, p, f] = jwt.split(".");
  assert.equal(verificarJwtRs256(`${c}.${Buffer.from('{"iat":2}').toString("base64url")}.${f}`, publicKey), null);
  assert.equal(verificarJwtRs256(`${c}.${p}`, publicKey), null);
});
