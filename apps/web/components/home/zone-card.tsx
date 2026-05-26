"use client";

import { useEffect, useState, startTransition } from "react";
import { MapPin } from "lucide-react";
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
      <div className="flex items-center gap-3 rounded-2xl bg-[color:var(--card)] p-3 shadow-[inset_0_0_0_1px_var(--border)]">
        <span
          aria-hidden
          className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]"
        >
          <MapPin size={16} strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[color:var(--fg-muted)]">
            Tu zona · 5 km
          </div>
          <div className="truncate font-heading text-base font-semibold text-[color:var(--fg)]">
            {name ?? (position ? "Cerca de ti" : "Activa tu ubicación")}
          </div>
          {vendorCount !== null && vendorCount > 0 && (
            <div className="text-xs text-[color:var(--fg-muted)]">
              <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--brand-hi)] align-middle" />
              {vendorCount} cerca
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "inline-flex flex-shrink-0 items-center justify-center rounded-full border border-[color:var(--brand-hi)]/60 px-3 py-1",
            "min-h-[40px] font-heading text-sm font-semibold text-[color:var(--brand-hi)]",
            "transition-colors hover:bg-[color:var(--brand-tint)] active:bg-[color:var(--brand-tint-strong)]",
          )}
        >
          Cambiar
        </button>
      </div>

      <ChangeLocationSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
