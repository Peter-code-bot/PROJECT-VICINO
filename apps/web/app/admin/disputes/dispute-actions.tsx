"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { resolveDispute } from "./actions";

type Decision = "resolved_buyer" | "resolved_seller" | "closed";

const MIN_NOTA = 10;
const MAX_NOTA = 2000;

export function DisputeActions({ id }: { id: string }) {
  const [nota, setNota] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const trimmedNota = nota.trim();
  const notaTooShort = trimmedNota.length > 0 && trimmedNota.length < MIN_NOTA;

  async function handle(decision: Decision) {
    setError(null);

    if (decision !== "closed" && trimmedNota.length < MIN_NOTA) {
      setError(`La nota es obligatoria (al menos ${MIN_NOTA} caracteres) para resolver a favor de una parte.`);
      return;
    }

    setLoading(true);
    try {
      const result = await resolveDispute({
        disputeId: id,
        decision,
        nota: trimmedNota,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setError("Error inesperado. Intenta de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label
          htmlFor={`nota-${id}`}
          className="text-xs font-medium text-muted-foreground"
        >
          Justificación{" "}
          <span className="text-muted-foreground/70">
            (obligatoria para resolver a favor de una parte; opcional al cerrar)
          </span>
        </label>
        <textarea
          id={`nota-${id}`}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          disabled={loading}
          maxLength={MAX_NOTA}
          rows={3}
          placeholder="Describe brevemente por qué tomas esta decisión (se guarda en audit_log)"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span className={notaTooShort ? "text-red-600" : undefined}>
            {trimmedNota.length}/{MAX_NOTA}
            {notaTooShort ? ` — mínimo ${MIN_NOTA} si resuelves a favor` : ""}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handle("resolved_buyer")}
          disabled={loading}
          className="rounded-md bg-green-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-green-700 disabled:opacity-50"
        >
          A favor del comprador
        </button>
        <button
          onClick={() => handle("resolved_seller")}
          disabled={loading}
          className="rounded-md bg-blue-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          A favor del vendedor
        </button>
        <button
          onClick={() => handle("closed")}
          disabled={loading}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
        >
          Cerrar sin acción
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
