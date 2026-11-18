/**
 * Fichas solo con sesion (18-nov-2026). Se vigilan las dos piezas:
 *
 *   1. El matcher de proxy.ts, compilado con el codigo de Next (el mismo que
 *      decide en cada peticion si el proxy corre): sus exclusiones van
 *      ancladas y toda URL de ficha pasa por el proxy y exige sesion.
 *   2. La ruta /[categoria]/[slug]: se cargan el layout y la pagina REALES y
 *      se comprueba que fuera de una categoria no consultan nada, y que sin
 *      sesion no dan nada de la ficha aunque el proxy no hubiera corrido.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import type * as TS from "typescript";
import { CATEGORIES } from "@vicino/shared";
import { loginPara, requiereSesion } from "../auth/acceso-invitado";
import { cargarReal, sentryEspia, WEB } from "../pruebas/cargar-real";
import { esCategoriaDeFicha, rutaDeFicha } from "./ruta-de-ficha";

const requireWeb = createRequire(path.join(WEB, "package.json"));
// Sintetico: el repo es publico y no lleva slugs ni ids de cuentas reales.
const SLUG = "publicacion-de-prueba-0a1b2c";

/**
 * Primeros segmentos que no son categorias y que el proxy trata aparte: los
 * nueve primeros se parecen a una exclusion del matcher; los demas son rutas
 * que requiereSesion() deja abiertas por prefijo. Ninguno puede abrir una
 * ficha.
 */
const ATAJOS_DEL_MATCHER = ["sentry-tunnel", "apix", "api", "icons", "faviconXico", "sw.jsx", "theme-init.jsx", "manifest.jsonx", "workbox-x.js"];
const ATAJOS_DE_RUTAS_ABIERTAS = [
  "_next", "login", "register", "forgot-password", "reset-password", "centro-de-ayuda", "cuenta-eliminada",
  "auth", "callback", ".well-known", "terminos", "privacidad", "eliminar-cuenta",
];
const ATAJOS = [...ATAJOS_DEL_MATCHER, ...ATAJOS_DE_RUTAS_ABIERTAS];

// ---------------------------------------------------------------------------
// El matcher de proxy.ts, compilado como lo compila Next.
// ---------------------------------------------------------------------------

/** Next lee config.matcher sin ejecutar proxy.ts; aqui se lee igual, del AST. */
function matcherDeProxy(): string[] {
  const ts = requireWeb("typescript") as typeof TS;
  const archivo = path.join(WEB, "proxy.ts");
  const fuente = ts.createSourceFile(archivo, readFileSync(archivo, "utf8"), ts.ScriptTarget.Latest, true);
  for (const sentencia of fuente.statements) {
    if (!ts.isVariableStatement(sentencia)) continue;
    for (const declaracion of sentencia.declarationList.declarations) {
      const valor = declaracion.initializer;
      if (!ts.isIdentifier(declaracion.name) || declaracion.name.text !== "config") continue;
      if (!valor || !ts.isObjectLiteralExpression(valor)) continue;
      for (const propiedad of valor.properties) {
        if (!ts.isPropertyAssignment(propiedad) || !ts.isIdentifier(propiedad.name)) continue;
        if (propiedad.name.text !== "matcher" || !ts.isArrayLiteralExpression(propiedad.initializer)) continue;
        return propiedad.initializer.elements.map((elemento) => {
          if (!ts.isStringLiteral(elemento)) throw new Error("config.matcher tiene que ser una lista de cadenas literales");
          return elemento.text;
        });
      }
    }
  }
  throw new Error("proxy.ts no exporta config.matcher");
}

interface ModuloMatchers {
  getMiddlewareMatchers(matcher: string[], nextConfig: object): unknown[];
}
interface ModuloRutas {
  getMiddlewareRouteMatcher(matchers: unknown[]): (ruta: string, req: object, query: object) => boolean;
}
// Las dos funciones con las que Next decide, en cada peticion, si corre el
// proxy. Si una version de Next las mueve, esta prueba falla en voz alta: es
// la señal para volver a comprobar el matcher, no para borrarla.
const { getMiddlewareMatchers } = requireWeb("next/dist/build/analysis/get-page-static-info.js") as ModuloMatchers;
const { getMiddlewareRouteMatcher } = requireWeb(
  "next/dist/shared/lib/router/utils/middleware-route-matcher.js",
) as ModuloRutas;
const correElProxy = getMiddlewareRouteMatcher(getMiddlewareMatchers(matcherDeProxy(), {}));
const pasaPorElProxy = (ruta: string) => correElProxy(ruta, { headers: {} }, {});

