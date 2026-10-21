import { createSign, createVerify } from "node:crypto";

/**
 * JWT RS256 con node:crypto, sin dependencias. Lo usan el enlace "Add to
 * Google Wallet" y el intercambio de token de la cuenta de servicio.
 */
export function base64url(entrada: Buffer | string): string {
  return Buffer.from(entrada).toString("base64url");
}

export function firmarJwtRs256(payload: Record<string, unknown>, privateKeyPem: string, cabeceraExtra: Record<string, string> = {}): string {
  const cabecera = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...cabeceraExtra }));
  const cuerpo = base64url(JSON.stringify(payload));
  const firma = createSign("RSA-SHA256").update(`${cabecera}.${cuerpo}`).end().sign(privateKeyPem);
  return `${cabecera}.${cuerpo}.${base64url(firma)}`;
}

/** Solo para pruebas y diagnostico: comprueba la firma y devuelve el payload. */
export function verificarJwtRs256(jwt: string, publicKeyPem: string): Record<string, unknown> | null {
  const [cabecera, cuerpo, firma, ...resto] = jwt.split(".");
  if (!cabecera || !cuerpo || !firma || resto.length > 0) return null;
  const valido = createVerify("RSA-SHA256").update(`${cabecera}.${cuerpo}`).end().verify(publicKeyPem, Buffer.from(firma, "base64url"));
  if (!valido) return null;
  return JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as Record<string, unknown>;
}
