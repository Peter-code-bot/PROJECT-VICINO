"use client";

import { useCallback, useEffect, startTransition, useState } from "react";
import Image from "next/image";
import useEmblaCarousel from "embla-carousel-react";

interface ImageGalleryProps {
  imagenPrincipal: string | null;
  galeriaImagenes: string[];
  titulo: string;
}

export function ImageGallery({
  imagenPrincipal,
  galeriaImagenes,
  titulo,
}: ImageGalleryProps) {
  const allImages = [
    ...(imagenPrincipal ? [imagenPrincipal] : []),
    ...galeriaImagenes.filter(Boolean),
  ];

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [emblaRef, emblaApi] = useEmblaCarousel({
    loop: allImages.length > 1,
  });

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    emblaApi.on("select", onSelect);
    startTransition(() => {
      setSelectedIndex(emblaApi.selectedScrollSnap());
    });
    return () => {
      emblaApi.off("select", onSelect);
    };
  }, [emblaApi, onSelect]);

  // Sin imágenes
  if (allImages.length === 0) {
    return (
      <div className="relative aspect-square md:aspect-[4/3] md:rounded-3xl overflow-hidden bg-cream-dark dark:bg-neutral-900 border-x-0 md:border border-border/40 flex flex-col items-center justify-center text-muted-foreground">
        <span className="text-4xl mb-2">📷</span>
        <span className="text-sm">Sin imagen</span>
      </div>
    );
  }

  // Una sola imagen — sin carrusel
  if (allImages.length === 1) {
    return (
      <div className="relative aspect-square md:aspect-[4/3] md:rounded-3xl overflow-hidden bg-cream-dark dark:bg-neutral-900 border-x-0 md:border border-border/40 w-full group">
        <Image
          src={allImages[0]!}
          alt={titulo}
          fill
          className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
          priority
        />
      </div>
    );
  }

  // Múltiples imágenes — carrusel Embla
  return (
    <div className="space-y-2">
      <div
        ref={emblaRef}
        className="overflow-hidden md:rounded-3xl border-x-0 md:border border-border/40 bg-cream-dark dark:bg-neutral-900"
      >
        <div className="flex">
          {allImages.map((src, i) => (
            <div
              key={i}
              className="relative flex-[0_0_100%] aspect-square md:aspect-[4/3]"
            >
              <Image
                src={src}
                alt={`${titulo} — imagen ${i + 1}`}
                fill
                className="object-cover"
                priority={i === 0}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Dots de navegación */}
      <div className="flex justify-center gap-1.5 py-1">
        {allImages.map((_, i) => (
          <button
            key={i}
            onClick={() => emblaApi?.scrollTo(i)}
            aria-label={`Ver imagen ${i + 1}`}
            className={`transition-all duration-200 rounded-full ${
              i === selectedIndex
                ? "w-4 h-1.5 bg-[color:var(--brand-hi)]"
                : "w-1.5 h-1.5 bg-[color:var(--fg-muted)]/30 hover:bg-[color:var(--fg-muted)]/60"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
