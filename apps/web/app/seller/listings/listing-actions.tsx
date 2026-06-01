"use client";

import { useState } from "react";
import Link from "next/link";
import { toggleProductStatus, deleteProduct } from "@/app/(marketplace)/vender/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { Pause, Pencil, Play, Trash2 } from "lucide-react";

interface ListingActionsProps {
  id: string;
  estatus: string;
}

type ToggleArgs = { id: string; newStatus: "disponible" | "pausado" };

export function ListingActions({ id, estatus: initialEstatus }: ListingActionsProps) {
  const [estatus, setEstatus] = useState(initialEstatus);
  const [deleting, setDeleting] = useState(false);

  const { mutate: toggleStatus, isPending: toggling } = useOptimisticMutation(
    ({ id, newStatus }: ToggleArgs) => toggleProductStatus(id, newStatus),
    {
      onMutate: ({ newStatus }) => {
        const previous = estatus;
        setEstatus(newStatus);
        return () => setEstatus(previous);
      },
      // No reconciliation: the server confirms exactly the newStatus we
      // requested or returns { error }, which triggers the rollback above.
    },
  );

  async function handleToggle() {
    const newStatus = estatus === "disponible" ? "pausado" : "disponible";
    await toggleStatus({ id, newStatus });
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar esta publicación? Esta acción no se puede deshacer.")) return;
    setDeleting(true);
    await deleteProduct(id);
  }

  const isPaused = estatus === "pausado";
  const busy = toggling || deleting;

  return (
    <div className="flex gap-2 shrink-0">
      <Link
        href={`/vender/${id}/editar`}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 min-w-0 rounded-lg border border-border text-muted-foreground bg-transparent hover:bg-muted hover:text-foreground transition-colors sm:text-xs font-medium shrink-0"
        title="Editar"
      >
        <Pencil className="h-4 w-4 shrink-0" />
      </Link>
      <button
        onClick={handleToggle}
        disabled={busy}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 min-w-0 rounded-lg border border-brand/40 text-brand bg-transparent hover:bg-brand-tint transition-colors sm:text-xs font-medium disabled:opacity-50 shrink-0"
        title={isPaused ? "Reanudar" : "Pausar"}
      >
        {isPaused ? <Play className="h-4 w-4 shrink-0" /> : <Pause className="h-4 w-4 shrink-0" />}
      </button>
      <button
        onClick={handleDelete}
        disabled={busy}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 min-w-0 rounded-lg border border-danger/30 text-danger bg-transparent hover:bg-danger/10 transition-colors sm:text-xs font-medium disabled:opacity-50 shrink-0"
        title="Eliminar"
      >
        <Trash2 className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
}
