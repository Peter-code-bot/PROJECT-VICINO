"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { approveVerification, rejectVerification } from "./actions";

export function VerificationActions({ id, userId }: { id: string; userId: string }) {
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [showReject, setShowReject] = useState(false);
  const router = useRouter();

  function run<R extends { error?: string; success?: boolean }>(
    fn: () => Promise<R>,
    successMsg: string,
    onSuccess?: () => void,
  ) {
    if (busy || pending) return;
    setBusy(true);
    startTransition(async () => {
      const res = await fn();
      setBusy(false);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(successMsg);
      onSuccess?.();
      router.refresh();
    });
  }

  function handleApprove() {
    run(() => approveVerification(id, userId), "Verificación aprobada");
  }

  function handleReject() {
    run(
      () => rejectVerification(id, note),
      "Verificación rechazada",
      () => setShowReject(false),
    );
  }

  const loading = busy || pending;

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          disabled={loading}
          className="rounded-md bg-green-600 text-white px-3 py-1.5 text-xs font-medium hover:bg-green-700 disabled:opacity-50"
        >
          Aprobar
        </button>
        <button
          onClick={() => setShowReject(!showReject)}
          disabled={loading}
          className="rounded-md border px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50"
        >
          Rechazar
        </button>
      </div>
      {showReject && (
        <div className="flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Motivo del rechazo..."
            className="flex-1 rounded-md border bg-background px-2 py-1.5 text-xs"
          />
          <button
            onClick={handleReject}
            disabled={loading}
            className="rounded-md bg-red-600 text-white px-3 py-1.5 text-xs disabled:opacity-50"
          >
            Confirmar rechazo
          </button>
        </div>
      )}
    </div>
  );
}
