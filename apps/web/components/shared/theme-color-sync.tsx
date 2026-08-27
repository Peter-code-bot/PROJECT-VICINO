"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";

/**
 * Los mismos valores que `--bg` en globals.css (:33 claro, :83 oscuro).
 *
 * Estan duplicados aqui porque un <meta> no lee variables CSS. La duplicacion
 * es real, asi que el desfase tambien lo era: el layout declaraba #0A0F0E como
 * color oscuro cuando el fondo oscuro de verdad es #050907, y eso dejaba una
 * costura visible entre la barra del navegador y la pagina.
 */
const COLOR_BARRA = { light: "#FFF8F0", dark: "#050907" } as const;

/**
 * Mantiene <meta name="theme-color"> de acuerdo con el tema de la APP.
 *
 * POR QUE HACE FALTA. app/layout.tsx declara el theme-color con dos entradas
 * por `prefers-color-scheme`, o sea que sigue al SISTEMA. Pero el tema de
 * VICINO no sigue al sistema: sale de localStorage y arranca en claro. Con el
 * telefono en oscuro y la app en claro, el navegador pintaba su barra oscura
 * sobre una pagina clara — una banda oscura arriba que no venia de la app
 * nativa sino de la web.
 *
 * theme-init.js ya deja el meta correcto ANTES del primer pintado. Esto cubre
 * lo otro: que al cambiar de tema con el conmutador, la barra cambie con el.
 * Va en un solo sitio a proposito — hay dos conmutadores hoy y parchear cada
 * uno significa que el tercero nacera roto.
 *
 * Se busca el meta SIN atributo `media`, que es justo el que inyecta
 * theme-init.js: los dos de Next llevan media y solo aplican segun el sistema.
 */
export function ThemeColorSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "light" && resolvedTheme !== "dark") return;
    try {
      let meta = document.head.querySelector<HTMLMetaElement>(
        'meta[name="theme-color"]:not([media])',
      );
      if (!meta) {
        // theme-init.js no llego a correr (bloqueado, o un fallo temprano).
        // Se crea aqui para que el conmutador siga funcionando igual.
        meta = document.createElement("meta");
        meta.setAttribute("name", "theme-color");
        document.head.insertBefore(meta, document.head.firstChild);
      }
      meta.setAttribute("content", COLOR_BARRA[resolvedTheme]);
    } catch {
      // El color de la barra es cosmetico: nunca puede tumbar la pagina.
    }
  }, [resolvedTheme]);

  return null;
}
