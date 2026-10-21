"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { confirmarCanje } from "./actions";

interface ConfirmarCanjeFormProps {
  deshabilitado?: boolean;
}

export function ConfirmarCanjeForm({ deshabilitado = false }: ConfirmarCanjeFormProps) {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [resultado, setResultado] = useState<{ cliente?: string; premio?: string; repetido?: boolean } | null>(null);
  const [error, setError] = useState("");
  const [enCurso, iniciar] = useTransition();

  function enviar(evento: React.FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    setError("");
    setResultado(null);
    iniciar(async () => {
      const respuesta = await confirmarCanje(codigo);
      if (respuesta.error) {
        setError(respuesta.error);
        return;
      }
      setResultado({ cliente: respuesta.cliente, premio: respuesta.premio, repetido: respuesta.repetido });
      setCodigo("");
      toast.success(respuesta.repetido ? "Ese canje ya estaba confirmado" : "Canje confirmado");
      router.refresh();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="Código de 6 dígitos"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
          disabled={deshabilitado || enCurso}
          aria-label="Código de canje"
          className="w-full rounded-[var(--r-md)] border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-[color:var(--fg)] outline-none focus:ring-2 focus:ring-[color:var(--brand)] disabled:opacity-60 sm:max-w-[220px]"
        />
        <button
          type="submit"
          disabled={deshabilitado || enCurso || codigo.length !== 6}
          className="rounded-[var(--r-pill)] bg-[color:var(--fg)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bg)] hover:opacity-90 disabled:opacity-60"
        >
          {enCurso ? "Confirmando…" : "Confirmar canje"}
        </button>
      </div>
      {deshabilitado ? (
        <p className="text-xs text-[color:var(--fg-muted)]">Publica el programa para poder confirmar canjes.</p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-[var(--r-md)] bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {resultado ? (
        <p role="status" className="rounded-[var(--r-md)] bg-[color:var(--bg-elev-2)] px-3 py-2 text-sm text-[color:var(--fg)]">
          {resultado.repetido ? "Ya confirmado: " : "Entrega "}
          <strong>{resultado.premio}</strong> a <strong>{resultado.cliente ?? "tu cliente"}</strong>.
        </p>
      ) : null}
    </form>
  );
}
