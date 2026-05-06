"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { markAuthorityNotified } from "../actions";

interface CriticalReportFormProps {
  criticalReportId: string;
}

export function CriticalReportForm({ criticalReportId }: CriticalReportFormProps) {
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reference.trim() || pending) return;

    startTransition(async () => {
      const res = await markAuthorityNotified(criticalReportId, reference.trim(), notes.trim() || undefined);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("Marcado como denunciado");
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2 rounded-md bg-muted/40 p-3">
      <p className="text-xs font-medium">Marcar denuncia presentada</p>
      <div className="grid grid-cols-1 gap-2">
        <input
          type="text"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          required
          placeholder="Folio / expediente *"
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Notas (opcional): autoridad, contacto, etc."
          className="rounded-md border border-border bg-background px-3 py-1.5 text-sm"
        />
      </div>
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!reference.trim() || pending}
          className="text-xs px-3 py-1.5 rounded-md bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Marcar como denunciado"}
        </button>
      </div>
    </form>
  );
}
