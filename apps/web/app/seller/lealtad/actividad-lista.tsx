"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { formatDate } from "@vicino/shared";
import { revertirEvento } from "./actions";

interface EventoActividad {
  id: string;
  tipo: "earn" | "redeem" | "reverse" | "adjust";
  sellos: number;
  motivo: string | null;
  created_at: string;
  cliente: string;
  revertido: boolean;
}

interface ActividadListaProps {
  eventos: EventoActividad[];
}

const TITULOS: Record<EventoActividad["tipo"], string> = {
  earn: "Sello por compra",
  redeem: "Premio canjeado",
  reverse: "Reversa",
  adjust: "Ajuste",
};

export function ActividadLista({ eventos }: ActividadListaProps) {
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [enCurso, iniciar] = useTransition();

  if (eventos.length === 0) {
    return (
      <p className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-6 text-center text-sm text-[color:var(--fg-muted)]">
        Todavía no hay movimientos. Aparecerán cuando tus clientes se unan y compren.
      </p>
    );
  }

  function revertir(id: string) {
    iniciar(async () => {
      const resultado = await revertirEvento(id, motivo);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Movimiento revertido");
      setAbierto(null);
      setMotivo("");
      router.refresh();
    });
  }

  return (
    <ul className="space-y-2">
      {eventos.map((e) => {
        const reversible = (e.tipo === "earn" || e.tipo === "redeem") && !e.revertido;
        return (
          <li key={e.id} className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-semibold text-[color:var(--fg)]">
                  {e.cliente} · {TITULOS[e.tipo]}
                  {e.revertido ? <span className="ml-1 text-xs font-normal text-[color:var(--fg-muted)]">(revertido)</span> : null}
                </p>
                <p className="truncate text-xs text-[color:var(--fg-muted)]">
                  {formatDate(e.created_at)}
                  {e.motivo ? ` · ${e.motivo}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`font-heading text-base font-bold tabular-nums ${e.sellos > 0 ? "text-[color:var(--fg)]" : "text-[color:var(--fg-muted)]"}`}>
                  {e.sellos > 0 ? `+${e.sellos}` : e.sellos}
                </span>
                {reversible ? (
                  <button
                    type="button"
                    onClick={() => { setAbierto(abierto === e.id ? null : e.id); setMotivo(""); }}
                    className="rounded-[var(--r-pill)] border border-[color:var(--border)] px-2.5 py-1 text-xs font-medium text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
                  >
                    Revertir
                  </button>
                ) : null}
              </div>
            </div>
            {abierto === e.id ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  value={motivo}
                  onChange={(ev) => setMotivo(ev.target.value.slice(0, 200))}
                  placeholder="Motivo (opcional, lo verá el cliente)"
                  maxLength={200}
                  className="w-full rounded-[var(--r-md)] border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] outline-none focus:ring-2 focus:ring-[color:var(--brand)]"
                />
                <button
                  type="button"
                  onClick={() => revertir(e.id)}
                  disabled={enCurso}
                  className="rounded-[var(--r-pill)] bg-[color:var(--fg)] px-4 py-2 text-xs font-semibold text-[color:var(--bg)] hover:opacity-90 disabled:opacity-60"
                >
                  {enCurso ? "Revirtiendo…" : "Confirmar reversa"}
                </button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
