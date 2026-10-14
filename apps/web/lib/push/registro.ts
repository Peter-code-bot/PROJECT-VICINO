/**
 * Pedir desde fuera que hooks/usePushNotifications.ts vuelva a registrar el
 * dispositivo para la cuenta que tenga la sesion AHORA.
 *
 * Hace falta porque entrar por la accion de servidor (signInWithPassword,
 * verificarCodigo, el callback de OAuth) escribe la cookie desde el servidor
 * y el cliente de navegador NO emite SIGNED_IN: la cuenta nueva se quedaba sin
 * token de push hasta el siguiente arranque en frio o paso a primer plano. Lo
 * mismo al "Cancelar" de "agregar cuenta", que ya habia soltado el token de la
 * cuenta actual. El evento es un documento-level CustomEvent sin datos: quien
 * registra ya sabe de que cuenta es la sesion.
 */
export const EVENTO_PUSH_REGISTRAR = "vicino:push-registrar";

export function pedirRegistroPush(): void {
  try {
    window.dispatchEvent(new Event(EVENTO_PUSH_REGISTRAR));
  } catch {
    // Sin window (prerender) no hay dispositivo que registrar.
  }
}
