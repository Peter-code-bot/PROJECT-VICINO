/**
 * El cambio de cuenta, paso a paso y con puertos para poder probarlo.
 *
 * El orden importa; cada paso esta donde esta por un fallo concreto que evita
 * (ver openspec/changes/2026-10-13-cambio-de-cuenta/design.md):
 *
 *   1. La sesion de la cuenta activa (A), con tokens que duren: getSession()
 *      (sin red con el token vigente) y, solo si le quedan menos de 5 min,
 *      un refreshSession() forzado. Un refresh token guardado con minutos de
 *      vida lo rotaria despues el ticker del cliente o el proxy sin que la
 *      boveda se entere, y al volver a A seria "Already Used". El refresh NO
 *      es incondicional: auth-js borra su storage (la cookie) ante cualquier
 *      AuthError no reintentable, y un 429 o un 500 de /token lo son; por eso
 *      se guarda antes una instantanea y, si el refresh falla sin veredicto,
 *      se restaura la cookie con ella.
 *   2. A a la boveda. Si el almacenamiento no escribe se aborta aqui: sin A
 *      guardada, cambiar a B seria cerrar sesion de A con otro nombre.
 *   3. Probar B en el cliente AISLADO (lib/cuentas/sesion-aislada.ts) y
 *      guardar en el acto los tokens que devuelve: si hubo refresh, son los
 *      unicos validos de B. Fallo de credencial: B sale de la boveda y la
 *      persona sigue en A, con la cookie intacta. Fallo de red: B se queda.
 *   4. fcm_token de A a NULL (mejor esfuerzo). El token de push es del
 *      telefono, no de la persona (mismo motivo que hooks/use-logout.ts). Va
 *      DESPUES de probar B (para no dejar a A sin push por un cambio que no
 *      iba a ocurrir) y ANTES de setSession (despues ya no hay permiso de
 *      escribir en A).
 *   5. Marca de cambio en curso, para que session-data-provider no haga su
 *      navegacion dura al ver otra cuenta.
 *   6. setSession(B vigente) en el cliente principal: escribe la cookie. Con el
 *      access token vigente auth-js llama a /user y guarda. Si /user contesta
 *      que esa sesion ya no existe (B revocada entre el paso 3 y este), auth-js
 *      BORRA el storage, o sea la cookie de A: por eso, tras un fallo, se
 *      relee la cookie y SOLO si quedo vacia se restaura con los tokens del
 *      paso 1 (si es de B, es que el setSession cuajo tarde: se da por bueno).
 *
 * La navegacion (router.refresh + router.replace("/perfil")) la hace quien
 * llama: necesita el router y es la unica parte que no se puede probar aqui.
 */
import type { AuthError, Session } from "@supabase/supabase-js";
import type { Cuenta, DatosCuenta, ResultadoGuardar } from "./boveda";
import { clasificarErrorAuth } from "./clasificar-error-auth";
import type { ResultadoProbar, Tokens } from "./sesion-aislada";

type RespuestaSesion = Promise<{ data: { session: Session | null }; error: AuthError | null }>;

export interface PuertoAuthPrincipal {
  getSession(): RespuestaSesion;
  refreshSession(): RespuestaSesion;
  setSession(tokens: { access_token: string; refresh_token: string }): RespuestaSesion;
}

export interface PuertoBoveda {
  guardar(datos: DatosCuenta): ResultadoGuardar;
  quitar(userId: string): void;
  buscar(userId: string): Cuenta | null;
}

export type Reportar = (paso: string, error: unknown, nivel?: "warning" | "error") => void;

export interface PuertoCambio {
  principal: PuertoAuthPrincipal;
  probar(tokens: Tokens): Promise<ResultadoProbar>;
  /** profiles.fcm_token = NULL para la cuenta que se va. Mejor esfuerzo. */
  soltarTokenPush(userId: string): Promise<void>;
  boveda: PuertoBoveda;
  marcar(userId: string): void;
  desmarcar(): void;
  /** Para Sentry. Nunca recibe tokens. */
  reportar: Reportar;
}

export type MotivoFallo = "sin_sesion" | "sin_almacenamiento" | "llena" | "vencida" | "red" | "en_curso";

export type ResultadoCambio =
  | { ok: true; userId: string; nombre: string }
  | { ok: false; motivo: MotivoFallo; mensaje: string };

type Fallo = Extract<ResultadoCambio, { ok: false }>;

