"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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

  async function handleToggleAdmin() {
    setLoading(true);
    if (isAdmin) {
      await removeRole(userId, "admin");
    } else {
      await assignRole(userId, "admin");
    }
    router.refresh();
    setLoading(false);
  }

  async function handleToggleMod() {
    setLoading(true);
    if (isMod) {
      await removeRole(userId, "moderator");
    } else {
      await assignRole(userId, "moderator");
    }
    router.refresh();
    setLoading(false);
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
