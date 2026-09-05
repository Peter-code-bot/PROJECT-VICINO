"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { CACHE_INMUTABLE } from "@/lib/storage/cache";

interface AvatarInlineUploadProps {
  initial: string;
  avatarUrl: string;
  onUploadSuccess: (url: string) => void;
  onError: (msg: string) => void;
}

const MAX_SAFE_SIZE_MB = 25;

export function AvatarInlineUpload({
  initial,
  avatarUrl,
  onUploadSuccess,
  onError,
}: AvatarInlineUploadProps) {
  const [avatarUploading, setAvatarUploading] = useState(false);

  return (
    <div className="flex flex-col items-center justify-center mb-6">
      <div className="relative w-[72px] h-[72px] rounded-full bg-muted overflow-hidden shrink-0">
        {avatarUrl ? (
          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
            {initial}
          </div>
        )}
        {avatarUploading && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader2 className="w-5 h-5 text-white animate-spin" />
          </div>
        )}
      </div>
      <label className="cursor-pointer mt-3">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          disabled={avatarUploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > MAX_SAFE_SIZE_MB * 1024 * 1024) {
              onError(`La imagen es demasiado grande (máx ${MAX_SAFE_SIZE_MB}MB)`);
              return;
            }
            setAvatarUploading(true);
            try {
              let uploadBlob: Blob = file;
              let ext = file.name.split(".").pop() ?? "jpg";
              
              if (typeof window === "undefined" || !window.createImageBitmap) {
                onError("No pudimos procesar la foto en este navegador");
                setAvatarUploading(false);
                return;
              }

              try {
                const bmp = await window.createImageBitmap(file);
                const MAX_SIZE = 800;
                let width = bmp.width;
                let height = bmp.height;
                
                if (width > MAX_SIZE || height > MAX_SIZE) {
                  if (width > height) {
                    height = Math.round(height * (MAX_SIZE / width));
                    width = MAX_SIZE;
                  } else {
                    width = Math.round(width * (MAX_SIZE / height));
                    height = MAX_SIZE;
                  }
                }
                
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                if (ctx) {
                  ctx.drawImage(bmp, 0, 0, width, height);
                  const compressedBlob = await new Promise<Blob | null>((resolve) => 
                    canvas.toBlob(resolve, "image/jpeg", 0.85)
                  );
                  if (!compressedBlob) throw new Error("Fallo al exportar blob");
                  uploadBlob = compressedBlob;
                  ext = "jpg";
                } else {
                  throw new Error("No se pudo crear contexto 2d");
                }
              } catch (compressErr) {
                console.warn("avatar compression failed", compressErr);
                throw new Error("No pudimos procesar la foto en tu dispositivo.");
              }

              const supabase = (await import("@/lib/supabase/client")).createClient();
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (!user) throw new Error("No autenticado");
              const path = `${user.id}/avatar-${Date.now()}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("avatars")
                .upload(path, uploadBlob, { upsert: true, cacheControl: CACHE_INMUTABLE });
              if (upErr) throw upErr;
              const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
              onUploadSuccess(urlData.publicUrl);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Error al subir foto");
            }
            setAvatarUploading(false);
          }}
        />
        <span className="text-[13px] font-medium text-primary hover:underline">
          {avatarUrl ? "Cambiar foto" : "Subir foto"}
        </span>
      </label>
    </div>
  );
}
