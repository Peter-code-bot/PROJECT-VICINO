"use client";

import { useState } from "react";
import Link from "next/link";
import { toggleProductStatus, deleteProduct } from "@/app/(marketplace)/vender/actions";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { Pencil, Eye, EyeOff, Trash2 } from "lucide-react";

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
    <div className="flex items-center gap-2 shrink-0">
      {/* Editar (Lápiz) -> VERDE */}
      <Link
        href={`/vender/${id}/editar`}
        className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-10 rounded-xl text-white bg-[#4A7970] hover:opacity-90 active:scale-95 transition-all shadow-xs shrink-0"
        title="Editar"
        aria-label="Editar publicación"
      >
        <Pencil className="h-4 w-4 shrink-0" />
      </Link>

      {/* Ocultar (Ojito diagonal) -> NEGRO */}
      <button
        type="button"
        onClick={handleToggle}
        disabled={busy}
        className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-10 rounded-xl text-white bg-[#1E222E] hover:opacity-90 active:scale-95 transition-all shadow-xs disabled:opacity-50 shrink-0"
        title={isPaused ? "Mostrar publicación" : "Ocultar publicación"}
        aria-label={isPaused ? "Mostrar publicación" : "Ocultar publicación"}
      >
        {isPaused ? (
          <Eye className="h-4 w-4 shrink-0" />
        ) : (
          <EyeOff className="h-4 w-4 shrink-0" />
        )}
      </button>

      {/* Eliminar (Basurero) -> ROJO */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy}
        className="flex items-center justify-center w-10 h-10 sm:w-11 sm:h-10 rounded-xl text-white bg-[#D6544D] hover:opacity-90 active:scale-95 transition-all shadow-xs disabled:opacity-50 shrink-0"
        title="Eliminar"
        aria-label="Eliminar publicación"
      >
        <Trash2 className="h-4 w-4 shrink-0" />
      </button>
    </div>
  );
}
