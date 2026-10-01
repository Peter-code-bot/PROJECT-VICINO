"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, X, ArrowRight, MapPin } from "lucide-react";
import { MAP_AREA, type MapBounds, type MapFeature, type MapQuery } from "@vicino/shared";
import { PublicationMap } from "@/components/map/publication-map";
import { PublicationResultsDrawer } from "@/components/map/publication-results-drawer";
import { ZoneCard } from "@/components/home/zone-card";
import { DiscoveryFilters, type DiscoveryFilterValues } from "@/components/shared/discovery-filters";
import { useSessionUI } from "@/components/layout/session-data-provider";
import { usePublicationCoverage } from "@/hooks/use-publication-coverage";
import { useCoverageListings } from "@/hooks/use-coverage-listings";
import { boundsAround, intersectMapBounds, queryFromMapParams } from "@/lib/geo/publication-map";
import { clusterMapCells, publicDistance } from "@/lib/geo/map-coverage";

type Center = { lat: number; lng: number };
interface SelectedGroup { feature: MapFeature; query: MapQuery; center: Center | null; revision: string }
interface MapUI { query: MapQuery; viewport: MapBounds; center: Center | null; locationCenter: Center | null; storedCenter: Center | null; selected: SelectedGroup | null; hasSavedLocation: boolean }
const EMPTY: MapFeature[] = [];

function searchHref(query: MapQuery) {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.categories.length === 1) params.set("category", query.categories[0]!);
  if (query.tipo) params.set("tipo", query.tipo);
  if (query.price_min !== null) params.set("price_min", String(query.price_min));
  if (query.price_max !== null) params.set("price_max", String(query.price_max));
  if (query.mode === "nearby" && query.center) { params.set("lat", String(query.center.lat)); params.set("lng", String(query.center.lng)); params.set("radio", String(query.radius_meters)); }
  return "/buscar" + (params.size ? "?" + params : "");
}

