"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Star, X, Check, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { publishLocalReview } from "@/app/(marketplace)/reviews/actions";
import type { OwnLocalReview } from "@/lib/reviews/contracts";
import { localReviewReturnPath } from "@/lib/reviews/navigation";

interface LocalReviewDialogProps {
  open: boolean;
  onClose: () => void;
  sellerId: string;
  sellerName: string;
  sellerAvatar?: string | null;
  ownReview?: OwnLocalReview | null;
  onSuccess?: (review: OwnLocalReview) => void;
}

export function LocalReviewDialog(props: LocalReviewDialogProps) {
  // A session is remounted on every opening; prior success, errors and drafts
  // cannot leak into the next seller or another visit to this form.
  return props.open ? <LocalReviewSession {...props} /> : null;
}

function LocalReviewSession({ onClose, sellerId, sellerName, sellerAvatar, ownReview, onSuccess }: LocalReviewDialogProps) {
  const [rating, setRating] = useState(ownReview?.rating ?? 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comentario, setComentario] = useState(ownReview?.comentario ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<OwnLocalReview | null>(null);
  const saving = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  const router = useRouter();

  function close() { if (!saving.current) onClose(); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving.current) return;
    if (!rating) { setError("Selecciona una calificación con estrellas."); return; }
    saving.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await publishLocalReview({ reviewedId: sellerId, rating, comentario: comentario.trim() || null }, window.location.pathname);
      if (!res.success) {
        if (res.code === "UNAUTHENTICATED") {
          router.push(`/login?next=${encodeURIComponent(localReviewReturnPath(window.location.href))}`);
          return;
        }
        setError(res.error); return;
      }
      setSaved(res.review);
      onSuccess?.(res.review);
      router.refresh();
    } catch {
      setError("No se pudo guardar la reseña. Inténtalo de nuevo.");
    } finally {
      saving.current = false;
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(value) => { if (!value) close(); }}>
      <DialogContent showClose={false} data-modal-open="true"
        className="w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto p-5"
        onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
        onCloseAutoFocus={(event) => { event.preventDefault(); opener.current?.focus(); }}
        onEscapeKeyDown={(event) => { if (saving.current) event.preventDefault(); }}
        onInteractOutside={(event) => { if (saving.current) event.preventDefault(); }}>
        <div className="flex items-center gap-2 pr-12">
          <Store className="h-5 w-5 text-brand" aria-hidden="true" />
          <DialogTitle className="text-base">Reseña del local</DialogTitle>
        </div>
        <DialogDescription>
          Comparte tu experiencia con {sellerName}. {ownReview ? "Puedes actualizar tu reseña del local." : "Una reseña del local no indica una compra verificada."}
        </DialogDescription>
        <button type="button" onClick={close} disabled={loading} aria-label="Cerrar formulario"
          className="absolute right-3 top-3 flex min-h-12 min-w-12 items-center justify-center rounded-full text-fg-muted hover:bg-card-2 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
        {saved ? (
          <div className="space-y-4 py-5 text-center" role="status">
            <Check className="mx-auto h-8 w-8 text-emerald-trust" aria-hidden="true" />
            <p className="font-display font-semibold">Reseña guardada</p>
            <p className="text-sm text-fg-muted">{saved.visible ? "Tu reseña ya está disponible en el local." : "Tu reseña se guardó y continúa oculta por moderación."}</p>
            <button type="button" onClick={close} className="min-h-12 w-full rounded-xl bg-brand px-4 font-semibold text-white focus-visible:ring-2 focus-visible:ring-brand">Cerrar</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" aria-busy={loading}>
            <div className="flex items-center gap-3 rounded-xl bg-card-2 p-3">
              <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-card text-brand">
                {sellerAvatar ? <Image src={sellerAvatar} alt="" fill className="object-cover" unoptimized /> : sellerName.charAt(0).toUpperCase()}
              </div>
              <p className="truncate text-sm font-semibold">{sellerName}</p>
            </div>
            {ownReview && !ownReview.visible ? <p className="text-sm text-fg-muted">Esta reseña está oculta por moderación. Editarla no la vuelve pública.</p> : null}
            {error ? <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
            <fieldset disabled={loading}>
              <legend className="mb-2 w-full text-center text-sm font-medium">Calificación general</legend>
              <div className="flex justify-center gap-1" role="group" aria-label="Calificación general">
                {[1, 2, 3, 4, 5].map((star) => <button key={star} type="button"
                  aria-label={`${star} ${star === 1 ? "estrella" : "estrellas"}`} aria-pressed={rating === star}
                  onClick={() => setRating(star)} onMouseEnter={() => setHoveredRating(star)} onMouseLeave={() => setHoveredRating(0)}
                  className="flex min-h-12 min-w-12 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-brand">
                  <Star aria-hidden="true" className={cn("h-7 w-7", star <= (hoveredRating || rating) ? "fill-[var(--trust-gold)] text-[var(--trust-gold)]" : "text-fg-dim")} />
                </button>)}
              </div>
            </fieldset>
            <div>
              <label htmlFor="local-review-comment" className="text-sm font-medium">Comentario (opcional)</label>
              <textarea id="local-review-comment" value={comentario} disabled={loading} onChange={(event) => setComentario(event.target.value)}
                maxLength={1000} rows={4} className="mt-1 w-full resize-none rounded-xl border border-border bg-card p-3 text-sm focus-visible:ring-2 focus-visible:ring-brand" />
              <p className="text-right text-xs text-fg-muted">{comentario.length}/1000</p>
            </div>
            <button type="submit" disabled={loading || !rating}
              className="min-h-12 w-full rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand/90 focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50">
              {loading ? "Guardando…" : ownReview ? "Guardar cambios" : "Publicar reseña del local"}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
