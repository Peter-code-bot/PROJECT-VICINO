// Prueba de la resolución de retorno seguro para /vender
//
//   pnpm exec tsx scripts/test-retorno-vender.ts

import {
  resolverDestinoRetornoVender,
  guardarOrigenVender,
  obtenerOrigenVender,
  limpiarOrigenVender,
} from "../apps/web/lib/navigation/retorno-vender.ts";

const TAB = String.fromCharCode(9);
const B = String.fromCharCode(92);

interface TestCase {
  name: string;
  options: Parameters<typeof resolverDestinoRetornoVender>[0];
  expectedDestino: string;
  expectedPuedeUsarBack: boolean;
}

const casos: TestCase[] = [
  {
    name: "Modo edición: siempre a /seller/listings sin usar back",
    options: { isEdit: true, fromParam: "/perfil", historyStateIdx: 3 },
    expectedDestino: "/seller/listings",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Desde Perfil con ?from=/perfil y con historial",
    options: { isEdit: false, fromParam: "/perfil", historyStateIdx: 2 },
    expectedDestino: "/perfil",
    expectedPuedeUsarBack: true,
  },
  {
    name: "Desde Perfil con ?from=/perfil pero entrada directa (sin historial)",
    options: { isEdit: false, fromParam: "/perfil", historyStateIdx: 0 },
    expectedDestino: "/perfil",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Desde Búsqueda con parámetros en sesión (q=bicicleta&category=deportes)",
    options: {
      isEdit: false,
      origenGuardado: "/buscar?q=bicicleta&category=deportes",
      historyStateIdx: 2,
    },
    expectedDestino: "/buscar?q=bicicleta&category=deportes",
    expectedPuedeUsarBack: true,
  },
  {
    name: "Desde Búsqueda con parámetros complejos y orden",
    options: {
      isEdit: false,
      fromParam: "/buscar?q=mesa&category=hogar&sort=price_asc&tipo=producto",
      historyStateIdx: 1,
    },
    expectedDestino: "/buscar?q=mesa&category=hogar&sort=price_asc&tipo=producto",
    expectedPuedeUsarBack: true,
  },
  {
    name: "Entrada directa: sin origen ni from -> fallback a Home (/)",
    options: { isEdit: false, historyStateIdx: 0 },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Referrer del mismo origen",
    options: {
      isEdit: false,
      referrer: "https://vicinomarket.com/perfil",
      windowOrigin: "https://vicinomarket.com",
      historyStateIdx: 1,
    },
    expectedDestino: "/perfil",
    expectedPuedeUsarBack: true,
  },
  {
    name: "Referrer externo (evil.example): bloqueado -> fallback a Home (/)",
    options: {
      isEdit: false,
      referrer: "https://evil.example/atacar",
      windowOrigin: "https://vicinomarket.com",
      historyStateIdx: 1,
    },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Intento de open redirect en ?from=//evil.example -> fallback a /",
    options: { isEdit: false, fromParam: "//evil.example" },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Intento de open redirect con barra invertida /\\evil.example -> fallback a /",
    options: { isEdit: false, fromParam: "/" + B + B + "evil.example" },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Caracteres de control en ?from= -> fallback a /",
    options: { isEdit: false, fromParam: "/" + TAB + "/evil.example" },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Loop prevention: si ?from apunta a /vender -> fallback a /",
    options: { isEdit: false, fromParam: "/vender" },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Loop prevention: si origenGuardado apunta a /vender/nuevo -> fallback a /",
    options: { isEdit: false, origenGuardado: "/vender/nuevo" },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Entrada directa a /vender tras navegación previa: no usa origen viejo",
    options: {
      isEdit: false,
      origenGuardado: "/buscar?q=mesa",
      isDirectHardNav: true,
      historyLength: 5,
      historyStateIdx: 3,
    },
    expectedDestino: "/",
    expectedPuedeUsarBack: false,
  },
  {
    name: "Recargar /vender tras llegar desde búsqueda: mantiene origen guardado",
    options: {
      isEdit: false,
      origenGuardado: "/buscar?q=mesa",
      isDirectHardNav: false,
      historyLength: 2,
      historyStateIdx: 1,
    },
    expectedDestino: "/buscar?q=mesa",
    expectedPuedeUsarBack: true,
  },
  {
    name: "Origen explícito from=/ es válido y respetado",
    options: {
      isEdit: false,
      fromParam: "/",
      historyStateIdx: 1,
    },
    expectedDestino: "/",
    expectedPuedeUsarBack: true,
  },
];

