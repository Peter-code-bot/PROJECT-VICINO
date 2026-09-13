"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { reverseGeocodeWithApple } from "@/lib/geo/apple-geocoder";

interface Result {
  name: string | null;
  fullName: string | null;
  loading: boolean;
}

const DRIFT_DEGREES = 0.001;

export function useReverseGeocode(
  position: { lat: number; lng: number; name?: string; fullName?: string } | null,
): Result {
  const [name, setName] = useState<string | null>(position?.name ?? null);
  const [fullName, setFullName] = useState<string | null>(position?.fullName ?? null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef<{ lat: number; lng: number } | null>(null);

  const posLat = position?.lat;
  const posLng = position?.lng;
  const posName = position?.name;
  const posFullName = position?.fullName;

  useEffect(() => {
    if (posLat === undefined || posLng === undefined) {
      lastFetchRef.current = null;
      startTransition(() => {
        setName(null);
        setFullName(null);
      });
      return;
    }

    // Si ya viene con nombre cacheado, usarlo instantáneamente
    if (posName) {
      startTransition(() => {
        setName(posName);
        setFullName(posFullName ?? posName);
      });
      lastFetchRef.current = { lat: posLat, lng: posLng };
      return;
    }

    const prev = lastFetchRef.current;
    if (
      prev &&
      Math.abs(prev.lat - posLat) < DRIFT_DEGREES &&
      Math.abs(prev.lng - posLng) < DRIFT_DEGREES
    ) {
      return;
    }

    const controller = new AbortController();
    startTransition(() => setLoading(true));

    reverseGeocodeWithApple(posLat, posLng, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        if (data) {
          setName(data.name);
          setFullName(data.fullName);
          lastFetchRef.current = { lat: posLat, lng: posLng };
        }
      })
      .catch(() => {
        // Silenciar fallback
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [posLat, posLng, posName, posFullName]);

  return { name, fullName, loading };
}
