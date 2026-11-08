import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal } from "../pruebas/cargar-real";

type Modulo = typeof import("./ubicacion-servidor");

/** El almacen de cookies de Next con solo `get`, como lo simulan los arneses de scripts/. */
async function cargar(cookies: Record<string, string>) {
  const pedidas: string[] = [];
  const modulo = await cargarReal<Modulo>("lib/geo/ubicacion-servidor.ts", { stubs: {
    "next/headers": { cookies: async () => ({ get: (nombre: string) => {
      pedidas.push(nombre);
      return Object.hasOwn(cookies, nombre) ? { name: nombre, value: cookies[nombre] } : undefined;
    } }) },
  } });
  return { modulo, pedidas };
}

test("lee las dos cookies de zona con get y devuelve la interpretacion unica", async () => {
  const { modulo, pedidas } = await cargar({ vicino_location: "19.0414,-98.2063", vicino_radius: "25000" });
  assert.deepEqual(await modulo.leerZonaGuardada(), { estado: "valida", punto: { lat: 19.041, lng: -98.206 }, radio: 25000 });
  assert.deepEqual(pedidas.sort(), ["vicino_location", "vicino_radius"]);
});

test("sin cookies: ausente con el radio por defecto", async () => {
  const { modulo } = await cargar({});
  assert.deepEqual(await modulo.leerZonaGuardada(), { estado: "ausente", punto: null, radio: 10000 });
});

test("fuera del area del mapa no cuenta como zona valida", async () => {
  const { modulo } = await cargar({ vicino_location: "40.000,-120.000" });
  assert.equal((await modulo.leerZonaGuardada()).estado, "fuera-de-area");
});