export function MapExplorer({ initialQuery, initialCenter, initialSavedCenter = null, initialHasSavedLocation = false, viewerScope }: { initialQuery: MapQuery; initialCenter: Center | null; initialSavedCenter?: Center | null; initialHasSavedLocation?: boolean; viewerScope: string }) {
  const [ui, setUI] = useSessionUI<MapUI>("publication-map:v2:" + viewerScope + ":" + JSON.stringify(initialQuery), {
    query: initialQuery, viewport: initialQuery.bounds, center: initialCenter, locationCenter: initialCenter, storedCenter: initialSavedCenter, selected: null, hasSavedLocation: initialHasSavedLocation,
  });
  const [focus, setFocus] = useState<{ bounds: MapBounds; revision: number } | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const latest = useRef(ui);
  const input = useRef<HTMLInputElement>(null);
  const fallbackFocus = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => { latest.current = ui; }, [ui]);
  const area = useMemo(() => intersectMapBounds(ui.viewport), [ui.viewport]);
  const { data, pending, error, retry } = usePublicationCoverage({ ...ui.query, bounds: area ?? MAP_AREA }, ui.center, viewerScope);
  const detail = useCoverageListings(ui.selected?.query ?? ui.query, ui.selected ? ui.selected.center : ui.center, ui.selected?.feature.id ?? null, ui.selected?.revision ?? null);
  const features = useMemo(() => area && data ? data.complete ? clusterMapCells(data.cells, area) : data.features : EMPTY, [data, area]);

  function publishQuery(query: MapQuery) {
    const params = new URLSearchParams(window.location.search);
    for (const key of ["q", "category", "tipo", "price_min", "price_max", "lat", "lng", "radio"]) params.delete(key);
    if (query.q) params.set("q", query.q);
    if (query.categories.length) params.set("category", query.categories.join(","));
    if (query.tipo) params.set("tipo", query.tipo);
    if (query.price_min !== null) params.set("price_min", String(query.price_min));
    if (query.price_max !== null) params.set("price_max", String(query.price_max));
    if (query.mode === "nearby" && query.center) { params.set("lat", String(query.center.lat)); params.set("lng", String(query.center.lng)); params.set("radio", String(query.radius_meters)); }
    window.history.replaceState(window.history.state, "", window.location.pathname + (params.size ? "?" + params : ""));
  }
  function updateQuery(patch: Partial<MapQuery>) {
    const previous = latest.current;
    const next = { ...previous, selected: null, query: { ...previous.query, ...patch, cell_id: null, cursor: null } };
    latest.current = next; setUI(next); publishQuery(next.query);
  }
  function applyFilters(value: DiscoveryFilterValues) {
    updateQuery({ categories: value.categories, tipo: value.tipo || null, price_min: value.priceMin === "" ? null : Number(value.priceMin), price_max: value.priceMax === "" ? null : Number(value.priceMax),
      mode: value.nearby && ui.locationCenter ? "nearby" : "zone", center: value.nearby ? ui.locationCenter : null, radius_meters: value.radiusMeters ?? ui.query.radius_meters });
  }
  useEffect(() => {
    const changed = (event: Event) => {
      const location = (event as CustomEvent<(Center & { radius?: number }) | null>).detail;
      const previous = latest.current;
      const center = location && Number.isFinite(location.lat) && Number.isFinite(location.lng) ? { lat: location.lat, lng: location.lng } : null;
      const radius = location?.radius ?? previous.query.radius_meters;
      const bounds = center ? intersectMapBounds(boundsAround(center, radius)) ?? MAP_AREA : MAP_AREA;
      const next: MapUI = { ...previous, center, locationCenter: center, storedCenter: center, hasSavedLocation: center !== null, viewport: bounds, selected: null,
        query: { ...previous.query, center: center && previous.query.mode === "nearby" ? center : null, mode: center ? previous.query.mode : "zone", radius_meters: radius, cell_id: null, cursor: null } };
      latest.current = next; setUI(next); setFocus({ bounds, revision: Date.now() }); publishQuery(next.query);
    };
    const restoreHistory = () => {
      const previous = latest.current;
      const params = Object.fromEntries(new URLSearchParams(window.location.search));
      const query = queryFromMapParams(params, previous.storedCenter, previous.query.radius_meters);
      const position = query.mode === "nearby" ? query.center : previous.storedCenter;
      const positionChanged = JSON.stringify(position) !== JSON.stringify(previous.locationCenter);
      const next: MapUI = { ...previous, query, selected: null, locationCenter: position,
        center: positionChanged ? position : previous.center, viewport: positionChanged ? query.bounds : previous.viewport };
      latest.current = next; setUI(next);
      if (positionChanged) setFocus({ bounds: query.bounds, revision: Date.now() });
    };
    window.addEventListener("vicino_location_updated", changed);
    window.addEventListener("popstate", restoreHistory);
    return () => { window.removeEventListener("vicino_location_updated", changed); window.removeEventListener("popstate", restoreHistory); };
    // The listener deliberately reads the latest camera/query from the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function onBounds(viewport: MapBounds) {
    const previous = latest.current;
    if (JSON.stringify(viewport) === JSON.stringify(previous.viewport)) return;
    const clipped = intersectMapBounds(viewport);
    let center = previous.center;
    if (clipped) {
      const camera = { lat: (clipped.north + clipped.south) / 2, lng: (clipped.east + clipped.west) / 2 };
      const diagonal = publicDistance({ lat: clipped.south, lng: clipped.west }, { lat: clipped.north, lng: clipped.east });
      const loadedCenter = center;
      const covered = loadedCenter && [[clipped.south, clipped.west], [clipped.south, clipped.east], [clipped.north, clipped.west], [clipped.north, clipped.east]]
        .every(([lat, lng]) => publicDistance(loadedCenter, { lat: lat!, lng: lng! }) <= 50_000);
      // A broad viewport needs the complete overview, rather than holes outside
      // the local circle. A local viewport only recenters after leaving it.
      if (diagonal > 85_000) center = null;
      else if (!center || !covered) center = camera;
    }
    const next = { ...previous, viewport, center };
    latest.current = next; setUI(next);
  }
  function select(feature: MapFeature) {
    if (!data) return;
    const active = document.activeElement;
    returnFocus.current = active instanceof HTMLElement && active.matches("button,a,input,[tabindex]") ? active : null;
    const previous = latest.current;
    const next = { ...previous, selected: { feature, query: { ...previous.query, cell_id: null, cursor: null }, center: previous.center, revision: data.revision } };
    latest.current = next; setUI(next);
  }
  function closeDrawer() { const next = { ...latest.current, selected: null }; latest.current = next; setUI(next); }
  const filterValues: DiscoveryFilterValues = { categories: ui.query.categories, tipo: ui.query.tipo ?? "", priceMin: ui.query.price_min === null ? "" : String(ui.query.price_min), priceMax: ui.query.price_max === null ? "" : String(ui.query.price_max), nearby: ui.query.mode === "nearby", radiusMeters: ui.query.radius_meters };

  return <div ref={fallbackFocus} tabIndex={-1} role="region" aria-label="Explorar publicaciones en el mapa" className="mx-auto w-full max-w-7xl space-y-3 px-3 py-3 sm:px-5 focus-visible:outline-2 focus-visible:outline-[color:var(--fg)]" data-navigation-kind="map" data-no-page-swipe data-no-pull-to-refresh>
    <h1 className="sr-only">Explorar publicaciones en el mapa</h1>
    <label className="flex min-h-12 items-center gap-3 rounded-2xl bg-[color:var(--sidebar-bg)] px-4 text-[color:var(--fg)] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[color:var(--fg)]"><Search className="h-5 w-5 shrink-0" /><span className="sr-only">Buscar publicaciones o vendedores</span><input ref={input} type="search" maxLength={120} value={ui.query.q} onChange={event => updateQuery({ q: event.target.value })} placeholder="Busca comida, clases, regalos…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-[color:var(--fg)]/70" />{ui.query.q && <button aria-label="Limpiar búsqueda" type="button" onClick={() => updateQuery({ q: "" })} className="min-h-11 min-w-11 rounded-xl focus-visible:outline-2"><X className="mx-auto h-4 w-4" /></button>}</label>
    <DiscoveryFilters value={filterValues} onApply={applyFilters} multipleCategories showDistance={ui.locationCenter !== null} />
    <div className="flex min-h-11 items-center justify-between gap-2"><ZoneCard hayUbicacionEnServidor={ui.hasSavedLocation} resolveName={false} positionOverride={ui.locationCenter} selected={ui.locationCenter !== null} /><Link href={searchHref(ui.query)} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-[color:var(--fg)]">Ver búsqueda<ArrowRight className="h-4 w-4" /></Link></div>
    <div className="relative h-[calc(100dvh-260px-var(--bottom-nav-h))] min-h-[340px] md:h-[calc(100dvh-260px)] md:min-h-[440px]">
      <PublicationMap initialBounds={ui.viewport} focus={focus} features={features} selected={ui.selected?.feature.id ?? null} onBounds={onBounds} onSelect={select} onAvailabilityChange={available => setMapFailed(!available)} />
      <div role="status" className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-24px)] rounded-2xl bg-[color:var(--sidebar-bg)] px-3 py-2 text-xs text-[color:var(--fg)] shadow-sm">{!area ? "Elige una zona de México" : data ? data.total + " publicaciones · " + data.seller_total + " vendedores" + (pending ? " · Actualizando…" : "") : pending ? "Cargando publicaciones…" : "Explora una zona en el mapa"}</div>
      {data && !data.complete && ui.center && <span className="absolute bottom-8 left-3 rounded-xl bg-[color:var(--sidebar-bg)] px-3 py-2 text-xs" role="status">Vista general de la zona</span>}
      {mapFailed && <Link href={searchHref(ui.query)} className="discovery-control absolute bottom-8 inset-x-4 text-center">Ver publicaciones de esta zona<ArrowRight className="h-4 w-4" /></Link>}
    </div>
    {error && <p role="alert" className="flex flex-wrap items-center gap-2 text-sm">{error}<button type="button" onClick={retry} className="discovery-control">Reintentar publicaciones</button></p>}
    {features.length > 0 && <details className="rounded-2xl bg-[color:var(--sidebar-bg)] px-4 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">Puntos del mapa</summary><p className="pb-2 text-xs">Cada punto agrupa publicaciones con ubicación aproximada.</p><div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto overscroll-contain pb-3 sm:grid-cols-3">{features.map((feature, index) => <button key={feature.id} type="button" onClick={() => select(feature)} className="discovery-control justify-start text-left"><MapPin className="h-4 w-4 shrink-0" /><span>Punto {index + 1} · {feature.count} {feature.count === 1 ? "publicación" : "publicaciones"}</span></button>)}</div></details>}
    {!pending && data?.total === 0 && <p role="status" className="text-sm">Aún no hay publicaciones aquí. Mueve el mapa o prueba otros filtros.</p>}
    <p className="text-xs text-[color:var(--fg)]">Ubicaciones aproximadas. {ui.query.mode === "nearby" ? "Resultados dentro de " + ui.query.radius_meters / 1000 + " km de la ubicación elegida." : ui.center ? "Puedes moverte por la zona y tocar un punto para ver sus publicaciones." : "Vista de México; acércate a una zona para explorar sus puntos."}</p>
    <PublicationResultsDrawer feature={ui.selected?.feature ?? null} data={detail.data ?? null} pending={detail.pending} error={detail.error ?? null} onClose={closeDrawer} onRetry={detail.retry} onLoadMore={detail.loadMore} returnFocus={returnFocus} fallbackFocus={fallbackFocus} />
  </div>;
}
