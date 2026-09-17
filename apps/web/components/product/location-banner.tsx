"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
const subscribeScreen = (listener: () => void) => {
  const query = matchMedia("(min-width: 768px)"); query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

export function LocationBanner({ ubicacion, productId, version, available, layout }: { ubicacion: string | null; productId: string; version?: string | null; available: boolean; layout: "mobile" | "desktop" }) {
  const desktop = useSyncExternalStore(subscribeScreen, () => matchMedia("(min-width: 768px)").matches, () => false);
  const activeLayout = layout === (desktop ? "desktop" : "mobile");
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const src = `/api/products/${productId}/location-map?theme=${resolvedTheme === "dark" ? "dark" : "light"}&v=${encodeURIComponent(version ?? "")}`;
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting && entry.target.getClientRects().length > 0)) {
        setVisible(true); observer.disconnect();
      }
    }, { rootMargin: "240px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  // Sin texto de zona ni mapa no hay nada que anunciar: antes se pintaban dos
  // lineas ("Ubicacion no indicada" y "La ubicacion es aproximada") que no
  // describian nada.
  if (!ubicacion && !available) return null;
  return <section ref={container} aria-labelledby={`ubicacion-${layout}`} className="w-full space-y-2">
    <h2 id={`ubicacion-${layout}`} className="font-heading text-lg font-bold text-fg">Ubicación</h2>
    {available && <div className="relative aspect-[32/9] overflow-hidden rounded-2xl bg-[var(--card-2)]">
      {visible && activeLayout && failed !== src && <>
        {/* Native image preserves attribution and avoids a public optimizer cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Mapa de la zona aproximada de la publicación" width={1280} height={360}
          className="h-full w-full" onLoad={() => setLoaded(src)} onError={() => setFailed(src)} />
        {loaded === src && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[60%] -translate-x-1/2 -translate-y-1/2 aspect-square rounded-full border-2 border-[var(--brand-hi)] bg-[var(--brand-hi)]/20" />}
      </>}
      {failed === src && <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-fg-muted">Mapa no disponible</p>}
    </div>}
    <p className="text-sm font-medium text-fg">{ubicacion || "Ubicación no indicada"}</p>
    {available && <p className="text-xs text-fg-muted">La ubicación es aproximada</p>}
  </section>;
}
