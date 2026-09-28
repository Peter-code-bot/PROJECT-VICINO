"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  SlidersHorizontal,
  X,
  Navigation,
  Loader2,
} from "lucide-react";
import { ListingTypeSwitch } from "@/components/search/listing-type-switch";
import type { ListingType } from "@/components/search/listing-type-switch";
import { SearchAutocompleteDropdown } from "@/components/search/search-autocomplete-dropdown";
import { FiltroCategoriasDrawer } from "@/components/shared/filtro-categorias-drawer";
import { useSearchHistory } from "@/hooks/use-search-history";



interface SearchFiltersProps {
  viewerUniversity?: string | null;
  initialQuery?: string;
  initialCategory?: string;
  initialSort?: string;
  initialTipo?: string;
  initialPriceMin?: string;
  initialPriceMax?: string;
  initialLat?: string;
}

export function SearchFilters({
  initialQuery,
  initialCategory,
  initialSort,
  initialTipo,
  initialPriceMin,
  initialPriceMax,
  initialLat,
  viewerUniversity,
}: SearchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { history, addQuery, removeQuery, clearAll } = useSearchHistory();
  const showDropdown = isInputFocused && (history.length > 0 || query.trim().length > 0);

  // URL PEDIDA Y AUN NO CONFIRMADA. useSearchParams devuelve la URL ya
  // confirmada, y mientras el servidor renderiza la nueva sigue siendo la vieja:
  // teclear un precio y tocar el orden antes de que confirme construia la URL
  // del orden sin el precio (la lista quedaba sin filtrar con el 100 a la
  // vista). Se parte de la pedida; se limpia al confirmar o cuando no queda
  // navegacion en curso (una ajena, como paginar o Atras, la reemplazo).
  const [navegando, iniciarNavegacion] = useTransition();
  const pendienteRef = useRef<string | null>(null);
  useEffect(() => {
    if (!navegando || searchParams.toString() === pendienteRef.current) pendienteRef.current = null;
  }, [navegando, searchParams]);

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(pendienteRef.current ?? searchParams.toString());
      // Cambiar cualquier filtro vuelve a la pagina 1 (S06). Precio, orden y
      // ubicacion no lo hacian: en la pagina 3, un precio que deja una sola
      // pagina mostraba «Página 3 de 1» y la lista vacia. La paginacion no pasa
      // por aqui (son enlaces de page.tsx), asi que esto solo toca filtros.
      if (!("page" in updates)) params.delete("page");
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      const qs = params.toString();
      pendienteRef.current = qs;
      const url = `/buscar?${qs}`;
      // Siempre push: un replace diferido (el del precio) descartaba cualquier
      // push que siguiera en vuelo y su entrada de historial.
      iniciarNavegacion(() => router.push(url));
    },
    [router, searchParams]
  );

  // Las esperas asincronas (temporizador del precio, respuesta del GPS) llaman
  // siempre al updateParams MAS RECIENTE, no al que existia cuando empezaron
  // (ese partiria de una URL vieja y perderia lo aplicado mientras tanto).
  const updateParamsRef = useRef(updateParams);
  useEffect(() => {
    updateParamsRef.current = updateParams;
  }, [updateParams]);
  // Una respuesta del GPS que llega con el componente ya desmontado no navega.
  const montadoRef = useRef(true);
  useEffect(() => {
    montadoRef.current = true;
    return () => {
      montadoRef.current = false;
    };
  }, []);

  // PRECIO CON ESPERA Y ACUMULADO. Antes cada tecla era una navegacion (un
  // render de servidor y hasta una entrada de historial por digito). Se espera
  // medio segundo sin teclear y se aplican juntos minimo y maximo: pasar de un
  // campo al otro no cancela el primero. Una sola entrada de historial por
  // cambio de precio.
  const preciosPendientes = useRef<Record<string, string | undefined>>({});
  const temporizadorPrecio = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(temporizadorPrecio.current), []);
  function cambiarPrecio(clave: "price_min" | "price_max", valor: string) {
    preciosPendientes.current = { ...preciosPendientes.current, [clave]: valor || undefined };
    clearTimeout(temporizadorPrecio.current);
    temporizadorPrecio.current = setTimeout(() => {
      const cambios = preciosPendientes.current;
      preciosPendientes.current = {};
      updateParamsRef.current(cambios);
    }, 500);
  }

  function handleHistorySelect(item: string) {
    setQuery(item);
    setIsInputFocused(false);
    updateParams({ q: item, page: undefined });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    handleSearchProducts(query);
  }

  function handleSearchProducts(q: string) {
    const trimmed = q.trim();
    if (trimmed) addQuery(trimmed);
    setQuery(trimmed);
    setIsInputFocused(false);
    updateParams({ q: trimmed || undefined, page: undefined });
  }

  function handleSearchUsers(q: string) {
    const trimmed = q.trim();
    if (trimmed) addQuery(trimmed);
    setIsInputFocused(false);
    // Option A: Redirect to the user search page
    router.push(`/buscar/usuarios?q=${encodeURIComponent(trimmed)}`);
  }

  function handleGeo() {
    // Antes fallaba en silencio: el spinner se apagaba y no pasaba nada.
    if (!navigator.geolocation) {
      toast.error("No pudimos obtener tu ubicación.");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false);
        if (!montadoRef.current) return;
        // 4 decimales (~11 m), como la tarjeta de activar ubicacion: la
        // precision completa del GPS no aporta nada y queda en la URL.
        updateParamsRef.current({
          lat: pos.coords.latitude.toFixed(4),
          lng: pos.coords.longitude.toFixed(4),
          radio: "5000",
        });
      },
      () => {
        setGeoLoading(false);
        if (montadoRef.current) toast.error("No pudimos obtener tu ubicación.");
      },
      { timeout: 8000, maximumAge: 300_000 }
    );
  }

  function clearGeo() {
    updateParams({ lat: undefined, lng: undefined, radio: undefined });
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        {/* Focus tracking lives on the wrapper (not the input) so keyboard
            users tabbing into history-item buttons keep the dropdown open.
            React's synthetic onFocus/onBlur bubble like focusin/focusout, so
            this catches both the input and the dropdown buttons. */}
        <div
          className="relative flex-1"
          onFocus={() => setIsInputFocused(true)}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            // Short delay covers the mouse path on browsers where
            // relatedTarget is null on click (older Safari, etc.).
            setTimeout(() => setIsInputFocused(false), 150);
          }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--brand-hi)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca en VICINO..."
            className="w-full rounded-2xl product-card-custom pl-10 pr-4 py-2.5 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--fg-dim)] outline-none transition-colors focus:opacity-90"
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
        <button
          type="button"
          onClick={handleGeo}
          disabled={geoLoading}
          title="Cerca de mí"
          className="flex h-[40px] items-center gap-2 rounded-xl product-card-custom px-4 text-sm font-medium transition-colors hover:opacity-90 disabled:opacity-50"
        >
          {geoLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--brand-hi)]" />
          ) : (
            <Navigation className="h-4 w-4 text-[color:var(--brand-hi)]" />
          )}
          <span className="hidden sm:inline">Cerca</span>
        </button>
        {/* En movil el texto va oculto y el icono es aria-hidden: sin aria-label
            el lector de pantalla anunciaba solo «botón» (WCAG 4.1.2). */}
        <button
          type="button"
          aria-label="Filtros"
          aria-expanded={showFilters}
          aria-controls={showFilters ? "buscar-filtros" : undefined}
          onClick={() => setShowFilters((v) => !v)}
          className="flex h-[40px] items-center gap-2 rounded-xl product-card-custom px-4 text-sm font-medium transition-colors hover:opacity-90"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filtros</span>
        </button>
      </form>

      {/* Badge de resultados cercanos activos */}
      {initialLat && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brand-tint-strong)] px-3 py-1 text-xs font-medium text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
            <Navigation className="w-3 h-3" />
            Resultados cercanos
            <button onClick={clearGeo} className="ml-1 hover:text-[color:var(--brand)]" aria-label="Quitar filtro de ubicación">
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Filtro de categoria. La pagina solo lee UN `category` de la URL
          (params.category en page.tsx), asi que el modo es "una": mandarle un
          segundo slug se perderia sin decirlo. El `page: undefined` va porque
          el numero de pagina de la busqueda anterior no sobrevive al cambio de
          filtro: dejarlo aterriza en una pagina vacia con resultados de sobra
          en la primera. */}
      <div className="flex items-center">
        <FiltroCategoriasDrawer
          viewerUniversity={viewerUniversity}
          seleccionadas={initialCategory ? [initialCategory] : []}
          modo="una"
          onAplicar={(slugs) =>
            // subcategory solo vale dentro de "universidad" (Ver todo de Home);
            // al cambiar la categoria se limpia para no dejar una combinacion
            // imposible en la URL.
            updateParams({ category: slugs[0], subcategory: undefined, page: undefined })
          }
        />
      </div>

      {/* Listing type switch */}
      <div className="flex justify-center">
        <ListingTypeSwitch
          value={initialTipo as ListingType | undefined}
          onChange={(t) =>
            updateParams({ tipo: t ?? undefined, page: undefined })
          }
        />
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div id="buscar-filtros" className="space-y-4 rounded-2xl bg-[color:var(--card)] p-4 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[color:var(--fg)]">Filtros</span>
            <button
              onClick={() => setShowFilters(false)}
              className="text-[color:var(--fg-muted)] transition-colors hover:text-[color:var(--fg)]"
              aria-label="Cerrar filtros"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Price range */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-dim)]">
              Precio (MXN)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Mín"
                defaultValue={initialPriceMin}
                onChange={(e) => cambiarPrecio("price_min", e.target.value)}
                className="w-24 rounded-md bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              />
              <span className="text-[color:var(--fg-dim)]">—</span>
              <input
                type="number"
                placeholder="Máx"
                defaultValue={initialPriceMax}
                onChange={(e) => cambiarPrecio("price_max", e.target.value)}
                className="w-24 rounded-md bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              />
            </div>
          </div>

          {/* Sort */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-dim)]">
              Ordenar por
            </label>
            <select
              value={initialSort ?? "newest"}
              onChange={(e) =>
                updateParams({
                  sort:
                    e.target.value === "newest" ? undefined : e.target.value,
                })
              }
              className="w-full rounded-md bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              <option value="newest">Más recientes</option>
              <option value="price_asc">Precio: menor a mayor</option>
              <option value="price_desc">Precio: mayor a menor</option>
              <option value="most_sold">Más vendidos</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