/** Con menos de esto por delante, el token de la cuenta que se va se refresca antes de guardarlo. */
export const UMBRAL_REFRESCO_MS = 5 * 60 * 1000;

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

export type SesionActiva =
  | { estado: "ok"; sesion: Session }
  /** No hay cookie. */
  | { estado: "sin_sesion" }
  /** GoTrue dio un veredicto sobre el refresh token de A: auth-js ya borro la cookie. */
  | { estado: "muerta"; userId: string }
  | { estado: "red" };

/**
 * Paso 1: la sesion activa con tokens que aguanten dormidos.
 *
 * Compartido con "Agregar cuenta" (components/cuentas/hoja-cuentas.tsx), que
 * guarda la cuenta actual con la misma exigencia antes de salir a /login.
 */
export async function sesionActivaParaGuardar(
  principal: PuertoAuthPrincipal,
  reportar: Reportar,
  ahora: number = Date.now(),
): Promise<SesionActiva> {
  let instantanea: Session | null;
  try {
    ({ data: { session: instantanea } } = await principal.getSession());
  } catch (excepcion) {
    reportar("get_session", excepcion, "warning");
    return { estado: "red" };
  }
  if (!instantanea) return { estado: "sin_sesion" };
  const vence = (instantanea.expires_at ?? 0) * 1000;
  if (vence - ahora > UMBRAL_REFRESCO_MS) return { estado: "ok", sesion: instantanea };

  try {
    const { data, error } = await principal.refreshSession();
    if (!error && data.session) return { estado: "ok", sesion: data.session };
    if (error && clasificarErrorAuth(error) === "credencial") return { estado: "muerta", userId: instantanea.user.id };
    reportar("refresh_actual", error ?? new Error("refreshSession sin sesion"), "warning");
  } catch (excepcion) {
    reportar("refresh_actual", excepcion, "warning");
  }
  // Sin veredicto (429, 5xx, tope, respuesta rara): auth-js pudo borrar la
  // cookie igual. La instantanea sigue siendo valida; se vuelve a poner.
  try {
    const { data } = await principal.getSession();
    if (!data.session) {
      const { error } = await principal.setSession({
        access_token: instantanea.access_token,
        refresh_token: instantanea.refresh_token,
      });
      if (error) {
        reportar("restaurar_actual", error);
        return { estado: "red" };
      }
    }
  } catch (excepcion) {
    reportar("restaurar_actual", excepcion);
    return { estado: "red" };
  }
  return { estado: "ok", sesion: instantanea };
}

function fallo(motivo: MotivoFallo, mensaje: string): Fallo {
  return { ok: false, motivo, mensaje };
}

function sinConexion(actualNombre?: string): Fallo {
  return fallo("red", actualNombre ? `Sin conexión. Sigues en ${actualNombre}.` : "Sin conexión. Inténtalo de nuevo.");
}

function vencida(destino: Cuenta, puerto: PuertoCambio): Fallo {
  puerto.boveda.quitar(destino.userId);
  return fallo("vencida", `La sesión de ${nombreVisible(destino)} venció. Vuelve a entrar.`);
}

/** Paso 3: probar B en el aislado y guardar sus tokens vigentes en el acto. */
async function probarYGuardar(destino: Cuenta, puerto: PuertoCambio, actualNombre?: string): Promise<{ sesion: Session } | Fallo> {
  const prueba: ResultadoProbar = await puerto.probar({ accessToken: destino.accessToken, refreshToken: destino.refreshToken });
  if (!prueba.ok) {
    if (prueba.clase === "credencial") return vencida(destino, puerto);
    puerto.reportar("probar", prueba.error, "warning");
    return sinConexion(actualNombre);
  }
  const guardado = puerto.boveda.guardar({
    ...destino,
    email: destino.email || prueba.sesion.user.email || "",
    accessToken: prueba.sesion.access_token,
    refreshToken: prueba.sesion.refresh_token,
  });
  if (guardado !== "guardada") puerto.reportar("guardar_destino", new Error(guardado), "warning");
  return { sesion: prueba.sesion };
}

