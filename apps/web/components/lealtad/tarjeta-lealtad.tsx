import { cn } from "@/lib/utils";

/**
 * La tarjeta tal como se ve en la app y, aproximadamente, en las carteras.
 * Es solo presentacion (sin hooks): la usan el formulario del negocio como
 * vista previa en vivo, la lista y el detalle del cliente.
 *
 * "3 de 5" es el dato canonico (PDF, seccion 2); la cuadricula de sellos es
 * una mejora visual que depende de la plantilla. Las dos Wallets controlan su
 * propia presentacion: esto no promete una imagen identica.
 */
export interface TarjetaLealtadProps {
  negocio: string;
  nombre: string;
  premio: string;
  metaSellos: number;
  sellos: number;
  color: string;
  plantilla: string;
  titular?: string | null;
  estilo?: "apple" | "google";
  className?: string;
}

export function TarjetaLealtad({
  negocio,
  nombre,
  premio,
  metaSellos,
  sellos,
  color,
  plantilla,
  titular,
  estilo = "apple",
  className,
}: TarjetaLealtadProps) {
  const meta = Math.max(1, metaSellos);
  const llenos = Math.max(0, Math.min(sellos, meta));
  const conCuadricula = plantilla !== "minimal";
  const columnas = Math.min(meta, plantilla === "sellos" ? 5 : 10);

  return (
    <div
      className={cn(
        "relative overflow-hidden text-white shadow-[0_12px_30px_rgba(0,0,0,0.18)]",
        estilo === "google" ? "rounded-2xl" : "rounded-[22px]",
        className,
      )}
      style={{ backgroundColor: color }}
      aria-label={`Tarjeta de ${negocio}: ${llenos} de ${meta} sellos`}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-4 text-[11px] font-semibold uppercase tracking-[0.12em] opacity-90">
        <span className="truncate">{negocio}</span>
        <span className="shrink-0">{estilo === "google" ? "Google Wallet" : "Apple Wallet"}</span>
      </div>

      <div className="px-5 pb-1 pt-3">
        <p className="truncate font-heading text-lg font-bold leading-tight">{nombre}</p>
        <p className="mt-1 line-clamp-2 text-sm opacity-90">{premio}</p>
      </div>

      <div className="flex items-end justify-between gap-3 px-5 pb-4 pt-2">
        <div>
          <p className="text-[11px] uppercase tracking-wider opacity-80">Sellos</p>
          <p className="font-heading text-3xl font-extrabold leading-none tabular-nums">
            {llenos} <span className="text-base font-semibold opacity-80">de {meta}</span>
          </p>
        </div>
        {titular ? (
          <div className="min-w-0 text-right">
            <p className="text-[11px] uppercase tracking-wider opacity-80">Titular</p>
            <p className="max-w-[9rem] truncate text-sm font-semibold">{titular}</p>
          </div>
        ) : null}
      </div>

      {conCuadricula ? (
        <div
          className={cn("grid px-5 pb-5", plantilla === "sellos" ? "gap-2" : "gap-1.5")}
          style={{ gridTemplateColumns: `repeat(${columnas}, minmax(0, 1fr))` }}
          aria-hidden
        >
          {Array.from({ length: meta }, (_, i) => (
            <span
              key={i}
              className={cn(
                "rounded-full border border-white/70",
                plantilla === "sellos" ? "aspect-square" : "h-2.5",
                i < llenos ? "bg-white" : "bg-white/15",
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
