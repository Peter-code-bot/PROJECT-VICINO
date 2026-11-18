// Prueba de la redireccion de www al apex (redirects() de apps/web/next.config.ts).
//
//   pnpm exec tsx scripts/test-redirect-www.mjs        (desde la raiz)
//
// Importa next.config.ts tal cual, envuelto por Sentry, bundle-analyzer y PWA:
// se prueba la configuracion que recibe Next, no una copia de la regla. Hace
// falta el tsx de la raiz para eso, y la carga tarda entre medio minuto y un
// minuto (los avisos de deprecacion de @sentry/nextjs que salen al cargar no son
// de esta prueba). Una regla con forma invalida la rechaza Next al cargarla
// (loadCustomRoutes): sale con 1 y su propio mensaje.
//
// Que comprueba:
//   1. redirects() devuelve exactamente la regla de www, y solo esa.
//   2. En www: 308 al apex, conservando ruta y query, con X-Frame-Options: DENY
//      (la senal del paso 3 del doc de que contesto el despliegue). Incluye el
//      resto de /.well-known/: no es estatico, lo atiende [categoria]/[slug].
//   3. En www NO se redirigen /.well-known/assetlinks.json ni el AASA, y solo
//      esos dos, exactos: Google y Apple los piden con 200 y sin redireccion.
//   4. Ningun otro host redirige: apex, vercel.app, un preview y localhost.
//   5. Anti-bucle: ninguna respuesta redirige a la misma URL que se pidio. Una
//      regla sin su `has` (has: [] tambien compila) redirigiria el apex a si
//      mismo y tumbaria el sitio entero al mergear.
//
// FRAGIL, y conviene saber por que:
//   - Usa next/experimental/testing/server (unstable_getResponseFromNextConfig y
//     getRedirectUrl). Esta documentada (next-config-js/index.md, "Unit Testing
//     (experimental)"), pero es unstable_: puede cambiar con cualquier version.
//   - Esa API truena al cargarse si no existe globalThis.AsyncLocalStorage
//     ("Invariant: AsyncLocalStorage accessed in runtime..."); por eso se define
//     antes del require.
//   - Solo modela next.config. No modela el router de Vercel (su redireccion de
//     dominio contesta antes que esta regla), ni proxy.ts, ni los archivos de
//     public/. Ademas descarta los parametros que captura `has` (por eso truena
//     con la reescritura de /sentry-tunnel), une con coma las claves repetidas de
//     query y con rutas '//x' arma un Location de protocolo relativo: por eso
//     aqui no hay casos asi, ni rutas con barra final (Next las quita con su
//     propio 308 antes de esta regla).
//   - La prueba que vale es el curl contra produccion despues del cambio en
//     Vercel: docs/APP-LINKS-WWW-2026-11-07.md, paso 3.
//
// Solo imprime el status y el Location de cada caso, y X-Frame-Options en los
// 308 de www: nada mas de la configuracion ni de las cabeceras.

import { AsyncLocalStorage } from "node:async_hooks";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const web = resolve(raiz, "apps/web");
const req = createRequire(resolve(web, "package.json"));
const { unstable_getResponseFromNextConfig, getRedirectUrl } = req("next/experimental/testing/server");

const APEX = "vicinomarket.com";
const WWW = "www.vicinomarket.com";

// La misma regla que next.config.ts, escrita aparte a proposito: si alguien la
// cambia alli, esta prueba tiene que enterarse.
const REGLA_WWW = {
  source: "/:path((?!\\.well-known/(?:assetlinks\\.json|apple-app-site-association)$).*)",
  has: [{ type: "host", value: WWW }],
  destination: `https://${APEX}/:path`,
  permanent: true,
};

const ARCHIVOS_DE_ASOCIACION = ["/.well-known/assetlinks.json", "/.well-known/apple-app-site-association"];

/** [ruta, Location esperado en www]. */
const CASOS_WWW = [
  ["/", `https://${APEX}/`],
  ["/terminos?a=1", `https://${APEX}/terminos?a=1`],
  ["/comida/pan-dulce", `https://${APEX}/comida/pan-dulce`],
  ["/?feed=solicitudes", `https://${APEX}/?feed=solicitudes`],
  // Bajo /.well-known/ solo se quedan los dos archivos, y exactos.
  ["/.well-known/otra-cosa", `https://${APEX}/.well-known/otra-cosa`],
  ["/.well-known/assetlinks.json.bak", `https://${APEX}/.well-known/assetlinks.json.bak`],
];

