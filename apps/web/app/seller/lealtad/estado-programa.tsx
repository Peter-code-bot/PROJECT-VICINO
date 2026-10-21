"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cambiarEstadoPrograma } from "./actions";

interface EstadoProgramaProps {
  status: string;
}

/** Publicar / Pausar / Reanudar. La transicion la valida la base. */
export function EstadoPrograma({ status }: EstadoProgramaProps) {
  const router = useRouter();
  const [enCurso, iniciar] = useTransition();
  const [confirmandoPausa, setConfirmandoPausa] = useState(false);

  function cambiar(estado: "activo" | "pausado") {
    iniciar(async () => {
      const resultado = await cambiarEstadoPrograma(estado);
      if (resultado.error) {
        toast.error(resultado.error);
        return;
      }
      setConfirmandoPausa(false);
      toast.success(estado === "activo" ? "Programa activo" : "Programa en pausa");
      router.refresh();
    });
  }

  const base =
    "inline-flex items-center justify-center rounded-[var(--r-pill)] px-4 py-2.5 text-sm font-semibold transition-opacity disabled:opacity-60";
  const primario = `${base} bg-[color:var(--fg)] text-[color:var(--bg)] hover:opacity-90`;
  const secundario = `${base} border border-[color:var(--border)] text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]`;

  if (status === "borrador") {
    return (
      <button type="button" onClick={() => cambiar("activo")} disabled={enCurso} className={primario}>
        {enCurso ? "Publicando…" : "Publicar programa"}
      </button>
    );
  }
  if (status === "pausado") {
    return (
      <button type="button" onClick={() => cambiar("activo")} disabled={enCurso} className={primario}>
        {enCurso ? "Reanudando…" : "Reanudar programa"}
      </button>
    );
  }
  if (status !== "activo") return null;

  if (!confirmandoPausa) {
    return (
      <button type="button" onClick={() => setConfirmandoPausa(true)} disabled={enCurso} className={secundario}>
        Pausar programa
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-[color:var(--fg)]">¿Pausar? Nadie nuevo podrá unirse ni sumar sellos.</span>
      <button type="button" onClick={() => cambiar("pausado")} disabled={enCurso} className={primario}>
        {enCurso ? "Pausando…" : "Sí, pausar"}
      </button>
      <button type="button" onClick={() => setConfirmandoPausa(false)} disabled={enCurso} className={secundario}>
        Cancelar
      </button>
    </div>
  );
}
