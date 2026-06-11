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
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const isAdmin = currentRoles.includes("admin");
  const isMod = currentRoles.includes("moderator");

  async function handleToggleAdmin() {
    setLoading(true);
    setError(null);
    const res = isAdmin
      ? await removeRole(userId, "admin")
      : await assignRole(userId, "admin");
    if (res && "error" in res && res.error) {
      setError(res.error);
      setLoading(false);
      return;
    }
    router.refresh();
    setLoading(false);
  }

  async function handleToggleMod() {
    setLoading(true);
    setError(null);
    const res = isMod
      ? await removeRole(userId, "moderator")
      : await assignRole(userId, "moderator");
    if (res && "error" in res && res.error) {
      setError(res.error);
      setLoading(false);
      return;
    }
    router.refresh();
    setLoading(false);
  }

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      {error && (
        <p className="text-xs text-destructive max-w-[16rem] text-right">{error}</p>
      )}
      <div className="flex gap-2">
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
    </div>
  );
}