let fallos = 0;
for (const c of casos) {
  const res = resolverDestinoRetornoVender(c.options);
  const okDestino = res.destino === c.expectedDestino;
  const okBack = res.puedeUsarBack === c.expectedPuedeUsarBack;
  const ok = okDestino && okBack;
  if (!ok) fallos += 1;
  console.log(
    (ok ? "  ok   " : "  FALLA") +
      " " +
      c.name.padEnd(65) +
      " -> destino=" +
      JSON.stringify(res.destino) +
      " back=" +
      res.puedeUsarBack +
      (ok ? "" : " (esperaba destino=" + JSON.stringify(c.expectedDestino) + " back=" + c.expectedPuedeUsarBack + ")"),
  );
}

// ─────────────────────────────────────────────────────────────
// REGRESIÓN: Secuencia Buscar -> Inicio -> Publicar -> Volver
// Utiliza las funciones reales de guardar, recuperar y resolver
// ─────────────────────────────────────────────────────────────
console.log("\n--- REGRESIÓN DE SECUENCIA REAL (guardar, recuperar y resolver) ---");

// Simular entorno window.sessionStorage en Node
const storageMap = new Map<string, string>();
(globalThis as any).window = {
  sessionStorage: {
    getItem: (k: string) => storageMap.get(k) ?? null,
    setItem: (k: string, v: string) => storageMap.set(k, v),
    removeItem: (k: string) => storageMap.delete(k),
    clear: () => storageMap.clear(),
  },
};

// 1. Paso Buscar: usuario busca mesa
limpiarOrigenVender();
guardarOrigenVender("/buscar?q=mesa&sort=price_asc");
const origenBuscar = obtenerOrigenVender();
const paso1Ok = origenBuscar === "/buscar?q=mesa&sort=price_asc";
console.log(
  (paso1Ok ? "  ok   " : "  FALLA") +
    " " +
    "1. En Buscar: origen guardado en storage".padEnd(65) +
    " -> " +
    JSON.stringify(origenBuscar),
);
if (!paso1Ok) fallos++;

// 2. Paso Inicio: usuario navega a Inicio ("/") antes de ir a Publicar
guardarOrigenVender("/");
const origenInicio = obtenerOrigenVender();
const paso2Ok = origenInicio === "/";
console.log(
  (paso2Ok ? "  ok   " : "  FALLA") +
    " " +
    "2. En Inicio: actualiza storage a / (sobrescribe búsqueda)".padEnd(65) +
    " -> " +
    JSON.stringify(origenInicio),
);
if (!paso2Ok) fallos++;

// 3. Paso Publicar -> Volver: resuelve hacia Inicio y NO hacia la búsqueda vieja
const resRegreso = resolverDestinoRetornoVender({
  origenGuardado: obtenerOrigenVender(),
  historyStateIdx: 2,
});
const paso3Ok = resRegreso.destino === "/";
console.log(
  (paso3Ok ? "  ok   " : "  FALLA") +
    " " +
    "3. En /vender: resolverDestinoRetornoVender retorna a Inicio (/)".padEnd(65) +
    " -> " +
    JSON.stringify(resRegreso.destino),
);
if (!paso3Ok) fallos++;

// 4. Intento inseguro con origen previo en storage: fromParam=//evil.com no debe redirigir a evil ni pisar el destino
guardarOrigenVender("/perfil");
const resAtaqueConStorage = resolverDestinoRetornoVender({
  fromParam: "//evil.com",
  origenGuardado: obtenerOrigenVender(),
  historyStateIdx: 2,
});
const paso4Ok = resAtaqueConStorage.destino === "/perfil";
console.log(
  (paso4Ok ? "  ok   " : "  FALLA") +
    " " +
    "4. Intento inseguro //evil.com descartado a favor del origen seguro".padEnd(65) +
    " -> " +
    JSON.stringify(resAtaqueConStorage.destino),
);
if (!paso4Ok) fallos++;

console.log("");
console.log(
  fallos === 0
    ? (casos.length + 4) + "/" + (casos.length + 4) + " casos y regresiones pasan."
    : fallos + " caso(s) FALLAN.",
);
process.exit(fallos === 0 ? 0 : 1);
