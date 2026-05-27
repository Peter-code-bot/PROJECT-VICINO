"use client";

import { useEffect, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MapPin, Loader2 } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";

/**
 * Empty-state card shown on /rankings when the URL has no lat/lng.
 * Asks the user to share their location, and on success silently rewrites the
 * URL with lat/lng so the Server Component re-renders with the hyperlocal RPC.
 * If the geolocation hook has a cached position, we apply it on mount without
 * a re-prompt.
 */
export function ActivateLocationCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { state, request } = useGeolocation();
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (state.status !== "success") return;
    const params = new URLSearchParams(searchParams.toString());
    if (params.has("lat") && params.has("lng")) return;
    params.set("lat", state.position.lat.toFixed(4));
    params.set("lng", state.position.lng.toFixed(4));
    startTransition(() => {
      router.replace(`?${params.toString()}`, { scroll: false });
    });
  }, [state, router, searchParams]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <MapPin className="h-6 w-6 text-primary" aria-hidden />
      </div>
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          Activa tu ubicación
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El ranking se calcula en un radio de 5 km. Necesitamos tu ubicación
          para mostrarte a los mejores vendedores cercanos.
        </p>
      </div>
      <button
        type="button"
        onClick={request}
        disabled={state.status === "loading" || pending}
        className="inline-flex h-10 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {state.status === "loading" || pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <MapPin className="h-4 w-4" aria-hidden />
        )}
        Compartir mi ubicación
      </button>
      {state.status === "error" ? (
        <p className="text-xs text-destructive">{state.message}</p>
      ) : null}
    </div>
  );
}
