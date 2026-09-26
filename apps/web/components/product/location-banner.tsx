"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { mapPreviewError, type MapPreviewError } from "@/lib/geo/map-preview-error";
const subscribeScreen = (listener: () => void) => {
  const query = matchMedia("(min-width: 768px)"); query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

function PreviewFailure({ error, onRetry }: { error: MapPreviewError; onRetry: () => void }) {
  const [remaining, setRemaining] = useState(error.delay);
  useEffect(() => {
    if (!error.retryable || error.delay <= 0) return;
    const deadline = Date.now() + error.delay * 1000;
    const timer = setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemaining(next);
      if (next === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [error]);
  return <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center text-xs text-fg-muted">
    <p role="status">{error.message}</p>
    {error.retryable && <button type="button" disabled={remaining > 0} onClick={onRetry}
      className="min-h-11 px-3 font-medium underline disabled:opacity-60">
      {remaining > 0 ? `Reintentar en ${remaining} s` : "Reintentar mapa"}
    </button>}
  </div>;
}

export function LocationBanner({ ubicacion, productId, version, available, layout }: { ubicacion: string | null; productId: string; version?: string | null; available: boolean; layout: "mobile" | "desktop" }) {
  const desktop = useSyncExternalStore(subscribeScreen, () => matchMedia("(min-width: 768px)").matches, () => false);
  const activeLayout = layout === (desktop ? "desktop" : "mobile");
  const container = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; url?: string; error?: MapPreviewError } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const src = `/api/products/${productId}/location-map?theme=${resolvedTheme === "dark" ? "dark" : "light"}&v=${encodeURIComponent(version ?? "")}`;
  const requestKey = `${src}:${attempt}`;
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
  }, [available, ubicacion, activeLayout]);
  useEffect(() => {
    if (!available || !visible || !activeLayout) return;
    const controller = new AbortController();
    let url: string | undefined;
    const timeout = setTimeout(() => controller.abort("timeout"), 15_000);
    async function load() {
      try {
        const response = await fetch(src, { signal: controller.signal });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          if (!controller.signal.aborted) setResult({ key: requestKey,
            error: mapPreviewError(response.status, body?.code, response.headers.get("Retry-After")) });
          return;
        }
        if (!response.headers.get("Content-Type")?.startsWith("image/png")) throw new Error("Invalid map image");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setResult({ key: requestKey, url });
      } catch {
        if (!controller.signal.aborted || controller.signal.reason === "timeout") {
          setResult({ key: requestKey, error: mapPreviewError(503) });
        }
      } finally { clearTimeout(timeout); }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timeout); if (url) URL.revokeObjectURL(url); };
  }, [available, visible, activeLayout, src, requestKey]);
  const current = result?.key === requestKey ? result : null;
  // Sin texto de zona ni mapa no hay nada que anunciar: antes se pintaban dos
  // lineas ("Ubicacion no indicada" y "La ubicacion es aproximada") que no
  // describian nada.
  if (!ubicacion && !available) return null;
  return <section ref={container} aria-labelledby={`ubicacion-${layout}`} className="w-full space-y-2">
    <h2 id={`ubicacion-${layout}`} className="font-heading text-lg font-bold text-fg">Ubicación</h2>
    {available && <div className="relative aspect-[32/9] overflow-hidden rounded-2xl bg-[var(--card-2)]">
      {visible && activeLayout && current?.url && <>
        {/* Native image preserves attribution and avoids a public optimizer cache. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt="Mapa de la zona aproximada de la publicación" width={1280} height={360}
          className="h-full w-full" onLoad={() => setLoaded(requestKey)} onError={() => setResult({ key: requestKey, error: mapPreviewError(503) })} />
        {loaded === requestKey && <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 h-[60%] -translate-x-1/2 -translate-y-1/2 aspect-square rounded-full border-2 border-[var(--brand-hi)] bg-[var(--brand-hi)]/20" />}
      </>}
      {activeLayout && current?.error && <PreviewFailure key={requestKey} error={current.error} onRetry={() => setAttempt(value => value + 1)} />}
    </div>}
    <p className="text-sm font-medium text-fg">{ubicacion || "Ubicación no indicada"}</p>
    {available && <p className="text-xs text-fg-muted">La ubicación es aproximada</p>}
  </section>;
}
