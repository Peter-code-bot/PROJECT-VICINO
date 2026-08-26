"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { ZoomIn, ZoomOut, RotateCcw, Loader2, Crop } from "lucide-react";
import { getCroppedProductBlob, type CropArea } from "@/lib/crop-image";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CropResult =
  | { type: "image"; blob: Blob }
  | { type: "video"; file: File; cropArea: CropArea };

interface ProductMediaCropperProps {
  open: boolean;
  /** data URL for images, object URL for videos */
  mediaSrc: string | null;
  mediaType: "image" | "video";
  /** Original File — needed for the video passthrough */
  originalFile?: File;
  /**
   * Salir del recortador SIN recortar. El archivo se usa tal cual.
   *
   * Antes se llamaba onCancel y descartaba el archivo en silencio, que es lo
   * contrario de lo que promete el boton: quien pulsa "omitir" quiere saltarse
   * el RECORTE, no perder la foto que acaba de elegir. Y perderla no se
   * deshace — hay que volver a buscarla en el telefono.
   */
  onSkip: () => void;
  onCropComplete: (result: CropResult) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ProductMediaCropper({
  open,
  mediaSrc,
  mediaType,
  originalFile,
  onSkip,
  onCropComplete,
}: ProductMediaCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<CropArea | null>(null);
  const [saving, setSaving] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Sin esto el fallo de crop era mudo: el catch solo hacia console.error y el
  // usuario veia el modal volver a "Aplicar crop" sin explicacion.
  const [error, setError] = useState<string | null>(null);

  // Portal mount gate — avoids SSR hydration mismatch
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
  useEffect(() => setMounted(true), []);

  // Reset state when a new media source is presented
  useEffect(() => {
    if (mediaSrc) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedArea(null);
      setSaving(false);
      setError(null);
    }
  }, [mediaSrc]);

  const onCropDone = useCallback(
    (_: unknown, pixels: CropArea) => {
      setCroppedArea(pixels);
    },
    [],
  );

  async function handleApply() {
    if (!mediaSrc || !croppedArea) return;
    setSaving(true);
    setError(null);
    try {
      if (mediaType === "image") {
        const blob = await getCroppedProductBlob(mediaSrc, croppedArea);
        onCropComplete({ type: "image", blob });
      } else {
        // Video: pass through the original file + crop coordinates.
        // The actual video file is NOT re-encoded; the crop area is used
        // to generate a cropped thumbnail and for visual display.
        //
        // Este early-return dejaba el boton clavado en "Procesando..." para
        // siempre: saltaba el setSaving(false) que estaba despues del try.
        // Ahora vive en el finally, asi que cualquier salida lo libera.
        if (!originalFile) {
          setError("No se pudo leer el archivo de video. Vuelve a seleccionarlo.");
          return;
        }
        onCropComplete({
          type: "video",
          file: originalFile,
          cropArea: croppedArea,
        });
      }
    } catch (err) {
      console.error("Crop failed:", err);
      setError(
        mediaType === "video"
          ? "No se pudo recortar el video. Intenta de nuevo u omite el recorte."
          : "No se pudo recortar la imagen. Intenta de nuevo u omite el recorte.",
      );
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setSaving(false);
    onSkip();
  }

  function handleReset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  }

  if (!mounted || !open || !mediaSrc) return null;

  const title = mediaType === "video" ? "Ajusta tu video" : "Ajusta tu foto";
  const subtitle =
    mediaType === "video"
      ? "Arrastra para encuadrar tu video"
      : "Arrastra para reposicionar y usa el deslizador para zoom";

  return createPortal(
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      // Pulsar fuera tampoco pierde el archivo. Un toque accidental que anade
      // una foto se arregla quitandola de la rejilla; uno que la borra obliga
      // a buscarla otra vez en el telefono.
      onClick={handleSkip}
    >
      <div
        className="bg-card w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Crop className="w-5 h-5 text-[color:var(--brand-hi)]" />
            {title}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        </div>

        {/* Cropper area */}
        <div className="relative w-full aspect-square bg-black">
          <Cropper
            {...(mediaType === "video"
              ? { video: mediaSrc }
              : { image: mediaSrc })}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="rect"
            showGrid={true}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropDone}
            minZoom={1}
            maxZoom={3}
          />
        </div>

        {/* Controls */}
        <div className="px-6 py-4 space-y-3 bg-card">
          {/* Zoom slider */}
          <div className="flex items-center gap-3">
            <ZoomOut className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-primary"
              aria-label="Zoom"
            />
            <ZoomIn className="w-4 h-4 text-muted-foreground shrink-0" />
          </div>

          {/* Reset */}
          <button
            onClick={handleReset}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
          >
            <RotateCcw className="w-3 h-3" /> Restablecer
          </button>
        </div>

        {/* Error — el modal ya no se queda mudo cuando el crop falla */}
        {error && (
          <div className="px-6 pb-1">
            <p role="alert" className="text-xs text-[color:var(--danger)]">
              {error}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex gap-3">
          <button
            onClick={handleSkip}
            disabled={saving}
            className="flex-1 rounded-full py-3 border border-border text-foreground font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Usar sin recortar
          </button>
          <button
            onClick={handleApply}
            disabled={saving || !croppedArea}
            className="flex-1 rounded-full py-3 bg-primary text-primary-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Procesando...
              </>
            ) : (
              "Aplicar crop"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
