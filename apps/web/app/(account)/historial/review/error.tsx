"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { historialHref, parseHistorialLocation } from "@/lib/historial/navigation";

export default function ReviewError({ reset }: { reset: () => void }) {
  const params = useSearchParams();
  const location = parseHistorialLocation({
    ...Object.fromEntries(params.entries()),
    tab: params.get("tab") ?? (params.get("type") === "buyer_to_seller" ? "compras" : "ventas"),
  });
  return (
    <div role="alert" className="w-full min-w-0 max-w-lg mx-auto px-4 py-6 space-y-4">
      <p>No pudimos cargar los datos de la reseña. Intenta de nuevo.</p>
      <button type="button" onClick={reset} className="min-h-11 text-[color:var(--brand-hi)]">Reintentar</button>
      <Link href={historialHref(location)} className="min-h-11 flex items-center text-[color:var(--brand-hi)]">Volver al historial</Link>
    </div>
  );
}
