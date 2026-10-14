/**
 * El cambio de cuenta, paso a paso y con puertos para poder probarlo.
 *
 * El orden importa; cada paso esta donde esta por un fallo concreto que evita
 * (ver openspec/changes/2026-10-13-cambio-de-cuenta/design.md):
 *
 *   1. getSession() de la cuenta activa (A): refresca si caduco, asi que lo que
 *      se guarda es el token MAS NUEVO. Guardar uno viejo y usarlo despues es
 *      "Already Used" = sesion de A revocada entera.
 *   2. A a la boveda. Si el almacenamiento no escribe se aborta aqui: sin A
 *      guardada, cambiar a B seria cerrar sesion de A con otro nombre.
 *   3. Probar B en el cliente AISLADO (lib/cuentas/sesion-aislada.ts). Si el
 *      token de B no vale, B sale de la boveda y la persona sigue en A, con la
 *      cookie intacta. Si es red, B se queda y la persona sigue en A.
 *   4. B a la boveda con los tokens que devolvio la prueba: si hubo refresh,
 *      los viejos ya se gastaron y perderlos seria perder B.
 *   5. fcm_token de A a NULL (mejor esfuerzo). El token de push es del
 *      telefono, no de la persona (mismo motivo que hooks/use-logout.ts). Va
 *      ANTES de setSession porque despues ya no hay permiso de escribir en A,
 *      y DESPUES de probar B para no dejar a A sin push por un cambio que no
 *      iba a ocurrir.
 *   6. Marca de cambio en curso, para que session-data-provider no haga su
 *      navegacion dura al ver otra cuenta.
 *   7. setSession(B vigente) en el cliente principal: escribe la cookie. Con el
 *      access token vigente auth-js solo llama a /user y guarda; si falla, no
 *      toca la cookie de A.
 *
 * La navegacion (router.refresh + router.replace("/perfil")) la hace quien
 * llama: necesita el router y es la unica parte que no se puede probar aqui.
 */
import type { AuthError, Session } from "@supabase/supabase-js";
import type { Cuenta, DatosCuenta, ResultadoGuardar } from "./boveda";
import { clasificarErrorAuth } from "./clasificar-error-auth";
import type { ResultadoProbar, Tokens } from "./sesion-aislada";

export interface PuertoAuthPrincipal {
  getSession(): Promise<{ data: { session: Session | null }; error: AuthError | null }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
    data: { session: Session | null };
    error: AuthError | null;
  }>;
}

export interface PuertoBoveda {
  guardar(datos: DatosCuenta): ResultadoGuardar;
  quitar(userId: string): void;
  buscar(userId: string): Cuenta | null;
}

export interface PuertoCambio {
  principal: PuertoAuthPrincipal;
  probar(tokens: Tokens): Promise<ResultadoProbar>;
  /** profiles.fcm_token = NULL para la cuenta que se va. Mejor esfuerzo. */
  soltarTokenPush(userId: string): Promise<void>;
  boveda: PuertoBoveda;
  marcar(userId: string): void;
  desmarcar(): void;
  /** Para Sentry. Nunca recibe tokens. */
  reportar(paso: string, error: unknown, nivel?: "warning" | "error"): void;
}

export type MotivoFallo = "sin_sesion" | "sin_almacenamiento" | "llena" | "vencida" | "red" | "en_curso";

export type ResultadoCambio =
  | { ok: true; userId: string; nombre: string }
  | { ok: false; motivo: MotivoFallo; mensaje: string };

let enCurso = false;

export function nombreVisible(cuenta: { nombre: string; username: string | null; email: string }): string {
  return cuenta.nombre.trim() || (cuenta.username ? `@${cuenta.username}` : cuenta.email);
}

/**
 * Lo que la boveda necesita saber de la sesion activa. Si ya habia una entrada
 * (el espejo de RegistroCuentaActiva), se conservan nombre, usuario y foto; si
 * no, se saca lo que la sesion trae.
 */
export function datosDeSesion(sesion: Session, previa: DatosCuenta | null): DatosCuenta {
  const meta = sesion.user.user_metadata as { full_name?: unknown; name?: unknown } | undefined;
  const nombreMeta = typeof meta?.full_name === "string" ? meta.full_name : typeof meta?.name === "string" ? meta.name : "";
  return {
    userId: sesion.user.id,
    email: previa?.email || sesion.user.email || "",
    nombre: previa?.nombre ?? nombreMeta,
    username: previa?.username ?? null,
    foto: previa?.foto ?? null,
    accessToken: sesion.access_token,
    refreshToken: sesion.refresh_token,
  };
}

function fallo(motivo: MotivoFallo, mensaje: string): ResultadoCambio {
  return { ok: false, motivo, mensaje };
}

function sinConexion(actualNombre?: string): ResultadoCambio {
  return fallo("red", actualNombre ? `Sin conexión. Sigues en ${actualNombre}.` : "Sin conexión. Inténtalo de nuevo.");
}

