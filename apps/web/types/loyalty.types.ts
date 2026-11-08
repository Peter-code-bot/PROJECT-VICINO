/**
 * Alias de tipos de lealtad y Wallet (migracion 20261020120000).
 *
 * La migracion esta aplicada y database.types.ts, que se genera desde
 * PRODUCCION (scripts/gen-types.mjs), ya trae sus tablas y RPC (edcfce5,
 * a81e4b7). Por eso aqui ya no se declara nada a mano: solo quedan alias
 * sobre el tipo generado. Las columnas con CHECK (status, proveedor...) llegan
 * del codegen como `string`, no como uniones.
 *
 * `conLealtad` queda por compatibilidad con las rutas y acciones que lo
 * llaman: devuelve el mismo cliente con el mismo tipo. Nada aqui cambia el
 * runtime.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Filas = Database["public"]["Tables"];

export type ClienteLealtad = SupabaseClient<Database>;

export type WalletPassRow = Filas["wallet_passes"]["Row"];

/** La tarjeta propia que pinta el perfil publico (lib/lealtad/datos.ts). */
export type MembresiaPropia = Pick<Filas["loyalty_memberships"]["Row"], "id" | "sellos_disponibles" | "status">;

/** Identidad: el cliente generado ya ve las tablas y RPC de lealtad. */
export function conLealtad(cliente: ClienteLealtad): ClienteLealtad {
  return cliente;
}
