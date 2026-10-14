import { isAuthApiError, isAuthError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Dos clases de fallo al despertar o revocar una sesion dormida, porque se
 * tratan al reves:
 *
 *   - "credencial": GoTrue (o auth-js) dio un veredicto sobre el token:
 *     invalido, ya usado, usuario borrado, sesion revocada desde otro sitio,
 *     JWT malformado. No mejora reintentando: la cuenta se QUITA de la boveda.
 *   - "red": transporte (fetch caido, timeout, abort, 5xx, 429, 408). La
 *     cuenta se queda y se avisa para reintentar.
 *
 * La regla es "red solo lo que es transporte": cualquier otro AuthError es un
 * veredicto. Al reves (todo lo desconocido como red) una entrada con un token
 * malformado no se purgaba nunca y la persona veia "Sin conexion" para
 * siempre. Mismo criterio que usuarioOInvitado() en lib/session-auth.ts.
 */
export type ClaseErrorAuth = "credencial" | "red";

export function clasificarErrorAuth(error: unknown): ClaseErrorAuth {
  if (isAuthRetryableFetchError(error)) return "red";
  if (isAuthApiError(error)) {
    const estado = error.status ?? 0;
    return estado >= 400 && estado < 500 && estado !== 408 && estado !== 429 ? "credencial" : "red";
  }
  if (isAuthError(error)) return "credencial";
  return "red";
}
