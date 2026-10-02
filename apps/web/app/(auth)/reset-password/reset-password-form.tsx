"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cambiarPasswordRecuperada } from "../actions";
import { conTope } from "@/lib/auth/con-tope";
import { limpiarCorreoAuth } from "@/lib/auth/contexto-temporal";

export function ResetPasswordForm({ destino }: { destino: string }) {
  const router = useRouter();
  const lock = useRef(false);
  const [password, setPassword] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  return <form className="space-y-4" onSubmit={async event => {
    event.preventDefault();
    if (lock.current) return;
    if (password !== confirmar) { setError("Las contraseñas no coinciden."); return; }
    lock.current = true; setLoading(true); setError("");
    try {
      const result = await conTope(cambiarPasswordRecuperada(password, destino));
      if (result.error) { setError(result.error); return; }
      limpiarCorreoAuth();
      router.replace(result.destino ?? "/"); router.refresh();
    } catch { setError("No pudimos cambiar tu contraseña. Revisa tu conexión e intenta de nuevo."); }
    finally { lock.current = false; setLoading(false); }
  }}>
    {error && <p role="alert" className="text-danger">{error}</p>}
    <label className="block text-sm">Nueva contraseña<input type="password" autoComplete="new-password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-auth-input px-4" /></label>
    <label className="block text-sm">Confirmar contraseña<input type="password" autoComplete="new-password" required minLength={6} value={confirmar} onChange={e => setConfirmar(e.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-auth-input px-4" /></label>
    <button disabled={loading} type="submit" className="min-h-12 w-full rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground">{loading ? "Guardando…" : "Guardar contraseña y continuar"}</button>
  </form>;
}
