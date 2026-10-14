import { isAuthApiError, isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * Dos clases de fallo al despertar o revocar una sesion dormida, porque se
 * tratan al reves:
 *
 *   - "credencial": GoTrue dio un veredicto sobre el token (invalido, ya usado,
 *     usuario borrado, sesion revocada desde otro sitio). No mejora
 *     reintentando: la cuenta se QUITA de la boveda.
 *   - "red": transporte (fetch caido, timeout, 5xx, 429). La cuenta se queda y
 *     se avisa para reintentar.
 *
 * Mismo criterio que usuarioOInvitado() en lib/session-auth.ts, que es de
 * servidor; este es su equivalente de cliente.
 */
export type ClaseErrorAuth = "credencial" | "red";

export function clasificarErrorAuth(error: unknown): ClaseErrorAuth {
  if (isAuthRetryableFetchError(error)) return "red";
  if (isAuthApiError(error)) {
    const estado = error.status ?? 0;
    return estado >= 400 && estado < 500 && estado !== 408 && estado !== 429 ? "credencial" : "red";
  }
  // setSession() lanza AuthSessionMissingError si faltan tokens: no hay nada que despertar.
  if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AuthSessionMissingError") {
    return "credencial";
  }
  return "red";
}
