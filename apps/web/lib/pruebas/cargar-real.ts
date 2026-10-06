/**
 * Carga un archivo REAL de la app para probarlo en su sitio de llamada.
 *
 * POR QUE EXISTE. Una prueba que importa un ayudante aislado sigue en verde
 * aunque la pagina, la ruta o la accion que lo usaba deje de llamarlo: vigila
 * el ayudante, no el sitio donde el fallo se ve. Aqui se empaqueta con esbuild
 * el archivo tal cual esta en el repo, con sus imports internos de verdad, y
 * solo se sustituyen las fronteras que una prueba no puede tocar: Next
 * (headers, cookies, navigation), Sentry, el cliente de Supabase con cookies y
 * el freno de Upstash.
 *
 * Es el mismo patron que scripts/test-s04b-server.ts y
 * scripts/test-frontend-routes.ts, pero dentro de la suite de apps/web
 * (`node --import tsx --test $(git ls-files '*.test.ts')`), que es la que se
 * corre antes de cada push.
 *
 * El codigo se evalua en el MISMO realm que la prueba (no en un vm aparte):
 * asi `instanceof Error`, las promesas y los objetos que devuelve se comparan
 * sin sorpresas entre contextos.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import type * as TS from "typescript";

/** apps/web, se ejecute la prueba desde donde se ejecute. */
export const WEB = path.resolve(__dirname, "..", "..");

const requireWeb = createRequire(path.join(WEB, "package.json"));

interface Esbuild {
  build(opciones: Record<string, unknown>): Promise<{ outputFiles: Array<{ text: string }> }>;
}
interface ArgsResolve {
  path: string;
  importer: string;
  kind: string;
}
interface Constructor {
  onResolve(filtro: { filter: RegExp }, cb: (args: ArgsResolve) => { path: string; namespace: string } | undefined): void;
  onLoad(filtro: { filter: RegExp; namespace: string }, cb: (args: { path: string }) => { contents: string; loader: string }): void;
}

// esbuild no es dependencia directa de apps/web: es el que trae tsx, igual que
// en los scripts de prueba de la raiz.
const esbuild = requireWeb(requireWeb.resolve("esbuild", { paths: [requireWeb.resolve("tsx")] })) as Esbuild;

/** Fronteras que ningun archivo puede importar fuera de Next. */
const STUBS_SIEMPRE: Record<string, object> = {
  // Lanza al importarse fuera de la condicion react-server.
  "server-only": {},
};

export interface OpcionesCarga {
  /**
   * Especificador EXACTO del import -> exportaciones del modulo que lo
   * sustituye. Aplica a cualquier archivo del paquete que lo importe, no solo
   * al de entrada: si una ruta importa una lib que a su vez importa Sentry, la
   * lib tambien recibe el doble.
   */
  stubs?: Record<string, object>;
  /**
   * Vacia los imports de valor del archivo de ENTRADA que no esten en `stubs`
   * ni en `reales`: cada nombre importado pasa a ser un componente que no pinta
   * nada. Sirve para layouts y paginas, cuyo arbol de componentes de cliente no
   * es lo que se prueba. Los imports internos de lo que si se carga de verdad
   * no se tocan.
   */
  aislarEntrada?: { reales: string[] };
  /** Variables libres para el codigo cargado, p. ej. `window`. */
  globales?: Record<string, unknown>;
}

/** Imports de valor del archivo: especificador -> nombres importados. */
function importsDeValor(archivo: string): Map<string, string[]> {
  const ts = requireWeb("typescript") as typeof TS;
  const fuente = readFileSync(archivo, "utf8");
  const arbol = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map<string, string[]>();
  for (const sentencia of arbol.statements) {
    if (!ts.isImportDeclaration(sentencia) || !ts.isStringLiteral(sentencia.moduleSpecifier)) continue;
    const clausula = sentencia.importClause;
    if (clausula?.isTypeOnly) continue;
    const especificador = sentencia.moduleSpecifier.text;
    const nombres = imports.get(especificador) ?? [];
    if (clausula?.name) nombres.push("default");
    const enlaces = clausula?.namedBindings;
    if (enlaces && ts.isNamespaceImport(enlaces)) {
      throw new Error(`cargarReal: "import * as" de ${especificador} necesita un stub explicito`);
    }
    if (enlaces && ts.isNamedImports(enlaces)) {
      for (const el of enlaces.elements) if (!el.isTypeOnly) nombres.push((el.propertyName ?? el.name).text);
    }
    imports.set(especificador, nombres);
  }
  return imports;
}

