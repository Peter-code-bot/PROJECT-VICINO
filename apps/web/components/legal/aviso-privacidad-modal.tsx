"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, type ReactElement } from "react";
import { X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/**
 * El cuerpo del aviso sale del MISMO modulo que pinta /privacidad, no de una
 * copia.
 *
 * Copiar aqui el texto legal es el fallo que esto evita: el dia que cambie una
 * clausula, una de las dos copias se queda vieja y la persona acepta un
 * documento distinto del publicado, mientras el consentimiento se registra con
 * la version del otro. Un aviso desincronizado no acredita nada.
 *
 * Se importa el COMPONENTE del cuerpo y no la pagina: la pagina exporta
 * `metadata`, y ese export no puede cruzar a un grafo de cliente. Ademas la
 * pagina trae su propio h1, que aqui saldria debajo de la cabecera del modal
 * repitiendo el titulo.
 *
 * Diferido y sin SSR a proposito: son ~30 KB de texto legal que no tienen que
 * viajar con la pantalla de verificacion hasta que alguien toque el enlace, y
 * el modal solo existe en el cliente.
 */
const CuerpoDelAviso = dynamic(
  () =>
    import("@/components/legal/aviso-privacidad-cuerpo").then(
      (m) => m.AvisoPrivacidadCuerpo,
    ),
  {
    ssr: false,
    loading: () => (
      <p className="px-4 py-10 text-center text-sm text-[color:var(--fg-dim)]">
        Cargando el Aviso de Privacidad…
      </p>
    ),
  },
);

interface AvisoPrivacidadModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * El Aviso de Privacidad encima de la pantalla, sin navegar a ningun sitio.
 *
 * POR QUE NO ES UN ENLACE. El enlace llevaba a /privacidad, y quien lo tocaba
 * desde la verificacion perdia la pantalla: los archivos elegidos en los inputs
 * no sobreviven a una navegacion, asi que volver significaba repetir las fotos.
 * Aqui se abre encima y al cerrar sigue todo donde estaba.
 *
 * `data-modal-open` no es decorativo: es la convencion que lee
 * components/capacitor-init para que el boton atras del APK cierre el modal en
 * vez de sacar a la persona de la pantalla. Funciona porque ese codigo despacha
 * un Escape sintetico en `document`, que es justo donde escucha este modal.
 */
export function AvisoPrivacidadModal({
  open,
  onClose,
}: AvisoPrivacidadModalProps): ReactElement | null {
  const cerrarRef = useRef<HTMLButtonElement>(null);

  useBodyScrollLock(open);

  // El foco se mueve SOLO al abrir, y por eso este efecto no depende de
  // `onClose`: quien lo llama suele pasar una funcion nueva en cada render, y
  // con esa dependencia el foco volvia al boton de cerrar cada vez que la
  // pantalla de detras se re-renderizaba —a media lectura, y perdiendo el
  // sitio en el que iba la persona.
  useEffect(() => {
    if (!open) return;
    cerrarRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function alPulsarTecla(evento: KeyboardEvent) {
      if (evento.key === "Escape") onClose();
    }
    document.addEventListener("keydown", alPulsarTecla);
    return () => document.removeEventListener("keydown", alPulsarTecla);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center sm:items-center sm:p-4"
      data-modal-open="true"
    >
      <button
        type="button"
        aria-label="Cerrar"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="titulo-aviso-privacidad"
        className="relative flex h-full w-full flex-col bg-background sm:h-auto sm:max-h-[85vh] sm:w-[min(760px,92vw)] sm:rounded-[var(--r-lg)] sm:border sm:border-border sm:shadow-[var(--shadow-lg)]"
      >
        {/* El relleno de arriba suma el inset de la pantalla porque en movil el
            panel va a pantalla completa y queda debajo de la isla o la muesca. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:pt-3">
          <h2
            id="titulo-aviso-privacidad"
            className="flex-1 font-display text-base font-semibold text-fg"
          >
            Aviso de Privacidad
          </h2>
          <button
            ref={cerrarRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar el Aviso de Privacidad"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-card-2"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* El relleno lo pone el modal y no el cuerpo: /privacidad lo envuelve
            en su propio contenedor con max-w-3xl, y el cuerpo extraido ya no
            trae ninguno. Sin esto el texto legal toca los dos bordes. */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5">
          <CuerpoDelAviso />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-3">
          {/* Salida de emergencia, no el camino normal: si el trozo diferido no
              llega a cargarse (red caida a mitad, o la app dentro del WebView),
              el modal se quedaria con el texto de carga y sin aviso que leer. */}
          <a
            href="/privacidad"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[color:var(--fg-dim)] underline"
          >
            Abrir en una pestaña nueva
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[var(--r-lg)] bg-[color:var(--fg)] px-4 py-2 text-sm font-semibold text-[color:var(--bg)] hover:opacity-80"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
