"use client";

import { useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useReverseGeocode } from "@/hooks/use-reverse-geocode";
import { ChangeLocationSheet } from "./change-location-sheet";
import type { GeoPosition } from "@/lib/geo/location-storage";

interface ZoneCardProps {
  /**
   * Si el SERVIDOR ya sabia que hay ubicacion, leyendo la cookie
   * `vicino_location` al pintar el home.
   *
   * Sin esto la pildora entraba en tres tiempos y por eso «aparecian primero
   * las categorias y luego Cerca de ti»:
   *
   *   1. HTML del servidor  -> «Activa ubicacion». useGeolocation arranca en
   *      `idle` A PROPOSITO: lee el localStorage dentro de un efecto para que
   *      el primer render coincida con el del servidor y no haya error de
   *      hidratacion. O sea que en el primer pintado NO hay ubicacion.
   *   2. tras hidratar      -> «Cerca de ti», cuando el efecto lee el cache.
   *   3. tras ir a la red   -> el nombre de la colonia (Apple Maps Geocoder).
   *
   * Las categorias, en cambio, son marcado del servidor: entran con el HTML.
   * De ahi el desfase — no era que «Cerca de ti» fuese lento, es que salia
   * despues de descargar, parsear e hidratar el JS.
   *
   * La ubicacion YA viaja en la cookie y el servidor ya la lee para armar el
   * feed, asi que el primer pintado puede decir la verdad y ahorrarse el
   * paso 1 entero. Y decir «Cerca de ti» es lo honesto aunque el localStorage
   * estuviera vacio: el feed que se esta pintando debajo YA esta filtrado por
   * esa cookie.
   */
  hayUbicacionEnServidor?: boolean;
  resolveName?: boolean;
  /** Explicit URL centers must not display the name of a different saved zone. */
  positionOverride?: Pick<GeoPosition, "lat" | "lng"> | null;
  selected?: boolean;
}

export function ZoneCard({ hayUbicacionEnServidor = false, resolveName = true, positionOverride, selected = false }: ZoneCardProps) {
  const { state } = useGeolocation();
  const stored = state.status === "success" ? state.position : null;
  const position = positionOverride === undefined ? stored : positionOverride;
  const sameStoredZone = position && stored && Math.abs(position.lat - stored.lat) < 0.001 && Math.abs(position.lng - stored.lng) < 0.001;
  const cachedName = sameStoredZone ? stored.name : undefined;
  const { name } = useReverseGeocode(resolveName ? (sameStoredZone ? stored : position) : null);
  const [open, setOpen] = useState(false);

  const hayUbicacion = position !== null || hayUbicacionEnServidor;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={open}
        aria-label={hayUbicacion ? `Cambiar ubicación: ${cachedName ?? name ?? "Tu ubicación"}` : "Activar ubicación"}
        className={`inline-flex min-h-11 items-center gap-1.5 rounded-2xl px-3 py-2 transition-colors hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--fg)] ${selected ? "discovery-active" : "product-card-custom product-card-text"}`}
      >
        <MapPin className="h-[13px] w-[13px]" strokeWidth={2} />
        <span className="font-heading text-[13px] font-semibold whitespace-nowrap">
          {cachedName ?? name ?? (hayUbicacion ? "Tu ubicación" : "Activar ubicación")}
        </span>
        <ChevronDown className="h-3 w-3" strokeWidth={2} />
      </button>

      <ChangeLocationSheet open={open} onClose={() => setOpen(false)} initialPositionOverride={positionOverride} />
    </>
  );
}
