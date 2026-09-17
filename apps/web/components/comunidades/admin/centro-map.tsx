"use client";

import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const AppleMapContainer = dynamic(() => import("@/components/map/apple-map-container"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[240px] items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand)]" />
    </div>
  ),
});

interface Props {
  /** Punto elegido ahora mismo: es lo que mueve el pin. */
  lat: number;
  lng: number;
  /**
   * Encuadre del mapa. Va aparte del pin a proposito: si el encuadre siguiera
   * al pin, cada toque volveria a centrar el mapa y tiraria el zoom y el
   * desplazamiento que la persona acaba de hacer con el dedo.
   */
  vista: { lat: number; lng: number };
  onMove: (lat: number, lng: number) => void;
}

/**
 * Mapa para mover el centro de la comunidad: se arrastra con un dedo, se
 * acerca con la pinza, y el pin se mueve arrastrandolo o tocando el mapa.
 * Ya no dibuja circulo de radio: mover el centro no tiene limite de distancia.
 */
export default function CentroMap({ lat, lng, vista, onMove }: Props) {
  return (
    // Sin estos dos atributos el arrastre sobre el mapa lo interceptan
    // PageSwipeWrapper y PullToRefreshWrapper: el gesto cambia de pestana o
    // recarga la pagina en vez de mover el mapa. Van en el recuadro entero
    // para cubrir tambien la etiqueta y el hueco de carga.
    <div
      data-no-page-swipe="true"
      data-no-pull-to-refresh="true"
      className="relative h-[240px] overflow-hidden rounded-2xl"
    >
      <AppleMapContainer
        center={[vista.lat, vista.lng]}
        markerPosition={[lat, lng]}
        draggableMarker
        onMarkerDragEnd={onMove}
        onMapClick={onMove}
        height={240}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-xl bg-[color:var(--bg)]/85 px-2.5 py-1 text-xs text-[color:var(--fg-muted)] backdrop-blur-sm">
        Arrastra el pin o toca el mapa para mover el centro
      </div>
    </div>
  );
}
