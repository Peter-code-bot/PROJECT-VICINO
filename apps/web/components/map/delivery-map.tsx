"use client";
import { useCallback } from "react";
import LocationPicker, { type LocationSelection } from "./location-picker";
interface DeliveryMapProps {
  onLocationChange: (lat: number, lng: number, address: string) => void;
  onRadiusChange: (km: number) => void;
  initialLat?: number;
  initialLng?: number;
  initialRadius?: number;
}
/** Adapts the legacy product form contract; the shared picker uses null for absence. */
export default function DeliveryMap({ onLocationChange, ...props }: DeliveryMapProps) {
  const change = useCallback((value: LocationSelection | null) => {
    onLocationChange(value?.lat ?? 0, value?.lng ?? 0, value?.address ?? "");
  }, [onLocationChange]);
  return <LocationPicker {...props} onChange={change} placeholder="Busca tu zona de entrega…" />;
}
