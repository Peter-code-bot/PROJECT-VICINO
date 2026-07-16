"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Clock, MapPin, MessageSquare, DollarSign } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { cn } from "@/lib/utils";

export interface RequestCardData {
  id: string;
  title: string;
  description: string | null;
  budget_estimated: number | null;
  image_url: string | null;
  expires_at: string;
  created_at: string;
  distance_meters: number;
  buyer_profile: {
    nombre: string;
    avatar_url: string | null;
  };
  categories: Array<{ slug: string; nombre: string }>;
  response_count: number;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function RequestCard({ data }: { data: RequestCardData }) {
  return (
    <Link
      href={`/solicitudes/${data.id}`}
      className="block rounded-2xl bg-[color:var(--sidebar-bg)] p-4 transition-all hover:shadow-md active:scale-[0.98]"
    >
      <div className="flex gap-3">
        {/* Text content */}
        <div className="flex-1 min-w-0">
          {/* Metadata row */}
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1.5">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              A {formatDistance(data.distance_meters)}
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatRelativeTime(data.created_at)}
            </span>
          </div>

          {/* Title */}
          <h3 className="font-semibold text-foreground text-[15px] leading-snug line-clamp-2 mb-1">
            {data.title}
          </h3>

          {/* Description */}
          {data.description && (
            <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
              {data.description}
            </p>
          )}

          {/* Chips row */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Budget chip */}
            {data.budget_estimated && (
              <span className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] font-heading font-bold text-sm",
                "bg-[#1A1A2E] text-white",
                "dark:bg-white/92 dark:text-brand-dark"
              )}>
                <DollarSign className="h-3.5 w-3.5" />
                ${data.budget_estimated.toLocaleString()} MXN
              </span>
            )}

            {/* Category chips */}
            {data.categories.slice(0, 2).map((cat) => (
              <span
                key={cat.slug}
                className="inline-flex px-2.5 py-1 rounded product-card-tab font-heading font-extrabold text-[9.5px] tracking-[1.4px] uppercase shadow-[0_4px_10px_rgba(0,0,0,0.30)]"
              >
                {cat.nombre}
              </span>
            ))}

            {/* Response count */}
            {data.response_count > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground ml-auto">
                <MessageSquare className="h-3 w-3" />
                {data.response_count} {data.response_count === 1 ? "oferta" : "ofertas"}
              </span>
            )}
          </div>
        </div>

        {/* Optional image thumbnail */}
        {data.image_url && (
          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-xl">
            <Image
              src={data.image_url}
              alt={data.title}
              fill
              className="object-cover"
              sizes="80px"
            />
          </div>
        )}
      </div>
    </Link>
  );
}
