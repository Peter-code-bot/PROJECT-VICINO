"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "@/components/auth/auth-link";
import { Clock, MapPin, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { cn } from "@/lib/utils";

/** Public preview fields; no buyer, location or private attachment is needed. */
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
  buyer_profile: {
    nombre: string;
    avatar_url: string | null;
  };
  response_count: number;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function RequestCard({ data }: { data: RequestCardData | RequestCardPreviewData }) {
  const guestPreview = !("buyer_profile" in data);
  const image = "image_url" in data ? data.image_url : null;
  const distance = "distance_meters" in data ? data.distance_meters : null;
  const responses = "response_count" in data ? data.response_count : 0;
  return (
    <Link
      href={`/solicitudes/${data.id}`}
      className={cn("block rounded-2xl bg-[color:var(--sidebar-bg)] p-4 transition-all hover:shadow-md active:scale-[0.98]", guestPreview && "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!")}
    >
      <div className="flex gap-3">
        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Top category (only if no image) */}
          {!image && data.categories.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mb-2">
              {data.categories.slice(0, 2).map((cat) => (
                <span
                  key={cat.slug}
                  className="inline-flex px-2.5 py-1 rounded product-card-tab font-heading font-extrabold text-[9.5px] tracking-[1.4px] uppercase shadow-[0_4px_10px_rgba(0,0,0,0.30)]"
                >
                  {cat.nombre}
                </span>
              ))}
            </div>
          )}

          {/* Title */}
          <h3 className="font-semibold text-foreground text-[15px] leading-snug line-clamp-2 mb-1">
            {data.title}
          </h3>

          {/* Description */}
          {data.description && (
            <p className={cn("text-sm line-clamp-2 mb-2", guestPreview ? "text-fg dark:text-fg-muted" : "text-muted-foreground")}>
              {data.description}
            </p>
          )}

          {/* Bottom row: Budget, Location, Time, Offers */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 mt-2">
            {/* Budget text */}
            {/* != null y > 0: con `&&` un presupuesto de 0 pintaba un "0" suelto. */}
            {data.budget_estimated != null && data.budget_estimated > 0 && (
              <span className="font-heading font-extrabold text-[15px] text-foreground tracking-tight">
                ${data.budget_estimated.toLocaleString("es-MX")} MXN
              </span>
            )}

            {/* Metadata row (Location, Time) */}
            <div className={cn("flex items-center gap-1.5 text-xs", guestPreview ? "text-fg dark:text-fg-muted" : "text-muted-foreground")}>
              {distance !== null && <span className="inline-flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                A {formatDistance(distance)}
              </span>}
              {distance !== null && data.created_at && <span>·</span>}
              {data.created_at && <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatRelativeTime(data.created_at)}
              </span>}
            </div>

            {/* Response count */}
            {responses > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <MessageSquare className="h-3 w-3" />
                {responses} {responses === 1 ? "oferta" : "ofertas"}
              </span>
            )}
          </div>
        </div>

        {/* Optional image thumbnail */}
        {image && (
          <div className="relative h-20 w-24 flex-shrink-0 overflow-hidden rounded-xl">
            <Image
              src={image}
              alt={data.title}
              fill
              className="object-cover"
              sizes="96px"
            />
            {data.categories.length > 0 && (
              <div className="absolute bottom-1 right-1 left-1 flex justify-end">
                <span
                  className="inline-flex px-1.5 py-0.5 rounded product-card-tab font-heading font-extrabold text-[8px] tracking-[1px] uppercase shadow-[0_2px_5px_rgba(0,0,0,0.5)] truncate max-w-full"
                >
                  {data.categories[0]?.nombre}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
