import { destinoSeguro } from "../auth/destino-seguro";

const CLAVE_ORIGEN_VENDER = "vicino:origen-vender";

/**
 * Guarda en sessionStorage la última ruta interna visitada para que
 * el botón de regreso de /vender pueda volver a ella.
 * Se ignoran rutas que comiencen con /vender para no sobreescribir
 * el origen con la propia pantalla de publicación.
 */
export function guardarOrigenVender(ruta: string): void {
  if (typeof window === "undefined") return;
  try {
    if (
      !ruta ||
      !ruta.startsWith("/") ||
      ruta.startsWith("//") ||
      ruta.includes("\\") ||
      ruta.startsWith("/vender")
    ) {
      return;
    }
    const segura = destinoSeguro(ruta);
    if (segura.startsWith("/vender") || segura !== ruta) return;
    window.sessionStorage.setItem(CLAVE_ORIGEN_VENDER, segura);
  } catch {
    // Si sessionStorage no está disponible (modo privado estricto), no falla.
  }
}

/**
 * Recupera la ruta de origen guardada en sessionStorage, validándola
 * con destinoSeguro. Devuelve null si no hay o si no es segura.
 */
export function obtenerOrigenVender(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const guardada = window.sessionStorage.getItem(CLAVE_ORIGEN_VENDER);
    if (!guardada) return null;
    if (
      !guardada.startsWith("/") ||
      guardada.startsWith("//") ||
      guardada.includes("\\") ||
      guardada.startsWith("/vender")
    ) {
      return null;
    }
    const segura = destinoSeguro(guardada);
    if (segura.startsWith("/vender") || segura !== guardada) return null;
    return segura;
  } catch {
    return null;
  }
}

/**
 * Limpia la ruta de origen guardada.
 */
export function limpiarOrigenVender(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(CLAVE_ORIGEN_VENDER);
  } catch {
    // ignore
  }
}

export interface ResolverRetornoOptions {
  isEdit?: boolean;
  fromParam?: string | null;
  origenGuardado?: string | null;
  referrer?: string | null;
  windowOrigin?: string;
  historyLength?: number;
  historyStateIdx?: number;
  isDirectHardNav?: boolean;
}

export interface ResultadoRetorno {
  destino: string;
  puedeUsarBack: boolean;
}

/**
 * Detecta si la carga actual de /vender fue una navegación directa en el documento
 * (por teclear la URL en la barra de direcciones o venir de un enlace externo),
 * a diferencia de una navegación client-side de Next.js o una recarga (F5).
 */
export function esEntradaDirectaVender(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const navEntries = performance.getEntriesByType("navigation");
    if (!navEntries || navEntries.length === 0) return false;
    const nav = navEntries[0] as PerformanceNavigationTiming;
    if (nav.type === "navigate") {
      const docUrl = new URL(nav.name || window.location.href);
      if (docUrl.pathname.startsWith("/vender")) {
        const ref = document.referrer;
        if (!ref) return true;
        try {
          const refUrl = new URL(ref);
          if (refUrl.origin !== window.location.origin) return true;
        } catch {
          return true;
        }
      }
    }
  } catch {
    // Si la API falla, no bloqueamos
  }
  return false;
}

/**
 * Determina el destino seguro de retorno desde /vender según las reglas:
 * 1. Modo edición -> siempre a /seller/listings (no usa back).
 * 2. ?from= en la URL si es ruta interna segura válida (no /vender). Admite "/" explícito.
 * 3. Si es entrada directa dura sin ?from= -> fallback a "/" (no usa origen viejo ni back).
 * 4. Origen guardado en sessionStorage si es ruta interna segura válida (no /vender). Admite "/" de Inicio.
 * 5. Document referrer si pertenece al mismo origen y es ruta interna segura válida (no /vender).
 * 6. Fallback: entrada directa / sin origen válido -> fallback a "/" (Home).
 */
export function resolverDestinoRetornoVender({
  isEdit = false,
  fromParam = null,
  origenGuardado = null,
  referrer = null,
  windowOrigin = "",
  historyLength = 1,
  historyStateIdx,
  isDirectHardNav = false,
}: ResolverRetornoOptions): ResultadoRetorno {
  if (isEdit) {
    return { destino: "/seller/listings", puedeUsarBack: false };
  }

  // 1. ?from= explícito (admite "/" explícito y rechaza destinos inseguros / bucles)
  if (fromParam) {
    const esValido =
      fromParam.startsWith("/") &&
      !fromParam.startsWith("//") &&
      !fromParam.includes("\\") &&
      !fromParam.startsWith("/vender") &&
      destinoSeguro(fromParam) === fromParam;

    if (esValido) {
      const tieneHistorial =
        historyStateIdx !== undefined ? historyStateIdx > 0 : historyLength > 1;
      return { destino: fromParam, puedeUsarBack: tieneHistorial };
    }
  }

  // 2. Si fue entrada directa dura a /vender (e.g. tecleada en barra o externa sin ?from=),
  // se descarta cualquier origen viejo almacenado en sessionStorage y no se usa history.back().
  if (isDirectHardNav) {
    return { destino: "/", puedeUsarBack: false };
  }

  const tieneHistorial =
    historyStateIdx !== undefined ? historyStateIdx > 0 : historyLength > 1;

  // 3. Origen guardado en sesión (de navegación client-side interna previa o recarga)
  if (origenGuardado) {
    const esValido =
      origenGuardado.startsWith("/") &&
      !origenGuardado.startsWith("//") &&
      !origenGuardado.includes("\\") &&
      !origenGuardado.startsWith("/vender") &&
      destinoSeguro(origenGuardado) === origenGuardado;

    if (esValido) {
      return { destino: origenGuardado, puedeUsarBack: tieneHistorial };
    }
  }

  // 4. Document referrer (si navegó desde otra página del mismo origen)
  if (referrer) {
    try {
      const refUrl = new URL(
        referrer,
        windowOrigin || "https://vicinomarket.com",
      );
      if (!windowOrigin || refUrl.origin === windowOrigin) {
        const refPath = refUrl.pathname + refUrl.search;
        const esValido =
          refPath.startsWith("/") &&
          !refPath.startsWith("//") &&
          !refPath.includes("\\") &&
          !refPath.startsWith("/vender") &&
          destinoSeguro(refPath) === refPath;

        if (esValido) {
          return { destino: refPath, puedeUsarBack: tieneHistorial };
        }
      }
    } catch {
      // referrer malformado
    }
  }

  // 5. Fallback: entrada directa sin origen válido -> Home
  return { destino: "/", puedeUsarBack: false };
}
