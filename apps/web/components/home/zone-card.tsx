"use client";

import { useEffect, useState, startTransition } from "react";
import { MapPin, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useReverseGeocode } from "@/hooks/use-reverse-geocode";
import { getNearbyVendorCount } from "@/lib/geo/actions";
import { ChangeLocationSheet } from "./change-location-sheet";

export function ZoneCard() {
  const { state } = useGeolocation();
  const position = state.status === "success" ? state.position : null;
  const { name } = useReverseGeocode(position);
  const [vendorCount, setVendorCount] = useState<number | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!position) {
      startTransition(() => setVendorCount(null));
      return;
    }
    let cancelled = false;
    getNearbyVendorCount({
      lat: position.lat,
      lng: position.lng,
      radiusMeters: 5000,
    }).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setVendorCount(null);
        return;
      }
      setVendorCount(res.count);
    });
    return () => {
      cancelled = true;
    };
  }, [position?.lat, position?.lng]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 product-card-custom transition-colors hover:opacity-90"
      >
        <MapPin className="h-[13px] w-[13px] product-card-muted" strokeWidth={2} />
        <span className="font-heading text-[13px] font-semibold product-card-text whitespace-nowrap">
          {name ?? (position ? "Cerca de ti" : "Activa ubicación")}
        </span>
        <ChevronDown className="h-3 w-3 product-card-muted" strokeWidth={2} />
      </button>

      <ChangeLocationSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
