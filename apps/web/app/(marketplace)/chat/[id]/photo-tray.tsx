"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { MAX_ADJUNTOS_POR_MENSAJE } from "@vicino/shared";

/** Tope de entrada, antes de comprimir. Lo que se sube pesa mucho menos. */
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * El boton de adjuntar. El <input type="file"> va oculto y no escondido con
 * display:none a lo bruto: se apila debajo del boton para que siga siendo
 * alcanzable por teclado y por los lectores de pantalla.
 */
export function PhotoPickerButton({
  onElegir,
  restantes,
  disabled,
}: {
  onElegir: (files: File[]) => void;
  restantes: number;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const agotado = restantes <= 0;

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled || agotado}
        aria-label={
          agotado
            ? `Máximo ${MAX_ADJUNTOS_POR_MENSAJE} fotos por mensaje`
            : "Adjuntar fotos"
        }
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--card-2)] hover:text-[color:var(--fg)] disabled:opacity-40"
      >
        <ImagePlus className="h-5 w-5" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const elegidas = Array.from(e.target.files ?? []);
          // Se limpia el valor SIEMPRE: sin esto, volver a elegir exactamente
          // el mismo archivo no dispara onChange y parece que la app se colgo.
          e.target.value = "";
          if (elegidas.length > 0) onElegir(elegidas);
        }}
      />
    </>
  );
}

/**
 * La tira de fotos elegidas, antes de mandarlas.
 *
 * Existe porque mandar una foto sin verla antes es un acto de fe. Y porque
 * quitar una elegida por error tiene que costar un toque, no cancelar el
 * mensaje entero.
 */
export function PhotoTray({
  fotos,
  onQuitar,
  ocupado,
}: {
  fotos: File[];
  onQuitar: (indice: number) => void;
  ocupado: boolean;
}) {
  const [previews, setPreviews] = useState<string[]>([]);

  useEffect(() => {
    const urls = fotos.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    // Cada objectURL retiene el archivo en memoria hasta que se revoca. En un
    // chat donde se eligen y descartan fotos varias veces, no revocarlas es una
    // fuga que crece con el uso.
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [fotos]);

  if (fotos.length === 0) return null;

  return (
    <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pt-3">
      {previews.map((url, i) => (
        <div key={url} className="relative h-16 w-16 shrink-0">
          <img
            src={url}
            alt={`Foto ${i + 1} por enviar`}
            className="h-full w-full rounded-lg object-cover"
          />
          <button
            type="button"
            onClick={() => onQuitar(i)}
            disabled={ocupado}
            aria-label={`Quitar la foto ${i + 1}`}
            className="absolute -right-1 -top-1 rounded-full bg-[color:var(--fg)] p-0.5 text-[color:var(--bg)] disabled:opacity-40"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * Decide que fotos entran de las que se acaban de elegir.
 *
 * Devuelve tambien POR QUE se quedaron fuera las demas. Descartar en silencio
 * es lo que hace que alguien elija seis fotos, vea cinco y no sepa si la sexta
 * fallo o si nunca la selecciono.
 */
export function admitirFotos(
  actuales: File[],
  nuevas: File[],
): { fotos: File[]; aviso: string } {
  const hueco = MAX_ADJUNTOS_POR_MENSAJE - actuales.length;
  const validas = nuevas.filter((f) => f.type.startsWith("image/") && f.size <= MAX_BYTES);

  const rechazadasPorTipo = nuevas.length - nuevas.filter((f) => f.type.startsWith("image/")).length;
  const rechazadasPorPeso = nuevas.filter((f) => f.type.startsWith("image/") && f.size > MAX_BYTES).length;
  const sobrantes = Math.max(0, validas.length - hueco);

  const avisos: string[] = [];
  if (rechazadasPorTipo > 0) avisos.push("solo se pueden mandar imágenes");
  if (rechazadasPorPeso > 0) avisos.push("alguna foto pesa demasiado");
  if (sobrantes > 0) avisos.push(`el máximo es ${MAX_ADJUNTOS_POR_MENSAJE} por mensaje`);

  return {
    fotos: [...actuales, ...validas.slice(0, hueco)],
    aviso: avisos.length > 0 ? `No se añadieron todas: ${avisos.join(", ")}.` : "",
  };
}
