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
 *   - Todas sus peticiones llevan tope de tiempo (35 s, ver abajo):
 *     fetchConLimite no acota /auth/v1/*, y un socket parado en un movil
 *     tarda minutos en morir.
 *
 * La memoria se vacia al terminar cada operacion: aqui no se queda nada.
 */
import { createClient, type AuthError, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { clasificarErrorAuth, type ClaseErrorAuth } from "./clasificar-error-auth";

/**
 * Tope de las peticiones del cliente aislado. MAYOR que los 30 s
 * (AUTO_REFRESH_TICK_DURATION_MS) en los que auth-js reintenta un
 * /token fallido por transporte con el MISMO refresh token: un abort nuestro
 * a los 20 s contaba como fallo de transporte, auth-js reenviaba el refresh
 * token, y si la primera peticion si habia llegado al servidor, el reenvio
 * caia fuera de la ventana de reuso de 10 s y GoTrue revocaba la familia
 * entera. Con 35 s el predicado de reintento es falso y nunca se reenvia.
 */
export const TOPE_AUTH_AISLADO_MS = 35_000;

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

/** fetch con tope: aborta a los 35 s, respetando la señal de quien llama si la hay. */
function fetchConTope(original: typeof fetch): typeof fetch {
  return (input, init) => {
    const controlador = new AbortController();
    const reloj = setTimeout(() => controlador.abort(new DOMException("VICINO_AUTH_TIMEOUT", "TimeoutError")), TOPE_AUTH_AISLADO_MS);
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
 * Una operacion a la vez. Todas comparten la unica `memoria`, y cada
 * operacion son DOS llamadas a auth-js con el cerrojo suelto en medio
 * (setSession y luego signOut). Sin esto, un "Quitar X" lento (su /user en
 * vuelo) y un "Cambiar a Y" tocado despues se cruzaban: el setSession(Y) de
 * la prueba entraba entre las dos llamadas de la revocacion, su olvidar()
 * vaciaba la memoria, y el signOut de X salia sin sesion (o con la de Y):
 * "revocada" sin revocar nada, o revocando la equivocada.
 */
let cola: Promise<unknown> = Promise.resolve();
function enSerie<T>(operacion: () => Promise<T>): Promise<T> {
  const resultado = cola.then(operacion, operacion);
  cola = resultado.then(() => undefined, () => undefined);
  return resultado;
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
export function probarSesion(tokens: Tokens, auth: AuthAislado = authAislado()): Promise<ResultadoProbar> {
  return enSerie(async () => {
    try {
      return await cargar(tokens, auth);
    } catch (error) {
      return { ok: false, clase: clasificarErrorAuth(error), error };
    } finally {
      olvidar();
    }
  });
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
export function revocarSesion(
  tokens: Tokens,
  alRotar?: (sesion: Session) => void,
  auth: AuthAislado = authAislado(),
): Promise<ResultadoRevocar> {
  return enSerie(async () => {
    try {
      const carga = await cargar(tokens, auth);
      if (!carga.ok) {
        return carga.clase === "credencial" ? { ok: true, yaInvalida: true } : { ok: false, clase: "red", error: carga.error };
      }
      if (carga.sesion.refresh_token !== tokens.refreshToken) alRotar?.(carga.sesion);
      // auth-js ya ignora 401/403/404 del /logout (sesion que no existe): un error
      // aqui es de transporte. OJO: signOut() carga la sesion con un margen de
      // 90 s (setSession no lo aplica), asi que puede haber rotado el refresh
      // token POR DENTRO justo antes del /logout fallido. Lo que haya quedado
      // en memoria es lo que vale, y se avisa antes de olvidarlo.
      const { error: errorSalida } = await auth.signOut({ scope: "local" });
      if (errorSalida) {
        const enMemoria = sesionEnMemoria();
        if (enMemoria && enMemoria.refresh_token !== tokens.refreshToken && enMemoria.refresh_token !== carga.sesion.refresh_token) {
          alRotar?.(enMemoria);
        }
        return { ok: false, clase: "red", error: errorSalida };
      }
      return { ok: true, yaInvalida: false };
    } catch (error) {
      return { ok: false, clase: "red", error };
    } finally {
      olvidar();
    }
  });
}

/** Lo que auth-js dejo guardado en la memoria del cliente aislado, si es una sesion. */
function sesionEnMemoria(): Session | null {
  try {
    const crudo = memoria.get(STORAGE_KEY_AISLADO);
    if (!crudo) return null;
    const dato = JSON.parse(crudo) as Partial<Session> | null;
    return dato && typeof dato.access_token === "string" && typeof dato.refresh_token === "string" ? (dato as Session) : null;
  } catch {
    return null;
  }
}
