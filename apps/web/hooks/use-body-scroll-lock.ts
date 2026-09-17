"use client";

import { useEffect } from "react";

/**
 * Locks page scroll while `active` is true. Restores prior overflow on cleanup.
 * Used by full-screen drawers/overlays to prevent rubber-banding behind them.
 *
 * Fija los DOS elementos a proposito:
 *
 * - `documentElement`: `body { overflow: hidden }` solo llega al viewport
 *   cuando el elemento raiz tiene overflow visible en LOS DOS ejes, y
 *   globals.css le pone `overflow-x: clip` a `html`. Medido en Chromium: con
 *   el body fijado la pagina seguia desplazandose igual. Quien desplaza es la
 *   raiz, asi que la raiz es la que hay que fijar; sin esto, arrastrar dentro
 *   de un sheet en iPadOS movia la pagina de detras.
 * - `body`: lib/navigation/gestures.ts lee exactamente
 *   `document.body.style.overflow === "hidden"` para cancelar el swipe de
 *   pestana y el pull-to-refresh mientras hay un modal. Quitarlo dejaria esos
 *   gestos vivos por debajo del overlay.
 *
 * Lo que NO se toca es `touch-action`. El navegador cruza el valor del
 * elemento tocado con el de TODOS sus ancestros, y los sheets se portan dentro
 * del propio body: un `touch-action: none` ahi dejaria sin desplazamiento el
 * contenido del sheet, que es justo lo que hay que poder mover. La contencion
 * de cada panel vive en su `overscroll-contain`.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const raiz = document.documentElement;
    // Con la barra de desplazamiento clasica de Windows, fijar la raiz la hace
    // desaparecer y el contenido se ensancha 15 px de golpe al abrir cualquier
    // modal (medido: clientWidth 1265 -> 1280). `scrollbar-gutter: stable` no
    // lo evita, porque no aplica a una caja con overflow clip ni hidden. Se
    // mide el hueco ANTES de fijar y se devuelve como relleno. Donde la barra
    // flota (iPadOS, macOS) la medida es 0 y no se toca nada.
    const hueco = window.innerWidth - raiz.clientWidth;
    raiz.style.overflow = "hidden";
    if (hueco > 0) raiz.style.paddingRight = `${hueco}px`;
    document.body.style.overflow = "hidden";
    return () => {
      // Se limpia a vacio en vez de restaurar lo que habia, igual que antes:
      // con dos overlays encadenados, restaurar el valor capturado por el
      // segundo devolveria el "hidden" del primero y dejaria la pagina fijada
      // para siempre.
      raiz.style.overflow = "";
      raiz.style.paddingRight = "";
      document.body.style.overflow = "";
    };
  }, [active]);
}
