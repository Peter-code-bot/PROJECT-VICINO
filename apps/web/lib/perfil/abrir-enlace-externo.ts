/**
 * Decide si un enlace externo de la ficha de un negocio se quedaria DENTRO
 * del WebView de la app en vez de ir al sistema.
 *
 * Capacitor entrega al sistema (Intent ACTION_VIEW en Android) toda
 * navegacion a un host que NO este en `server.allowNavigation` de
 * capacitor.config.ts. Pero esa lista trae `*.google.com` (por el OAuth), y
 * en Android eso casa con www.google.com, maps.google.com y
 * search.google.com: un enlace de Maps copiado del navegador o el de resenas
 * (search.google.com/local/writereview) cargaria la web de Google ENCIMA de
 * la ficha de VICINO, sin boton de volver. iOS no tiene el problema: con
 * target=_blank WebKit llama a createWebViewWith y Capacitor abre con
 * UIApplication.open aunque el host este en la lista.
 *
 * Para esos hosts, en Android, el componente abre con @capacitor/browser
 * (pestana del sistema, con su propio boton de cerrar), que ya va dentro del
 * binario publicado. El resto (wa.me, instagram.com, maps.app.goo.gl,
 * goo.gl, g.page, google.com.mx) sigue el camino normal: el sistema abre la
 * app del canal si esta instalada o el navegador si no.
 *
 * La mascara `*.google.com` de Capacitor casa cualquier host con tres o mas
 * etiquetas que termine en .google.com; `google.com` a secas (dos etiquetas)
 * y `*.google.com.mx` NO casan. Se reproduce aqui tal cual, no se generaliza.
 */
export const HOSTS_DENTRO_DEL_WEBVIEW_ANDROID = /(^|\.)google\.com$/;

export function cargaDentroDelWebView(href: string, plataforma: string): boolean {
  if (plataforma !== "android") return false;
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "google.com") return false;
  return HOSTS_DENTRO_DEL_WEBVIEW_ANDROID.test(host);
}
