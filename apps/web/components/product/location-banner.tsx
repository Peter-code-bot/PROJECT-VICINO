import { MapPin } from "lucide-react";

interface LocationBannerProps {
  ubicacion: string | null;
}

export function LocationBanner({ ubicacion }: LocationBannerProps) {
  if (!ubicacion) return null;

  return (
    <div className="flex w-fit items-center gap-2 rounded-[var(--r-lg)] product-card-custom p-3 text-sm text-fg-muted">
      <MapPin className="h-4 w-4 shrink-0 text-white" />
      <span className="font-medium text-fg">{ubicacion}</span>
    </div>
  );
}
