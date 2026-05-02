"use client";

// TODO(bloque-7): migrar a <Drawer> consolidado + <FormError> cuando exista.
// Por ahora implementación inline siguiendo el patrón de avatar-cropper-modal.

import { useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  REPORT_REASONS_BY_TARGET,
  REPORT_REASON_LABELS,
  REPORT_TARGET_LABELS,
  type ReportTargetType,
  type ReportReason,
} from "@vicino/shared";

interface ReportModalProps {
  open: boolean;
  onClose: () => void;
  targetType: ReportTargetType;
  targetId: string;
  /** Etiqueta visible del target ("Tacos al pastor", "@usuario", etc). Opcional. */
  targetLabel?: string;
}

const MAX_DESCRIPTION = 500;

export function ReportModal({
  open,
  onClose,
  targetType,
  targetId,
  targetLabel,
}: ReportModalProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const reasons = REPORT_REASONS_BY_TARGET[targetType];
  const targetWord = REPORT_TARGET_LABELS[targetType];

  function reset() {
    setReason(null);
    setDescription("");
    setSubmitting(false);
  }

  function handleClose() {
    if (submitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!reason || submitting) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          reason,
          description: description.trim() || null,
        }),
      });

      if (res.status === 201) {
        toast.success("Gracias. Tu reporte fue enviado y será revisado en 48 horas.");
        reset();
        onClose();
        return;
      }

      let message = "No pudimos enviar tu reporte. Intenta de nuevo.";
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // ignore JSON parse error
      }

      if (res.status === 401) {
        toast.error("Inicia sesión para reportar contenido.");
      } else if (res.status === 409) {
        toast.info(message);
        reset();
        onClose();
      } else if (res.status === 429) {
        toast.error("Has reportado demasiado contenido recientemente. Intenta más tarde.");
      } else {
        toast.error(message);
      }
    } catch {
      toast.error("Error de red. Verifica tu conexión.");
    } finally {
      setSubmitting(false);
    }
  }

  const isCSAM = reason === "child_safety";

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div
        className="bg-card w-full max-w-md rounded-3xl overflow-hidden shadow-2xl border border-border max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-border/60">
          <h2 id="report-modal-title" className="text-lg font-bold text-foreground">
            Reportar {targetWord}
          </h2>
          {targetLabel && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {targetLabel}
            </p>
          )}
        </div>

        {/* Body */}
        <div className="px-6 py-4 space-y-4 overflow-y-auto">
          <fieldset>
            <legend className="text-sm font-medium text-foreground mb-2">
              Motivo
            </legend>
            <div className="space-y-1.5">
              {reasons.map((r) => (
                <label
                  key={r}
                  className="flex items-center gap-3 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-muted/50"
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    disabled={submitting}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm text-foreground">{REPORT_REASON_LABELS[r]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {isCSAM && (
            <div className="flex gap-2 rounded-lg border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-700 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p>
                Este motivo activa <strong>revisión prioritaria</strong>. Si crees que existe un
                riesgo inmediato a un menor, también <strong>denuncia a las autoridades</strong>{" "}
                (Policía Cibernética / FGR).
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="report-description"
              className="text-sm font-medium text-foreground"
            >
              Cuéntanos qué pasó (opcional)
            </label>
            <textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              disabled={submitting}
              rows={3}
              className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50"
              placeholder="Detalles que ayuden a entender el reporte"
            />
            <p className="mt-1 text-xs text-muted-foreground text-right">
              {description.length}/{MAX_DESCRIPTION}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/60 flex items-center justify-end gap-2 bg-card">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="text-sm px-4 py-2 rounded-lg text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!reason || submitting}
            className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Enviar reporte
          </button>
        </div>
      </div>
    </div>
  );
}
