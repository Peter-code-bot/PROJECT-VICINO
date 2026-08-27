"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ScrollText, X } from "lucide-react";

export type AvisoLegal = {
  documento: string;
  version: string;
  vigente_desde: string;
  resumen: string;
};

const NOMBRE: Record<string, string> = {
  aviso: "Aviso de Privacidad",
  terminos: "Términos y Condiciones",
};

const RUTA: Record<string, string> = {
  aviso: "/privacidad",
  terminos: "/terminos",
};

const clave = (a: AvisoLegal) => `vicino:aviso-legal:${a.documento}:${a.version}`;

/**
 * La "notificacion visible en la Plataforma" que exige la seccion 18 del Aviso
 * para los cambios sustanciales, con sus 30 dias de anticipacion.
 *
 * QUE SE ANUNCIA Y QUE NO. Solo las versiones marcadas como SUSTANCIALES que
 * todavia no entran en vigor. Las demas no: el documento no lo pide, y un aviso
 * que salta por cada retoque de redaccion deja de leerse — con lo cual el dia
 * que importe, tampoco.
 *
 * SE PUEDE CERRAR, Y ESO ESTA BIEN. Lo que el §18 obliga es a que la
 * notificacion sea visible con antelacion, no a que sea imposible de quitar. El
 * cierre se recuerda por documento Y version, asi que la siguiente version
 * vuelve a anunciarse aunque esta se haya cerrado.
 *
 * La fecha se pinta en el huso del navegador y no en el del servidor: quien lo
 * lee necesita saber cuando le entra en vigor a ELLA.
 */
export function BannerCambioLegal({ avisos }: { avisos: AvisoLegal[] }) {
  const [cerrados, setCerrados] = useState<Set<string>>(new Set());
  // Nada se pinta hasta leer lo ya cerrado. Sin esto, el banner de un aviso ya
  // descartado aparece un instante en cada carga.
  const [listo, setListo] = useState(false);

  useEffect(() => {
    const vistos = new Set<string>();
    try {
      for (const a of avisos) {
        if (window.localStorage.getItem(clave(a)) === "1") vistos.add(clave(a));
      }
    } catch {
      // Modo privado o almacenamiento bloqueado: se muestran todos. Preferimos
      // ensenar de mas un aviso legal que ocultarlo por no poder leer una marca.
    }
    setCerrados(vistos);
    setListo(true);
  }, [avisos]);

  if (!listo) return null;

  const visibles = avisos.filter((a) => !cerrados.has(clave(a)));
  if (visibles.length === 0) return null;

  function cerrar(a: AvisoLegal) {
    try {
      window.localStorage.setItem(clave(a), "1");
    } catch {
      // Sin marca, reaparece en la proxima carga. Molesto, no roto.
    }
    setCerrados((prev) => new Set(prev).add(clave(a)));
  }

  return (
    <div className="space-y-2 px-4 pt-3">
      {visibles.map((a) => (
        <div
          key={clave(a)}
          role="status"
          className="flex items-start gap-3 rounded-2xl bg-[color:var(--card-2)] p-3 shadow-[inset_0_0_0_1px_var(--border)]"
        >
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand)]/10">
            <ScrollText className="h-4 w-4 text-[color:var(--brand)]" />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-[color:var(--fg)]">
              Vamos a actualizar{" "}
              {NOMBRE[a.documento] ?? "nuestros documentos legales"}
            </p>
            <p className="mt-0.5 text-[color:var(--fg-muted)]">{a.resumen}</p>
            <p className="mt-1 text-xs text-[color:var(--fg-muted)]">
              Entra en vigor el{" "}
              <strong className="text-[color:var(--fg)]">
                {new Date(a.vigente_desde).toLocaleDateString("es-MX", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              .{" "}
              <Link
                href={RUTA[a.documento] ?? "/privacidad"}
                className="font-semibold text-[color:var(--brand)] underline"
              >
                Leer el documento
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={() => cerrar(a)}
            aria-label="Cerrar el aviso"
            className="shrink-0 rounded-full p-1 text-[color:var(--fg-dim)] transition-colors hover:text-[color:var(--fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
