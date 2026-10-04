import { destinoAutenticadoSeguro } from "./destino-seguro";
import { esRutaLegal } from "../navigation/rutas-legales";

const PUBLICAS = ["/login", "/register", "/forgot-password", "/reset-password", "/centro-de-ayuda", "/cuenta-eliminada"];
const TECNICAS = ["/auth", "/callback", "/.well-known", "/api", "/_next"];

/** Shared by navigation and proxy. Auth callbacks and public Home reads stay reachable. */
export function requiereSesion(ruta: string): boolean {
  try {
    const url = new URL(ruta, "https://vicino.invalid");
    if (url.origin !== "https://vicino.invalid") return false;
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "") || "/";
    if (path === "/") {
      const feeds = url.searchParams.getAll("feed");
      const tabs = url.searchParams.getAll("tab");
      // Solicitudes y comunidades tienen previews nacionales propios. Los
      // filtros, Siguiendo y Mis comunidades siguen siendo de la cuenta.
      return url.searchParams.getAll("cats").some(Boolean) || feeds.length > 1 || tabs.length > 1 ||
        feeds.some(feed => !["", "parati", "solicitudes", "comunidades"].includes(feed)) ||
        tabs.some(tab => !["", "muro", "descubrir"].includes(tab));
    }
    if (esRutaLegal(path)) return false;
    return ![...PUBLICAS, ...TECNICAS].some(base => path === base || path.startsWith(`${base}/`));
  } catch { return true; }
}

export function loginPara(destino: string): string {
  return `/login?next=${encodeURIComponent(destinoAutenticadoSeguro(destino))}`;
}

export const COOKIE_DESTINO_ONBOARDING = "vicino_onboarding_next";
