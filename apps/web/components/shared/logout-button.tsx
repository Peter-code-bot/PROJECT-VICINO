"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

interface LogoutButtonProps {
  variant?: "default" | "sidebar" | "mobile";
  className?: string;
}

export function LogoutButton({ variant = "default", className }: LogoutButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogout() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  }

  if (variant === "sidebar") {
    return (
      <button
        onClick={handleLogout}
        disabled={loading}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors w-full",
          className
        )}
      >
        <LogOut className="h-4 w-4" />
        {loading ? "Cerrando..." : "Cerrar sesión"}
      </button>
    );
  }

  if (variant === "mobile") {
    return (
      <button
        onClick={handleLogout}
        disabled={loading}
        className={cn(
          "flex flex-col items-center gap-0.5 py-2 px-1 min-w-[56px] text-red-500",
          className
        )}
      >
        <LogOut className="h-5 w-5" />
        <span className="text-[10px] font-medium">{loading ? "..." : "Salir"}</span>
      </button>
    );
  }

  return (
    <button
      onClick={handleLogout}
      disabled={loading}
      className={cn(
        "flex items-center justify-center gap-2 w-full rounded-xl border border-red-200 dark:border-red-800 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50",
        className
      )}
    >
      <LogOut className="h-4 w-4" />
      {loading ? "Cerrando sesión..." : "Cerrar sesión"}
    </button>
  );
}