test("lo que nunca fue una navegacion sigue fuera del proxy", () => {
  for (const ruta of [
    "/api",
    "/api/session/datos",
    "/api/products/00000000-0000-4000-8000-000000000001/location-map",
    "/api/cron/recompute-rankings",
    "/sentry-tunnel",
    "/sentry-tunnel/",
    "/sw.js",
    "/sw.js.map",
    "/workbox-130d51c8.js",
    "/workbox-130d51c8.js.map",
    "/theme-init.js",
    "/manifest.json",
    "/offline.html",
    "/_next/static/chunks/main-app-281413b9ea418d45.js",
    "/_next/image",
    "/favicon.ico",
    "/icons/icon-128.png",
    "/apple-touch-icon.png",
    "/og-image.jpg",
  ]) {
    assert.equal(pasaPorElProxy(ruta), false, `${ruta} no deberia pagar el proxy`);
  }
});

test("las paginas pasan por el proxy, tambien en su forma RSC", () => {
  for (const ruta of ["/", "/buscar", "/login", "/perfil", "/offline.html/x", `/comida/${SLUG}`, `/comida/${SLUG}.rsc`]) {
    assert.equal(pasaPorElProxy(ruta), true, ruta);
  }
});

test("los atajos del matcher ya pasan por el proxy y mandan a /login (salvo /api, que es de las rutas)", () => {
  for (const segmento of ATAJOS_DEL_MATCHER.filter((s) => s !== "api")) {
    const ruta = `/${segmento}/${SLUG}`;
    assert.equal(pasaPorElProxy(ruta), true, `${ruta} se salta el proxy`);
    assert.equal(requiereSesion(ruta), true, `${ruta} no exige sesion`);
  }
  // /api/* sigue fuera del proxy a proposito: cada route handler resuelve su
  // sesion. Que /api/<slug> no abra una ficha lo garantiza la ruta (abajo).
  assert.equal(pasaPorElProxy(`/api/${SLUG}`), false);
});

test("toda URL de ficha pasa por el proxy y exige sesion, en todas las categorias", () => {
  for (const { slug: categoria } of CATEGORIES) {
    const ruta = `/${categoria}/${SLUG}`;
    assert.equal(pasaPorElProxy(ruta), true, `${ruta} se salta el proxy`);
    assert.equal(pasaPorElProxy(`${ruta}.rsc`), true, `${ruta}.rsc se salta el proxy`);
    assert.equal(requiereSesion(ruta), true, `${ruta} quedo abierta para invitados`);
  }
});

// ---------------------------------------------------------------------------
// La ruta: solo una categoria abre una ficha.
// ---------------------------------------------------------------------------

test("solo las categorias son primer segmento de una ficha", () => {
  for (const { slug } of CATEGORIES) assert.equal(esCategoriaDeFicha(slug), true, slug);
  for (const segmento of [...ATAJOS, "", "Comida", "%63omida", "comida/x", "comida "]) {
    assert.equal(esCategoriaDeFicha(segmento), false, JSON.stringify(segmento));
  }
});

test("rutaDeFicha codifica los dos segmentos", () => {
  assert.equal(rutaDeFicha("comida", SLUG), `/comida/${SLUG}`);
  assert.equal(rutaDeFicha("comida", "a/b?c"), "/comida/a%2Fb%3Fc");
});

type Layout = {
  default(props: { children: unknown; params: Promise<{ categoria: string }> }): Promise<unknown>;
};
const NO_ENCONTRADO = /NEXT_NOT_FOUND/;
const navegacion = {
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
};

test("el layout de [categoria] responde 404 fuera de una categoria", async () => {
  const layout = await cargarReal<Layout>("app/(marketplace)/[categoria]/layout.tsx", {
    stubs: { "next/navigation": navegacion },
  });
  for (const categoria of ATAJOS) {
    await assert.rejects(layout.default({ children: "ficha", params: Promise.resolve({ categoria }) }), NO_ENCONTRADO, categoria);
  }
  assert.equal(await layout.default({ children: "ficha", params: Promise.resolve({ categoria: "comida" }) }), "ficha");
});

interface Consulta {
  tabla: string;
  filtros: Array<[string, string, unknown]>;
}
interface Cadena {
  select(): Cadena;
  eq(columna: string, valor: unknown): Cadena;
  neq(columna: string, valor: unknown): Cadena;
  single(): Promise<{ data: null; error: { code: string } }>;
  maybeSingle(): Promise<{ data: null; error: null }>;
}

