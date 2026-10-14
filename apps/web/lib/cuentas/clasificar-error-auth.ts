import {
  isAuthApiError,
  isAuthRetryableFetchError,
  isAuthSessionMissingError,
  AuthInvalidCredentialsError,
  AuthInvalidJwtError,
} from "@supabase/supabase-js";

/**
 * Dos clases de fallo al despertar o revocar una sesion dormida, porque se
 * tratan al reves:
 *
 *   - "credencial": un VEREDICTO sobre el token. Del servidor: AuthApiError
 *     4xx (invalido, ya usado, usuario borrado, sesion revocada desde otro
 *     sitio); de auth-js, sin ir a la red: JWT malformado
 *     (AuthInvalidJwtError), tokens que faltan (AuthSessionMissingError),
 *     credenciales incompletas. No mejora reintentando: la cuenta se QUITA de
 *     la boveda.
 *   - "red": transporte y servidor sin veredicto (fetch caido, abort, 5xx,
 *     429, 408, una respuesta que no es JSON: AuthUnknownError). La cuenta se
 *     queda y se avisa para reintentar.
 *
 * Un 429 o un 500 de /token NO son veredictos sobre el token aunque auth-js
 * los trate como AuthError definitivo (y borre su storage): aqui se clasifican
 * como red, y quien llama restaura lo que auth-js borro.
 * Mismo criterio que usuarioOInvitado() en lib/session-auth.ts.
 */
export type ClaseErrorAuth = "credencial" | "red";

export function clasificarErrorAuth(error: unknown): ClaseErrorAuth {
  if (isAuthRetryableFetchError(error)) return "red";
  if (isAuthApiError(error)) {
    const estado = error.status ?? 0;
    return estado >= 400 && estado < 500 && estado !== 408 && estado !== 429 ? "credencial" : "red";
  }
  if (isAuthSessionMissingError(error)) return "credencial";
  if (error instanceof AuthInvalidJwtError || error instanceof AuthInvalidCredentialsError) return "credencial";
  return "red";
}
