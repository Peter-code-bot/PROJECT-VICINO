"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { ZoomIn, ZoomOut, RotateCcw, Loader2 } from "lucide-react";
import { getCroppedBlob, type CropArea } from "@/lib/crop-image";

interface AvatarCropperModalProps {
  open: boolean;
  imageSrc: string | null;
  onCancel: () => void;
  onSave: (blob: Blob) => Promise<void>;
  saving?: boolean;
}

export function AvatarCropperModal({
  open,
  imageSrc,
  onCancel,
  onSave,
  saving = false,
}: AvatarCropperModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<CropArea | null>(null);
  const [mounted, setMounted] = useState(false);

  // Mounted gate guarantees document.body exists before createPortal runs;
  // also avoids SSR hydration mismatch on the portaled subtree.
  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern; same shape as account-menu-drawer.tsx
  useEffect(() => setMounted(true), []);

  const onCropComplete = useCallback((_: unknown, pixels: CropArea) => {
    setCroppedArea(pixels);
  }, []);

  function reset() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  }

  async function handleSave() {
    if (!imageSrc || !croppedArea) return;
    const blob = await getCroppedBlob(imageSrc, croppedArea);
    await onSave(blob);
    reset();
  }

  function handleCancel() {
    reset();
    onCancel();
  }

  if (!mounted || !open || !imageSrc) return null;

  // Portal to body so the modal's `position: fixed` covers the viewport
  // instead of being constrained to PageSwipeWrapper's transform ancestor
  // (introduced in Phase 6).
  return createPortal(
    <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={handleCancel}>
      <div className="bg-card w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border/60">
          <h2 className="text-lg font-bold text-foreground">Ajusta tu foto de perfil</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Arrastra para reposicionar y usa el deslizador para zoom</p>
        </div>

        {/* Cropper area */}
        <div className="relative w-full aspect-square bg-black">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
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
          <button onClick={reset} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5">
            <RotateCcw className="w-3 h-3" /> Restablecer
          </button>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-2 flex gap-3">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="flex-1 rounded-full py-3 border border-border text-foreground font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !croppedArea}
            className="flex-1 rounded-full py-3 bg-primary text-primary-foreground font-semibold disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Guardando...
              </>
            ) : (
              "Guardar foto"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
