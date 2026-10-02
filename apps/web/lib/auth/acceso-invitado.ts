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
    if (path === "/") return Boolean(url.searchParams.get("cats") || (url.searchParams.get("feed") && url.searchParams.get("feed") !== "parati"));
    if (esRutaLegal(path)) return false;
    return ![...PUBLICAS, ...TECNICAS].some(base => path === base || path.startsWith(`${base}/`));
  } catch { return true; }
}

export function loginPara(destino: string): string {
  return `/login?next=${encodeURIComponent(destinoAutenticadoSeguro(destino))}`;
}

export const COOKIE_DESTINO_ONBOARDING = "vicino_onboarding_next";
