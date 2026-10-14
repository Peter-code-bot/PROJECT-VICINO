"use client";

import useEmblaCarousel from "embla-carousel-react";
import { RequestCard, type RequestCardPreviewData } from "./request-card";
import { groupRequestRows } from "@/lib/solicitudes/request-rows";
import { useEffect, useState } from "react";
import { useSessionUI } from "@/components/layout/session-data-provider";

export function RequestCarousel<T extends RequestCardPreviewData>({ requests, category, onNavigate, scope }: {
  requests: T[];
  category?: { slug: string; nombre: string };
  onNavigate?: () => void;
  scope?: string;
}) {
  const [index, saveIndex] = useSessionUI(`request-carousel:${scope ?? requests.map(request => request.id).join(",")}:${category?.slug ?? "all"}`, 0);
  const [initialIndex] = useState(index);
  const [ref, embla] = useEmblaCarousel({ align: "start", dragFree: true, startIndex: initialIndex });
  useEffect(() => {
    if (!embla) return;
    const save = () => saveIndex(embla.selectedScrollSnap());
    embla.on("select", save);
    return () => { embla.off("select", save); };
  }, [embla, saveIndex]);
  return <div ref={ref} className="-mx-4 overflow-hidden px-4" data-no-page-swipe>
    <div className="flex gap-3">{requests.map(request => <div key={request.id} className="w-40 shrink-0 sm:w-48"><RequestCard data={request} category={category} onNavigate={onNavigate} /></div>)}</div>
  </div>;
}

export function RequestRows<T extends RequestCardPreviewData>({ requests, onViewMore }: {
  requests: T[];
  onViewMore?: (category: { slug: string; nombre: string } | null) => void;
}) {
  return <div className="space-y-6">{groupRequestRows(requests).map(row => <section key={row.category?.slug ?? "recientes"}>
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="font-heading text-base font-bold text-fg">{row.category?.nombre ?? "Recientes"}</h2>
      {onViewMore && <button type="button" className="min-h-10 px-2 text-sm font-medium text-fg underline underline-offset-4" onClick={() => onViewMore(row.category)}>Ver más<span className="sr-only"> {row.category?.nombre ?? "solicitudes recientes"}</span></button>}
    </div>
    <RequestCarousel requests={row.requests} category={row.category ?? undefined} />
  </section>)}</div>;
}
