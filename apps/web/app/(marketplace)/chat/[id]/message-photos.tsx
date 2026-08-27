"use client";

import { useState } from "react";
import { X, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatAttachment } from "@vicino/shared";

/**
 * Las fotos de un mensaje.
 *
 * Se pinta con <img> y no con next/image a proposito: la fuente es una URL
 * FIRMADA de un bucket privado, con su token en la query y una vida de una hora.
 * El optimizador de Next la volveria a pedir desde el servidor y la cachearia
 * por URL — o sea, cachearia el token. Aqui la peticion la hace el navegador de
 * quien mira, que es el unico que tiene por que poder verla.
 *
 * El hueco se reserva con las dimensiones guardadas en el propio adjunto. Sin
 * eso la conversacion pega un salto cuando cada foto termina de cargar y te
 * saca de donde estabas leyendo — que en un chat, donde se lee hacia arriba, es
 * de lo mas molesto.
 */
export function MessagePhotos({
  adjuntos,
  firmas,
  esPropio,
}: {
  adjuntos: ChatAttachment[];
  /** ruta -> URL firmada. Una ruta ausente es una foto que aun no se firma o
   *  que ya no esta disponible; las dos se pintan como hueco, no como rota. */
  firmas: Map<string, string>;
  esPropio: boolean;
}) {
  const [abierta, setAbierta] = useState<string | null>(null);
  if (adjuntos.length === 0) return null;

  const sola = adjuntos.length === 1;

  return (
    <>
      <div
        className={cn(
          "mb-1 grid gap-1 overflow-hidden rounded-xl",
          sola ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {adjuntos.map((a) => {
          const url = firmas.get(a.path);
          // Con una sola foto se respeta su proporcion; con varias, cuadradas,
          // que es lo que mantiene la retícula legible.
          const proporcion = sola && a.w && a.h ? `${a.w} / ${a.h}` : "1 / 1";

          return (
            <button
              key={a.path}
              type="button"
              onClick={() => url && setAbierta(url)}
              disabled={!url}
              aria-label={url ? "Ver la foto completa" : "Foto no disponible"}
              className={cn(
                "relative block w-full overflow-hidden bg-[color:var(--card-2)]",
                sola ? "max-w-[15rem]" : "",
                url ? "cursor-zoom-in" : "cursor-default",
              )}
              style={{ aspectRatio: proporcion }}
            >
              {url ? (
                <img
                  src={url}
                  alt="Foto enviada en el chat"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <ImageOff
                    className={cn(
                      "h-5 w-5",
                      esPropio ? "text-[color:var(--bg)]/50" : "text-[color:var(--fg-dim)]",
                    )}
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {abierta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setAbierta(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Foto ampliada"
        >
          <button
            type="button"
            onClick={() => setAbierta(null)}
            aria-label="Cerrar"
            className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] rounded-full bg-white/10 p-2 text-white"
          >
            <X className="h-5 w-5" />
          </button>
          {/* object-contain declarado: es justo lo que le faltaba al visor de
              producto y hacia que ahi las fotos salieran recortadas. */}
          <img
            src={abierta}
            alt="Foto enviada en el chat"
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
