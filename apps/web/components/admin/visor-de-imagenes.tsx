"use client";

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ImageOff, RotateCcw, X } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";

/** Un documento ya firmado por el servidor, listo para pintarse. */
export interface DocumentoDeVerificacion {
  /** Lo que se lee bajo la miniatura y lo que anuncia el visor: "Selfie", "Frente"... */
  readonly etiqueta: string;
  /** URL FIRMADA. Se firma en el servidor y caduca; aqui solo se pide. */
  readonly url: string;
}

interface VisorDeImagenesProps {
  readonly documentos: readonly DocumentoDeVerificacion[];
}

/**
 * Miniaturas de los documentos de una verificacion mas un visor a pantalla
 * completa.
 *
 * Sustituye a tres enlaces "Ver imagen ->" que abrian una pestana del
 * navegador: dentro del APK eso saca al revisor de la aplicacion y lo deja en
 * el navegador del sistema, con la URL firmada a la vista y sin forma de volver
 * a la cola mas que con el boton atras.
 */
export function VisorDeImagenes({ documentos }: VisorDeImagenesProps): ReactElement | null {
  const [montado, setMontado] = useState(false);
  const [indiceAbierto, setIndiceAbierto] = useState<number | null>(null);
  /** URLs cuya carga fallo en el intento actual. */
  const [fallidas, setFallidas] = useState<ReadonlySet<string>>(() => new Set<string>());
  /** URL -> numero de intento. Subirlo remonta la <img> y la vuelve a pedir. */
  const [intentos, setIntentos] = useState<ReadonlyMap<string, number>>(
    () => new Map<string, number>(),
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const botonCerrarRef = useRef<HTMLButtonElement>(null);
  const focoPrevio = useRef<HTMLElement | null>(null);
  const estabaAbierto = useRef(false);

  // El portal necesita que document.body exista, y el subarbol portado no debe
  // participar de la hidratacion.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- deteccion de montaje para el portal; misma forma que avatar-cropper-modal.tsx
  useEffect(() => setMontado(true), []);

  const total = documentos.length;
  const indiceActual = indiceAbierto ?? -1;
  const documento = indiceActual >= 0 ? (documentos[indiceActual] ?? null) : null;
  const abierto = documento !== null;

  useBodyScrollLock(abierto);

  const cerrar = useCallback(() => {
    setIndiceAbierto(null);
    // Se devuelve el foco a la miniatura ANTES de desmontar el visor: si no, el
    // foco cae al body y el siguiente Tab reempieza por el principio de la
    // pagina, lejos de la verificacion que se estaba revisando.
    const previo = focoPrevio.current;
    focoPrevio.current = null;
    previo?.focus();
  }, []);

  const mover = useCallback(
    (delta: number) => {
      if (total === 0) return;
      setIndiceAbierto((actual) => (actual === null ? null : (actual + delta + total) % total));
    },
    [total],
  );

  const reintentar = useCallback((url: string) => {
    setFallidas((previas) => {
      const siguientes = new Set(previas);
      siguientes.delete(url);
      return siguientes;
    });
    // No se le anade ningun parametro a la URL: la firma viaja en la query y
    // tocarla es pedir un 400. Basta con remontar la imagen por su clave.
    setIntentos((previos) => new Map(previos).set(url, (previos.get(url) ?? 0) + 1));
  }, []);

  const marcarFallo = useCallback((url: string) => {
    setFallidas((previas) => (previas.has(url) ? previas : new Set(previas).add(url)));
  }, []);

  const claveDeImagen = (url: string): string => `${url}#${intentos.get(url) ?? 0}`;

  /**
   * Las miniaturas tambien se pintan en el servidor, asi que el navegador
   * puede terminar —o romper— la carga ANTES de que React hidrate y enganche
   * onError. En ese caso el evento no llega nunca y el documento se queda como
   * el hueco roto del navegador, que es justo lo que no puede pasar aqui. Al
   * montar se pregunta al elemento si ya acabo sin pixeles.
   *
   * Se exige tambien `currentSrc`: una miniatura diferida por `loading="lazy"`
   * todavia no ha pedido nada, y darla por fallida pintaria toda la cola en
   * rojo salvo lo que se vea en pantalla.
   */
  const revisarSiYaFallo = useCallback(
    (url: string) => (elemento: HTMLImageElement | null) => {
      if (!elemento || !elemento.complete || elemento.currentSrc === "") return;
      if (elemento.naturalWidth === 0) marcarFallo(url);
    },
    [marcarFallo],
  );

  useEffect(() => {
    // El foco se coloca solo al ABRIR. Hacerlo en cada cambio de indice se lo
    // robaria a la flecha que se acaba de pulsar, y el siguiente Enter cerraria
    // el visor en vez de seguir avanzando.
    if (abierto && !estabaAbierto.current) botonCerrarRef.current?.focus();
    estabaAbierto.current = abierto;
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return;
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === "Escape") {
        cerrar();
        return;
      }
      if (total > 1 && (evento.key === "ArrowLeft" || evento.key === "ArrowRight")) {
        evento.preventDefault();
        mover(evento.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (evento.key !== "Tab") return;
      // Sin retener el Tab el foco se va a los botones de Aprobar y Rechazar
      // que quedan debajo del visor: un Enter a ciegas resolveria la
      // verificacion mientras la pantalla muestra un documento.
      const panel = panelRef.current;
      if (!panel) return;
      const enfocables = Array.from(panel.querySelectorAll<HTMLElement>("button:not([disabled])"));
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      if (!primero || !ultimo) return;
      const activo = document.activeElement;
      const dentro = activo instanceof Node && panel.contains(activo);
      if (evento.shiftKey && (!dentro || activo === primero)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && (!dentro || activo === ultimo)) {
        evento.preventDefault();
        primero.focus();
      }
    }
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [abierto, total, cerrar, mover]);

  if (documentos.length === 0) return null;

  return (
    <>
      <ul className="grid grid-cols-3 gap-2 sm:gap-3">
        {documentos.map((doc, indice) => (
          // La clave es la etiqueta y no la URL: la firma se renueva en cada
          // carga de la pagina, y con la URL de clave cada refresco desmontaria
          // y volveria a montar las tres miniaturas.
          <li key={doc.etiqueta} className="space-y-1">
            <p className="truncate text-xs text-muted-foreground">{doc.etiqueta}</p>
            {fallidas.has(doc.url) ? (
              <button
                type="button"
                onClick={() => reintentar(doc.url)}
                aria-label={`No se pudo cargar la imagen de ${doc.etiqueta}. Reintentar`}
                // El minimo de alto va con la proporcion porque el aviso son
                // tres lineas de texto: en una rejilla de tres columnas a 375
                // px la caja de 4/3 mide 72 px y el contenido se saldria por
                // encima de los botones de la ficha.
                className="flex aspect-[4/3] min-h-[5.5rem] w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border bg-card-2 px-1.5 text-center"
              >
                <ImageOff className="h-4 w-4 text-fg-dim" aria-hidden="true" />
                <span className="text-[10px] leading-tight text-fg-muted">
                  No se pudo cargar la imagen
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
                  <RotateCcw className="h-3 w-3" aria-hidden="true" />
                  Reintentar
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={(evento) => {
                  focoPrevio.current = evento.currentTarget;
                  setIndiceAbierto(indice);
                }}
                aria-label={`Ver ${doc.etiqueta} en grande`}
                className="block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-lg border border-border bg-card-2"
              >
                {/* <img> y no next/image: es un documento de identidad con URL
                    firmada. El optimizador la volveria a pedir desde el
                    servidor y la cachearia por URL en una CDN publica -- o sea,
                    cachearia el documento junto con su token. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={claveDeImagen(doc.url)}
                  ref={revisarSiYaFallo(doc.url)}
                  src={doc.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                  onError={() => marcarFallo(doc.url)}
                />
              </button>
            )}
          </li>
        ))}
      </ul>

      {montado &&
        documento &&
        createPortal(
          // Se porta al body porque el contenedor del panel de admin arrastra un
          // `animate-fade-in-up` con fill forwards: su transform final sigue
          // siendo un transform, o sea un bloque contenedor, y un
          // `fixed inset-0` dentro se estiraria a lo alto de la cola de
          // verificaciones en vez de cubrir la pantalla.
          //
          // data-modal-open es la convencion que lee components/capacitor-init:
          // sin ella el boton atras de Android navega hacia atras en vez de
          // cerrar el visor.
          <div
            ref={panelRef}
            data-modal-open="true"
            role="dialog"
            aria-modal="true"
            aria-label={`${documento.etiqueta} — documento de verificación`}
            onClick={cerrar}
            className="fixed inset-0 z-[70] flex flex-col bg-black/95"
          >
            <div
              onClick={(evento) => evento.stopPropagation()}
              className="flex items-center justify-between gap-3 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{documento.etiqueta}</p>
                {total > 1 && (
                  <p className="text-xs text-white/60">
                    {indiceActual + 1} de {total}
                  </p>
                )}
              </div>
              <button
                ref={botonCerrarRef}
                type="button"
                onClick={cerrar}
                aria-label="Cerrar"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {fallidas.has(documento.url) ? (
                <div
                  onClick={(evento) => evento.stopPropagation()}
                  className="max-w-xs space-y-3 text-center"
                >
                  <ImageOff className="mx-auto h-8 w-8 text-white/70" aria-hidden="true" />
                  <p className="text-sm font-medium text-white">No se pudo cargar la imagen</p>
                  <p className="text-xs text-white/60">
                    Si vuelve a fallar, recarga la página: los enlaces de los documentos caducan.
                  </p>
                  <button
                    type="button"
                    onClick={() => reintentar(documento.url)}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    Reintentar
                  </button>
                </div>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element -- documento firmado: fuera del optimizador, igual que la miniatura */
                <img
                  key={claveDeImagen(documento.url)}
                  ref={revisarSiYaFallo(documento.url)}
                  src={documento.url}
                  alt={`${documento.etiqueta} de la verificación`}
                  decoding="async"
                  onClick={(evento) => evento.stopPropagation()}
                  onError={() => marcarFallo(documento.url)}
                  className="max-h-full max-w-full object-contain"
                />
              )}

              {total > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Documento anterior"
                    onClick={(evento) => {
                      evento.stopPropagation();
                      mover(-1);
                    }}
                    className="absolute left-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  >
                    <ChevronLeft className="h-6 w-6" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label="Documento siguiente"
                    onClick={(evento) => {
                      evento.stopPropagation();
                      mover(1);
                    }}
                    className="absolute right-2 top-1/2 inline-flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
                  >
                    <ChevronRight className="h-6 w-6" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
