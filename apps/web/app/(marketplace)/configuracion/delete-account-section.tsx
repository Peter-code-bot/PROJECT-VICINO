"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { deleteAccount } from "./actions";

const CONFIRM_WORD = "ELIMINAR";

export function DeleteAccountSection() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setLoading(true);
    setError(null);

    const result = await deleteAccount();

    if (result.error) {
      setError(result.error);
      setLoading(false);
      return;
    }

    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/");
  }

  if (confirming) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-800 p-4 bg-red-50/50 dark:bg-red-950/10">
        <p className="text-sm font-medium text-foreground mb-1">
          ¿Eliminar tu cuenta permanentemente?
        </p>
        <p className="text-xs text-muted-foreground mb-4">
          Esta acción es irreversible. Se borrarán tu perfil, publicaciones,
          chats, reseñas y todos tus datos.
        </p>
        <p className="text-xs font-medium text-foreground mb-2">
          Escribe{" "}
          <span className="font-mono font-bold text-red-600 dark:text-red-400">
            {CONFIRM_WORD}
          </span>{" "}
          para confirmar:
        </p>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          disabled={loading}
          placeholder={CONFIRM_WORD}
          className="w-full mb-4 px-3 py-2 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-red-400 disabled:opacity-50"
          aria-label="Escribe ELIMINAR para confirmar"
        />
        {error && (
          <p className="text-xs text-red-600 dark:text-red-400 mb-3">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={loading || inputValue !== CONFIRM_WORD}
            aria-label="Confirmar eliminación de cuenta"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Trash2 className="h-4 w-4" />
            {loading ? "Eliminando..." : "Sí, eliminar mi cuenta"}
          </button>
          <button
            onClick={() => {
              setConfirming(false);
              setInputValue("");
              setError(null);
            }}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-border hover:bg-muted text-sm font-medium transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      aria-label="Eliminar mi cuenta"
      className="flex items-center gap-3 w-full rounded-xl border border-red-200 dark:border-red-800 px-4 py-3 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
    >
      <Trash2 className="h-4 w-4" />
      Eliminar mi cuenta
    </button>
  );
}
