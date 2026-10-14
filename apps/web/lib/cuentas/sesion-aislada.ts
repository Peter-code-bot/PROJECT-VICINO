/**
 * Un cliente de Supabase APARTE para tocar sesiones dormidas sin rozar la cookie.
 *
 * Por que no vale el cliente normal (lib/supabase/client.ts): su storage ES la
 * cookie de sesion. Y auth-js 2.99.3, en setSession() con un access token
 * caducado, llama a _callRefreshToken(); si el refresh token no vale, ejecuta
 * _removeSession(), que BORRA el storage, o sea la cookie de la cuenta activa.
 * Lo mismo hace _getUser() ante un 403 session_not_found. Probar la sesion de
 * B en el cliente principal podia cerrar la de A.
 *
 * Este cliente tiene storage en memoria y su propio storageKey, asi que:
 *   - setSession() aqui valida (y refresca si hace falta) la sesion dormida y
 *     devuelve tokens VIGENTES, que es lo unico que se le pasa despues al
 *     cliente principal.
 *   - signOut({ scope: "local" }) aqui revoca SOLO la sesion cargada: la de la
 *     cuenta que se quita del dispositivo, y no la activa ni las de otros
 *     dispositivos de esa persona.
 *   - Su cerrojo (navigator.locks) y su BroadcastChannel llevan otro nombre,
 *     asi que no bloquean ni avisan al cliente principal.
 *   - Todas sus peticiones llevan tope de tiempo: fetchConLimite no acota
 *     /auth/v1/*, y un socket parado en un movil tarda minutos en morir.
 *
 * La memoria se vacia al terminar cada operacion: aqui no se queda nada.
 */
import { createClient, type AuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { TOPE_ACCION_MS } from "../auth/con-tope";
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

type RespuestaSesion = Promise<{ data: { session: Session | null }; error: AuthError | null }>;

/** Lo que se usa del cliente aislado. Por su forma, para poder dar uno falso en pruebas. */
export interface AuthAislado {
  setSession(tokens: { access_token: string; refresh_token: string }): RespuestaSesion;
  refreshSession(tokens: { refresh_token: string }): RespuestaSesion;
  signOut(opciones: { scope: "local" }): Promise<{ error: AuthError | null }>;
}

const STORAGE_KEY_AISLADO = "vicino-cuentas-aislado";
const memoria = new Map<string, string>();
let cliente: SupabaseClient | null = null;

/** fetch con tope: aborta a los 20 s, respetando la señal de quien llama si la hay. */
function fetchConTope(original: typeof fetch): typeof fetch {
  return (input, init) => {
    const controlador = new AbortController();
    const reloj = setTimeout(() => controlador.abort(new DOMException("VICINO_AUTH_TIMEOUT", "TimeoutError")), TOPE_ACCION_MS);
    const señal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    if (señal?.aborted) controlador.abort(señal.reason);
    else señal?.addEventListener("abort", () => controlador.abort(señal.reason), { once: true });
    return original(input, { ...init, signal: controlador.signal }).finally(() => clearTimeout(reloj));
  };
}

function crearClienteAislado(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { fetch: fetchConTope(fetch) },
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
 * Carga la sesion en el cliente aislado y devuelve una vigente.
 *
 * setSession decide por el reloj LOCAL si el access token caduco: si el
 * telefono va atrasado, manda un token que el servidor ya rechaza (403) y eso
 * parece un veredicto de credencial sin haber probado el refresh token, que
 * puede ser perfectamente valido. Por eso un fallo de credencial en setSession
 * se reintenta con refreshSession(): el unico veredicto que cuenta es el de
 * /token. El refresh token es de un solo uso, asi que lo que vuelve son
 * tokens NUEVOS y quien llama tiene que guardarlos.
 */
async function cargar(tokens: Tokens, auth: AuthAislado): Promise<ResultadoProbar> {
  const { data, error } = await auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  });
  if (!error && data.session) return { ok: true, sesion: data.session };
  if (error && clasificarErrorAuth(error) === "red") return { ok: false, clase: "red", error };
  const reintento = await auth.refreshSession({ refresh_token: tokens.refreshToken });
  if (!reintento.error && reintento.data.session) return { ok: true, sesion: reintento.data.session };
  const motivo = reintento.error ?? error ?? new Error("refreshSession sin sesion");
  return { ok: false, clase: reintento.error ? clasificarErrorAuth(reintento.error) : "credencial", error: motivo };
}

/**
 * Despierta una sesion dormida EN MEMORIA y devuelve tokens vigentes. Si el
 * refresh token roto, los tokens que vuelven son los UNICOS validos: hay que
 * guardarlos en la boveda antes de hacer nada mas.
 */
export async function probarSesion(tokens: Tokens, auth: AuthAislado = authAislado()): Promise<ResultadoProbar> {
  try {
    return await cargar(tokens, auth);
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
 * `alRotar` recibe los tokens nuevos si cargar la sesion roto el refresh
 * token: si el /logout de despues falla por red, la boveda tiene que quedarse
 * con los tokens que SI valen, o el siguiente intento (quitar o cambiar) seria
 * "Already Used" y GoTrue revocaria la familia entera.
 *
 * Un fallo de credencial al cargarla (ya revocada, usuario borrado) cuenta
 * como exito: no habia nada que revocar. Solo la red devuelve ok: false, y
 * entonces la entrada se conserva para reintentar.
 */
export async function revocarSesion(
  tokens: Tokens,
  alRotar?: (sesion: Session) => void,
  auth: AuthAislado = authAislado(),
): Promise<ResultadoRevocar> {
  try {
    const carga = await cargar(tokens, auth);
    if (!carga.ok) {
      return carga.clase === "credencial" ? { ok: true, yaInvalida: true } : { ok: false, clase: "red", error: carga.error };
    }
    if (carga.sesion.refresh_token !== tokens.refreshToken) alRotar?.(carga.sesion);
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
