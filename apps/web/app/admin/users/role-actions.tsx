"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { assignRole, removeRole } from "./actions";
import { Shield, ShieldCheck } from "lucide-react";

interface RoleActionsProps {
  userId: string;
  currentRoles: string[];
}

export function RoleActions({ userId, currentRoles }: RoleActionsProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const isAdmin = currentRoles.includes("admin");
  const isMod = currentRoles.includes("moderator");

  async function toggleRole(role: "admin" | "moderator", tieneRol: boolean) {
    setLoading(true);
    const res = tieneRol
      ? await removeRole(userId, role)
      : await assignRole(userId, role);
    setLoading(false);
    // Descartar el retorno hacia que un fallo (rate limit, RLS) se viera igual
    // que un exito: la pantalla se refrescaba con los mismos roles y no habia
    // forma de saber si el cambio no se aplico o si ya estaba asi.
    if (res && "error" in res && res.error) {
      toast.error(res.error);
      return;
    }
    router.refresh();
  }

  async function handleToggleAdmin() {
    await toggleRole("admin", isAdmin);
  }

  async function handleToggleMod() {
    await toggleRole("moderator", isMod);
  }

  return (
    <div className="flex gap-2 shrink-0">
      <button
        onClick={handleToggleAdmin}
        disabled={loading}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Shield className="w-3 h-3" />
        {isAdmin ? "Quitar Admin" : "Hacer Admin"}
      </button>
      <button
        onClick={handleToggleMod}
        disabled={loading}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <ShieldCheck className="w-3 h-3" />
        {isMod ? "Quitar Mod" : "Hacer Mod"}
      </button>
    </div>
  );
}
