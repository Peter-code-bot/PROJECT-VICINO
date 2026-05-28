"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProductGalleryCarouselProps {
  images: string[];
  title: string;
  // Reserved for future "preserve order" handling. Mobile carousel does not
  // honor colSpan/rowSpan but the prop is accepted so callers stay stable.
  savedSizes?: Array<{ colSpan: number; rowSpan: number }> | null;
}

export function ProductGalleryCarousel({ images, title }: ProductGalleryCarouselProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const slideRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.55) {
            const raw = entry.target.getAttribute("data-idx");
            const idx = raw === null ? Number.NaN : Number(raw);
            if (!Number.isNaN(idx)) setActiveIdx(idx);
          }
        }
      },
      { root: containerRef.current, threshold: [0.55] },
    );
    for (const slide of slideRefs.current) {
      if (slide) observer.observe(slide);
    }
    return () => observer.disconnect();
  }, [images.length]);

  function scrollToIdx(idx: number) {
    const slide = slideRefs.current[idx];
    if (slide) {
      slide.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
    }
  }

  if (images.length === 0) {
    return (
      <div className="aspect-[4/3] w-full max-h-[300px] bg-card-2 border-b border-border flex flex-col items-center justify-center gap-2 text-fg-muted">
        <ImageOff className="h-8 w-8 opacity-60" aria-hidden />
        <span className="text-sm">Sin imágenes</span>
      </div>
    );
  }

  const single = images.length === 1 ? images[0] : null;
  if (single) {
    return (
      <div className="relative aspect-square w-full overflow-hidden bg-card-2">
        <Image
          src={single}
          alt={title}
          fill
          sizes="100vw"
          priority
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className="relative aspect-square w-full"
      role="region"
      aria-roledescription="carrusel"
      aria-label={`Galeria de ${title}`}
    >
      <div
        ref={containerRef}
        className="no-scrollbar h-full w-full overflow-x-auto snap-x snap-mandatory flex"
      >
        {images.map((src, idx) => (
          <div
            key={`${src}-${idx}`}
            ref={(el) => {
              slideRefs.current[idx] = el;
            }}
            data-idx={idx}
            className="relative h-full w-full shrink-0 snap-center bg-card-2"
            role="group"
            aria-roledescription="diapositiva"
            aria-label={`Imagen ${idx + 1} de ${images.length}`}
          >
            <Image
              src={src}
              alt={`${title} imagen ${idx + 1}`}
              fill
              sizes="100vw"
              priority={idx === 0}
              loading={idx === 0 ? "eager" : "lazy"}
              className="object-cover"
            />
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
        {images.map((_, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => scrollToIdx(idx)}
            aria-label={`Ir a imagen ${idx + 1}`}
            aria-current={idx === activeIdx ? "true" : undefined}
            className={cn(
              "pointer-events-auto h-1.5 rounded-full transition-all duration-200",
              idx === activeIdx
                ? "w-[18px] bg-white shadow"
                : "w-1.5 bg-white/50",
            )}
          />
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-full bg-black/40 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
        {activeIdx + 1} / {images.length}
      </div>
    </div>
  );
}
