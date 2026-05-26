"use client";

import { useEffect, useRef, useState, startTransition } from "react";

interface NominatimAddress {
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  city?: string;
  town?: string;
  municipality?: string;
  postcode?: string;
}

interface NominatimReverseResponse {
  address?: NominatimAddress;
}

interface Result {
  name: string | null;
  fullName: string | null;
  loading: boolean;
}

const DRIFT_DEGREES = 0.001;

function buildName(addr: NominatimAddress | undefined): {
  name: string | null;
  fullName: string | null;
} {
  if (!addr) return { name: null, fullName: null };
  const barrio = addr.suburb ?? addr.neighbourhood ?? addr.quarter ?? null;
  const ciudad = addr.city ?? addr.town ?? addr.municipality ?? null;

  let name: string | null = null;
  if (barrio && ciudad) name = `${barrio}, ${ciudad}`;
  else if (barrio) name = barrio;
  else if (ciudad) name = ciudad;

  const fullName =
    name && addr.postcode ? `${name}, CP ${addr.postcode}` : name;

  return { name, fullName };
}

export function useReverseGeocode(
  position: { lat: number; lng: number } | null,
): Result {
  const [name, setName] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!position) {
      lastFetchRef.current = null;
      startTransition(() => {
        setName(null);
        setFullName(null);
      });
      return;
    }

    const prev = lastFetchRef.current;
    if (
      prev &&
      Math.abs(prev.lat - position.lat) < DRIFT_DEGREES &&
      Math.abs(prev.lng - position.lng) < DRIFT_DEGREES
    ) {
      return;
    }

    const controller = new AbortController();
    startTransition(() => setLoading(true));

    const url = `https://nominatim.openstreetmap.org/reverse?lat=${position.lat}&lon=${position.lng}&format=json&addressdetails=1`;

    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP error"))))
      .then((data: NominatimReverseResponse) => {
        const built = buildName(data.address);
        setName(built.name);
        setFullName(built.fullName);
        lastFetchRef.current = { lat: position.lat, lng: position.lng };
      })
      .catch(() => {
        // Silenciar: red, JSON inválido o abort — el UI muestra fallback.
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [position?.lat, position?.lng]);

  return { name, fullName, loading };
}
