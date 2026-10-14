"use client";

import useEmblaCarousel from "embla-carousel-react";
import { groupCommunitiesByCategory } from "@vicino/shared";
import type { ComunidadResumen } from "@/lib/comunidades/tipos";
import { ComunidadCard, type ComunidadCardPreview } from "./comunidad-card";
import type { EstadoRelacion } from "./join-button";

type CarouselCommunity = ComunidadResumen | ComunidadCardPreview;

function CommunityRow({ items, conBoton, onEstado }: { items: CarouselCommunity[]; conBoton?: boolean; onEstado?: (id: string, estado: EstadoRelacion) => void }) {
  const [emblaRef] = useEmblaCarousel({ align: "start", dragFree: true });
  return <div className="overflow-hidden -mx-4 px-4" ref={emblaRef} data-no-page-swipe>
    <div className="flex items-stretch gap-3">
      {items.map(item => <div key={item.id} className="shrink-0 w-40 sm:w-48"><ComunidadCard comunidad={item} vertical conBoton={conBoton} onEstado={onEstado} /></div>)}
    </div>
  </div>;
}

export function CommunityCarousel({ items, conBoton, onEstado }: { items: CarouselCommunity[]; conBoton?: boolean; onEstado?: (id: string, estado: EstadoRelacion) => void }) {
  return <div className="space-y-6">{groupCommunitiesByCategory(items).map(group => <section key={group.id} aria-label={group.name}>
    <h3 className="mb-3 font-heading text-[15px] font-semibold text-fg">{group.name}</h3>
    <CommunityRow items={group.items} conBoton={conBoton} onEstado={onEstado} />
  </section>)}</div>;
}
