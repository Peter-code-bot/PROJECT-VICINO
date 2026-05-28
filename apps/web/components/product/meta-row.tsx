"use client";

import { useEffect, useState } from "react";

interface MetaRowProps {
  categoria: string;
  ubicacion: string | null;
  sellerLat?: number | null;
  sellerLng?: number | null;
}

const GEO_CACHE_KEY = "vicino_user_geo";
const GEO_CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedGeo {
  lat: number;
  lng: number;
  at: number;
}

function readCachedGeo(): CachedGeo | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(GEO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedGeo;
    if (
      typeof parsed.lat !== "number" ||
      typeof parsed.lng !== "number" ||
      typeof parsed.at !== "number"
    ) {
      return null;
    }
    if (Date.now() - parsed.at > GEO_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedGeo(geo: CachedGeo) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(GEO_CACHE_KEY, JSON.stringify(geo));
  } catch {
    // sessionStorage may be unavailable in private mode; ignore.
  }
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return R * c;
}

function formatKm(km: number): string {
  return `${(Math.round(km * 10) / 10).toFixed(1)} km`;
}

function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

function shortUbicacion(ubicacion: string | null): string | null {
  if (!ubicacion) return null;
  const parts = ubicacion
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts[1] ?? parts[0] ?? ubicacion;
}

export function MetaRow({
  categoria,
  ubicacion,
  sellerLat,
  sellerLng,
}: MetaRowProps) {
  const [distanceLabel, setDistanceLabel] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [geoDenied, setGeoDenied] = useState(false);

  useEffect(() => {
    if (typeof sellerLat !== "number" || typeof sellerLng !== "number") {
      setDistanceLabel(null);
      return;
    }

    const cached = readCachedGeo();
    if (cached) {
      const km = haversineKm(cached.lat, cached.lng, sellerLat, sellerLng);
      setDistanceLabel(formatKm(km));
      return;
    }

    if (typeof window === "undefined" || !("geolocation" in navigator)) {
      setDistanceLabel(null);
      return;
    }

    setResolving(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const geo: CachedGeo = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          at: Date.now(),
        };
        writeCachedGeo(geo);
        const km = haversineKm(geo.lat, geo.lng, sellerLat, sellerLng);
        setDistanceLabel(formatKm(km));
        setResolving(false);
      },
      () => {
        setGeoDenied(true);
        setResolving(false);
      },
      { enableHighAccuracy: false, timeout: 6000, maximumAge: GEO_CACHE_TTL_MS },
    );
  }, [sellerLat, sellerLng]);

  const ubic = shortUbicacion(ubicacion);
  const sellerHasGeo =
    typeof sellerLat === "number" && typeof sellerLng === "number";

  let distance: string | null = null;
  if (distanceLabel) {
    distance = distanceLabel;
  } else if (sellerHasGeo && resolving) {
    distance = "Calculando...";
  } else if (sellerHasGeo && geoDenied && !ubic) {
    distance = "Cerca de ti";
  }

  const parts: string[] = [];
  if (distance) parts.push(distance);
  if (ubic) parts.push(ubic);
  parts.push(capitalizeFirst(categoria.replace(/-/g, " ")));

  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted">
      {parts.map((p, i) => (
        <span key={`${p}-${i}`} className="inline-flex items-center gap-1.5">
          {i > 0 ? (
            <span aria-hidden className="text-fg-dim">
              ·
            </span>
          ) : null}
          <span>{p}</span>
        </span>
      ))}
    </div>
  );
}
