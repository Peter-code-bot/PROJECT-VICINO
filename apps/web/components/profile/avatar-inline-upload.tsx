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
            if (file.size > 5 * 1024 * 1024) {
              onError("La imagen no debe exceder 5MB");
              return;
            }
            setAvatarUploading(true);
            try {
              const supabase = (await import("@/lib/supabase/client")).createClient();
              const {
                data: { user },
              } = await supabase.auth.getUser();
              if (!user) throw new Error("No autenticado");
              const ext = file.name.split(".").pop() ?? "jpg";
              const path = `${user.id}/avatar-${Date.now()}.${ext}`;
              const { error: upErr } = await supabase.storage
                .from("avatars")
                .upload(path, file, { upsert: true, cacheControl: CACHE_INMUTABLE });
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