/** Ninguna ruta redirige en estos origenes. El preview es un nombre sintetico. */
const ORIGENES_SIN_REDIRECCION = [
  `https://${APEX}`,
  "https://startup-marketplace-web.vercel.app",
  "https://vicinomarket-git-rama-equipo.vercel.app",
  "http://localhost:3000",
];

const RUTAS = [...CASOS_WWW.map(([ruta]) => ruta), ...ARCHIVOS_DE_ASOCIACION];

const fallos = [];

function anotar(ok, nombre, detalle) {
  if (!ok) fallos.push(nombre);
  console.log(`${ok ? "  ok   " : "  FALLA"} ${nombre}${detalle ? ` -> ${detalle}` : ""}`);
}

async function cargarConfiguracion() {
  const modulo = await import(pathToFileURL(resolve(web, "next.config.ts")).href);
  // Con tsx el modulo trae una sola clave, default; segun como se transpile,
  // la configuracion puede venir un nivel mas adentro.
  const exportado = modulo.default?.default ?? modulo.default;
  return typeof exportado === "function"
    ? await exportado("phase-production-build", { defaultConfig: {} })
    : await exportado;
}

async function responder(config, url) {
  const respuesta = await unstable_getResponseFromNextConfig({ url, nextConfig: config });
  return {
    status: respuesta.status,
    location: getRedirectUrl(respuesta),
    // headers() se aplica tambien a las redirecciones (Next las evalua antes).
    marco: respuesta.headers.get("x-frame-options"),
  };
}

/** Anti-bucle: un Location igual a la URL pedida es un 308 infinito. */
function esBucle(url, location) {
  if (!location) return false;
  try {
    return new URL(location, url).href === new URL(url).href;
  } catch {
    return false;
  }
}

async function comprobarRegla(config) {
  if (typeof config?.redirects !== "function") {
    anotar(false, "next.config.ts define redirects()", `es ${typeof config?.redirects}`);
    return;
  }
  const reglas = await config.redirects();
  anotar(
    isDeepStrictEqual(reglas, [REGLA_WWW]),
    "redirects() devuelve solo la regla de www",
    `${Array.isArray(reglas) ? reglas.length : "ninguna"} regla(s)`,
  );
}

async function comprobarCaso(config, url, esperado) {
  const { status, location, marco } = await responder(config, url);
  const ok = esperado
    ? status === 308 && location === esperado && marco === "DENY"
    : status === 200 && location === null;
  const obtenido = `${status} ${location ?? "(sin Location)"}${esperado ? ` (X-Frame-Options: ${marco ?? "ninguna"})` : ""}`;
  const pedido = esperado ? `308 ${esperado} (X-Frame-Options: DENY)` : "200 sin Location";
  anotar(ok, url, ok ? obtenido : `${obtenido}; se esperaba ${pedido}`);
  if (esBucle(url, location)) anotar(false, `${url} no redirige a si misma`, location);
}

async function main() {
  const config = await cargarConfiguracion();
  console.log("Regla en next.config.ts");
  await comprobarRegla(config);

  console.log(`\nwww (${WWW}): 308 al apex con ruta y query`);
  for (const [ruta, esperado] of CASOS_WWW) await comprobarCaso(config, `https://${WWW}${ruta}`, esperado);

  console.log("\nwww: los archivos de asociacion se sirven sin redireccion");
  for (const ruta of ARCHIVOS_DE_ASOCIACION) await comprobarCaso(config, `https://${WWW}${ruta}`, null);

  console.log("\nOtros hosts: nada redirige");
  for (const origen of ORIGENES_SIN_REDIRECCION) {
    for (const ruta of RUTAS) await comprobarCaso(config, `${origen}${ruta}`, null);
  }
}

try {
  await main();
} catch (error) {
  anotar(false, "la prueba corre hasta el final", error instanceof Error ? error.message : String(error));
}

console.log(
  fallos.length === 0
    ? "\nTodo en orden: la regla solo redirige www y deja pasar los dos archivos de asociacion."
    : `\n${fallos.length} comprobacion(es) FALLAN.`,
);
process.exitCode = fallos.length === 0 ? 0 : 1;