/** Pasos 5 y 6, con una sesion de B ya probada, vigente y guardada. */
async function aplicarSesionProbada(destino: Cuenta, sesion: Session, puerto: PuertoCambio, actualNombre?: string): Promise<ResultadoCambio> {
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
 * Tras un fallo del paso 6, que hay en la cookie:
 *   - "destino": el setSession de B cuajo tarde (tras el tope). Se da por bueno.
 *   - "intacta": sigue habiendo sesion (A): no se toca.
 *   - "restaurada" / "fallo": auth-js la borro (el /user de B contesto
 *     session_not_found) y se vuelve a poner A con los tokens del paso 1.
 */
async function trasFalloDeAplicar(actual: Session, destino: Cuenta, puerto: PuertoCambio): Promise<"destino" | "intacta" | "restaurada" | "fallo"> {
  try {
    const { data } = await puerto.principal.getSession();
    if (data.session?.user.id === destino.userId) return "destino";
    if (data.session) return "intacta";
    const { error } = await puerto.principal.setSession({
      access_token: actual.access_token,
      refresh_token: actual.refresh_token,
    });
    if (error) {
      puerto.reportar("restaurar_actual", error);
      return "fallo";
    }
    return "restaurada";
  } catch (excepcion) {
    puerto.reportar("restaurar_actual", excepcion);
    return "fallo";
  }
}

/**
 * Pasos 3, 5 y 6 sin cuenta activa que guardar: lo usa use-logout.ts tras
 * cerrar la sesion activa, y RegistroCuentaActiva para reintentar un cambio
 * que aterrizo en la cuenta equivocada.
 */
export async function aplicarCuenta(destino: Cuenta, puerto: PuertoCambio): Promise<ResultadoCambio> {
  const prueba = await probarYGuardar(destino, puerto);
  if (!("sesion" in prueba)) return prueba;
  return aplicarSesionProbada(destino, prueba.sesion, puerto);
}

/** El cambio completo, de la cuenta activa a `destino`. */
export async function cambiarACuenta(destino: Cuenta, puerto: PuertoCambio): Promise<ResultadoCambio> {
  if (enCurso) return fallo("en_curso", "Ya hay un cambio en curso.");
  enCurso = true;
  // La marca va desde el principio: el refresh del paso 1 puede hacer que
  // auth-js borre la cookie y emita SIGNED_OUT (y la restauracion, SIGNED_IN),
  // y session-data-provider no debe navegar ni recargar por ninguno de los
  // dos. Todo camino que no acabe en ok la quita (finally).
  puerto.marcar(destino.userId);
  let resultado: ResultadoCambio = fallo("red", "Sin conexión. Inténtalo de nuevo.");
  try {
    resultado = await ejecutarCambio(destino, puerto);
    return resultado;
  } finally {
    enCurso = false;
    if (!resultado.ok) puerto.desmarcar();
  }
}

async function ejecutarCambio(destino: Cuenta, puerto: PuertoCambio): Promise<ResultadoCambio> {
  {
    // Paso 1.
    const activa = await sesionActivaParaGuardar(puerto.principal, puerto.reportar);
    if (activa.estado === "red") return sinConexion();
    if (activa.estado === "sin_sesion" || activa.estado === "muerta") {
      // No hay cuenta que conservar: se pasa a B como tras un cierre de sesion.
      // Con "muerta", auth-js ya borro la cookie; si B tampoco entra, no queda
      // sesion ninguna y quien llama manda a /login.
      if (activa.estado === "muerta") puerto.boveda.quitar(activa.userId);
      const resultado = await aplicarCuenta(destino, puerto);
      if (!resultado.ok && activa.estado === "muerta") return fallo("sin_sesion", "Tu sesión venció. Vuelve a entrar.");
      return resultado;
    }
    const actual = activa.sesion;
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
    const prueba = await probarYGuardar(destino, puerto, nombreA);
    if (!("sesion" in prueba)) return prueba;

    // Paso 4: con B ya validada y guardada, y A todavia con permiso de escribir en su perfil.
    try {
      await puerto.soltarTokenPush(actual.user.id);
    } catch (excepcion) {
      puerto.reportar("soltar_token_push", excepcion, "warning");
    }

    // Pasos 5 y 6.
    const resultado = await aplicarSesionProbada(destino, prueba.sesion, puerto, nombreA);
    if (resultado.ok) return resultado;
    const cookie = await trasFalloDeAplicar(actual, destino, puerto);
    if (cookie === "destino") {
      puerto.marcar(destino.userId);
      return { ok: true, userId: destino.userId, nombre: nombreVisible(destino) };
    }
    return resultado;
  }
}

/** Solo para pruebas: deja el modulo como recien cargado. */
export function reiniciarCambioParaPruebas(): void {
  enCurso = false;
}
