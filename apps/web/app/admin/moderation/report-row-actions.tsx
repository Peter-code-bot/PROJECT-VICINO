"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  resolveReport,
  dismissReport,
  suspendUser,
  unsuspendUser,
  unhideListing,
} from "./actions";
import type { ReportTargetType } from "@vicino/shared";

interface ReportRowActionsProps {
  reportId: string;
  targetType: ReportTargetType;
  targetId: string;
  /** Si el target ya está oculto, se muestra "Restaurar" en lugar de "Ocultar" */
  targetHidden?: boolean;
  /** Solo se muestra cuando targetType === 'user' y el actor es admin */
  isAdmin?: boolean;
}

export function ReportRowActions({
  reportId,
  targetType,
  targetId,
  targetHidden = false,
  isAdmin = false,
}: ReportRowActionsProps) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function handle<R extends { error?: string; success?: boolean }>(
    fn: () => Promise<R>,
    successMsg: string
  ) {
    if (busy || pending) return;
    setBusy(true);
    startTransition(async () => {
      const res = await fn();
      setBusy(false);
      if (res.error) toast.error(res.error);
      else {
        toast.success(successMsg);
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <button
        onClick={() => handle(() => resolveReport(reportId, { hideTarget: true }), "Resuelto y ocultado")}
        disabled={busy || pending || targetHidden}
        className="px-2 py-1 rounded-md text-red-600 hover:bg-red-500/10 disabled:opacity-50"
      >
        Resolver y ocultar
      </button>

      {targetType === "listing" && targetHidden && (
        <button
          onClick={() => handle(() => unhideListing(targetId), "Producto restaurado")}
          disabled={busy || pending}
          className="px-2 py-1 rounded-md text-green-600 hover:bg-green-500/10 disabled:opacity-50"
        >
          Restaurar producto
        </button>
      )}

      <button
        onClick={() => handle(() => dismissReport(reportId), "Reporte desestimado")}
        disabled={busy || pending}
        className="px-2 py-1 rounded-md text-muted-foreground hover:bg-muted disabled:opacity-50"
      >
        Desestimar
      </button>

      {targetType === "user" && isAdmin && (
        <>
          {targetHidden ? (
            <button
              onClick={() => handle(() => unsuspendUser(targetId), "Usuario restaurado")}
              disabled={busy || pending}
              className="px-2 py-1 rounded-md text-green-600 hover:bg-green-500/10 disabled:opacity-50"
            >
              Restaurar autor
            </button>
          ) : (
            <button
              onClick={() => handle(() => suspendUser(targetId), "Usuario suspendido")}
              disabled={busy || pending}
              className="px-2 py-1 rounded-md text-red-600 font-semibold hover:bg-red-500/10 disabled:opacity-50"
            >
              Suspender autor
            </button>
          )}
        </>
      )}
    </div>
  );
}
