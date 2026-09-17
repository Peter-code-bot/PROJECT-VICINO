"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { assignRole, removeRole } from "./actions";
import { Shield, ShieldCheck, Loader2 } from "lucide-react";

interface RoleActionsProps {
  userId: string;
  currentRoles: string[];
}

/** El movimiento que espera la clave de seguridad. */
interface Pendiente {
  rol: "admin" | "moderator";
  tieneRol: boolean;
}

export function RoleActions({ userId, currentRoles }: RoleActionsProps) {
  const [loading, setLoading] = useState(false);
  const [pendiente, setPendiente] = useState<Pendiente | null>(null);
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const claveRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const isAdmin = currentRoles.includes("admin");
  const isMod = currentRoles.includes("moderator");

  // Foco en el campo al abrir, y Escape cierra: es un dialogo, y quien
  // administra lo va a abrir muchas veces.
  useEffect(() => {
    if (!pendiente) return;
    claveRef.current?.focus();
    const alTeclear = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !loading) cerrar();
    };
    document.addEventListener("keydown", alTeclear);
    return () => document.removeEventListener("keydown", alTeclear);
  }, [pendiente, loading]);

  function cerrar() {
    setPendiente(null);
    setClave("");
    setError(null);
  }

  async function confirmar() {
    if (!pendiente || loading) return;
    setLoading(true);
    setError(null);
    const res = pendiente.tieneRol
      ? await removeRole(userId, pendiente.rol, clave)
      : await assignRole(userId, pendiente.rol, clave);
    setLoading(false);
    // Descartar el retorno hacia que un fallo (rate limit, RLS) se viera igual
    // que un exito: la pantalla se refrescaba con los mismos roles y no habia
    // forma de saber si el cambio no se aplico o si ya estaba asi.
    if (res && "error" in res && res.error) {
      // El error se queda DENTRO del dialogo, no en un toast que desaparece:
      // si la clave estaba mal, hay que poder corregirla sin volver a empezar.
      setError(res.error);
      return;
    }
    cerrar();
    toast.success(
      pendiente.tieneRol
        ? `Rol ${etiqueta(pendiente.rol)} retirado.`
        : `Rol ${etiqueta(pendiente.rol)} concedido.`,
    );
    router.refresh();
  }

  const accion = pendiente
    ? `${pendiente.tieneRol ? "Quitar" : "Conceder"} ${etiqueta(pendiente.rol)}`
    : "";

  return (
    <div className="flex gap-2 shrink-0">
      <button
        onClick={() => setPendiente({ rol: "admin", tieneRol: isAdmin })}
        disabled={loading}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <Shield className="w-3 h-3" />
        {isAdmin ? "Quitar Admin" : "Hacer Admin"}
      </button>
      <button
        onClick={() => setPendiente({ rol: "moderator", tieneRol: isMod })}
        disabled={loading}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
      >
        <ShieldCheck className="w-3 h-3" />
        {isMod ? "Quitar Mod" : "Hacer Mod"}
      </button>

      {pendiente && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar acción de seguridad"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={() => { if (!loading) cerrar(); }}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-[0_8px_40px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="font-heading text-lg font-bold text-foreground">
              Confirmar acción de seguridad
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {accion} para esta cuenta. Escribe la clave de seguridad del panel para continuar.
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                void confirmar();
              }}
            >
              <input
                ref={claveRef}
                type="password"
                value={clave}
                onChange={(event) => setClave(event.target.value)}
                autoComplete="off"
                aria-label="Clave de seguridad del panel"
                placeholder="Clave de seguridad"
                className="w-full rounded-xl bg-[color:var(--card-2)] px-3 py-2.5 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-hi)]"
              />
              {error && (
                <p role="alert" className="text-sm text-[color:var(--danger)]">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cerrar}
                  disabled={loading}
                  className="flex-1 rounded-xl bg-[color:var(--card-2)] px-4 py-2.5 text-sm font-semibold text-foreground shadow-[inset_0_0_0_1px_var(--border)] disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading || clave.length === 0}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--brand)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {loading ? "Aplicando…" : "Confirmar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function etiqueta(rol: "admin" | "moderator"): string {
  return rol === "admin" ? "Admin" : "Moderador";
}
