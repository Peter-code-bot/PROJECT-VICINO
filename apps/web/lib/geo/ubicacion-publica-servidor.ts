import "server-only";
import { z } from "zod";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { DecimalesRejilla, PrecisionUbicacion } from "./ubicacion-publica";

/**
 * Lee el dato publico autorizado de UNA publicacion con el cliente admin:
 * public.ubicacion_publica_de_publicacion, la misma proyeccion que usa el mapa
 * (search_map_publications_v4). Solo service_role puede ejecutarla.
 *
 * NO autoriza: quien llama ya comprobo con el cliente del usuario (RLS) que la
 * publicacion es visible para esa cuenta. Es el mismo orden que seguia la
 * ruta del minimapa cuando leia ubicacion_geo.
 */
const respuestaSchema = z.object({
  disponible: z.boolean(),
  precision: z.enum(["exacta", "aproximada"]),
  revision: z.number().int().nonnegative(),
  decimales: z.union([z.literal(2), z.literal(3)]),
  lat: z.number().finite().min(-85).max(85).optional(),
  lng: z.number().finite().min(-180).max(180).optional(),
});

export interface UbicacionPublica {
  disponible: boolean;
  precision: PrecisionUbicacion;
  revision: number;
  decimales: DecimalesRejilla;
  /** Solo en el servidor (para pedir la imagen); nunca cruza al cliente. */
  punto: { lat: number; lng: number } | null;
}

export type LecturaUbicacionPublica =
  | { estado: "ok"; ubicacion: UbicacionPublica }
  /** La funcion aun no existe: migracion 20261108210000 sin aplicar. */
  | { estado: "sin-funcion" }
  | { estado: "error"; error: unknown };

const FUNCION_AUSENTE = "PGRST202";

export async function leerUbicacionPublica(
  admin: ReturnType<typeof createAdminClient>,
  productId: string,
  decimales: DecimalesRejilla,
): Promise<LecturaUbicacionPublica> {
  const { data, error } = await admin.rpc("ubicacion_publica_de_publicacion", {
    p_product_id: productId,
    p_decimales: decimales,
  });
  if (error) return error.code === FUNCION_AUSENTE ? { estado: "sin-funcion" } : { estado: "error", error };
  const parsed = respuestaSchema.safeParse(data);
  if (!parsed.success) return { estado: "error", error: new Error("Respuesta de ubicacion publica invalida") };
  const r = parsed.data;
  const punto = r.disponible && r.lat !== undefined && r.lng !== undefined ? { lat: r.lat, lng: r.lng } : null;
  return {
    estado: "ok",
    ubicacion: { disponible: punto !== null, precision: r.precision, revision: r.revision, decimales: r.decimales, punto },
  };
}
