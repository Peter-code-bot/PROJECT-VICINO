"use client";

import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { firmarAdjuntos, FIRMA_TTL_SEGUNDOS } from "@/lib/chat/attachments";

/**
 * Margen antes de que caduque una firma. Se renueva a los 55 minutos de una
 * firma de 60 para que nadie se quede mirando una foto que acaba de expirar
 * mientras sigue leyendo la conversacion.
 */
const MARGEN_MS = 5 * 60 * 1000;
const REVISION_MS = 60 * 1000;

/**
 * Convierte rutas del bucket privado chat-media en URLs utilizables.
 *
 * POR QUE HACE FALTA UN HOOK Y NO UNA LLAMADA SUELTA. El bucket es privado, asi
 * que lo unico que se guarda en la base es la RUTA, no una URL: una URL firmada
 * caduca y guardarla seria guardar algo que deja de servir. Las firmas se piden
 * en bloque —una peticion por lote y no una por foto— y se renuevan solas,
 * porque un chat abierto una hora es de lo mas normal.
 *
 * Las rutas que la firma rechaza no entran al mapa. El chat pinta entonces el
 * hueco de "no disponible", que es informacion util, en vez de una imagen rota.
 */
export function useFirmasAdjuntos(
  supabase: SupabaseClient,
  paths: string[],
): Map<string, string> {
  const [firmas, setFirmas] = useState<Map<string, string>>(new Map());
  // Cuando caduca cada firma. Vive en una ref porque cambiarlo no debe repintar:
  // lo unico que se pinta es el mapa de URLs.
  const caducidadRef = useRef<Map<string, number>>(new Map());
  // Las rutas ya en vuelo, para que dos repintados seguidos no pidan dos veces
  // la misma firma.
  const enVueloRef = useRef<Set<string>>(new Set());

  // Se compara por contenido y no por identidad: `paths` se recalcula en cada
  // render y un useEffect con el array pelado en las dependencias se dispararia
  // siempre, pidiendo firmas nuevas en bucle.
  const clave = paths.join("|");

  useEffect(() => {
    let cancelado = false;

    async function refrescar() {
      const ahora = Date.now();
      const pendientes = paths.filter((p) => {
        if (enVueloRef.current.has(p)) return false;
        const caduca = caducidadRef.current.get(p);
        return caduca === undefined || caduca - ahora < MARGEN_MS;
      });
      if (pendientes.length === 0) return;

      pendientes.forEach((p) => enVueloRef.current.add(p));
      try {
        const nuevas = await firmarAdjuntos(supabase, pendientes);
        if (cancelado || nuevas.size === 0) return;

        const expira = Date.now() + FIRMA_TTL_SEGUNDOS * 1000;
        nuevas.forEach((_url, path) => caducidadRef.current.set(path, expira));
        setFirmas((prev) => {
          const siguiente = new Map(prev);
          nuevas.forEach((url, path) => siguiente.set(path, url));
          return siguiente;
        });
      } finally {
        pendientes.forEach((p) => enVueloRef.current.delete(p));
      }
    }

    void refrescar();
    const timer = setInterval(() => void refrescar(), REVISION_MS);
    return () => {
      cancelado = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, supabase]);

  return firmas;
}
