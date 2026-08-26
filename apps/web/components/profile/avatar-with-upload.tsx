"use client";

import { CACHE_INMUTABLE } from "@/lib/storage/cache";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { fileToDataURL } from "@/lib/crop-image";

const AvatarCropperModal = dynamic(
  () => import("./avatar-cropper-modal").then((m) => m.AvatarCropperModal),
  { ssr: false }
);

interface AvatarWithUploadProps {
  userId: string;
  currentAvatarUrl: string | null;
  displayName: string;
  isOwnProfile: boolean;
}

export function AvatarWithUpload({
  userId,
  currentAvatarUrl,
  displayName,
  isOwnProfile,
}: AvatarWithUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(currentAvatarUrl);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Limpiamos el input antes de cualquier salida: si no, rechazar una foto y
    // volver a elegir LA MISMA no vuelve a disparar el evento y la pantalla se
    // queda muerta sin que nadie entienda por qué.
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Ese archivo no es una imagen. Elige una foto JPG o PNG.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("La foto pesa más de 10 MB. Elige una más ligera.");
      return;
    }

    try {
      const dataUrl = await fileToDataURL(file);
      setImageSrc(dataUrl);
      setCropperOpen(true);
    } catch {
      toast.error("No pudimos abrir esa foto. Intenta con otra.");
    }
  }

  async function handleSaveCropped(blob: Blob) {
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${userId}/avatar-${Date.now()}.jpg`;

      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, blob, {
          contentType: "image/jpeg",
          upsert: true,
          cacheControl: CACHE_INMUTABLE,
        });
      if (upErr) throw upErr;

      const { data } = supabase.storage.from("avatars").getPublicUrl(path);

      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ foto: data.publicUrl })
        .eq("id", userId);
      if (dbErr) throw dbErr;

      setPreview(data.publicUrl);
      setCropperOpen(false);
      setImageSrc(null);
      router.refresh();
    } catch (err) {
      console.error("Avatar upload failed:", err);
      toast.error("No se pudo guardar tu foto. Revisa tu conexión e intenta de nuevo.");
    }
    setUploading(false);
  }

  const initial = displayName?.charAt(0)?.toUpperCase() ?? "?";

  return (
    <div className="relative group shrink-0">
      <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-border/40 bg-muted">
        {preview ? (
          <Image src={preview} alt={displayName} width={96} height={96} className="object-cover w-full h-full" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-3xl font-bold text-muted-foreground">
            {initial}
          </div>
        )}
      </div>

      {isOwnProfile && (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="hidden md:flex absolute inset-0 w-20 h-20 sm:w-24 sm:h-24 rounded-full items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
        >
          {uploading ? <Loader2 className="w-6 h-6 text-white animate-spin" /> : <Camera className="w-6 h-6 text-white" />}
        </button>
      )}

      {isOwnProfile && (
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="md:hidden absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background shadow-md"
        >
          {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
        </button>
      )}

      {isOwnProfile && (
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" disabled={uploading} />
      )}

      <AvatarCropperModal
        open={cropperOpen}
        imageSrc={imageSrc}
        onCancel={() => { setCropperOpen(false); setImageSrc(null); }}
        onSave={handleSaveCropped}
        saving={uploading}
      />
    </div>
  );
}
