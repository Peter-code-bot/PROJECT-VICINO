"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProductMediaCropper } from "@/components/product/product-media-cropper";
import { MAX_BYTES_POR_IMAGEN } from "@/lib/comunidades/media";
import { CommunityPhoto } from "./community-photo";

export function CommunityPhotoInput({ nombre, foto, onChange, currentUrl, disabled }: { nombre: string; foto: File | null; onChange: (file: File | null) => void; currentUrl?: string | null; disabled?: boolean }) {
  const [source, setSource] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!foto) return;
    const url = URL.createObjectURL(foto);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- object URL lifecycle follows the selected file
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);
  useEffect(() => () => { if (source) URL.revokeObjectURL(source); }, [source]);
  return <div className="space-y-2">
    <p className="text-sm font-medium text-fg">Foto del grupo <span className="font-normal text-fg-muted">(opcional)</span></p>
    <div className="flex items-center gap-3">
      <CommunityPhoto nombre={nombre} url={foto ? preview : currentUrl} className="h-20 w-20 shrink-0 rounded-xl" />
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center rounded-full bg-card-2 px-4 text-sm font-semibold text-fg">
          Elegir foto
          <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" className="sr-only" disabled={disabled} onChange={event => {
            const file = event.target.files?.[0]; event.target.value = "";
            if (!file) return;
            if (!file.type.startsWith("image/") || file.size > MAX_BYTES_POR_IMAGEN) { toast.error("Elige una imagen de hasta 5 MB."); return; }
            setSource(URL.createObjectURL(file));
          }} />
        </label>
        {foto && <button type="button" disabled={disabled} onClick={() => onChange(null)} className="min-h-11 px-3 text-sm text-fg-muted">Quitar</button>}
      </div>
    </div>
    <ProductMediaCropper open={source !== null} mediaSrc={source} mediaType="image" onCancel={() => setSource(null)} onCropComplete={result => {
      if (result.type === "image") onChange(new File([result.blob], "grupo.webp", { type: "image/webp" }));
      setSource(null);
    }} />
  </div>;
}