function vencida(destino: Cuenta, puerto: PuertoCambio): ResultadoCambio {
  puerto.boveda.quitar(destino.userId);
  return fallo("vencida", `La sesión de ${nombreVisible(destino)} venció. Vuelve a entrar.`);
}

type Fallo = Extract<ResultadoCambio, { ok: false }>;

/** Paso 3. */
async function probarDestino(destino: Cuenta, puerto: PuertoCambio, actualNombre?: string): Promise<{ sesion: Session } | Fallo> {
  const prueba: ResultadoProbar = await puerto.probar({ accessToken: destino.accessToken, refreshToken: destino.refreshToken });
  if (prueba.ok) return { sesion: prueba.sesion };
  if (prueba.clase === "credencial") return vencida(destino, puerto) as Fallo;
  puerto.reportar("probar", prueba.error, "warning");
  return sinConexion(actualNombre) as Fallo;
}

/** Pasos 4, 6 y 7, con una sesion de B ya probada y vigente. */
async function aplicarSesionProbada(
  destino: Cuenta,
  sesion: Session,
  puerto: PuertoCambio,
  actualNombre?: string,
): Promise<ResultadoCambio> {
  // Paso 4 antes de nada: si el refresh roto, estos son los unicos tokens validos de B.
  const guardadoB = puerto.boveda.guardar({
    ...destino,
    email: destino.email || sesion.user.email || "",
    accessToken: sesion.access_token,
    refreshToken: sesion.refresh_token,
  });
  if (guardadoB !== "guardada") puerto.reportar("guardar_destino", new Error(guardadoB), "warning");

  puerto.marcar(destino.userId);
  let error: AuthError | null = null;
  try {
    ({ error } = await puerto.principal.setSession({
      access_token: sesion.access_token,
      refresh_token: sesion.refresh_token,
    }));
  } catch (excepcion) {
    puerto.desmarcar();
    puerto.reportar("set_session", excepcion);
    return sinConexion(actualNombre);
  }
  if (error) {
    puerto.desmarcar();
    if (clasificarErrorAuth(error) === "credencial") return vencida(destino, puerto);
    puerto.reportar("set_session", error, "warning");
    return sinConexion(actualNombre);
  }
  return { ok: true, userId: destino.userId, nombre: nombreVisible(destino) };
}

/**
 * Pasos 3 a 7 sin cuenta activa que guardar: lo usa use-logout.ts tras cerrar
 * la sesion activa, y RegistroCuentaActiva para reintentar un cambio que
 * aterrizo en la cuenta equivocada.
 */
export async function aplicarCuenta(destino: Cuenta, puerto: PuertoCambio): Promise<ResultadoCambio> {
  const prueba = await probarDestino(destino, puerto);
  if (!("sesion" in prueba)) return prueba;
  return aplicarSesionProbada(destino, prueba.sesion, puerto);
}

/** El cambio completo, de la cuenta activa a `destino`. */
export async function cambiarACuenta(destino: Cuenta, puerto: PuertoCambio): Promise<ResultadoCambio> {
  if (enCurso) return fallo("en_curso", "Ya hay un cambio en curso.");
  enCurso = true;
  try {
    // Paso 1.
    const { data, error } = await puerto.principal.getSession();
    const actual = data.session;
    if (error || !actual) {
      if (error) puerto.reportar("get_session", error, "warning");
      return fallo("sin_sesion", "No encontramos tu sesión actual. Vuelve a entrar.");
    }
    if (actual.user.id === destino.userId) return { ok: true, userId: destino.userId, nombre: nombreVisible(destino) };

    // Paso 2.
    const datosA = datosDeSesion(actual, puerto.boveda.buscar(actual.user.id));
    const guardadoA = puerto.boveda.guardar(datosA);
    if (guardadoA === "llena") return fallo("llena", "Quita una cuenta para agregar otra.");
    if (guardadoA === "sin_almacenamiento") {
      return fallo("sin_almacenamiento", "No se pudo guardar tu cuenta actual. Inténtalo de nuevo.");
    }
    const nombreA = nombreVisible(datosA);

    // Paso 3.
    const prueba = await probarDestino(destino, puerto, nombreA);
    if (!("sesion" in prueba)) return prueba;

    // Paso 5: con B ya validada y A todavia con permiso de escribir en su perfil.
    try {
      await puerto.soltarTokenPush(actual.user.id);
    } catch (excepcion) {
      puerto.reportar("soltar_token_push", excepcion, "warning");
    }

    // Pasos 4, 6 y 7.
    return await aplicarSesionProbada(destino, prueba.sesion, puerto, nombreA);
  } finally {
    enCurso = false;
  }
}

/** Solo para pruebas: deja el modulo como recien cargado. */
export function reiniciarCambioParaPruebas(): void {
  enCurso = false;
}
