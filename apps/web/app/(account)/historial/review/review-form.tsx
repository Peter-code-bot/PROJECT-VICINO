"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Star, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";

interface ReviewFormProps {
  saleConfirmationId: string;
  productId: string;
  reviewedId: string;
  reviewType: "buyer_to_seller" | "seller_to_buyer";
}

export function ReviewForm({
  saleConfirmationId,
  productId,
  reviewedId,
  reviewType,
}: ReviewFormProps) {
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comentario, setComentario] = useState("");
  const [media, setMedia] = useState<{ file: File; preview: string; type: "image" | "video" }[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (media.length + files.length > 3) {
      setError("Máximo 3 archivos");
      return;
    }
    for (const file of files) {
      const isVideo = file.type.startsWith("video/");
      const maxSize = isVideo ? 50 * 1024 * 1024 : 5 * 1024 * 1024;
      if (file.size > maxSize) {
        setError(`${file.name} excede el límite (${isVideo ? "50MB" : "5MB"})`);
        return;
      }
    }
    setError("");
    const newMedia = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      type: (file.type.startsWith("video/") ? "video" : "image") as "image" | "video",
    }));
    setMedia((prev) => [...prev, ...newMedia]);
    if (e.target) e.target.value = "";
  }

  function removeMedia(index: number) {
    setMedia((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function uploadMedia(): Promise<string[]> {
    if (media.length === 0) return [];
    const urls: string[] = [];
    const ts = Date.now();
    for (let i = 0; i < media.length; i++) {
      const m = media[i]!;
      const ext = m.file.name.split(".").pop() ?? "jpg";
      const path = `${saleConfirmationId}/${ts}-${i}.${ext}`;
      const { error: err } = await supabase.storage
        .from("review-media")
        .upload(path, m.file);
      if (err) throw new Error(`Error subiendo archivo: ${err.message}`);
      const { data } = supabase.storage.from("review-media").getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (rating === 0) {
      setError("Selecciona una calificación");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const mediaUrls = await uploadMedia();

      const { error: insertError } = await supabase.from("reviews").insert({
        sale_confirmation_id: saleConfirmationId,
        product_id: productId,
        reviewer_id: (await supabase.auth.getUser()).data.user?.id,
        reviewed_id: reviewedId,
        review_type: reviewType,
        rating,
        comentario: comentario.trim() || null,
        fotos: mediaUrls,
      });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }

      setSuccess(true);
      setLoading(false);
      setTimeout(() => {
        router.push("/historial");
        router.refresh();
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir archivos");
      setLoading(false);
    }
  }

  if (success) {
    return (
      <div className="text-center py-12 space-y-4 animate-fade-in">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-green-50 dark:bg-green-950/30 flex items-center justify-center">
          <span className="text-3xl">✅</span>
        </div>
        <h2 className="text-lg font-heading font-bold">¡Reseña enviada con éxito!</h2>
        <p className="text-sm text-muted-foreground">Gracias por tu feedback. Redirigiendo al historial...</p>
        <button
          onClick={() => router.push("/historial")}
          className="inline-flex items-center gap-2 text-sm font-medium text-terracotta hover:underline"
        >
          ← Volver al historial
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Star rating */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Calificación</label>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="p-1"
            >
              <Star
                className={cn(
                  "h-8 w-8 transition-colors",
                  star <= (hoveredRating || rating)
                    ? "fill-amber-400 text-amber-400"
                    : "fill-muted text-muted hover:text-amber-300"
                )}
              />
            </button>
          ))}
        </div>
        {rating > 0 && (
          <p className="text-xs text-muted-foreground">
            {rating === 5 && "Excelente"}
            {rating === 4 && "Muy bueno"}
            {rating === 3 && "Bueno"}
            {rating === 2 && "Regular"}
            {rating === 1 && "Malo"}
          </p>
        )}
      </div>

      {/* Comment */}
      <div className="space-y-2">
        <label htmlFor="comentario" className="text-sm font-medium">
          Comentario{" "}
          <span className="text-muted-foreground font-normal">(opcional)</span>
        </label>
        <textarea
          id="comentario"
          value={comentario}
          onChange={(e) => setComentario(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Comparte tu experiencia..."
          className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary resize-y"
        />
      </div>

      {/* Media upload */}
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Fotos o videos{" "}
          <span className="text-muted-foreground font-normal">(opcional, máx. 3)</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          {media.map((m, i) => (
            <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border/50 group">
              {m.type === "image" ? (
                <Image src={m.preview} alt="" fill className="object-cover" />
              ) : (
                <video src={m.preview} className="w-full h-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => removeMedia(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              {m.type === "video" && (
                <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-black/60 text-white px-1 rounded font-medium">
                  Video
                </span>
              )}
            </div>
          ))}
          {media.length < 3 && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground hover:border-terracotta/40 hover:text-terracotta transition-colors"
            >
              <ImagePlus className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Agregar</span>
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      <button
        type="submit"
        disabled={loading || rating === 0}
        className="w-full rounded-md bg-bone px-4 py-2.5 text-sm font-medium text-bone-contrast hover:bg-bone-dark disabled:opacity-50"
      >
        {loading ? "Enviando..." : "Enviar reseña"}
      </button>
    </form>
  );
}
