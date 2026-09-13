/**
 * Distingue un fetch que no llego a completar de un error de verdad.
 *
 * Una server action de Next viaja por fetch(). Si la red se cae, el usuario se
 * va a mitad de la peticion o el WebView se va a segundo plano, Next relanza el
 * TypeError crudo (server-action-reducer.js hace `throw err`), y si la promesa
 * no tiene brazo de rechazo acaba en window.onunhandledrejection y de ahi en
 * Sentry como si fuese un bug. No lo es: VICINO-WEB-D y CAPACITOR-4 son eso.
 *
 * Lo unico que separa el caso es el mensaje, y cada motor usa el suyo:
 * Safari "Load failed", Chrome/WebView "Failed to fetch", Firefox
 * "NetworkError when attempting to fetch resource.".
 *
 * El regex va ANCLADO a proposito. Un TypeError real ("undefined is not an
 * object (evaluating 'x.y')") no casa, y sobre todo no casa
 * "Failed to fetch dynamically imported module: <url>", que SI es un bug
 * (despliegue con chunks viejos) y tiene que seguir reportandose.
 */
const MENSAJES_DE_RED =
  /^(Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?|Network request failed|cancelled|The network connection was lost\.?|The Internet connection appears to be offline\.?)$/i;

export function esFalloDeRed(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  return MENSAJES_DE_RED.test(error.message.trim());
}
