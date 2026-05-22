"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleProductStatus, deleteProduct } from "@/app/(marketplace)/vender/actions";
import { Pause, Play, Trash2 } from "lucide-react";

interface ListingActionsProps {
  id: string;
  estatus: string;
}

export function ListingActions({ id, estatus }: ListingActionsProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleToggle() {
    setLoading(true);
    const newStatus = estatus === "disponible" ? "pausado" : "disponible";
    await toggleProductStatus(id, newStatus);
    router.refresh();
    setLoading(false);
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar esta publicación? Esta acción no se puede deshacer.")) return;
    setLoading(true);
    await deleteProduct(id);
  }

  const isPaused = estatus === "pausado";

  return (
    <div className="flex gap-2 md:shrink-0 w-full md:w-auto">
      <button
        onClick={handleToggle}
        disabled={loading}
        className="flex flex-1 md:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand/40 text-brand bg-transparent hover:bg-brand-tint transition-colors text-xs font-medium disabled:opacity-50"
      >
        {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        {isPaused ? "Reanudar" : "Pausar"}
      </button>
      <button
        onClick={handleDelete}
        disabled={loading}
        className="flex flex-1 md:flex-none items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-danger/30 text-danger bg-transparent hover:bg-danger/10 transition-colors text-xs font-medium disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Eliminar
      </button>
    </div>
  );
}
