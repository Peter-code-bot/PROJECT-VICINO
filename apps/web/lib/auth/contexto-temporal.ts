"use client";

import { useState, useSyncExternalStore } from "react";
import { destinoAutenticadoSeguro } from "./destino-seguro";

const CLAVE = "vicino:auth-contexto";
const EVENTO = "vicino:auth-contexto-cambio";
const DURACION = 30 * 60 * 1000;
let memoria = "";
let venceMemoria = 0;

export function guardarCorreoAuth(email: string): void {
  memoria = email.trim().toLowerCase();
  venceMemoria = Date.now() + DURACION;
  try { sessionStorage.setItem(CLAVE, JSON.stringify({ email: memoria, vence: venceMemoria })); } catch { /* WebView sin almacenamiento. */ }
  window.dispatchEvent(new Event(EVENTO));
}

function leerCorreoAuth(): string {
  try {
    const raw = sessionStorage.getItem(CLAVE);
    if (raw) {
      const value = JSON.parse(raw);
      return typeof value.email === "string" && value.vence > Date.now() ? value.email : "";
    }
  } catch { /* Conserva el respaldo temporal en memoria. */ }
  return venceMemoria > Date.now() ? memoria : "";
}

function suscribir(listener: () => void) {
  window.addEventListener(EVENTO, listener);
  return () => window.removeEventListener(EVENTO, listener);
}

export function useCorreoAuth() {
  const sugerido = useSyncExternalStore(suscribir, leerCorreoAuth, () => "");
  const [editado, editar] = useState<string | null>(null);
  return [editado ?? sugerido, editar] as const;
}

export function limpiarCorreoAuth(): void {
  memoria = "";
  venceMemoria = 0;
  try { sessionStorage.removeItem(CLAVE); } catch { /* Sin persistencia. */ }
  window.dispatchEvent(new Event(EVENTO));
}

export function hrefAuth(ruta: "/login" | "/register" | "/forgot-password", next: unknown): string {
  const destino = destinoAutenticadoSeguro(next);
  return destino === "/" ? ruta : `${ruta}?next=${encodeURIComponent(destino)}`;
}
