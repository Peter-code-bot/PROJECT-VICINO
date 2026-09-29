"use client";

import { useRouter } from "next/navigation";
import { BotonRegresar } from "@/components/ui/boton-regresar";
import { resolverDestinoRetornoVender, obtenerOrigenVender, esEntradaDirectaVender } from "@/lib/navigation/retorno-vender";

export default function Loading() {
  const router = useRouter();
  return <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:py-10" aria-busy="true" data-navigation-feedback="sell">
    <BotonRegresar aria-label="Volver" onClick={() => {
      const { destino } = resolverDestinoRetornoVender({
        fromParam: new URLSearchParams(location.search).get("from"), origenGuardado: obtenerOrigenVender(),
        referrer: document.referrer, windowOrigin: location.origin, isDirectHardNav: esEntradaDirectaVender(),
      });
      router.replace(destino);
    }} />
    <h1 className="font-heading text-xl font-bold">Publicar producto</h1>
    <p role="status" className="text-sm text-muted-foreground">Cargando formulario…</p>
    <div aria-hidden="true" className="space-y-4 motion-safe:animate-pulse">
      <div className="h-28 rounded-xl bg-muted" />
      <div className="h-12 rounded-lg bg-muted" />
      <div className="h-24 rounded-lg bg-muted" />
    </div>
  </div>;
}
