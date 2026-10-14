/**
 * Cierre de sesion consciente de cuentas (decision D3), con puertos para
 * poder probarlo. hooks/use-logout.ts solo pone los cables y navega.
 *
 *   1. La cuenta que se va se resuelve LOCALMENTE (la cookie, via getSession),
 *      no con getUser(): con la red caida getUser devuelve null y la boveda
 *      tomaria el espejo de la propia cuenta activa como "la siguiente". Si
 *      ni la cookie se puede leer, no se cierra nada; y sin cookie no hay
 *      siguiente (mismo motivo).
 *   2. Con `todas`: revocar cada dormida con el cliente aislado ANTES de tocar
 *      nada de la activa (ni su token de push). Si alguna falla por red, se
 *      para AQUI y se avisa: "salir de todas" promete un telefono limpio, y
 *      borrar de la boveda una sesion que sigue viva en el servidor
 *      (indefinidamente: no caducan) seria mentir. Las que si se revocaron ya
 *      salieron de la boveda; reintentar es seguro, y la activa sigue intacta,
 *      con su push.
 *   3. Soltar el token de push de la que se va (mejor esfuerzo; el token es
 *      del telefono).
 *   4. Marcar el cambio en curso ANTES de signOut: el SIGNED_OUT que emite
 *      llegaria a session-data-provider y sin marca haria la navegacion dura
 *      a /login antes de pasar a la siguiente.
 *   5. signOut() GLOBAL, igual que siempre: revoca la activa en todos los
 *      dispositivos. Si falla, no se navega (la sesion sigue viva) y se vuelve
 *      a pedir el registro de push que el paso 3 solto.
 *   6. La que se fue sale de la boveda; con `todas`, la boveda se vacia.
 *   7. Si hay siguiente, se renueva la marca y se despierta con aplicarCuenta.
 *      Si eso falla, se avisa y se va a /login: ya no hay sesion.
 */
import type { AuthError } from "@supabase/supabase-js";
import type { Cuenta } from "./boveda";
import { nombreVisible, type ResultadoCambio } from "./cambio";
import type { ResultadoRevocar } from "./sesion-aislada";

export interface PuertoCierre {
  /** El userId de la cookie, sin red. null si no hay sesion. */
  sesionActual(): Promise<string | null>;
  soltarTokenPush(userId: string): Promise<void>;
  /** Vuelve a pedir el registro de push (lib/push/registro.ts) si el cierre no prospero. */
  pedirRegistroPush(): void;
  /** Revoca una dormida; quien lo implementa persiste los tokens rotados (alRotar). */
  revocar(cuenta: Cuenta): Promise<ResultadoRevocar>;
  signOut(): Promise<{ error: AuthError | null }>;
  aplicar(destino: Cuenta): Promise<ResultadoCambio>;
  boveda: {
    quitar(userId: string): void;
    vaciar(): void;
    cuentaMasReciente(excluir: string | null): Cuenta | null;
    cuentasDormidas(activa: string | null): Cuenta[];
  };
  marcar(userId: string): void;
  desmarcar(): void;
  reportar(paso: string, error: unknown, nivel?: "warning" | "error", extra?: Record<string, string>): void;
}

export interface OpcionesCierre {
  /** Revoca tambien las cuentas dormidas y vacia la boveda: el telefono queda limpio. */
  todas?: boolean;
}

export type ResultadoCierre =
  /** Sesion cerrada. `siguiente` es la cuenta que quedo activa, o null si hay que ir a /login. */
  | { ok: true; siguiente: { userId: string; nombre: string } | null; aviso?: string }
  /** No se cerro nada: la sesion sigue viva y quien llama muestra el mensaje. */
  | { ok: false; mensaje: string };

export async function cerrarSesionConCuentas(puerto: PuertoCierre, opciones: OpcionesCierre = {}): Promise<ResultadoCierre> {
  const todas = opciones.todas === true;
  let activa: string | null;
  try {
    activa = await puerto.sesionActual();
  } catch (excepcion) {
    // Sin saber quien se va no se cierra nada. Con getSession fallando (tope,
    // o auth-js borrando la cookie por un 429 al refrescar por dentro), la
    // "mas reciente" de la boveda seria el espejo de la PROPIA cuenta activa,
    // y el cierre acababa volviendo a entrar en ella, sin revocar nada.
    puerto.reportar("sesion_actual", excepcion, "warning");
    return { ok: false, mensaje: "No se pudo cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo." };
  }

  if (todas) {
    const fallidas: Cuenta[] = [];
    for (const dormida of puerto.boveda.cuentasDormidas(activa)) {
      const resultado = await puerto.revocar(dormida);
      if (resultado.ok) {
        puerto.boveda.quitar(dormida.userId);
      } else {
        fallidas.push(dormida);
        puerto.reportar("revocar_dormida", resultado.error, "warning", { userId: dormida.userId });
      }
    }
    if (fallidas.length > 0) {
      const nombres = fallidas.map(nombreVisible).join(", ");
      return { ok: false, mensaje: `No se pudo salir de ${nombres}. Revisa tu conexión e inténtalo de nuevo.` };
    }
  }

  if (activa) {
    try {
      await puerto.soltarTokenPush(activa);
    } catch (excepcion) {
      puerto.reportar("soltar_token_push", excepcion, "warning");
    }
  }

  // Sin cookie no hay "siguiente": la primera de la boveda seria el espejo de
  // la cuenta que la persona cree estar cerrando.
  const siguiente = todas || !activa ? null : puerto.boveda.cuentaMasReciente(activa);
  if (siguiente) puerto.marcar(siguiente.userId);

  const noSeCerro = (error: unknown): ResultadoCierre => {
    if (siguiente) puerto.desmarcar();
    puerto.reportar("sign_out", error);
    // La sesion sigue viva pero su token de push ya se solto: se vuelve a pedir.
    if (activa) puerto.pedirRegistroPush();
    return { ok: false, mensaje: "No se pudo cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo." };
  };
  let error: AuthError | null = null;
  try {
    ({ error } = await puerto.signOut());
  } catch (excepcion) {
    return noSeCerro(excepcion);
  }
  if (error) return noSeCerro(error);

  if (activa) puerto.boveda.quitar(activa);
  if (todas) puerto.boveda.vaciar();
  if (!siguiente) return { ok: true, siguiente: null };

  // La marca se renueva: el /logout pudo tardar y la vigencia cuenta desde que se puso.
  puerto.marcar(siguiente.userId);
  const resultado = await puerto.aplicar(siguiente);
  if (!resultado.ok) {
    puerto.desmarcar();
    if (resultado.motivo === "red") puerto.reportar("cierre_siguiente", new Error(resultado.motivo), "warning");
    return { ok: true, siguiente: null, aviso: resultado.mensaje };
  }
  return { ok: true, siguiente: { userId: resultado.userId, nombre: resultado.nombre } };
}
