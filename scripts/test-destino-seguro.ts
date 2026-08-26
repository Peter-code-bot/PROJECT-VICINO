// Prueba de la guarda de redireccion del login.
//
//   ./node_modules/.bin/tsx scripts/test-destino-seguro.ts
//
// Existe porque una redireccion abierta no se ve: la pagina carga, el usuario
// llega a otro sitio y nadie se entera salvo quien lo explota. Los casos que
// deben PASAR importan tanto como los que deben bloquearse: una guarda
// demasiado estricta rompe el flujo de venta, que es justo lo que venia a
// arreglar.

import { destinoSeguro } from "../apps/web/lib/auth/destino-seguro.ts";

const B = String.fromCharCode(92);

const casos: Array<[string, string | null | undefined, string]> = [
  ["sin parametro", null, "/"],
  ["cadena vacia", "", "/"],
  ["indefinido", undefined, "/"],
  ["ruta interna simple", "/vender", "/vender"],
  ["ruta interna con subruta", "/perfil/editar", "/perfil/editar"],
  ["ruta con query", "/perfil/editar?prompt=seller-mode", "/perfil/editar?prompt=seller-mode"],
  ["dominio absoluto", "https://evil.example", "/"],
  ["protocolo relativo", "//evil.example", "/"],
  ["barra invertida", "/" + B + B + "evil.example", "/"],
  ["barra invertida en medio", "/vender" + B + "x", "/"],
  ["sin barra inicial", "vender", "/"],
  ["javascript:", "javascript:alert(1)", "/"],
  ["data:", "data:text/html,x", "/"],
];

let fallos = 0;
for (const [nombre, entrada, esperado] of casos) {
  const real = destinoSeguro(entrada);
  const ok = real === esperado;
  if (!ok) fallos += 1;
  console.log(
    (ok ? "  ok   " : "  FALLA") +
      " " + nombre.padEnd(26) +
      " -> " + JSON.stringify(real) +
      (ok ? "" : "   esperaba " + JSON.stringify(esperado)),
  );
}

console.log("");
console.log(
  fallos === 0
    ? casos.length + "/" + casos.length + " casos pasan."
    : fallos + " caso(s) FALLAN.",
);
process.exit(fallos === 0 ? 0 : 1);
