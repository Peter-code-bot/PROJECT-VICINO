"use client";

import { useEffect, useRef } from "react";

/**
 * Cierra un modal propio con Escape mientras `activo` es true.
 *
 * No es solo teclado: en Android, el boton Atras de capacitor-init.tsx
 * (handleBackButton) ve [data-modal-open="true"], manda un keydown Escape
 * sintetico y NO navega. Un modal con la marca y sin este listener deja el
 * boton Atras muerto mientras esta abierto (convencion en la cabecera de
 * capacitor-init.tsx: marca + Escape, siempre juntos).
 *
 * `cerrar` va por ref para no volver a registrar el listener en cada render.
 */
export function useCerrarConEscape(activo: boolean, cerrar: () => void): void {
  const cerrarRef = useRef(cerrar);
  useEffect(() => {
    cerrarRef.current = cerrar;
  });
  useEffect(() => {
    if (!activo) return;
    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrarRef.current();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [activo]);
}
