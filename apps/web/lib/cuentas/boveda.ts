/**
 * Boveda local de cuentas: las sesiones DORMIDAS de este dispositivo.
 *
 * La cookie de Supabase sigue siendo la unica sesion viva. Lo que hay aqui es
 * la lista de cuentas a las que se puede volver sin pasar por /login: para cada
 * una, quien es (para pintar la fila de la hoja "Cuentas") y los dos tokens con
 * los que auth.setSession() la despierta. La entrada de la cuenta ACTIVA
 * tambien esta, como espejo: asi su refresh token siempre es el ultimo
 * (RegistroCuentaActiva la reescribe en cada TOKEN_REFRESHED).
 *
 * Mismo molde que lib/auth/verificacion-pendiente.ts, que ya resolvio los
 * cuatro problemas de un store en localStorage leido por React:
 *   - hidratacion: la instantanea del servidor es "[]" siempre;
 *   - instantanea comparable por valor: es el string crudo, no un objeto;
 *   - escritura que puede fallar (Safari con cookies bloqueadas, cuota llena):
 *     guardarCuenta devuelve que paso, no promete;
 *   - otras pestañas: el evento `storage` notifica a los oyentes.
 *
 * Zod al LEER, no al escribir. Lo que hay en localStorage lo pudo escribir una
 * version anterior de la app, una extension, o nadie. Una entrada que no valide
 * se descarta sola; la lista no se tira entera.
 *
 * Seguridad: los refresh tokens aqui tienen la MISMA exposicion que la cookie
 * de @supabase/ssr, que tambien la lee JS (no es httpOnly). No se guarda
 * ninguna contraseña, solo tokens que Supabase puede revocar; ver
 * lib/cuentas/sesion-aislada.ts para la revocacion al quitar una cuenta.
 */
import { z } from "zod";

export const CLAVE_BOVEDA = "vicino_cuentas_v1";
/** Decision D4: el tope que publica Instagram. Cada entrada es un refresh token vivo. */
export const MAX_CUENTAS = 5;

const cuentaSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().min(1),
  nombre: z.string(),
  username: z.string().nullable(),
  foto: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  ultimoUso: z.number().int().positive(),
});

export type Cuenta = z.infer<typeof cuentaSchema>;
/** Lo que hay que saber de una cuenta para guardarla; `ultimoUso` lo pone la boveda. */
export type DatosCuenta = Omit<Cuenta, "ultimoUso">;
export type ResultadoGuardar = "guardada" | "llena" | "sin_almacenamiento";

const oyentes = new Set<() => void>();

function notificar(): void {
  for (const oyente of oyentes) oyente();
}

function leerCrudo(): string {
  try {
    return window.localStorage.getItem(CLAVE_BOVEDA) ?? "[]";
  } catch {
    // Modo privado, almacenamiento bloqueado o `window` inexistente.
    return "[]";
  }
}

/**
 * Convierte lo que hay en localStorage en una lista limpia.
 *
 * Pura y exportada para poder probarla sin navegador. Descarta lo que no
 * valide, deduplica por userId (gana la primera, que tras ordenar es la mas
 * reciente) y ordena por ultimo uso descendente: la primera es la activa o, si
 * no hay sesion, la mas reciente, que es justo lo que "cerrar sesion y pasar a
 * la siguiente" necesita.
 */
export function interpretarBoveda(crudo: string): Cuenta[] {
  let dato: unknown;
  try {
    dato = JSON.parse(crudo);
  } catch {
    return [];
  }
  if (!Array.isArray(dato)) return [];
  const validas: Cuenta[] = [];
  for (const item of dato) {
    const resultado = cuentaSchema.safeParse(item);
    if (resultado.success) validas.push(resultado.data);
  }
  validas.sort((a, b) => b.ultimoUso - a.ultimoUso);
  const vistas = new Set<string>();
  const cuentas: Cuenta[] = [];
  for (const cuenta of validas) {
    if (vistas.has(cuenta.userId)) continue;
    vistas.add(cuenta.userId);
    cuentas.push(cuenta);
  }
  return cuentas.slice(0, MAX_CUENTAS);
}

