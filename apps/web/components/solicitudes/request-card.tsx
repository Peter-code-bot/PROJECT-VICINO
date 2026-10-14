"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "@/components/auth/auth-link";
import { Clock, MapPin, MessageSquare, Layers } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { ICONO_POR_SLUG } from "@/lib/categories/icons";
import { usePathname, useSearchParams } from "next/navigation";
import { safeRequestReturn } from "@/lib/solicitudes/request-navigation";

/** Only public text is required for the national guest preview. */
export interface RequestCardPreviewData {
  id: string;
  title: string;
  description: string | null;
  budget_estimated: number | null;
  created_at: string | null;
  categories: Array<{ slug: string; nombre: string }>;
}
export interface RequestCardData extends RequestCardPreviewData {
  image_url: string | null;
  expires_at: string;
  created_at: string;
  distance_meters: number;
  buyer_profile: { nombre: string; avatar_url: string | null };
  response_count: number;
}

export function formatRequestDistance(meters: number): string {
  const rounded = Math.ceil(Math.max(0, meters) / 100) * 100;
  return rounded < 1000 ? `${rounded} m` : `${(rounded / 1000).toFixed(1)} km`;
}

export function RequestCard({ data, category, onNavigate }: {
  data: RequestCardData | RequestCardPreviewData;
  /** The row's category is context, never an invented primary category. */
  category?: { slug: string; nombre: string };
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const returnTo = safeRequestReturn(`${pathname}?${search}`);
  const image = "image_url" in data ? data.image_url : null;
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const onlyCategory = data.categories.length === 1 ? data.categories.at(0) : undefined;
  const context = category ?? onlyCategory;
  const Icon = ICONO_POR_SLUG[context?.slug ?? ""] ?? Layers;
  const distance = "distance_meters" in data ? data.distance_meters : null;
  const responses = "response_count" in data ? data.response_count : null;
  const description = data.description?.trim();
  return (
    <Link href={`/solicitudes/${data.id}?returnTo=${encodeURIComponent(returnTo)}`} data-request-card={data.id} onClick={onNavigate}
      className="group relative block w-full min-w-0 overflow-hidden rounded-2xl product-card-custom transition-all duration-300 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
      <div className="relative aspect-square overflow-hidden bg-bg-elev-2">
        {image && failedImage !== image ? (
          <Image src={image} alt={data.title} fill className="object-cover" sizes="(max-width: 640px) 160px, 192px" onError={() => setFailedImage(image)} />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center">
            {description ? <p className="line-clamp-5 text-sm leading-relaxed product-card-semi">{description}</p>
              : <Icon aria-hidden="true" className="h-12 w-12 product-card-muted" strokeWidth={1.5} />}
          </div>
        )}
      </div>
      <div className="relative px-3.5 pb-3 pt-7 product-card-text">
        <div className="absolute left-3.5 right-3.5 top-0 -translate-y-1/2">
          <span className="inline-flex max-w-full truncate rounded product-card-tab px-2.5 py-1 font-heading text-[9.5px] font-extrabold uppercase tracking-[1px]">
            {context?.nombre ?? (data.categories.length > 1 ? `${data.categories.length} categorías` : "Sin categoría")}
          </span>
        </div>
        <div className="h-[2.6em] overflow-hidden">
          <h3 className="line-clamp-2 font-heading text-[14.5px] font-bold leading-[1.3] tracking-[-0.3px]">{data.title}</h3>
        </div>
        <p className="mt-2 h-5 whitespace-nowrap font-heading text-[12px] font-bold tabular-nums sm:text-sm">
          {data.budget_estimated != null && data.budget_estimated > 0 ? `$${data.budget_estimated.toLocaleString("es-MX")} MXN` : "Presupuesto por acordar"}
        </p>
        <div className="mt-2 min-h-4 truncate text-[10.5px] product-card-muted">
          {distance !== null ? <span className="inline-flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />Aprox. {formatRequestDistance(distance)}</span> : <span>Solicitud pública</span>}
        </div>
        <div className="mt-1 flex h-4 items-center justify-between gap-1 text-[10.5px] product-card-muted">
          <span className="inline-flex min-w-0 items-center gap-1 truncate"><Clock className="h-3 w-3 shrink-0" aria-hidden="true" />{data.created_at ? formatRelativeTime(data.created_at) : "Reciente"}</span>
          {responses !== null && <span className="inline-flex shrink-0 items-center gap-1" aria-label={`${responses} ${responses === 1 ? "oferta" : "ofertas"}`}><MessageSquare className="h-3 w-3" aria-hidden="true" />{responses > 999 ? new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(responses) : responses} {responses === 1 ? "oferta" : "ofertas"}</span>}
        </div>
      </div>
    </Link>
  );
}