/** Cliente de Supabase de mentira: registra cada consulta y no encuentra nada. */
function supabaseFalso(usuario: { id: string } | null) {
  const consultas: Consulta[] = [];
  let sesiones = 0;
  const cliente = {
    auth: {
      getUser: async () => {
        sesiones += 1;
        return usuario
          ? { data: { user: usuario }, error: null }
          : { data: { user: null }, error: Object.assign(new Error("Auth session missing!"), { name: "AuthSessionMissingError" }) };
      },
    },
    from(tabla: string): Cadena {
      const consulta: Consulta = { tabla, filtros: [] };
      consultas.push(consulta);
      const cadena: Cadena = {
        select: () => cadena,
        eq: (columna: string, valor: unknown) => {
          consulta.filtros.push(["eq", columna, valor]);
          return cadena;
        },
        neq: (columna: string, valor: unknown) => {
          consulta.filtros.push(["neq", columna, valor]);
          return cadena;
        },
        single: async () => ({ data: null, error: { code: "PGRST116" } }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return cadena;
    },
  };
  return { cliente, consultas, sesiones: () => sesiones };
}

type Pagina = {
  default(props: { params: Promise<{ categoria: string; slug: string }> }): Promise<unknown>;
  generateMetadata(props: { params: Promise<{ categoria: string; slug: string }> }): Promise<{ title?: unknown }>;
};

async function cargarPagina(usuario: { id: string } | null) {
  const supabase = supabaseFalso(usuario);
  const pagina = await cargarReal<Pagina>("app/(marketplace)/[categoria]/[slug]/page.tsx", {
    stubs: {
      "next/navigation": navegacion,
      "@/lib/supabase/server": { createClient: async () => supabase.cliente },
      "@/lib/supabase/admin": {
        createAdminClient: () => {
          throw new Error("la prueba no deberia llegar al cliente admin");
        },
      },
      "@sentry/nextjs": sentryEspia(),
    },
    aislarEntrada: { reales: ["react", "@/lib/navigation/ruta-de-ficha", "@/lib/auth/acceso-invitado", "@vicino/shared"] },
  });
  return { pagina, ...supabase };
}

const params = (categoria: string, slug = SLUG) => ({ params: Promise.resolve({ categoria, slug }) });

test("fuera de una categoria la pagina da 404 sin leer la sesion ni la publicacion", async () => {
  const { pagina, consultas, sesiones } = await cargarPagina({ id: "00000000-0000-4000-8000-000000000002" });
  for (const categoria of ATAJOS) {
    await assert.rejects(pagina.default(params(categoria)), NO_ENCONTRADO, categoria);
  }
  assert.equal(consultas.length, 0);
  assert.equal(sesiones(), 0);
});

test("fuera de una categoria el <head> no lleva nada de la ficha", async () => {
  const { pagina, consultas } = await cargarPagina(null);
  for (const categoria of ATAJOS) {
    assert.deepEqual(await pagina.generateMetadata(params(categoria)), { title: "Producto no encontrado" }, categoria);
  }
  assert.equal(consultas.length, 0);
});

test("sin sesion el <head> de una ficha real tampoco lleva nada de ella", async () => {
  const { pagina, consultas } = await cargarPagina(null);
  assert.deepEqual(await pagina.generateMetadata(params("comida")), {});
  assert.equal(consultas.length, 0);
});

test("con sesion el <head> busca la publicacion por su slug", async () => {
  const { pagina, consultas } = await cargarPagina({ id: "00000000-0000-4000-8000-000000000002" });
  // El doble no encuentra nada: sale el titulo de "no encontrado" DESPUES de consultar.
  assert.deepEqual(await pagina.generateMetadata(params("comida")), { title: "Producto no encontrado" });
  assert.equal(consultas.length, 1);
  assert.equal(consultas[0]?.tabla, "products_services");
  assert.deepEqual(consultas[0]?.filtros, [["eq", "slug", SLUG]]);
});

test("sin sesion la pagina manda a /login antes de leer la publicacion, aunque el proxy no hubiera corrido", async () => {
  const { pagina, consultas } = await cargarPagina(null);
  await assert.rejects(pagina.default(params("comida")), (error: unknown) => {
    assert.ok(error instanceof Error, "no es un Error");
    assert.equal(error.message, "NEXT_REDIRECT");
    assert.equal((error as Error & { url?: string }).url, loginPara(`/comida/${SLUG}`));
    return true;
  });
  assert.equal(consultas.length, 0);
});

test("con sesion y categoria real la pagina busca la publicacion por su slug", async () => {
  const { pagina, consultas } = await cargarPagina({ id: "00000000-0000-4000-8000-000000000002" });
  // El doble no encuentra nada: la pagina responde 404 DESPUES de consultar.
  await assert.rejects(pagina.default(params("comida")), NO_ENCONTRADO);
  assert.equal(consultas.length, 1);
  assert.equal(consultas[0]?.tabla, "products_services");
  assert.deepEqual(consultas[0]?.filtros, [
    ["eq", "slug", SLUG],
    ["neq", "estatus", "eliminado"],
  ]);
});
