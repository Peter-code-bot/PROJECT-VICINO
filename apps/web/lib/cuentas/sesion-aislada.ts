/**
 * Un cliente de Supabase APARTE para tocar sesiones dormidas sin rozar la cookie.
 *
 * Por que no vale el cliente normal (lib/supabase/client.ts): su storage ES la
 * cookie de sesion. Y auth-js 2.99.3, en setSession() con un access token
 * caducado, llama a _callRefreshToken(); si el refresh token no vale, ejecuta
 * _removeSession(), que BORRA el storage, o sea la cookie de la cuenta activa.
 * Probar la sesion de B en el cliente principal podia cerrar la de A.
 *
 * Este cliente tiene storage en memoria y su propio storageKey, asi que:
 *   - setSession() aqui valida (y refresca si hace falta) la sesion dormida y
 *     devuelve tokens VIGENTES, que es lo unico que se le pasa despues al
 *     cliente principal. Con el access token vigente, el principal va por el
 *     camino de _getUser(): guarda la cookie si va bien y, si no, devuelve el
 *     error SIN tocar nada.
 *   - signOut({ scope: "local" }) aqui revoca SOLO la sesion cargada: la de la
 *     cuenta que se quita del dispositivo, y no la activa ni las de otros
 *     dispositivos de esa persona.
 *   - Su cerrojo (navigator.locks) y su BroadcastChannel llevan otro nombre,
 *     asi que no bloquean ni avisan al cliente principal.
 *
 * La memoria se vacia al terminar cada operacion: aqui no se queda nada.
 */
import { createClient, type AuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { fetchConLimite } from "../supabase/fetch-con-limite";
import { clasificarErrorAuth, type ClaseErrorAuth } from "./clasificar-error-auth";

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export type ResultadoProbar =
  | { ok: true; sesion: Session }
  | { ok: false; clase: ClaseErrorAuth; error: unknown };

export type ResultadoRevocar =
  | { ok: true; yaInvalida: boolean }
  | { ok: false; clase: "red"; error: unknown };

/** Lo que se usa del cliente aislado. Por su forma, para poder dar uno falso en pruebas. */
export interface AuthAislado {
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
    data: { session: Session | null };
    error: AuthError | null;
  }>;
  signOut(opciones: { scope: "local" }): Promise<{ error: AuthError | null }>;
}

const STORAGE_KEY_AISLADO = "vicino-cuentas-aislado";
const memoria = new Map<string, string>();
let cliente: SupabaseClient | null = null;

function crearClienteAislado(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: fetchConLimite(fetch, url) },
    auth: {
      storage: {
        getItem: (clave) => memoria.get(clave) ?? null,
        setItem: (clave, valor) => {
          memoria.set(clave, valor);
        },
        removeItem: (clave) => {
          memoria.delete(clave);
        },
      },
      storageKey: STORAGE_KEY_AISLADO,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/** Uno solo por pestaña: cada GoTrueClient cuelga un listener de visibilidad del window. */
export function authAislado(): AuthAislado {
  cliente ??= crearClienteAislado();
  return cliente.auth;
}

function olvidar(): void {
  memoria.clear();
}

/**
 * Despierta una sesion dormida EN MEMORIA y devuelve tokens vigentes.
 *
 * Si el access token caduco, auth-js lo refresca con el refresh token: es su
 * primer uso desde que se guardo, asi que vale. Los tokens que vuelven son
 * NUEVOS y hay que guardarlos en la boveda antes de hacer nada mas: los viejos
 * ya se gastaron.
 */
export async function probarSesion(tokens: Tokens, auth: AuthAislado = authAislado()): Promise<ResultadoProbar> {
  try {
    const { data, error } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (error) return { ok: false, clase: clasificarErrorAuth(error), error };
    if (!data.session) return { ok: false, clase: "credencial", error: new Error("setSession sin sesion") };
    return { ok: true, sesion: data.session };
  } catch (error) {
    return { ok: false, clase: clasificarErrorAuth(error), error };
  } finally {
    olvidar();
  }
}

/**
 * Revoca en Supabase una sesion dormida (y solo esa).
 *
 * Por que revocar y no solo borrar la entrada de la boveda: las sesiones en
 * produccion no caducan (time-box e inactividad a 0). Un refresh token que se
 * borra de localStorage sin revocar vale para siempre en cualquier copia que
 * alguien haya hecho de ese localStorage.
 *
 * Un fallo de credencial al cargarla (ya revocada, usuario borrado, "Already
 * Used") cuenta como exito: no habia nada que revocar. Solo la red devuelve
 * ok: false, y entonces la entrada se conserva para reintentar.
 */
export async function revocarSesion(tokens: Tokens, auth: AuthAislado = authAislado()): Promise<ResultadoRevocar> {
  try {
    const { error } = await auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    if (error) {
      const clase = clasificarErrorAuth(error);
      return clase === "credencial" ? { ok: true, yaInvalida: true } : { ok: false, clase: "red", error };
    }
    // auth-js ya ignora 401/403/404 del /logout (sesion que no existe): un error
    // aqui es de transporte.
    const { error: errorSalida } = await auth.signOut({ scope: "local" });
    if (errorSalida) return { ok: false, clase: "red", error: errorSalida };
    return { ok: true, yaInvalida: false };
  } catch (error) {
    return { ok: false, clase: "red", error };
  } finally {
    olvidar();
  }
}
