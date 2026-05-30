"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { respondToReview } from "./actions";

export function RespondForm({ reviewId }: { reviewId: string }) {
  const [open, setOpen] = useState(false);
  const [respuesta, setRespuesta] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-[color:var(--brand-hi)] hover:underline"
      >
        Responder
      </button>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!respuesta.trim()) return;
    setLoading(true);
    await respondToReview(reviewId, respuesta.trim());
    router.refresh();
    setLoading(false);
    setOpen(false);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2 mt-2 min-w-0">
      <input
        value={respuesta}
        onChange={(e) => setRespuesta(e.target.value)}
        placeholder="Tu respuesta..."
        maxLength={1000}
        className="flex-1 min-w-0 basis-full sm:basis-auto rounded-[var(--r-lg)] border border-[color:var(--border)] bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] placeholder:text-[color:var(--fg-dim)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
      />
      <button
        type="submit"
        disabled={loading || !respuesta.trim()}
        className="rounded-[var(--r-pill)] bg-[color:var(--brand)] px-3 py-1.5 text-xs text-white hover:bg-[color:var(--brand-dark)] disabled:opacity-50 shrink-0 whitespace-nowrap"
      >
        {loading ? "..." : "Enviar"}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] shrink-0 whitespace-nowrap"
      >
        Cancelar
      </button>
    </form>
  );
}
