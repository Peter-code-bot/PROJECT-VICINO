"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGeolocation } from "@/hooks/useGeolocation";

export function ActivateLocationCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, request } = useGeolocation();

  useEffect(() => {
    if (state.status !== "success") return;
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("lat", state.position.lat.toFixed(4));
    next.set("lng", state.position.lng.toFixed(4));
    router.replace(`/rankings?${next.toString()}`, { scroll: false });
  }, [state, router, searchParams]);

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
          onClick={request}
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
