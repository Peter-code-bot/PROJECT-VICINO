"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
    try {
      const res = await respondToReview(reviewId, respuesta.trim());
      // Antes se descartaba el retorno y el formulario se cerraba igual: sesion
      // expirada, limite de escritura, texto invalido o un UPDATE de 0 filas
      // pasaban como exito y el vendedor creia publicada una respuesta que no
      // existia. En el fallo dejamos el formulario abierto y el texto intacto
      // para que pueda reintentar sin volver a escribirlo.
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      toast.success("Respuesta publicada");
      setRespuesta("");
      setOpen(false);
      router.refresh();
    } catch {
      // Si la llamada al Server Action revienta (red caida), sin este catch la
      // excepcion escapaba de handleSubmit y el boton se quedaba en "...".
      toast.error("No se pudo enviar tu respuesta. Revisa tu conexión e intenta de nuevo.");
    } finally {
      setLoading(false);
    }
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
