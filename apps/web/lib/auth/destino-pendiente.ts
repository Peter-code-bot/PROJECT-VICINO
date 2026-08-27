import { destinoSeguro } from "@/lib/auth/destino-seguro";

/**
 * Donde queria ir la persona cuando la mandamos a identificarse.
 *
 * POR QUE HACE FALTA UN ESCONDITE Y NO BASTA CON `?next=`. En el camino web, el
 * destino viaja en la URL y funciona. En el camino NATIVO no puede: el flujo de
 * OAuth vuelve por un deep link, `vicino://auth/callback`, y esa direccion
 * tiene que coincidir EXACTAMENTE con la registrada en Supabase y en el
 * intent-filter del AndroidManifest. Anadirle una query la rompe.
 *
 * Asi que en nativo el destino se guarda antes de salir y se recoge al volver.
 * Es el mismo origen, asi que sessionStorage sobrevive el viaje.
 *
 * Se recoge UNA vez y se borra: si se quedara, la siguiente vez que alguien
 * inicie sesion acabaria en el sitio de la vez anterior.
 */
const CLAVE = "vicino:destino-tras-identificarse";

export function guardarDestinoPendiente(destino: string): void {
  try {
    // Se sanea al GUARDAR, no solo al usar. Lo que entra aqui sale de la URL
    // actual, pero el escondite lo lee codigo que navega a ciegas: si algun dia
    // algo mete `//otro.example`, el saneado ya no estaria de por medio.
    const seguro = destinoSeguro(destino);
    if (seguro === "/") return;
    window.sessionStorage.setItem(CLAVE, seguro);
  } catch {
    // Modo privado o almacenamiento bloqueado. Se pierde el destino y se cae a
    // la portada, que es molesto pero no roto.
  }
}

/** Devuelve el destino guardado y lo borra. "/" si no hay ninguno. */
export function tomarDestinoPendiente(): string {
  try {
    const guardado = window.sessionStorage.getItem(CLAVE);
    window.sessionStorage.removeItem(CLAVE);
    return destinoSeguro(guardado);
  } catch {
    return "/";
  }
}
