"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { inscribirse } from "@/app/(marketplace)/tarjetas/actions";

interface UnirmeBotonProps {
  programId: string;
}

export function UnirmeBoton({ programId }: UnirmeBotonProps) {
  const router = useRouter();
  const [enCurso, iniciar] = useTransition();

  function unirse() {
    iniciar(async () => {
      const resultado = await inscribirse(programId);
      if (resultado.error || !resultado.membershipId) {
        toast.error(resultado.error ?? "No se pudo crear tu tarjeta.");
        return;
      }
      toast.success("Ya tienes tu tarjeta");
      router.push(`/tarjetas/${resultado.membershipId}`);
    });
  }

  return (
    <button
      type="button"
      onClick={unirse}
      disabled={enCurso}
      className="inline-flex items-center justify-center whitespace-nowrap rounded-[var(--r-pill)] bg-[color:var(--fg)] px-3.5 py-2 text-xs font-semibold text-[color:var(--bg)] hover:opacity-90 disabled:opacity-60"
    >
      {enCurso ? "Creando…" : "Unirme"}
    </button>
  );
}
