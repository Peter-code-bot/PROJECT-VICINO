import "server-only";
import { AuthApiError, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/** Lo lanza `usuarioOInvitado` cuando Auth no pudo contestar. */
export const AUTH_NO_DISPONIBLE = "VICINO_AUTH_NO_DISPONIBLE";

/**
 * Resuelve la sesion distinguiendo tres cosas que `getUser()` confunde en una:
 *
 *   1. No hay sesion (o el refresh token ya no vale, o la cuenta se borro):
 *      devuelve `null`. La ruta responde 401, el cliente vacia la memoria y
 *      manda a identificarse. Es lo correcto: esos datos ya no son de nadie.
 *   2. Auth no contesto (red caida, 5xx, 429 de GoTrue): LANZA. La ruta
 *      responde 503, el cliente conserva lo que tenia y reintenta en el
 *      siguiente primer plano. Un fallo pasajero durante una revalidacion en
 *      segundo plano no puede expulsar de la aplicacion a quien tiene sesion.
 *   3. Sesion valida: devuelve el usuario.
 *
 * La diferencia entre (1) y (2) es la clase del error: `AuthApiError` con
 * estado 4xx es un veredicto de GoTrue sobre la credencial —token invalido,
 * usuario inexistente— y no mejora reintentando; lo demas (incluido el 429 y
 * los 5xx, que auth-js entrega como AuthRetryableFetchError) es un problema de
 * transporte.
 */
export async function usuarioOInvitado(
  supabase: Pick<SupabaseClient<Database>, "auth">,
): Promise<User | null> {
  const { data, error } = await supabase.auth.getUser();
  if (!error) return data.user;
  if (error.name === "AuthSessionMissingError") return null;
  const estado = error.status ?? 0;
  if (error instanceof AuthApiError && estado >= 400 && estado < 500 && estado !== 408 && estado !== 429) {
    return null;
  }
  throw new Error(AUTH_NO_DISPONIBLE, { cause: error });
}

export function esAuthNoDisponible(error: unknown): boolean {
  return error instanceof Error && error.message === AUTH_NO_DISPONIBLE;
}
