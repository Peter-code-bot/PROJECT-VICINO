import { destinoSeguro } from "../auth/destino-seguro";

/**
 * Ruta interna a la que lleva un enlace que abrio la app (App Link, Universal
 * Link o vicino://), o null si no hay que navegar.
 *
 * La usan los dos caminos de components/capacitor-init.tsx: el enlace que
 * llega con la app abierta (appUrlOpen) y el de arranque en frio
 * (getLaunchUrl). Las guardas de OAuth, FCM y /auth/callback van ANTES y no
 * pasan por aqui.
 *
 * Devuelve pathname + search + hash COMPLETOS. Antes la raiz se reducia a la
 * query sola ('?feed=solicitudes'), y una URL relativa que empieza por '?' se
 * resuelve contra la pantalla abierta: con la app en /perfil acababa en
 * /perfil?feed=solicitudes.
 *
 * El host no se compara, igual que antes: los filtros del manifiesto y los
 * entitlements ya acotan que hosts llegan, y la navegacion siempre se queda en
 * el origen del WebView.
 *
 * null en tres casos:
 *   - la URL no se puede leer;
 *   - el destino es la raiz sin query ni hash: se conserva el "no navegar" de
 *     siempre, que deja la app donde estaba;
 *   - el destino no es una ruta interna segura. Un enlace verificado como
 *     https://vicinomarket.com//otro.example/x tiene pathname '//otro.example/x',
 *     que asignado a location.href sale a otro host (y new URL convierte la
 *     barra invertida en barra). Es la misma redireccion abierta que ya
 *     bloquea destinoSeguro.
 */
export function destinoDeEnlace(url: string): string | null {
  let enlace: URL;
  try {
    enlace = new URL(url);
  } catch {
    return null;
  }
  const destino = `${enlace.pathname}${enlace.search}${enlace.hash}`;
  if (destino === "/") return null;
  return destinoSeguro(destino) === destino ? destino : null;
}
