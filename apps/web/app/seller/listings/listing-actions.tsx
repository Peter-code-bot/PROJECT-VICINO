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
    <div className="flex gap-1 sm:gap-2 md:shrink-0 w-full md:w-auto">
      <Link
        href={`/vender/${id}/editar`}
        className="flex flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-1.5 min-w-0 rounded-lg border border-border text-muted-foreground bg-transparent hover:bg-muted hover:text-foreground transition-colors text-[10px] sm:text-xs font-medium"
      >
        <Pencil className="h-3.5 w-3.5 shrink-0" />
        Editar
      </Link>
      <button
        onClick={handleToggle}
        disabled={busy}
        className="flex flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-1.5 min-w-0 rounded-lg border border-brand/40 text-brand bg-transparent hover:bg-brand-tint transition-colors text-[10px] sm:text-xs font-medium disabled:opacity-50"
      >
        {isPaused ? <Play className="h-3.5 w-3.5 shrink-0" /> : <Pause className="h-3.5 w-3.5 shrink-0" />}
        {isPaused ? "Reanudar" : "Pausar"}
      </button>
      <button
        onClick={handleDelete}
        disabled={busy}
        className="flex flex-1 md:flex-none items-center justify-center gap-1 sm:gap-1.5 px-1.5 sm:px-3 py-1.5 min-w-0 rounded-lg border border-danger/30 text-danger bg-transparent hover:bg-danger/10 transition-colors text-[10px] sm:text-xs font-medium disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        Eliminar
      </button>
    </div>
  );
}
