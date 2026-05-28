"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { cancelAppointment } from "@/app/(marketplace)/citas/[id]/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";

// The cancelAppointment server action predates the { success, error }
// convention used by the rest of the migrated actions and returns the
// legacy { ok, message } shape. This local adapter normalizes the
// response so useOptimisticMutation can detect failures via result.error.
// Action itself is not touched (single call site, behavior unchanged).
async function cancelAppointmentAdapter(
  id: string,
): Promise<{ success?: true; error?: string }> {
  const r = await cancelAppointment(id);
  if (r.ok) return { success: true };
  return { error: r.message ?? "No se pudo cancelar la cita" };
}

export function CancelAppointmentButton({ appointmentId }: { appointmentId: string }) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [optimisticallyCancelled, setOptimisticallyCancelled] = useState(false);

  const { mutate, isPending } = useOptimisticMutation(cancelAppointmentAdapter, {
    onMutate: () => {
      const previousShowConfirm = showConfirm;
      const previousCancelled = optimisticallyCancelled;
      setShowConfirm(false);
      setOptimisticallyCancelled(true);
      return () => {
        setShowConfirm(previousShowConfirm);
        setOptimisticallyCancelled(previousCancelled);
      };
    },
    onSuccess: () => {
      toast.success("Cita cancelada");
    },
    onError: (err) => {
      const message =
        err instanceof Error && err.message
          ? err.message
          : "No se pudo cancelar la cita";
      toast.error(message);
    },
  });

  function handleCancel() {
    void mutate(appointmentId);
  }

  // After the optimistic flip the CTA collapses into a brief confirmation
  // line until the parent page re-renders with the updated status via
  // revalidatePath in the server action (mirrors the Fase 2 pattern where
  // local UI confirms instantly while the source-of-truth catches up).
  if (optimisticallyCancelled) {
    return (
      <div
        role="status"
        className="text-center text-sm text-muted-foreground py-3"
      >
        Cita cancelada · actualizando...
      </div>
    );
  }

  if (!showConfirm) {
    return (
      <button
        onClick={() => setShowConfirm(true)}
        className="w-full inline-flex items-center justify-center gap-2 rounded-full py-3 bg-card border border-destructive/40 text-destructive font-semibold hover:bg-destructive/10 transition-colors"
      >
        <X size={18} />
        Cancelar cita
      </button>
    );
  }

  return (
    <div className="bg-destructive/5 border border-destructive/30 rounded-2xl p-4 space-y-3">
      <p className="text-sm text-foreground font-medium">¿Seguro que quieres cancelar?</p>
      <p className="text-xs text-muted-foreground">Esta acción no se puede deshacer.</p>
      <div className="flex gap-2">
        <button
          onClick={() => setShowConfirm(false)}
          disabled={isPending}
          className="flex-1 rounded-full py-2.5 bg-background border border-border text-foreground font-semibold text-sm hover:bg-muted transition-colors disabled:opacity-50"
        >
          No, mantener
        </button>
        <button
          onClick={handleCancel}
          disabled={isPending}
          className="flex-1 rounded-full py-2.5 bg-destructive text-destructive-foreground font-semibold text-sm hover:bg-destructive/90 transition-colors disabled:opacity-50"
        >
          {isPending ? "Cancelando..." : "Sí, cancelar"}
        </button>
      </div>
    </div>
  );
}
