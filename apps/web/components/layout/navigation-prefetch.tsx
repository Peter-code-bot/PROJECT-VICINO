"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
// Next 16.2.12 requires kind when passing onInvalidate (unlike newer docs).
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { isTabRoute, TAB_ROUTES } from "@/lib/navigation/tab-routes";

type Connection = { saveData?: boolean; effectiveType?: string };
const WINDOW_MS = 30_000;

/** Owns tab warming for swipe, bottom nav and sidebar. This stores scheduling
 * metadata only; Next owns the actual Router Cache and its invalidation. */
export function NavigationPrefetch({ authenticated }: { authenticated: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const warmed = useRef(new Map<string, number>());
  const requests = useRef<number[]>([]);

  useEffect(() => {
    function prefetch(href: string) {
      const connection = (navigator as Navigator & { connection?: Connection }).connection;
      if (!navigator.onLine || document.visibilityState !== "visible" || connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return;
      if (!isTabRoute(href) || href === pathname || (!authenticated && (href === "/chat" || href === "/perfil"))) return;
      const now = performance.now();
      // Bound manual requests even when Next invalidates rapidly. Invalidating
      // a route permits a future intent, never starts a background retry loop.
      requests.current = requests.current.filter(time => now - time < WINDOW_MS);
      const previous = warmed.current.get(href);
      if ((previous !== undefined && now - previous < WINDOW_MS) || requests.current.length >= 4) return;
      warmed.current.set(href, now);
      requests.current.push(now);
      // El inicio (y /buscar) es el render mas caro del sitio: la RPC de 150
      // filas con dos subconsultas JSONB por fila. Su loading.tsx ya pinta lo
      // que hay en memoria, asi que precargarlo FULL seria pagar esa consulta
      // por CADA intento (cada pointerover, cada vecino al montar) para
      // ahorrar un esqueleto que casi nunca se ve. AUTO trae solo el loading
      // y deja la pagina para el toque. /chat y /perfil son baratos y FULL
      // deja la primera visita lista antes del toque.
      const kind = href === "/" || href === "/buscar" ? PrefetchKind.AUTO : PrefetchKind.FULL;
      try {
        router.prefetch(href, { kind, onInvalidate: () => {
          if (warmed.current.get(href) === now) warmed.current.delete(href);
        } });
      } catch {
        warmed.current.delete(href);
        // Warming is optional: normal Link navigation remains available.
      }
    }
    const intent = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest<HTMLAnchorElement>("a[data-tab-prefetch][href]");
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || url.search || url.hash) return;
      prefetch(url.pathname);
    };
    // Defer only speculative work; taps never wait for this timer.
    const timer = setTimeout(() => {
      const index = (TAB_ROUTES as readonly string[]).indexOf(pathname);
      if (index < 0) return;
      for (const neighbor of [TAB_ROUTES[index - 1], TAB_ROUTES[index + 1]]) {
        if (neighbor) prefetch(neighbor);
      }
    }, 300);
    document.addEventListener("pointerover", intent, { passive: true });
    document.addEventListener("pointerdown", intent, { passive: true });
    document.addEventListener("focusin", intent);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerover", intent);
      document.removeEventListener("pointerdown", intent);
      document.removeEventListener("focusin", intent);
    };
  }, [pathname, router, authenticated]);
  return null;
}
