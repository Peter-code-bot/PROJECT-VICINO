import "server-only";
import { cookies } from "next/headers";
import { COOKIE_LOCATION, COOKIE_RADIUS } from "./location-storage";
import { interpretarZonaGuardada, type ZonaGuardada } from "./zona-guardada";

export type { ZonaGuardada } from "./zona-guardada";

/**
 * El UNICO lector de la zona guardada en el servidor (paginas, componentes de
 * servidor y acciones). La interpretacion vive en zona-guardada.ts.
 *
 * Usa `get` y no `getAll` a proposito: es lo unico que simulan los arneses de
 * scripts/ (test-home-guest-previews.ts, test-university.ts), y basta.
 */
export async function leerZonaGuardada(): Promise<ZonaGuardada> {
  const almacen = await cookies();
  return interpretarZonaGuardada(
    almacen.get(COOKIE_LOCATION)?.value,
    almacen.get(COOKIE_RADIUS)?.value,
  );
}
