"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { SearchAutocompleteDropdown } from "@/components/search/search-autocomplete-dropdown";
import { DiscoveryFilters } from "@/components/shared/discovery-filters";
import { useSearchHistory } from "@/hooks/use-search-history";
import { UNIVERSITY_CATEGORY } from "@/lib/university";
import type { GeoPosition } from "@/lib/geo/location-storage";

interface SearchFiltersProps {
  viewerUniversity?: string | null;
  initialQuery?: string;
  initialCategory?: string;
  initialSort?: string;
  initialTipo?: string;
  initialPriceMin?: string;
  initialPriceMax?: string;
  initialPosition?: GeoPosition | null;
}

export function SearchFilters({
  initialQuery,
  initialCategory,
  initialSort,
  initialTipo,
  initialPriceMin,
  initialPriceMax,
  initialPosition,
  viewerUniversity,
}: SearchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const locationSource = `${initialPosition?.lat ?? ""},${initialPosition?.lng ?? ""},${initialPosition?.radius ?? ""}`;
  const [location, setLocation] = useState({ source: locationSource, value: initialPosition ?? null });
  // A confirmed URL/SSR zone wins over a previous client-side location event.
  if (location.source !== locationSource) setLocation({ source: locationSource, value: initialPosition ?? null });
  const effectivePosition = location.source === locationSource ? location.value : initialPosition ?? null;
  const committedQuery = initialQuery ?? "";
  const [input, setInput] = useState({ source: committedQuery, value: committedQuery });
  // Back/Forward or an external navigation wins over an old input draft.
  if (input.source !== committedQuery) setInput({ source: committedQuery, value: committedQuery });
  const query = input.source === committedQuery ? input.value : committedQuery;
  const setQuery = (value: string) => setInput({ source: committedQuery, value });
  const [isInputFocused, setIsInputFocused] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { history, addQuery, removeQuery, clearAll } = useSearchHistory();
  const showDropdown = isInputFocused && (history.length > 0 || query.trim().length > 0);

  // Compose with the last requested URL while the server confirms navigation,
  // so a quick search/Apply/location change cannot discard a pending filter.
  const [navegando, iniciarNavegacion] = useTransition();
  const pendienteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!navegando || searchParams.toString() === pendienteRef.current) pendienteRef.current = null;
  }, [navegando, searchParams]);

  const updateParams = useCallback((updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams(pendienteRef.current ?? searchParams.toString());
    if (!("page" in updates)) params.delete("page");
    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    const qs = params.toString();
    pendienteRef.current = qs;
    iniciarNavegacion(() => router.push(qs ? `/buscar?${qs}` : "/buscar"));
  }, [router, searchParams]);

  const updateParamsRef = useRef(updateParams);
  useEffect(() => { updateParamsRef.current = updateParams; }, [updateParams]);
  useEffect(() => () => clearTimeout(blurTimer.current), []);
  useEffect(() => {
    const locationChanged = (event: Event) => {
      const position = (event as CustomEvent<GeoPosition | null>).detail;
      if (position !== undefined) setLocation({ source: locationSource, value: position });
      const params = new URLSearchParams(pendienteRef.current ?? searchParams.toString());
      // An old explicit GPS link must not override a newly saved/cleared zone.
      if (params.has("lat") || params.has("lng") || params.has("radio")) {
        updateParamsRef.current({ lat: undefined, lng: undefined, radio: undefined });
      }
    };
    window.addEventListener("vicino_location_updated", locationChanged);
    return () => window.removeEventListener("vicino_location_updated", locationChanged);
  }, [locationSource, searchParams]);

  function handleSearchProducts(value: string) {
    const trimmed = value.trim();
    if (trimmed) addQuery(trimmed);
    setQuery(trimmed);
    setIsInputFocused(false);
    updateParams({ q: trimmed || undefined });
  }

  function handleHistorySelect(value: string) {
    setQuery(value);
    setIsInputFocused(false);
    updateParams({ q: value });
  }

  function handleSearchUsers(value: string) {
    const trimmed = value.trim();
    if (trimmed) addQuery(trimmed);
    setIsInputFocused(false);
    router.push(`/buscar/usuarios?q=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="w-full min-w-0 space-y-3" aria-busy={navegando}>
      <form onSubmit={(event) => { event.preventDefault(); handleSearchProducts(query); }} role="search">
        <div
          className="relative"
          onFocus={() => { clearTimeout(blurTimer.current); setIsInputFocused(true); }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            blurTimer.current = setTimeout(() => setIsInputFocused(false), 150);
          }}
        >
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[color:var(--brand-hi)]" />
          <input
            type="search"
            aria-label="Buscar en VICINO"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Busca en VICINO..."
            className="discovery-input pl-12 pr-4 text-sm placeholder:text-[color:var(--fg-muted)]"
          />
          {showDropdown && (
            <SearchAutocompleteDropdown
              query={query}
              history={history}
              onSelect={handleHistorySelect}
              onRemoveHistory={removeQuery}
              onClearHistory={clearAll}
              onSearchProducts={handleSearchProducts}
              onSearchUsers={handleSearchUsers}
            />
          )}
        </div>
      </form>
      <DiscoveryFilters
        value={{
          categories: initialCategory ? [initialCategory] : [],
          tipo: initialTipo === "producto" || initialTipo === "servicio" ? initialTipo : "",
          priceMin: initialPriceMin ?? "",
          priceMax: initialPriceMax ?? "",
          sort: initialSort,
          subcategory: searchParams.get("subcategory") ?? undefined,
        }}
        showSort
        showLocation
        initialPosition={effectivePosition}
        viewerUniversity={viewerUniversity}
        pending={navegando}
        onApply={(value) => updateParams({
          category: value.categories[0],
          subcategory: value.categories[0] === UNIVERSITY_CATEGORY ? value.subcategory : undefined,
          tipo: value.tipo || undefined,
          price_min: value.priceMin || undefined,
          price_max: value.priceMax || undefined,
          sort: value.sort && value.sort !== "newest" ? value.sort : undefined,
        })}
      />
    </div>
  );
}
