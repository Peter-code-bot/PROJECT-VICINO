"use client";

import { useSyncExternalStore } from "react";

const CONSULTA = "(prefers-reduced-motion: reduce)";

const disponible = () => typeof window !== "undefined" && typeof window.matchMedia === "function";

function suscribir(avisar: () => void): () => void {
  if (!disponible()) return () => {};
  const media = window.matchMedia(CONSULTA);
  media.addEventListener("change", avisar);
  return () => media.removeEventListener("change", avisar);
}

const leer = (): boolean => disponible() && window.matchMedia(CONSULTA).matches;
const leerEnServidor = (): boolean => false;

/**
 * "Reducir movimiento" del sistema, siguiendo sus cambios mientras el
 * componente esta montado.
 *
 * `useReducedMotion` de framer-motion lo lee UNA vez, al montar (useState con
 * el valor inicial). Un componente que vive mucho —el cajon de resultados vive
 * lo que dura /mapa, y en Capacitor el WebView dura dias— seguia animando
 * despues de que el usuario activara la opcion.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(suscribir, leer, leerEnServidor);
}
