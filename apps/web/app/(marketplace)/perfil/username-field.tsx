"use client";

import { useState } from "react";
import { setUsername } from "./actions";

/**
 * Campo del @ publico.
 *
 * Va aparte del formulario grande del perfil porque son dos acciones de
 * servidor distintas y un <form> solo admite una. Ademas sus errores son de
 * otra naturaleza: "ya esta en uso" pide escribir otra cosa, no reintentar.
 *
 * Ensena tambien el identificador interno. No es adorno: es lo que ve
 * moderacion, no cambia nunca, y es lo que hay que citar en un reporte.
 */
export function UsernameField({
  inicial,
  userId,
}: {
  inicial: string | null | undefined;
  userId: string | null | undefined;
}) {
  const guardado = inicial ?? "";
  const [valor, setValor] = useState(guardado);
  const [editando, setEditando] = useState(false);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [confirmado, setConfirmado] = useState(false);

  const sinCambios = valor.trim() === guardado;

  async function guardar() {
    setError("");
    setConfirmado(false);
    setGuardando(true);
    const datos = new FormData();
    datos.set("username", valor.trim());
    const r = await setUsername(datos);
    setGuardando(false);

    if (r.error) {
      setError(r.error);
      return;
    }
    // Se refleja lo que devolvio el servidor, no lo que se tecleo: es el
    // valor que quedo escrito de verdad.
    if (r.username) setValor(r.username);
    setConfirmado(true);
    setEditando(false);
  }

  if (!editando) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted-foreground bg-muted px-2 py-1 rounded-md">
          @{valor || "—"}
        </span>
        <button
          type="button"
          onClick={() => setEditando(true)}
          className="text-xs text-primary hover:underline"
        >
          Cambiar
        </button>
        {confirmado && (
          <span className="text-xs text-green-600" role="status">
            Guardado
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">@</span>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          maxLength={30}
          autoFocus
          aria-label="Nombre de usuario"
          aria-invalid={error ? true : undefined}
          className="w-40 text-xs font-mono px-2 py-1 rounded-md bg-muted border border-border/40"
        />
        <button
          type="button"
          onClick={guardar}
          disabled={guardando || sinCambios}
          className="text-xs text-primary hover:underline disabled:opacity-40"
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={() => {
            setValor(guardado);
            setError("");
            setEditando(false);
          }}
          className="text-xs text-muted-foreground hover:underline"
        >
          Cancelar
        </button>
      </div>
      {error && (
        <p className="text-xs text-destructive max-w-[16rem] text-right" role="alert">
          {error}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        3 a 30 caracteres · letras, numeros y guion bajo · ID interno: {userId ?? "—"}
      </p>
    </div>
  );
}
