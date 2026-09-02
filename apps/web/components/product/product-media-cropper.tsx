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
  // Instante del fotograma que se usa como portada. Fijo en 0.1 s desde que se
  // quito el selector; viaja en el CropResult para el camino de respaldo.
  const [segundoPortada, setSegundoPortada] = useState(0);
  // La portada del video, capturada como data URL para que la recorte el mismo
  // Cropper que usan las fotos. Null = todavia se esta capturando.
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

  // El video ya no se adelanta a mano: se captura el fotograma del arranque y
  // se pasa directo al encuadre. 0.1 s y no 0, porque en 0 muchos contenedores
  // aun no tienen frame decodificado. Es el mismo instante que pinta el
  // reproductor de la ficha con su fragmento #t=0.1, asi que portada y video
  // arrancan en la misma imagen.
  useEffect(() => {
    if (mediaType !== "video" || !mediaSrc || frameSrc) return;
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    let cancelado = false;
    function capturar() {
      if (cancelado || !v.videoWidth || !v.videoHeight) return;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        setError("No se pudo preparar la portada. Vuelve a seleccionar el video.");
        return;
      }
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      setSegundoPortada(0.1);
      setFrameSrc(canvas.toDataURL("image/jpeg", 0.92));
    }
    v.onloadeddata = () => { v.currentTime = 0.1; };
    v.onseeked = capturar;
    v.onerror = () => {
      if (!cancelado) setError("No se pudo leer el video. Vuelve a seleccionarlo.");
    };
    v.src = mediaSrc;
    return () => { cancelado = true; v.src = ""; };
  }, [mediaType, mediaSrc, frameSrc]);

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

        // El vendedor ya encuadro la portada capturada. El guard de frameSrc es
        // defensivo: el boton esta deshabilitado mientras no haya croppedArea, y
        // croppedArea solo existe si el Cropper llego a montarse, o sea si ya
        // habia portada. TypeScript no puede deducirlo desde aqui.
        if (!frameSrc || !croppedArea) return;
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

        {/* Video: la portada se captura sola del arranque y solo se encuadra.
            Antes habia aqui un reproductor con controles nativos para elegir el
            segundo; se quito el 1-sep-2026 por decision de producto. */}
        {mediaType === "video" && !frameSrc ? (
          <div className="relative w-full aspect-square bg-black flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span className="text-xs">Preparando la portada...</span>
            </div>
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
          {mediaType === "video" && frameSrc && (
            <p className="text-xs text-muted-foreground">
              Encuadra la portada. El video se publica completo: esto solo decide
              como se ve en el inicio.
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
            disabled={saving || !croppedArea}
            className="flex-1 rounded-full py-3 bg-primary text-primary-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Procesando...
              </>
            ) : (
              "Recortar y usar"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
