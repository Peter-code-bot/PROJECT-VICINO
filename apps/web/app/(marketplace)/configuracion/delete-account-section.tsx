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
      <div className="rounded-xl bg-[rgba(255,59,48,0.08)] p-4 shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]">
        <p className="mb-1 text-sm font-semibold text-[color:var(--fg)]">
          ¿Eliminar tu cuenta permanentemente?
        </p>
        <p className="mb-4 text-xs text-[color:var(--fg-muted)]">
          Esta acción es irreversible. Se borrarán tu perfil, publicaciones,
          chats, reseñas y todos tus datos.
        </p>
        <p className="mb-2 text-xs font-medium text-[color:var(--fg)]">
          Escribe{" "}
          <span className="font-mono font-bold text-[color:var(--danger)]">
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
          className="mb-4 w-full rounded-lg bg-[color:var(--card-2)] px-3 py-2 text-sm font-mono text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] placeholder:text-[color:var(--fg-dim)] focus:outline-none focus:shadow-[inset_0_0_0_1px_rgba(255,59,48,0.45)] disabled:opacity-50"
          aria-label="Escribe ELIMINAR para confirmar"
        />
        {error && (
          <p className="mb-3 text-xs text-[color:var(--danger)]">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            onClick={handleDelete}
            disabled={loading || inputValue !== CONFIRM_WORD}
            aria-label="Confirmar eliminación de cuenta"
            className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--danger)] px-4 py-2 text-sm font-semibold text-white transition-[filter] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
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
            className="inline-flex items-center rounded-lg bg-[color:var(--card-2)] px-4 py-2 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] disabled:opacity-50"
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
      className="flex w-full items-center gap-3 rounded-xl bg-[color:var(--sidebar-bg)] px-4 py-3 text-sm font-medium text-[color:var(--danger)] transition-colors hover:bg-[color:var(--danger)]/10"
    >
      <Trash2 className="h-4 w-4" />
      Eliminar mi cuenta
    </button>
  );
}
