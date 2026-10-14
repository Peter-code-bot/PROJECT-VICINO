/**
 * Lee un claim del access token SIN verificar la firma: aqui no se decide
 * nada de seguridad con el, solo si dos tokens pertenecen a la misma sesion
 * de GoTrue (`session_id`), para revocar la que queda huerfana cuando una
 * cuenta que ya estaba en la boveda vuelve a entrar por /login.
 */
export function sessionIdDeJwt(token: string): string | null {
  const partes = token.split(".");
  const cuerpo = partes[1];
  if (partes.length !== 3 || !cuerpo) return null;
  try {
    const base64 = cuerpo.replace(/-/g, "+").replace(/_/g, "/");
    const relleno = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const json = decodificarBase64(relleno);
    const claims: unknown = JSON.parse(json);
    const sessionId = (claims as { session_id?: unknown })?.session_id;
    return typeof sessionId === "string" && sessionId ? sessionId : null;
  } catch {
    return null;
  }
}

function decodificarBase64(valor: string): string {
  if (typeof atob === "function") {
    const binario = atob(valor);
    const bytes = Uint8Array.from(binario, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(valor, "base64").toString("utf8");
}
