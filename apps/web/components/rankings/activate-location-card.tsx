"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeolocation } from "@/hooks/useGeolocation";

export function ActivateLocationCard() {
  const router = useRouter();
  const { state, request } = useGeolocation();
  // Solo el toque de esta tarjeta refresca. useGeolocation tambien pasa a
  // `success` al montar (si ya habia zona) y con cada etiqueta nueva; un efecto
  // que reaccionara a cualquier `success` refrescaria sin que nadie pidiera nada.
  const pidioUbicacion = useRef(false);

  useEffect(() => {
    if (!pidioUbicacion.current) return;
    if (state.status === "error") {
      pidioUbicacion.current = false;
      return;
    }
    if (state.status !== "success") return;
    pidioUbicacion.current = false;
    // La cookie ya esta escrita (writeLocation la confirma antes de dar
    // `success`): /rankings la lee en el servidor, asi que basta con volver a
    // pintar la ruta. Antes se hacia router.replace con lat/lng en la URL, que
    // dejaba la zona en el historial, en los registros y en Sentry (PDF 05).
    // Si la zona cambio, el proveedor de sesion tambien refresca; esto cubre el
    // caso en que writeLocation no avisa porque la cookie no cambio.
    router.refresh();
  }, [state, router]);

  const activar = () => {
    pidioUbicacion.current = true;
    request();
  };

  const isLoading = state.status === "loading";
  const errorMessage = state.status === "error" ? state.message : null;

  return (
    <section className="mx-4 mt-8 rounded-xl border border-border bg-card p-6 text-center">
      <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MapPin className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 font-display text-xl font-semibold text-foreground">
        Activa tu ubicación
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Para ver el ranking de los mejores vendedores cerca de ti, necesitamos
        saber dónde estás. No guardamos tus coordenadas.
      </p>
      <div className="mt-5">
        <Button
          type="button"
          onClick={activar}
          loading={isLoading}
          variant="primary"
          size="md"
        >
          {isLoading ? "Detectando…" : "Activar ubicación"}
        </Button>
      </div>
      {errorMessage ? (
        <p className="mt-3 text-xs text-destructive">{errorMessage}</p>
      ) : null}
    </section>
  );
}