export function leerCuentas(): Cuenta[] {
  return interpretarBoveda(leerCrudo());
}

/** Instantanea para useSyncExternalStore: el string crudo, comparable por valor. */
export function instantaneaBoveda(): string {
  return leerCrudo();
}

/** En el servidor no hay dispositivo, asi que no hay cuentas. */
export function instantaneaBovedaServidor(): string {
  return "[]";
}

export function suscribirBoveda(alCambiar: () => void): () => void {
  // El evento `storage` solo lo dispara OTRA pestaña del mismo origen.
  if (oyentes.size === 0) window.addEventListener("storage", notificar);
  oyentes.add(alCambiar);
  return () => {
    oyentes.delete(alCambiar);
    if (oyentes.size === 0) window.removeEventListener("storage", notificar);
  };
}

function escribir(cuentas: Cuenta[]): boolean {
  let escrito = false;
  try {
    window.localStorage.setItem(CLAVE_BOVEDA, JSON.stringify(cuentas));
    escrito = true;
  } catch {
    // Quien llama decide que hacer sin almacenamiento; romper la pantalla no es opcion.
  }
  notificar();
  return escrito;
}

/**
 * Guarda o actualiza una cuenta y la pone como la mas reciente.
 *
 * Misma userId = misma entrada (no se duplica). Si la boveda esta llena y la
 * cuenta es nueva, NO se guarda y no se expulsa a nadie en silencio: la mas
 * vieja puede ser la del negocio. La hoja muestra "Quita una cuenta".
 */
export function guardarCuenta(datos: DatosCuenta, ahora: number = Date.now()): ResultadoGuardar {
  const actuales = leerCuentas();
  const resto = actuales.filter((c) => c.userId !== datos.userId);
  const esNueva = resto.length === actuales.length;
  if (esNueva && actuales.length >= MAX_CUENTAS) return "llena";
  const cuenta: Cuenta = { ...datos, ultimoUso: Math.max(1, Math.floor(ahora)) };
  return escribir([cuenta, ...resto]) ? "guardada" : "sin_almacenamiento";
}

/**
 * Reescribe SOLO los tokens de una cuenta que ya esta en la boveda. Si no
 * esta, no la crea: es lo que usa el espejo global de tokens
 * (components/cuentas/espejo-de-tokens.tsx), que corre en todas las pantallas
 * y no sabe nada del perfil.
 */
export function actualizarTokens(userId: string, tokens: { accessToken: string; refreshToken: string }): boolean {
  const actuales = leerCuentas();
  const cuenta = actuales.find((c) => c.userId === userId);
  if (!cuenta) return false;
  if (cuenta.accessToken === tokens.accessToken && cuenta.refreshToken === tokens.refreshToken) return true;
  return escribir(actuales.map((c) => (c.userId === userId ? { ...c, ...tokens } : c)));
}

export function quitarCuenta(userId: string): void {
  const actuales = leerCuentas();
  const resto = actuales.filter((c) => c.userId !== userId);
  if (resto.length === actuales.length) return;
  escribir(resto);
}

export function vaciarBoveda(): void {
  try {
    window.localStorage.removeItem(CLAVE_BOVEDA);
  } catch {
    // Mismo motivo que en escribir().
  }
  notificar();
}

export function buscarCuenta(userId: string): Cuenta | null {
  return leerCuentas().find((c) => c.userId === userId) ?? null;
}

/** La cuenta usada mas recientemente, sin contar `excluir` (normalmente la que se va). */
export function cuentaMasReciente(excluir?: string | null): Cuenta | null {
  return leerCuentas().find((c) => c.userId !== excluir) ?? null;
}

/** Las cuentas que NO son la activa. */
export function cuentasDormidas(activa?: string | null): Cuenta[] {
  return leerCuentas().filter((c) => c.userId !== activa);
}
