// Prueba del matcher de apps/web/proxy.ts: los dos archivos de asociacion de
// /.well-known/ no pasan por el proxy; el resto de /.well-known/ si.
//
//   node scripts/test-matcher-proxy.mjs        (desde la raiz)
//
// Por que importa: assetlinks.json y apple-app-site-association los piden los
// verificadores de Google y Apple, y tienen que contestar 200 sin depender de
// la sesion. Por el proxy pagaban updateSession/getUser y, con cookie, la RPC
// de confirmacion legal (que puede redirigir a /confirmar-cuenta o dar 503).
// La prueba comprueba tambien que lo demas SIGUE pasando por el proxy: un
// matcher mal escrito puede dejar sin las redirecciones de auth a rutas que si
// las necesitan, y eso no lo ve nadie hasta que alguien entra sin sesion. Eso
// incluye cualquier otra ruta bajo /.well-known/: no es un archivo estatico, la
// atiende [categoria]/[slug], y sin el proxy nadie refresca la sesion ni sanea
// las cabeceras en las que confia (marketplace)/layout.tsx.
//
// Lee el matcher del fuente con el parser de TypeScript (importar proxy.ts
// arrastraria Supabase y server-only) y lo compila con getMiddlewareMatchers,
// la funcion que usa next build para el manifiesto del proxy, sufijos de RSC
// incluidos.
//
// FRAGIL: getMiddlewareMatchers es interno de Next
// (next/dist/build/analysis/get-page-static-info.js), no una API publica. Si una
// version nueva lo mueve o le cambia la firma, esto falla al cargar: hay que
// buscar el reemplazo, no borrar la prueba. Supone ademas que la app no tiene
// basePath ni i18n (hoy no los tiene).

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(raiz, "apps/web");
const req = createRequire(resolve(web, "package.json"));

/** Nunca pasan por el proxy. Las dos primeras son el motivo de esta prueba. */
const EXCLUIDAS = [
  "/.well-known/assetlinks.json",
  "/.well-known/apple-app-site-association",
  "/api/cron/wallet-sync",
  "/sentry-tunnel",
  "/sw.js",
  "/offline.html",
  "/_next/static/chunks/main.js",
];

/** Siguen pasando: sesion, redirecciones de auth y limites del proxy. */
const INCLUIDAS = [
  "/",
  "/perfil",
  "/vender",
  "/login",
  "/auth/callback-server",
  "/terminos",
  "/terminos.rsc",
  "/comida/pan-dulce",
  // Bajo /.well-known/ solo salen los dos archivos, y exactos. Lo demas lo
  // atiende [categoria]/[slug] y tiene que seguir pasando por aqui.
  "/.well-known",
  "/.well-known/otra-cosa",
  "/.well-known/otra-cosa.rsc",
  "/.well-known/assetlinks.json.bak",
];

/** Las cadenas de `export const config = { matcher: [...] }`, o null. */
function matchersDelFuente(ts, codigo) {
  const archivo = ts.createSourceFile("proxy.ts", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  for (const sentencia of archivo.statements) {
    const exportada = ts.isVariableStatement(sentencia) &&
      sentencia.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exportada) continue;
    for (const declaracion of sentencia.declarationList.declarations) {
      if (!ts.isIdentifier(declaracion.name) || declaracion.name.text !== "config") continue;
      const objeto = declaracion.initializer;
      if (!objeto || !ts.isObjectLiteralExpression(objeto)) return null;
      const propiedad = objeto.properties.find((p) =>
        ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "matcher");
      if (!propiedad) return null;
      const valor = propiedad.initializer;
      const elementos = ts.isArrayLiteralExpression(valor) ? [...valor.elements] : [valor];
      if (!elementos.every((e) => ts.isStringLiteralLike(e))) {
        throw new Error("el matcher ya no es una lista de cadenas: actualiza esta prueba");
      }
      return elementos.map((e) => e.text);
    }
  }
  return null;
}

function compilar(matchers) {
  const { getMiddlewareMatchers } = req("next/dist/build/analysis/get-page-static-info");
  return getMiddlewareMatchers(matchers, { basePath: "", i18n: null }).map((m) => new RegExp(m.regexp));
}

const fallos = [];

function anotar(ok, nombre, detalle) {
  if (!ok) fallos.push(nombre);
  console.log(`${ok ? "  ok   " : "  FALLA"} ${nombre}${detalle ? ` -> ${detalle}` : ""}`);
}

try {
  const ts = req("typescript");
  const matchers = matchersDelFuente(ts, readFileSync(resolve(web, "proxy.ts"), "utf8"));
  if (!matchers) throw new Error("no encontre export const config = { matcher } en proxy.ts");
  const expresiones = compilar(matchers);
  const pasaPorElProxy = (ruta) => expresiones.some((re) => re.test(ruta));

  console.log("No pasan por el proxy");
  for (const ruta of EXCLUIDAS) {
    anotar(!pasaPorElProxy(ruta), ruta, pasaPorElProxy(ruta) ? "pasa por el proxy" : "excluida");
  }
  console.log("\nSiguen pasando por el proxy");
  for (const ruta of INCLUIDAS) {
    anotar(pasaPorElProxy(ruta), ruta, pasaPorElProxy(ruta) ? "pasa por el proxy" : "EXCLUIDA");
  }
} catch (error) {
  anotar(false, "la prueba corre hasta el final", error instanceof Error ? error.message : String(error));
}

console.log(fallos.length === 0 ? "\nTodo en orden." : `\n${fallos.length} comprobacion(es) FALLAN.`);
process.exitCode = fallos.length === 0 ? 0 : 1;
