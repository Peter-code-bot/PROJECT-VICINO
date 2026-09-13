"use client";

import { useState } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useReverseGeocode } from "@/hooks/use-reverse-geocode";
import { ChangeLocationSheet } from "./change-location-sheet";

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
}

export function ZoneCard({ hayUbicacionEnServidor = false }: ZoneCardProps) {
  const { state } = useGeolocation();
  const position = state.status === "success" ? state.position : null;
  const { name } = useReverseGeocode(position);
  const [open, setOpen] = useState(false);

  const hayUbicacion = position !== null || hayUbicacionEnServidor;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 product-card-custom transition-colors hover:opacity-90"
      >
        <MapPin className="h-[13px] w-[13px] product-card-muted" strokeWidth={2} />
        <span className="font-heading text-[13px] font-semibold product-card-text whitespace-nowrap">
          {name ?? (hayUbicacion ? "Cerca de ti" : "Activa ubicación")}
        </span>
        <ChevronDown className="h-3 w-3 product-card-muted" strokeWidth={2} />
      </button>

      <ChangeLocationSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