/** Un componente vacio con nombre, para que se reconozca al recorrer el arbol. */
function componenteVacio(nombre: string): () => null {
  const vacio = () => null;
  Object.defineProperty(vacio, "name", { value: `Vacio(${nombre})` });
  return vacio;
}

const normalizar = (p: string) => path.normalize(p).toLowerCase();

/**
 * Empaqueta `relativo` (ruta desde apps/web) con las fronteras sustituidas y
 * devuelve sus exportaciones. Cada llamada evalua el modulo de nuevo: el
 * estado de modulo (cachés, banderas de "ya avisado") no se arrastra entre
 * pruebas.
 */
export async function cargarReal<T>(relativo: string, opciones: OpcionesCarga = {}): Promise<T> {
  const entrada = path.join(WEB, relativo);
  const stubs: Record<string, object> = { ...STUBS_SIEMPRE, ...opciones.stubs };
  const stubsEntrada: Record<string, object> = {};

  if (opciones.aislarEntrada) {
    const reales = new Set(opciones.aislarEntrada.reales);
    for (const [especificador, nombres] of importsDeValor(entrada)) {
      if (Object.hasOwn(stubs, especificador) || reales.has(especificador)) continue;
      stubsEntrada[especificador] = Object.fromEntries(nombres.map((n) => [n, componenteVacio(n)]));
    }
  }

  const todos: Record<string, object> = { ...stubsEntrada, ...stubs };
  const entradaNormalizada = normalizar(entrada);
  const fronteras = {
    name: "fronteras-de-prueba",
    setup(build: Constructor) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return undefined;
        if (Object.hasOwn(stubs, args.path)) return { path: args.path, namespace: "stub" };
        if (Object.hasOwn(stubsEntrada, args.path) && normalizar(args.importer) === entradaNormalizada) {
          return { path: args.path, namespace: "stub" };
        }
        return undefined;
      });
      // __esModule: true para que `import X from` lea la clave `default` del
      // stub en vez de recibir el objeto entero.
      build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
        contents: `module.exports = Object.assign({ __esModule: true }, __stubs[${JSON.stringify(args.path)}]);`,
        loader: "js",
      }));
    },
  };

  const salida = await esbuild.build({
    entryPoints: [entrada],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
    // Los paquetes de node_modules se cargan de verdad (next/server, zod,
    // supabase-js...); los alias @/ se resuelven con el tsconfig y se
    // empaquetan, que es lo que hace que el sitio de llamada sea el real.
    packages: "external",
    jsx: "automatic",
    tsconfig: path.join(WEB, "tsconfig.json"),
    logLevel: "silent",
    plugins: [fronteras],
  });
  const codigo = salida.outputFiles[0]?.text;
  if (!codigo) throw new Error(`cargarReal: esbuild no produjo salida para ${relativo}`);

  const globales = opciones.globales ?? {};
  const modulo = { exports: {} as Record<string, unknown> };
  const evaluar = new Function("module", "exports", "require", "__stubs", ...Object.keys(globales), codigo);
  evaluar(modulo, modulo.exports, requireWeb, todos, ...Object.values(globales));
  return modulo.exports as T;
}

/** Elemento de React tal como lo devuelve un componente de servidor sin renderizar. */
interface Elemento {
  type: unknown;
  props?: { children?: unknown } & Record<string, unknown>;
}

const esElemento = (nodo: unknown): nodo is Elemento =>
  typeof nodo === "object" && nodo !== null && "$$typeof" in nodo && "type" in nodo;

/**
 * Busca en el arbol devuelto por un layout o una pagina (sin renderizar) los
 * elementos cuyo tipo es `tipo`. Los componentes vacios no se ejecutan, asi
 * que sus `children` siguen siendo elementos y se recorren.
 */
export function buscarElementos(nodo: unknown, tipo: unknown): Elemento[] {
  if (Array.isArray(nodo)) return nodo.flatMap((hijo) => buscarElementos(hijo, tipo));
  if (!esElemento(nodo)) return [];
  const propios = nodo.type === tipo ? [nodo] : [];
  return [...propios, ...buscarElementos(nodo.props?.children, tipo)];
}

/** Espia minimo: guarda los argumentos de cada llamada. */
export function espia<A extends unknown[] = unknown[]>(): ((...args: A) => void) & { llamadas: A[] } {
  const llamadas: A[] = [];
  const fn = (...args: A) => {
    llamadas.push(args);
  };
  return Object.assign(fn, { llamadas });
}

/** Doble de @sentry/nextjs que registra lo que se le manda. */
export function sentryEspia() {
  return {
    captureException: espia<[unknown, Record<string, unknown>?]>(),
    captureMessage: espia<[string, Record<string, unknown>?]>(),
  };
}
