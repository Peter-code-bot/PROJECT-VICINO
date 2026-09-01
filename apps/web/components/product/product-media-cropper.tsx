"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { ZoomIn, ZoomOut, RotateCcw, Loader2, Crop } from "lucide-react";
import { getCroppedProductBlob, type CropArea } from "@/lib/crop-image";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type CropResult =
  | { type: "image"; blob: Blob }
  /**
   * El video NUNCA se recorto de verdad: este componente devolvia el archivo
   * original intacto y el area de recorte solo servia para recortar la
   * MINIATURA. O sea, le prometia al vendedor un recorte que no ocurria.
   *
   * Ahora hace lo que si puede hacer y ademas es lo que hacia falta: elegir
   * QUE FOTOGRAMA queda de portada. Antes se tomaba siempre el del segundo 0,1
   * y al vendedor le tocaba lo que saliera.
   */
  | { type: "video"; file: File; segundoPortada: number; portada: Blob | null };

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
  /**
   * Descartar ESTE archivo y pasar al siguiente de la cola. Es la unica
   * salida de la imagen desde que el recorte 1:1 es obligatorio: sin ella,
   * quien elige la foto equivocada queda encerrado en el recortador.
   */
  onCancel: () => void;
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
  onCancel,
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
  // Selector de portada del video. Solo se usa cuando mediaType es "video".
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [segundoPortada, setSegundoPortada] = useState(0);
  // Paso 2 del video: el fotograma elegido, capturado como data URL para que lo
  // recorte el mismo Cropper que usan las fotos. Null = seguimos en el paso 1.
  const [frameSrc, setFrameSrc] = useState<string | null>(null);

  // Portal mount gate — avoids SSR hydration mismatch
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
  useEffect(() => setMounted(true), []);

  // Reset state when a new media source is presented
  useEffect(() => {
    if (mediaSrc) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reiniciar el recorte cuando entra un medio nuevo
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedArea(null);
      setSaving(false);
      setError(null);
      setFrameSrc(null);
    }
  }, [mediaSrc]);

  const onCropDone = useCallback(
    (_: unknown, pixels: CropArea) => {
      setCroppedArea(pixels);
    },
    [],
  );

  async function handleApply() {
    if (!mediaSrc) return;
    setSaving(true);
    setError(null);
    try {
      if (mediaType === "image") {
        if (!croppedArea) return;
        const blob = await getCroppedProductBlob(mediaSrc, croppedArea);
        onCropComplete({ type: "image", blob });
      } else {
        // Los return tempranos de aqui son seguros porque setSaving(false) vive
        // en el finally. Cuando estaba despues del try, un return dejaba el
        // boton clavado en "Procesando..." para siempre.
        if (!originalFile) {
          setError("No se pudo leer el archivo de video. Vuelve a seleccionarlo.");
          return;
        }

        // Paso 1: capturar el fotograma actual y pasar al encuadre.
        if (!frameSrc) {
          const v = videoRef.current;
          if (!v || !v.videoWidth || !v.videoHeight) {
            setError("No se pudo leer el fotograma. Adelanta el video e intenta de nuevo.");
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            setError("No se pudo preparar la portada. Intenta de nuevo.");
            return;
          }
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          setSegundoPortada(v.currentTime);
          setFrameSrc(canvas.toDataURL("image/jpeg", 0.92));
          return;
        }

        // Paso 2: el vendedor ya encuadro ese fotograma.
        if (!croppedArea) return;
        const portada = await getCroppedProductBlob(frameSrc, croppedArea);
        onCropComplete({
          type: "video",
          file: originalFile,
          segundoPortada,
          portada,
        });
      }
    } catch (err) {
      console.error("Crop failed:", err);
      setError(
        mediaType === "video"
          ? "No se pudo recortar el video. Intenta de nuevo u omite el recorte."
          : "No se pudo recortar la imagen. Intenta de nuevo o cancela y elige otra.",
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
      // El recorte 1:1 es obligatorio para imagen, asi que el fondo ya no es un
      // atajo: la salida es el boton Cancelar, que descarta el archivo a
      // proposito. Un toque accidental fuera no debe publicar ni borrar nada.
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

        {/* Video: selector de portada. Imagen: recortador.
            Para video se usan los controles NATIVOS a proposito: funcionan en
            movil, el vendedor ya sabe usarlos, y quitan de en medio el velo
            oscuro de react-easy-crop, que con un video vertical dentro de una
            caja cuadrada pintaba franjas oscuras arriba y abajo. Eso es lo que
            se reportaba como "banda negra arriba", y desaparece solo. */}
        {mediaType === "video" && !frameSrc ? (
          <div className="relative w-full bg-black">
            <video
              ref={videoRef}
              src={mediaSrc ?? undefined}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[60vh] object-contain bg-black"
              onTimeUpdate={(e) => setSegundoPortada(e.currentTarget.currentTime)}
              onLoadedMetadata={(e) => setSegundoPortada(e.currentTarget.currentTime)}
            />
          </div>
        ) : mediaType === "video" && frameSrc ? (
          <div className="relative w-full aspect-square bg-black">
            <Cropper
              image={frameSrc}
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
        ) : (
          <div className="relative w-full aspect-square bg-black">
            <Cropper
              image={mediaSrc}
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
        )}

        {/* Controls */}
        <div className="px-6 py-4 space-y-3 bg-card">
          {mediaType === "video" && (
            <p className="text-xs text-muted-foreground">
              {frameSrc
                ? "Encuadra la portada. El video se publica completo: esto solo decide como se ve en el inicio."
                : "Adelanta el video hasta el momento que quieras como portada y pulsa «Usar este fotograma»."}
            </p>
          )}

          {/* Zoom slider — solo para imagen: en video no hay recorte que ajustar */}
          {(mediaType === "image" || frameSrc) && (
          <>
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
          </>
          )}
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
            onClick={mediaType === "image" ? onCancel : handleSkip}
            disabled={saving}
            className="flex-1 rounded-full py-3 border border-border text-foreground font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            {mediaType === "image" ? "Cancelar" : "Usar sin recortar"}
          </button>
          <button
            onClick={handleApply}
            disabled={saving || (!croppedArea && (mediaType === "image" || frameSrc !== null))}
            className="flex-1 rounded-full py-3 bg-primary text-primary-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Procesando...
              </>
            ) : (
              mediaType === "video" && !frameSrc ? "Usar este fotograma" : "Recortar y usar"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
